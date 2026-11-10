import { maxOrderAudioBytes, maxOrderRecordingMs, orderAudioExtension, orderAudioFormats } from "./order-audio";
import type { TranscriptionProvider } from "./order-transcription";

export type OrderRecordingHost = {
  recorder?: typeof MediaRecorder;
  microphone?: () => Promise<MediaStream>;
  upload: typeof fetch;
  active(): boolean;
};

/** One explicit, bounded recording. Audio lives only in this request's memory. */
export class RecordedOrderTranscription implements TranscriptionProvider {
  private cancelCurrent?: () => void;
  private finishCurrent?: () => void;
  constructor(private host: OrderRecordingHost) {}
  start(events: Parameters<TranscriptionProvider["start"]>[0], limitMs = maxOrderRecordingMs) {
    this.cancel();
    const Recorder = this.host.recorder;
    if (!Recorder || !this.host.microphone) { events.error("Audio recording is unavailable in this browser. Type your order below."); return; }
    const mimeType = typeof Recorder.isTypeSupported === "function" ? orderAudioFormats.find(type => Recorder.isTypeSupported(type)) : undefined;
    if (!mimeType) { events.error("This browser has no supported order audio format. Type your order below."); return; }
    if (!this.host.active()) { events.error("Return to this page to start recording."); return; }
    let active = true, stopping = false, transcribing = false, bytes = 0;
    let stream: MediaStream | undefined, recorder: MediaRecorder | undefined;
    let chunks: Blob[] = [];
    let timer: ReturnType<typeof setTimeout>;
    const controller = new AbortController();
    const releaseMicrophone = () => { stream?.getTracks().forEach(track => track.stop()); stream = undefined; };
    const dispose = () => {
      active = false; clearTimeout(timer); controller.abort();
      if (recorder) {
        recorder.ondataavailable = recorder.onstop = recorder.onerror = null;
        try { if (recorder.state !== "inactive") recorder.stop(); } catch { /* already stopped */ }
        recorder = undefined;
      }
      releaseMicrophone(); chunks = [];
      if (this.cancelCurrent === dispose) { this.cancelCurrent = undefined; this.finishCurrent = undefined; }
    };
    const fail = (message: string) => { if (active) { dispose(); events.error(message); } };
    const transcribe = async () => {
      if (!active || transcribing) return;
      transcribing = true;
      clearTimeout(timer); releaseMicrophone();
      const type = recorder?.mimeType || mimeType;
      const extension = orderAudioExtension(type);
      if (!bytes) { fail("The recording is empty. Record your order again or type it below."); return; }
      if (!extension) { fail("The recorded audio format is unsupported. Type your order below."); return; }
      const body = new FormData();
      body.append("audio", new Blob(chunks, { type }), `order.${extension}`);
      chunks = [];
      events.transcribing?.();
      if (!active) return;
      timer = setTimeout(() => fail("Transcription timed out. Try recording again or type your order."), 45000);
      try {
        const response = await this.host.upload("/api/order-transcription", { method: "POST", body, signal: controller.signal, credentials: "same-origin", cache: "no-store" });
        if (!active) return;
        let data: unknown;
        try { data = await response.json(); } catch { throw new Error("The transcription server returned a malformed response. Try again or type your order."); }
        if (!active) return;
        if (!response.ok) throw new Error(data && typeof data === "object" && "error" in data && typeof data.error === "string" ? data.error.slice(0, 500) : "Transcription failed. Try again or type your order.");
        if (!data || typeof data !== "object" || !("text" in data) || typeof data.text !== "string" || data.text.length > 20000) throw new Error("The transcription server returned a malformed response. Try again or type your order.");
        if (!data.text.trim()) throw new Error("No words were transcribed. Record your order again or type it below.");
        const text = data.text.trim();
        dispose(); events.complete(text);
      } catch (error) {
        fail(error instanceof TypeError ? "Could not reach the transcription server. Check your connection or type your order." : error instanceof Error ? error.message : "Transcription failed. Try again or type your order.");
      }
    };
    const stop = () => {
      if (!active || stopping || !recorder) return;
      stopping = true; clearTimeout(timer);
      timer = setTimeout(() => fail("Recording could not finish. Try again or type your order."), 3000);
      try { recorder.stop(); releaseMicrophone(); } catch { fail("Recording could not finish. Try again or type your order."); }
    };
    this.cancelCurrent = dispose; this.finishCurrent = stop;
    timer = setTimeout(() => fail("Microphone permission is taking too long. Try again or type your order."), 20000);
    void this.host.microphone().then(acquired => {
      if (!active || !this.host.active()) { acquired.getTracks().forEach(track => track.stop()); if (active) fail("Recording stopped because this page is inactive. Start again when ready."); return; }
      clearTimeout(timer); stream = acquired;
      try {
        recorder = new Recorder(stream, { mimeType, audioBitsPerSecond: 128000 });
        recorder.ondataavailable = event => {
          if (!active || !event.data.size) return;
          bytes += event.data.size;
          if (bytes > maxOrderAudioBytes) { fail("The recording is too large. Record a shorter order or type it below."); return; }
          chunks.push(event.data);
        };
        recorder.onerror = () => fail("Audio recording failed. Try again or type your order.");
        recorder.onstop = () => { void transcribe(); };
        recorder.start(1000);
        timer = setTimeout(stop, Math.min(Math.max(limitMs, 1), maxOrderRecordingMs));
        events.started();
      } catch { fail("Could not start audio recording. Try again or type your order."); }
    }).catch(error => fail(error instanceof DOMException && (error.name === "NotAllowedError" || error.name === "SecurityError") ? "Microphone permission denied. Allow microphone access or type your order." : "Could not access the microphone. Check your device or type your order."));
  }
  stop() { this.finishCurrent?.(); }
  cancel() { this.cancelCurrent?.(); }
}

export function browserOrderRecordingHost(): OrderRecordingHost {
  return {
    recorder: typeof MediaRecorder === "undefined" ? undefined : MediaRecorder,
    microphone: navigator.mediaDevices?.getUserMedia ? () => navigator.mediaDevices.getUserMedia({ audio: true }) : undefined,
    upload: (url, options) => fetch(url, options),
    active: () => document.visibilityState === "visible",
  };
}
