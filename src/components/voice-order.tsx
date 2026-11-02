"use client";
import { useEffect, useRef, useState } from "react";
import type { Order } from "@/lib/engine";
import { confirmOrder, correctOrder, extractSpokenOrder, fieldValue, orderFields, orderReadback, type Correction, type OrderCandidate } from "@/lib/spoken-order";
import { createOrderTranscription, createOrderResponseRecognition, onOrderInterruption, type TranscriptionProvider } from "@/lib/order-transcription";

type Props = { save(order: Order, spoken: boolean): void; close(): void; announce(text: string, spoken?: boolean): Promise<void>; stopSpeech(): void };
export function VoiceOrder({ save, close, announce, stopSpeech }: Props) {
  const [transcript, setTranscript] = useState("");
  const [error, setError] = useState("");
  const errorMessage = useRef<HTMLParagraphElement>(null);
  const [candidate, setCandidate] = useState<OrderCandidate | null>(null);
  const [status, setStatus] = useState("Ready. Type your order or allow the microphone and begin.");
  const [phase, setPhase] = useState<"idle" | "requesting" | "recording" | "transcribing">("idle");
  const listening = phase === "recording", busy = phase !== "idle";
  const [consent, setConsent] = useState(false);
  const [editing, setEditing] = useState(false);
  const [targetKey, setTargetKey] = useState("platform");
  const [answer, setAnswer] = useState("");
  const provider = useRef<TranscriptionProvider | null>(null);
  const dictated = useRef(false);
  const spoken = useRef(false), epoch = useRef(0), finished = useRef(false);
  const heading = useRef<HTMLHeadingElement>(null);
  const focusTranscript = useRef(false);
  const latest = useRef({ announce, stopSpeech });
  useEffect(() => { latest.current = { announce, stopSpeech }; });
  useEffect(() => {
    const generation = epoch;
    const off = onOrderInterruption(() => {
      epoch.current++;
      provider.current?.cancel();
      latest.current.stopSpeech();
      setPhase("idle");
      setStatus("Listening stopped. Your unsaved draft remains available. Start listening explicitly to continue.");
    });
    const focus = requestAnimationFrame(() => heading.current?.focus());
    return () => { generation.current++; provider.current?.cancel(); if (!finished.current) latest.current.stopSpeech(); cancelAnimationFrame(focus); off(); };
  }, []);
  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      if (focusTranscript.current && !candidate) { document.getElementById("order-transcript")?.focus(); focusTranscript.current = false; }
      else heading.current?.focus();
    });
    return () => cancelAnimationFrame(frame);
  }, [candidate, editing]);
  useEffect(() => { if (error) errorMessage.current?.focus(); }, [error]);
  function cancelListening() { epoch.current++; provider.current?.cancel(); stopSpeech(); setPhase("idle"); }
  function showError(message: string) {
    setError(message);
    // Repeated identical errors must also regain focus. New errors are focused
    // by the effect after React commits the alert and attaches its ref.
    errorMessage.current?.focus();
  }
  function reset() {
    cancelListening(); dictated.current = false; setTranscript(""); setError(""); setCandidate(null); setEditing(false); setAnswer("");
    setStatus("Start again. Nothing saved. Describe your order when ready.");
  }
  function targetFrom(key: string): Correction {
    if (key === "platform") return { field: "platform" };
    const [index, field] = key.split(":");
    return { index: Number(index), field: field as Exclude<Correction["field"], "platform"> };
  }
  function keyFrom(target: Correction) { return "index" in target ? `${target.index}:${target.field}` : "platform"; }
  function question(draft: OrderCandidate, target: Correction) {
    return target.field === "platform" ? "Which platform did you order from?" : `What ${target.field} did you order for product ${"index" in target ? target.index + 1 : 1}, ${"index" in target ? draft.items[target.index].name : ""}?`;
  }
  function listen(mode: "order" | "command" | "correction", draft = candidate, target?: Correction) {
    cancelListening();
    setError("");
    provider.current = mode === "order" ? createOrderTranscription() : createOrderResponseRecognition();
    spoken.current = true;
    setPhase("requesting");
    setStatus("Requesting microphone permission. Cancel remains available.");
    provider.current?.start({
      started: () => { setPhase("recording"); setStatus(mode === "order" ? "Listening to your order. Choose Finish recording when done. Maximum 60 seconds." : mode === "command" ? "Listening for Confirm, Change, Start again, or Cancel. Up to 15 seconds." : "Listening for this correction. Up to 15 seconds."); },
      transcribing: () => { setPhase("transcribing"); setStatus("Transcribing your order. The microphone is off. Cancel remains available."); },
      error: message => { setPhase("idle"); setStatus("Listening stopped. Nothing saved yet."); showError(message); },
      complete: text => {
        setPhase("idle");
        setStatus("Listening ended. Nothing saved yet.");
        if (mode === "order") {
          dictated.current = true; setTranscript(text); process(text); return;
        }
        const command = text.toLowerCase().trim().replace(/[.!?]+$/, "");
        if (command === "cancel") { cancelListening(); close(); return; }
        if (command === "start again") { reset(); return; }
        if (!text.trim()) { showError("Nothing heard. Try again or use the field controls."); return; }
        if (mode === "correction" && draft && target) {
          try { const updated = correctOrder(draft, target, text); setCandidate(updated); setEditing(false); void review(updated); }
          catch { setStatus("Could not apply that correction. Use the field controls."); }
        } else if (draft) {
          if (command === "confirm") persist(draft);
          else if (command === "change" || command.startsWith("change ")) {
            const match = command.match(/^change (platform|name|quantity|size|color|flavour|type|variant|brand)(?: (?:of |for )?product (\d+))?$/);
            const chosen: Correction = match ? match[1] === "platform" ? { field: "platform" } : { index: Number(match[2] ?? 1) - 1, field: match[1] as Exclude<Correction["field"], "platform"> } : (draft.unresolved[0] ?? { index: 0, field: "name" });
            if ("index" in chosen && (chosen.index < 0 || chosen.index >= draft.items.length)) { setStatus("That product number does not exist. Use Change to select a product."); return; }
            void change(draft, chosen);
          } else setStatus("Command not recognized. Say Confirm, Change, or Start again in a new listening window, or use the buttons.");
        }
      },
    }, mode === "order" ? 60000 : 15000);
  }
  async function review(draft: OrderCandidate) {
    setCandidate(draft); setEditing(false);
    const summary = `${orderReadback(draft)} The microphone is off. Use the controls, or choose Speak response before speaking.`;
    setStatus(summary);
    epoch.current++;
    await announce(summary, spoken.current);
  }
  function process(value = transcript) {
    cancelListening();
    setError("");
    try { void review(extractSpokenOrder(value)); }
    catch (e) { showError(e instanceof Error ? e.message : "Could not interpret the order. Please try again."); }
  }
  async function change(draft: OrderCandidate, target: Correction, voice = false) {
    cancelListening(); setEditing(true); setTargetKey(keyFrom(target));
    setAnswer(target.field === "platform" ? draft.platform ?? "" : "index" in target ? fieldValue(draft.items[target.index], target.field) : "");
    const prompt = question(draft, target);
    setStatus(prompt);
    const token = ++epoch.current;
    await announce(prompt, voice);
    if (epoch.current === token && voice && consent) listen("correction", draft, target);
  }
  function persist(draft: OrderCandidate) {
    try { const order = confirmOrder(draft, true, dictated.current ? "voice" : "manual"); cancelListening(); finished.current = true; save(order, spoken.current); }
    catch { setStatus("Use Change to confirm uncertain fields. Names must be at most 160 characters, platforms 120, brands and variants 100, and sizes 60."); if (draft.unresolved[0]) void change(draft, draft.unresolved[0]); }
  }
  return <section className="panel" aria-labelledby="voice-order-heading">
    <h2 id="voice-order-heading" ref={heading} tabIndex={-1}>{candidate ? editing ? "Change one detail" : "Review your order" : "Tell OrderCheck what I ordered"}</h2>
    <p>Describe your order naturally. Include the product name, quantity, size and variant when you know them.</p>
    <p aria-live="polite" aria-atomic="true">{status}</p>
    <p><strong>Order microphone: {listening ? "listening" : "off"}.</strong> Audio is sent securely to OpenAI for transcription only when you explicitly record an order. OrderCheck does not store the recording after transcription. Optional short spoken responses use your browser speech provider.</p>
    <label><input type="checkbox" checked={consent} onChange={e => { setConsent(e.target.checked); if (!e.target.checked) cancelListening(); }} /> Allow order audio transcription and optional spoken responses</label>
    <p>Order dictation uses an English language hint and supports Pakistani English speech. Check the transcript; transcription can still mishear names.</p>
    {!candidate && <>
      <div className="button-row"><button className="primary" disabled={!consent || busy} onClick={() => listen("order")}>Start order recording</button><button className="secondary" disabled={!listening} onClick={() => provider.current?.stop()}>Finish recording</button></div>
    </>}
    <div hidden={!!candidate}>
      <label htmlFor="order-transcript">Order transcript</label><textarea id="order-transcript" maxLength={20000} rows={5} value={transcript} disabled={busy} aria-invalid={!!error} aria-describedby={error ? "order-transcript-error" : undefined} onChange={e => { dictated.current = false; setTranscript(e.target.value); setError(""); }} />
    </div>
    {error && <p id="order-transcript-error" ref={errorMessage} role="alert" tabIndex={-1}>{error}</p>}
    {!candidate && <button className="primary" disabled={!transcript.trim() || busy} onClick={() => process()}>Review order</button>}
    {candidate && <>
      {candidate.platform && <p>Platform: {candidate.platform}</p>}
      <ol>{candidate.items.map((item, index) => <li key={item.id}><h3>Product {index + 1}: {item.name || "Name needs confirmation"}</h3><dl>{orderFields.filter(field => field !== "name" && fieldValue(item, field)).map(field => <div key={field}><dt>{field}</dt><dd>{fieldValue(item, field)}</dd></div>)}</dl></li>)}</ol>
      {candidate.unresolved.length > 0 && <p>Needs confirmation: {candidate.unresolved.map(t => `${"index" in t ? `product ${t.index + 1} ` : ""}${t.field}`).join(", ")}.</p>}
      {editing ? <>
        <label htmlFor="order-correction-field">Field to change</label><select id="order-correction-field" value={targetKey} onChange={e => { void change(candidate, targetFrom(e.target.value)); }}><option value="platform">Platform</option>{candidate.items.flatMap((item, index) => orderFields.map(field => <option key={`${item.id}:${field}`} value={`${index}:${field}`}>Product {index + 1}: {field}</option>))}</select>
        <label>Correct value<input maxLength={160} value={answer} onChange={e => setAnswer(e.target.value)} /></label>
        <p>Leave an optional value blank to omit it. A quantity must be a whole number from 1 to 999.</p>
        <div className="button-row"><button className="primary" disabled={busy} onClick={() => { const updated = correctOrder(candidate, targetFrom(targetKey), answer); void review(updated); }}>Apply correction and review</button><button className="secondary" disabled={!consent || busy} onClick={() => { void change(candidate, targetFrom(targetKey), true); }}>Speak this correction</button></div>
      </> : <div className="button-row">
        <button className="primary" disabled={!!candidate.unresolved.length || busy} onClick={() => persist(candidate)}>Confirm and save voice order</button>
        <button className="secondary" onClick={() => { void change(candidate, candidate.unresolved[0] ?? { index: 0, field: "name" }); }}>Change</button>
        <button className="secondary" disabled={busy} onClick={() => { spoken.current = true; void review(candidate); }}>Read back order</button>
        <button className="secondary" disabled={!consent || busy} onClick={() => listen("command", candidate)}>Speak response</button>
      </div>}
      <button className="secondary" disabled={busy} onClick={() => { cancelListening(); focusTranscript.current = true; setCandidate(null); setEditing(false); setError(""); setStatus("Edit your transcript, then choose Review order."); }}>Edit order transcript</button>
    </>}
    <div className="button-row"><button className="secondary" onClick={reset}>Start again</button><button className="secondary" onClick={() => { cancelListening(); close(); }}>Cancel order</button><button className="secondary" disabled={!busy} onClick={() => { cancelListening(); setStatus("Recording cancelled. Nothing from this recording was saved."); }}>Cancel recording</button></div>
  </section>;
}
