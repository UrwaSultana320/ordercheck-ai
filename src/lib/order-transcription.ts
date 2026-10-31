import { browserVoiceHost, type Recognition, type VoiceHost } from "./voice";

export interface TranscriptionProvider {
  start(events: { started(): void; complete(text: string): void; error(message: string): void }, limitMs?: number): void;
  stop(): void;
  cancel(): void;
}
/** Browser-vendor STT, not an application AI service. No audio is retained. */
export class BrowserTranscription implements TranscriptionProvider {
  private rec: Recognition | null = null;
  private timer?: ReturnType<typeof setTimeout>;
  private silence?: ReturnType<typeof setTimeout>;
  private end?: () => void;
  constructor(private host: Pick<VoiceHost, "recognition" | "active">) {}
  start(events: Parameters<TranscriptionProvider["start"]>[0], limitMs = 60000) {
    this.cancel();
    const Constructor = this.host.recognition;
    if (!Constructor) { events.error("Speech recognition is unavailable. Type your order below."); return; }
    if (!this.host.active()) { events.error("Return to this page to start listening."); return; }
    const rec = new Constructor();
    this.rec = rec;
    rec.lang = "en-US";
    rec.continuous = true;
    rec.interimResults = true;
    const parts: string[] = [];
    const finish = () => {
      if (this.rec !== rec) return;
      if (!this.host.active()) { this.cancel(); return; }
      const text = parts.join(" ").trim();
      this.cancel();
      events.complete(text);
    };
    this.end = finish;
    rec.onstart = () => { if (this.rec === rec) events.started(); };
    rec.onresult = e => {
      if (this.rec !== rec) return;
      if (!this.host.active()) { this.cancel(); return; }
      for (let i = e.resultIndex; i < e.results.length; i++) parts[i] = e.results[i][0].transcript;
      const spoken = parts.join(" ").trim();
      if (/^(cancel|start again)[.!?]*$/i.test(spoken)) { finish(); return; }
      if (/\bstop recording[.!?]*$/i.test(spoken)) {
        parts.splice(0, parts.length, spoken.replace(/\bstop recording[.!?]*$/i, "").trim());
        finish(); return;
      }
      if (limitMs <= 15000 && e.results[e.results.length - 1]?.isFinal) { finish(); return; }
      clearTimeout(this.silence);
      this.silence = setTimeout(finish, 4500);
    };
    rec.onend = finish;
    rec.onerror = e => {
      if (this.rec !== rec) return;
      if (!this.host.active()) { this.cancel(); return; }
      this.cancel();
      events.error(e.error === "not-allowed" || e.error === "service-not-allowed" ? "Microphone permission denied. Allow microphone access or type your order." : `Listening stopped (${e.error}). Try again or type your order.`);
    };
    this.timer = setTimeout(finish, limitMs);
    try { rec.start(); } catch { this.cancel(); events.error("Could not start the microphone. Try again or type your order."); }
  }
  stop() { this.end?.(); }
  cancel() {
    clearTimeout(this.timer); clearTimeout(this.silence);
    const rec = this.rec;
    this.rec = null; this.end = undefined;
    if (rec) { rec.onstart = rec.onresult = rec.onend = rec.onerror = null; try { rec.abort(); } catch { /* already ended */ } }
  }
}
export function createOrderTranscription(): TranscriptionProvider {
  return new BrowserTranscription(browserVoiceHost());
}
/** Lifecycle/device events are isolated here for replacement by a mobile adapter. */
export function onOrderInterruption(cancel: () => void): () => void {
  const hidden = () => { if (document.visibilityState !== "visible") cancel(); };
  const key = (e: KeyboardEvent) => { if (e.key === "Escape") cancel(); };
  window.addEventListener("blur", cancel);
  document.addEventListener("visibilitychange", hidden);
  window.addEventListener("keydown", key);
  return () => { window.removeEventListener("blur", cancel); document.removeEventListener("visibilitychange", hidden); window.removeEventListener("keydown", key); };
}
