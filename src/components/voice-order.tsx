"use client";
import { useEffect, useRef, useState } from "react";
import type { Order } from "@/lib/engine";
import { canConfirmField, confirmCurrentDetails, hasRequiredQuantity, confirmOrder, correctOrder, extractSpokenOrder, fieldValue, orderFields, orderReadback, type Correction, type OrderCandidate } from "@/lib/spoken-order";
import { createOrderTranscription, createOrderResponseRecognition, onOrderInterruption, type TranscriptionProvider } from "@/lib/order-transcription";

type Props = { save(order: Order, spoken: boolean): void; close(): void; announce(text: string, spoken?: boolean): Promise<void>; stopSpeech(): void };
type ResponseDiagnostic = { raw: string | null; normalized: string | null; state: "idle" | "requesting microphone" | "listening" | "received response" | "no speech" | "recognition error" | "processing command"; error: string | null };
const emptyResponseDiagnostic: ResponseDiagnostic = { raw: null, normalized: null, state: "idle", error: null };
export function VoiceOrder({ save, close, announce, stopSpeech }: Props) {
  const [transcript, setTranscript] = useState("");
  const [error, setError] = useState("");
  const errorMessage = useRef<HTMLParagraphElement>(null);
  const [candidate, setCandidate] = useState<OrderCandidate | null>(null);
  const [status, setStatus] = useState("Ready. Type your order or allow the microphone and begin.");
  const [phase, setPhase] = useState<"idle" | "requesting" | "recording" | "transcribing">("idle");
  const [listeningMode, setListeningMode] = useState<"order" | "command" | "correction">("order");
  const [responseDiagnostic, setResponseDiagnostic] = useState<ResponseDiagnostic>(emptyResponseDiagnostic);
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
  const listeningReason = listeningMode === "command"
    ? "Listening for your response. Say Confirm, Change, or Start again."
    : listeningMode === "correction"
      ? "Listening for your correction. Finish or cancel this response before saving."
      : "Finish or cancel recording before saving.";
  const saveReason = candidate && (busy ? listeningReason
    : !hasRequiredQuantity(candidate) ? "Quantity is required before this order can be saved."
    : candidate.unresolved.length ? "Confirm or correct the highlighted details before saving." : "");
  const canConfirm = candidate && candidate.unresolved.length > 0 && candidate.unresolved.every(target => canConfirmField(candidate, target));
  const latest = useRef({ announce, stopSpeech });
  useEffect(() => { latest.current = { announce, stopSpeech }; });
  useEffect(() => {
    const generation = epoch;
    const off = onOrderInterruption(() => {
      epoch.current++;
      provider.current?.cancel();
      latest.current.stopSpeech();
      setPhase("idle");
      setResponseDiagnostic(value => ({ ...value, state: "idle" }));
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
  function cancelListening() { epoch.current++; provider.current?.cancel(); stopSpeech(); setPhase("idle"); setResponseDiagnostic(value => ({ ...value, state: "idle" })); }
  function showError(message: string) {
    setError(message);
    // Repeated identical errors must also regain focus. New errors are focused
    // by the effect after React commits the alert and attaches its ref.
    errorMessage.current?.focus();
  }
  function reset() {
    cancelListening(); dictated.current = false; setTranscript(""); setError(""); setCandidate(null); setEditing(false); setAnswer("");
    setResponseDiagnostic(emptyResponseDiagnostic);
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
    setListeningMode(mode);
    setPhase("requesting");
    if (mode === "command") setResponseDiagnostic({ ...emptyResponseDiagnostic, state: "requesting microphone" });
    else if (mode === "order") setResponseDiagnostic(emptyResponseDiagnostic);
    setStatus("Requesting microphone permission. Cancel remains available.");
    provider.current?.start({
      started: () => { setPhase("recording"); if (mode === "command") setResponseDiagnostic(value => ({ ...value, state: "listening" })); setStatus(mode === "order" ? "Listening to your order. Choose Finish recording when done. Maximum 60 seconds." : mode === "command" ? "Listening for Confirm, Change, Start again, or Cancel. Up to 15 seconds." : "Listening for this correction. Up to 15 seconds."); },
      transcribing: () => { setPhase("transcribing"); setStatus("Transcribing your order. The microphone is off. Cancel remains available."); },
      rawResponse: text => { if (mode === "command") setResponseDiagnostic(value => ({ ...value, raw: text, state: text ? "received response" : "no speech" })); },
      recognitionError: code => { if (mode === "command") setResponseDiagnostic(value => ({ ...value, error: code, state: code === "no-speech" ? "no speech" : "recognition error" })); },
      error: message => { setPhase("idle"); if (mode === "command") setResponseDiagnostic(value => ({ ...value, state: "recognition error" })); setStatus("Listening stopped. Nothing saved yet."); showError(message); },
      complete: text => {
        setPhase("idle");
        setStatus("Listening ended. Nothing saved yet.");
        if (mode === "order") {
          dictated.current = true; setTranscript(text); process(text); return;
        }
        const command = text.toLowerCase().trim().replace(/[.!?]+$/, "");
        if (mode === "command") setResponseDiagnostic(value => ({ ...value, normalized: command, state: text.trim() ? "processing command" : "no speech" }));
        if (command === "cancel") { cancelListening(); close(); return; }
        if (command === "start again") { reset(); return; }
        if (!text.trim()) {
          if (mode === "command") {
            const message = "No response heard. Use Speak response or the buttons to continue.";
            setStatus(message); void announce(message, true);
          } else showError("Nothing heard. Try again or use the field controls.");
          return;
        }
        if (mode === "correction" && draft && target) {
          try { const updated = correctOrder(draft, target, text); setCandidate(updated); setEditing(false); void review(updated); }
          catch { setStatus("Could not apply that correction. Use the field controls."); }
        } else if (draft) {
          if (command === "confirm") persist(draft, true);
          else if (command === "change" || command.startsWith("change ")) {
            const match = command.match(/^change (platform|name|quantity|size|color|flavour|type|variant|brand)(?: (?:of |for )?product (\d+))?$/);
            const chosen: Correction = match ? match[1] === "platform" ? { field: "platform" } : { index: Number(match[2] ?? 1) - 1, field: match[1] as Exclude<Correction["field"], "platform"> } : (draft.unresolved[0] ?? { index: 0, field: "name" });
            if ("index" in chosen && (chosen.index < 0 || chosen.index >= draft.items.length)) { setStatus("That product number does not exist. Use Change to select a product."); return; }
            void change(draft, chosen);
          } else {
            if (mode === "command") setResponseDiagnostic(value => ({ ...value, state: "received response" }));
            setStatus("Command not recognized. Say Confirm, Change, or Start again in a new listening window, or use the buttons.");
          }
        }
      },
    }, mode === "order" ? 60000 : 15000);
  }
  async function review(draft: OrderCandidate) {
    // Cancel any prior response window and invalidate an interrupted readback.
    cancelListening();
    setCandidate(draft); setEditing(false);
    const automatic = dictated.current && consent;
    const summary = `${orderReadback(draft)} ${automatic
      ? "Say Confirm to save this order, Change to correct it, or Start again."
      : "The microphone is off. Use the controls, or choose Speak response before speaking."}`;
    setStatus(summary);
    const token = ++epoch.current;
    await announce(summary, spoken.current);
    // Global Stop/blur handlers can cancel speech before the composer's own
    // interruption handler runs. Let that event finish before checking intent.
    await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
    // Speech completion is also resolved on cancellation; only the current,
    // uninterrupted review may open a single bounded response window.
    if (automatic && epoch.current === token) listen("command", draft);
  }
  function process(value = transcript) {
    cancelListening();
    setResponseDiagnostic(emptyResponseDiagnostic);
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
  function persist(draft: OrderCandidate, spokenConfirm = false) {
    if (!hasRequiredQuantity(draft)) {
      const index = draft.items.findIndex(item => !hasRequiredQuantity({ ...draft, items: [item] }));
      const message = `I still need the quantity for product ${index + 1} before I can save this order.`;
      setStatus(message); void announce(message, spokenConfirm); return;
    }
    if (spokenConfirm) { draft = confirmCurrentDetails(draft); setCandidate(draft); }
    try {
      const order = confirmOrder(draft, true, dictated.current ? "voice" : "manual");
      cancelListening();
      finished.current = true;
      save(order, spokenConfirm);
    }
    catch { setStatus("Use Change to confirm uncertain fields. Names must be at most 160 characters, platforms 120, brands and variants 100, and sizes 60."); if (draft.unresolved[0]) void change(draft, draft.unresolved[0]); }
  }
  return <section className="panel voice-order" aria-labelledby="voice-order-heading">
    <h2 id="voice-order-heading" ref={heading} tabIndex={-1}>{candidate ? editing ? "Change one detail" : "Review your order" : "Tell OrderCheck what I ordered"}</h2>
    <p>Describe your order naturally. Include the product name, quantity, size and variant when you know them.</p>
    <p aria-live="polite" aria-atomic="true">{status}</p>
    <p><strong>Order microphone: {listening ? "listening" : "off"}.</strong> Audio is sent securely to Groq for transcription only when you explicitly record an order. OrderCheck does not store the recording after transcription. Optional short spoken responses use your browser speech provider.</p>
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
      <section aria-labelledby="voice-response-diagnostic-heading" style={{ minWidth: 0, overflowWrap: "anywhere", whiteSpace: "pre-wrap" }}>
        <h3 id="voice-response-diagnostic-heading">Voice response diagnostic</h3>
        <p>Last voice response heard: {responseDiagnostic.raw === null ? "no response yet" : responseDiagnostic.raw === "" ? "nothing" : `"${responseDiagnostic.raw}"`}</p>
        <p>Normalized command: {responseDiagnostic.normalized === null ? "not processed" : `"${responseDiagnostic.normalized}"`}</p>
        <p>Voice response state: {responseDiagnostic.state}</p>
        {responseDiagnostic.error && <p>Voice response error: {responseDiagnostic.error}</p>}
      </section>
      <section className="voice-order-transcript" aria-labelledby="raw-transcription-heading">
        <h3 id="raw-transcription-heading">Raw transcription</h3>
        <p>{transcript}</p>
      </section>
      {candidate.platform && <p className="voice-order-platform"><strong>Platform:</strong> {candidate.platform}</p>}
      <ol className="voice-order-products">{candidate.items.map((item, index) => <li className="voice-order-product" key={item.id}><h3>Product {index + 1}</h3><p className="voice-order-name">{item.name || "Name needs confirmation"}</p><dl className="voice-order-details">{orderFields.filter(field => field !== "name" && fieldValue(item, field)).map(field => <div key={field}><dt>{field}</dt><dd>{fieldValue(item, field)}</dd></div>)}</dl></li>)}</ol>
      {candidate.unresolved.length > 0 && <p><strong>Needs confirmation: {candidate.unresolved.map(t => `${"index" in t ? `product ${t.index + 1} ` : ""}${t.field}`).join(", ")}.</strong></p>}
      <p id="voice-order-save-reason" role="status" aria-atomic="true">{saveReason}</p>
      {editing ? <>
        <label htmlFor="order-correction-field">Field to change</label><select id="order-correction-field" value={targetKey} onChange={e => { void change(candidate, targetFrom(e.target.value)); }}><option value="platform">Platform</option>{candidate.items.flatMap((item, index) => orderFields.map(field => <option key={`${item.id}:${field}`} value={`${index}:${field}`}>Product {index + 1}: {field}</option>))}</select>
        <label>Correct value<input maxLength={160} value={answer} onChange={e => setAnswer(e.target.value)} /></label>
        <p>Leave an optional value blank to omit it. A quantity must be a whole number from 1 to 999.</p>
        <div className="button-row"><button className="primary" disabled={busy} onClick={() => { const updated = correctOrder(candidate, targetFrom(targetKey), answer); void review(updated); }}>Apply correction and review</button><button className="secondary" disabled={!consent || busy} onClick={() => { void change(candidate, targetFrom(targetKey), true); }}>Speak this correction</button></div>
      </> : <div className="button-row">
        {canConfirm && <button className="primary" disabled={busy} onClick={() => { cancelListening(); setError(""); const updated = confirmCurrentDetails(candidate); setCandidate(updated); setStatus("Current displayed details confirmed. Review and choose Confirm and save voice order to save."); }}>Confirm current details</button>}
        <button className="primary" aria-describedby={saveReason ? "voice-order-save-reason" : undefined} disabled={!!saveReason} onClick={() => persist(candidate)}>Confirm and save voice order</button>
        <button className="secondary" onClick={() => { void change(candidate, candidate.unresolved[0] ?? { index: 0, field: "name" }); }}>Change</button>
        <button className="secondary" disabled={busy} onClick={() => { spoken.current = true; void review(candidate); }}>Read back order</button>
        <button className="secondary" disabled={!consent || busy} onClick={() => listen("command", candidate)}>Speak response</button>
      </div>}
      <button className="secondary" disabled={busy} onClick={() => { cancelListening(); focusTranscript.current = true; setCandidate(null); setEditing(false); setError(""); setStatus("Edit your transcript, then choose Review order."); }}>Edit order transcript</button>
    </>}
    <div className="button-row"><button className="secondary" onClick={reset}>Start again</button><button className="secondary" onClick={() => { cancelListening(); close(); }}>Cancel order</button><button className="secondary" disabled={!busy} onClick={() => { cancelListening(); setStatus("Recording cancelled. Nothing from this recording was saved."); }}>Cancel recording</button></div>
  </section>;
}
