import { commandFrom, type Command } from "./session";

type RecognitionResult = {
  resultIndex: number;
  results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }>;
};
export interface Recognition {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onstart: (() => void) | null;
  onend: (() => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onresult: ((e: RecognitionResult) => void) | null;
  start(): void;
  abort(): void;
}
type SpeechJob = { text: string; priority: number; done: () => void };
export type VoiceHost = {
  recognition?: new () => Recognition;
  synthesis?: Pick<SpeechSynthesis, "speak" | "cancel">;
  utterance: (text: string) => SpeechSynthesisUtterance;
  active: () => boolean;
};
export class VoiceController {
  enabled = false;
  rate = 0.95;
  private rec: Recognition | null = null;
  private listeningIntent = false;
  private deadline = 0;
  private resumes = 0;
  private listeningTimer?: ReturnType<typeof setTimeout>;
  private speechTimer?: ReturnType<typeof setTimeout>;
  private current: SpeechJob | null = null;
  private queue: SpeechJob[] = [];
  private epoch = 0;
  constructor(
    private host: VoiceHost,
    private events: {
      command: (command: Command) => void;
      listening: (value: boolean) => void;
      speaking: (value: boolean) => void;
      error: (message: string) => void;
    },
  ) {}
  say(text: string, priority = 1, explicit = false): Promise<void> {
    if ((!this.enabled && !explicit) || !this.host.active()) return Promise.resolve();
    if (!this.host.synthesis) {
      this.events.error(
        "Spoken guidance is unavailable in this browser. Guidance remains displayed as text.",
      );
      return Promise.resolve();
    }
    if (this.current?.text === text || this.queue.some((j) => j.text === text))
      return Promise.resolve();
    if (this.current && priority > this.current.priority)
      this.cancelSpeech(false);
    return new Promise((resolve) => {
      this.queue.push({ text, priority, done: resolve });
      this.queue.sort((a, b) => b.priority - a.priority);
      this.pump();
    });
  }
  private pump() {
    if (this.current || !this.queue.length) return;
    this.pauseRecognition();
    const job = this.queue.shift()!;
    this.current = job;
    const epoch = ++this.epoch;
    const finish = (failed = false) => {
      if (this.epoch !== epoch) return;
      clearTimeout(this.speechTimer);
      this.events.speaking(false);
      this.current = null;
      job.done();
      if (failed)
        this.events.error(
          "Spoken guidance was unavailable. The same guidance is displayed as text; use Repeat to try again.",
        );
      if (this.queue.length) this.pump();
      else this.resumeRecognition();
    };
    try {
      const speech = this.host.utterance(job.text);
      speech.rate = this.rate;
      speech.onstart = () => {
        if (epoch === this.epoch) this.events.speaking(true);
      };
      speech.onend = () => finish();
      speech.onerror = () => finish(true);
      this.speechTimer = setTimeout(() => {
        this.host.synthesis?.cancel();
        finish(true);
      }, 45000);
      this.host.synthesis!.speak(speech);
    } catch {
      finish(true);
    }
  }
  cancelSpeech(resume = true) {
    this.epoch++;
    clearTimeout(this.speechTimer);
    this.host.synthesis?.cancel();
    this.events.speaking(false);
    this.current?.done();
    this.current = null;
    this.queue.forEach((j) => j.done());
    this.queue = [];
    if (resume) this.resumeRecognition();
  }
  startListening() {
    this.stopListening();
    if (!this.host.recognition) {
      this.events.error(
        "Voice commands are unavailable in this browser. Use the named buttons and keyboard controls.",
      );
      return;
    }
    if (!this.host.active()) return;
    this.listeningIntent = true;
    this.deadline = Date.now() + 15000;
    this.resumes = 0;
    this.listeningTimer = setTimeout(() => this.stopListening(), 15000);
    this.resumeRecognition();
  }
  private resumeRecognition() {
    if (
      !this.listeningIntent ||
      this.rec ||
      this.current ||
      !this.host.active() ||
      Date.now() >= this.deadline ||
      this.resumes >= 4
    )
      return;
    const Constructor = this.host.recognition;
    if (!Constructor) return;
    const rec = new Constructor();
    this.rec = rec;
    this.resumes++;
    rec.lang = "en-US";
    rec.continuous = false;
    rec.interimResults = false;
    rec.onstart = () => {
      if (this.rec === rec) this.events.listening(true);
    };
    rec.onerror = (e) => {
      if (this.rec !== rec) return;
      this.stopListening();
      this.events.error(
        `Voice command service stopped (${e.error}). Use controls or explicitly start another listening window. Some browsers need a network connection.`,
      );
    };
    rec.onend = () => {
      if (this.rec === rec) {
        this.rec = null;
        this.events.listening(false);
        this.listeningIntent = false;
        clearTimeout(this.listeningTimer);
      }
    };
    rec.onresult = (e) => {
      if (this.rec !== rec || this.current || !this.host.active()) return;
      for (let i = e.resultIndex; i < e.results.length; i++) {
        if (!e.results[i].isFinal) continue;
        const command = commandFrom(e.results[i][0].transcript);
        this.stopListening();
        if (command) this.events.command(command);
        else
          this.events.error(
            "Command not recognized. Use Start, Stop, Repeat, Next, Help or Retry, or the controls below.",
          );
        break;
      }
    };
    try {
      rec.start();
    } catch {
      this.stopListening();
      this.events.error(
        "Could not start voice commands. Check microphone permissions or use the controls.",
      );
    }
  }
  private pauseRecognition() {
    const rec = this.rec;
    this.rec = null;
    this.events.listening(false);
    if (rec) {
      rec.onresult = null;
      rec.onend = null;
      rec.onerror = null;
      rec.onstart = null;
      try {
        rec.abort();
      } catch {
        /* Already ended. */
      }
    }
  }
  stopListening() {
    this.listeningIntent = false;
    clearTimeout(this.listeningTimer);
    this.pauseRecognition();
  }
  stop() {
    this.stopListening();
    this.cancelSpeech(false);
  }
}
export function browserVoiceHost(): VoiceHost {
  const browser = window as typeof window & {
    SpeechRecognition?: new () => Recognition;
    webkitSpeechRecognition?: new () => Recognition;
  };
  return {
    recognition: browser.SpeechRecognition ?? browser.webkitSpeechRecognition,
    synthesis: browser.speechSynthesis,
    utterance: (text) => new SpeechSynthesisUtterance(text),
    active: () => document.visibilityState === "visible",
  };
}
