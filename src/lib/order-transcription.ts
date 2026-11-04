import { browserVoiceHost, type Recognition, type VoiceHost } from "./voice";
import { browserOrderRecordingHost, RecordedOrderTranscription } from "./order-recording";

export const orderDictationLocales = [
  { value: "en-PK", label: "English (Pakistan)" },
  { value: "en-US", label: "English (US) — fallback" },
] as const;
export type OrderDictationLocale = typeof orderDictationLocales[number]["value"];
export const defaultOrderDictationLocale: OrderDictationLocale = "en-PK";

export interface TranscriptionProvider {
  start(events: { started(): void; transcribing?(): void; complete(text: string): void; error(message: string): void }, limitMs?: number): void;
  stop(): void;
  cancel(): void;
}
/** Browser-vendor STT, not an application AI service. No audio is retained. */
export class BrowserTranscription implements TranscriptionProvider {
  private rec: Recognition | null = null;
  private timer?: ReturnType<typeof setTimeout>;
  private silence?: ReturnType<typeof setTimeout>;
  private end?: () => void;
  constructor(private host: Pick<VoiceHost, "recognition" | "active">, private locale: OrderDictationLocale = defaultOrderDictationLocale) {}
  start(events: Parameters<TranscriptionProvider["start"]>[0], limitMs = 60000) {
    this.cancel();
    const Constructor = this.host.recognition;
    if (!Constructor) { events.error("Speech recognition is unavailable. Type your order below."); return; }
    if (!this.host.active()) { events.error("Return to this page to start listening."); return; }
    const rec = new Constructor();
    this.rec = rec;
    rec.lang = this.locale;
    rec.continuous = true;
    rec.interimResults = true;
    const parts: string[] = [];
    let stopping = false;
    const finish = () => {
      if (this.rec !== rec) return;
      if (!this.host.active()) { this.cancel(); return; }
      const text = parts.join(" ").trim().replace(/\bstop recording[.!?]*$/i, "").trim();
      this.cancel();
      events.complete(text);
    };
    const stop = () => {
      if (this.rec !== rec || stopping) return;
      stopping = true;
      clearTimeout(this.timer); clearTimeout(this.silence);
      // stop() lets the provider deliver its last result before onend. Bound
      // the wait in case a browser never emits onend; cancellation still aborts.
      this.timer = setTimeout(finish, 1500);
      try { if (rec.stop) rec.stop(); else finish(); } catch { finish(); }
    };
    this.end = stop;
    rec.onstart = () => { if (this.rec === rec) events.started(); };
    rec.onresult = e => {
      if (this.rec !== rec) return;
      if (!this.host.active()) { this.cancel(); return; }
      for (let i = e.resultIndex; i < e.results.length; i++) parts[i] = e.results[i][0].transcript;
      // Interim entries can disappear from the provider's current result list.
      parts.length = e.results.length;
      if (stopping) return;
      const spoken = parts.join(" ").trim();
      const final = e.results[e.results.length - 1]?.isFinal;
      if (final && /^(cancel|start again)[.!?]*$/i.test(spoken)) { finish(); return; }
      if (final && /\bstop recording[.!?]*$/i.test(spoken)) { stop(); return; }
      if (limitMs <= 15000 && final) { stop(); return; }
      clearTimeout(this.silence);
      this.silence = setTimeout(stop, 4500);
    };
    rec.onend = finish;
    rec.onerror = e => {
      if (this.rec !== rec) return;
      if (!this.host.active()) { this.cancel(); return; }
      this.cancel();
      if (e.error === "no-speech" && limitMs <= 15000) { events.complete(""); return; }
      events.error(e.error === "language-not-supported" ? "Your browser provider does not support the selected speech language. Select English (US) as a fallback and try again, or type your order." : e.error === "not-allowed" || e.error === "service-not-allowed" ? "Microphone permission denied. Allow microphone access or type your order." : `Listening stopped (${e.error}). Try again or type your order.`);
    };
    this.timer = setTimeout(stop, limitMs);
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
  return new RecordedOrderTranscription(browserOrderRecordingHost());
}
/** Bounded review responses/corrections use browser recognition. */
export function createOrderResponseRecognition(locale: OrderDictationLocale = defaultOrderDictationLocale): TranscriptionProvider {
  return new BrowserTranscription(browserVoiceHost(), locale);
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
