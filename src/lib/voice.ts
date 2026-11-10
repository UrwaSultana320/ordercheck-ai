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
  stop?(): void;
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
  private ending = false;
  private executing = false;
  private blocked = false;
  private unsupportedReported = false;
  private listeningTimer?: ReturnType<typeof setTimeout>;
  private speechTimer?: ReturnType<typeof setTimeout>;
  private current: SpeechJob | null = null;
  private queue: SpeechJob[] = [];
  private epoch = 0;
  constructor(
    private host: VoiceHost,
    private events: {
      command: (command: Command) => void | Promise<void>;
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
    // Keep recognition alive for Stop / Stop speaking barge-in.
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
      else this.scheduleRecognition();
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
    if (resume) this.scheduleRecognition();
  }
  startListening(explicit = true) {
    if (!this.host.recognition) {
      if (!this.unsupportedReported) {
        this.unsupportedReported = true;
        this.events.error("Voice commands aren't available in this browser. You can still use the controls on screen.");
      }
      return;
    }
    if (!this.host.active()) return;
    // Only an explicit retry may recover a fatal/service failure.
    if (explicit) this.blocked = false;
    if (this.blocked) return;
    this.listeningIntent = true;
    this.resumeRecognition();
  }
  private scheduleRecognition() {
    clearTimeout(this.listeningTimer);
    if (!this.listeningIntent || this.blocked || !this.host.active()) return;
    this.listeningTimer = setTimeout(() => this.resumeRecognition(), 250);
  }
  private resumeRecognition() {
    if (!this.listeningIntent || this.blocked || this.rec || this.executing || !this.host.active()) return;
    clearTimeout(this.listeningTimer);
    const Constructor = this.host.recognition;
    if (!Constructor) return;
    const rec = new Constructor();
    this.rec = rec;
    this.ending = false;
    rec.lang = "en-US";
    rec.continuous = false;
    rec.interimResults = false;
    rec.onstart = () => {
      if (this.rec === rec && !this.ending) this.events.listening(true);
    };
    rec.onerror = (e) => {
      if (this.rec !== rec || this.ending) return;
      if (e.error === "no-speech") return; // onend schedules the next session.
      this.blocked = true;
      this.stopListening();
      this.events.error(
        ["not-allowed", "service-not-allowed"].includes(e.error)
          ? "Microphone permission is needed for voice commands. Allow microphone access and try again."
          : `Voice commands stopped (${e.error}). Check your connection and microphone, then use Start listening to try again.`,
      );
    };
    rec.onend = () => {
      if (this.rec !== rec) return;
      this.rec = null;
      this.ending = false;
      this.events.listening(false);
      this.scheduleRecognition();
    };
    rec.onresult = (e) => {
      if (this.rec !== rec || this.ending || this.executing || !this.listeningIntent || !this.host.active()) return;
      for (let i = e.resultIndex; i < e.results.length; i++) {
        if (!e.results[i].isFinal) continue;
        const command = commandFrom(e.results[i][0].transcript);
        // Narration may contain Next or Finish. Only interruption commands
        // are safe while an utterance (including queued speech) is active.
        if (this.current && command !== "stop" && command !== "stop speaking") continue;
        if (!command) {
          this.events.error("Command not recognized. Use Start, Stop, Repeat, Next, Finish, Help or Retry, or the controls below.");
          break;
        }
        if (command === "stop speaking") {
          this.cancelSpeech();
          this.events.command(command);
          break;
        }
        if (command === "stop") {
          this.stop();
          this.events.command(command);
          break;
        }
        this.executing = true;
        this.pauseRecognition();
        // Preserve intent across command handling. Navigation/Stop can still
        // explicitly end it. Wait for asynchronous commands before restarting.
        void this.executeCommand(command);
        break;
      }
    };
    try {
      rec.start();
    } catch {
      this.blocked = true;
      this.stopListening();
      this.events.error("Could not start voice commands. Check microphone permissions and use Start listening to try again.");
    }
  }
  private async executeCommand(command: Command) {
    try {
      await this.events.command(command);
    } catch {
      this.events.error("The voice command could not be completed. Try again or use the controls on screen.");
    } finally {
      this.executing = false;
      this.scheduleRecognition();
    }
  }
  private pauseRecognition() {
    const rec = this.rec;
    this.events.listening(false);
    if (rec && !this.ending) {
      // Retain the instance until its asynchronous onend. Never overlap
      // an aborting recognizer with a newly started one.
      this.ending = true;
      try {
        rec.abort();
      } catch {
        this.blocked = true;
        this.listeningIntent = false;
        this.events.error("Voice commands could not stop safely. Reload the page to try again.");
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
