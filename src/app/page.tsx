"use client";
import { useEffect, useRef, useState } from "react";
import { AudioLines, CheckCheck, ScanLine, ShieldCheck } from "lucide-react";
import { extractOrder, orderSchema, type Item, type Order } from "@/lib/engine";
import { readImport } from "@/lib/media";
import { VoiceOrder } from "@/components/voice-order";
import { newId } from "@/lib/id";
import { useAssistant, type Preferences } from "@/lib/use-assistant";
import { commandAllowed } from "@/lib/session";
export default function Home() {
  const video = useRef<HTMLVideoElement>(null),
    heading = useRef<HTMLHeadingElement>(null);
  const a = useAssistant(video, heading);
  const [composing, setComposing] = useState(false);
  const [voiceSaved, setVoiceSaved] = useState(false);
  const scanAfterSave = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (voiceSaved && !composing && a.tab === "orders") {
      const frame = requestAnimationFrame(() => scanAfterSave.current?.focus());
      return () => cancelAnimationFrame(frame);
    }
  }, [voiceSaved, composing, a.tab]);
  const summaryHeading = useRef<HTMLHeadingElement>(null);
  const orderHeading = useRef<HTMLHeadingElement>(null);
  const helpHeading = useRef<HTMLHeadingElement>(null);
  const settingsHeading = useRef<HTMLHeadingElement>(null);
  const finished = a.phase === "finished";
  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      const target = finished
        ? summaryHeading.current
        : a.tab === "scan"
          ? heading.current
          : a.tab === "help"
            ? helpHeading.current
            : a.tab === "settings"
              ? settingsHeading.current
              : a.tab === "orders" && !composing && !voiceSaved
                ? orderHeading.current
                : null;
      if (target) {
        const details = target.closest("details");
        if (details) details.open = true;
        target.focus();
      }
    });
    return () => cancelAnimationFrame(frame);
  }, [a.tab, finished, composing, voiceSaved]);
  const [importing, setImporting] = useState(false),
    [editing, setEditing] = useState<string | null>(null);
  const [label, setLabel] = useState("My delivery"),
    [source, setSource] = useState<NonNullable<Order["source"]>>("purchase");
  const [text, setText] = useState(""),
    [draft, setDraft] = useState<Item[]>([]),
    [busy, setBusy] = useState(false);
  const [barcode, setBarcode] = useState(""),
    [manualText, setManualText] = useState(""),
    [consent, setConsent] = useState(false);
  const importAbort = useRef<AbortController | null>(null);
  useEffect(() => {
    if (a.phase === "awaiting-reference")
      queueMicrotask(() => {
        setImporting(false);
        setComposing(true);
      });
    if (a.phase === "paused") {
      importAbort.current?.abort();
      queueMicrotask(() => setBusy(false));
    }
  }, [a.phase]);
  useEffect(() => {
    const pause = () => {
      importAbort.current?.abort();
      setBusy(false);
    };
    window.addEventListener("blur", pause);
    return () => {
      importAbort.current?.abort();
      window.removeEventListener("blur", pause);
    };
  }, []);
  function openVoiceOrder() {
    a.stop();
    a.navigate("orders");
    setImporting(false);
    setComposing(true);
    a.phaseTo("idle");
    void a.announce(
      "Create your order above. Review and confirm before saving.",
    );
  }
  function openImport() {
    setComposing(false);
    a.navigate("orders");
    setImporting(true);
    setEditing(null);
    setDraft([]);
    setText("");
    a.phaseTo("idle");
  }
  function stop() {
    setComposing(false);
    importAbort.current?.abort();
    setBusy(false);
    a.stop();
  }
  async function upload(file?: File) {
    if (!file) return;
    importAbort.current?.abort();
    const abort = new AbortController();
    importAbort.current = abort;
    setBusy(true);
    void a.announce(
      "Reading your reference. Cancel remains available; nothing is saved yet.",
    );
    try {
      const content = await readImport(file, abort.signal);
      if (!abort.signal.aborted) {
        setText(content);
        void a.announce(
          "Reference text is ready. Extract products, then review the uncertain fields.",
        );
      }
    } catch (e) {
      if (!abort.signal.aborted)
        void a.announce(
          e instanceof Error
            ? e.message
            : "Could not read file. Paste text instead.",
          3,
        );
    } finally {
      if (importAbort.current === abort) {
        importAbort.current = null;
        setBusy(false);
      }
    }
  }
  function saveVoiceOrder(order: Order, spoken: boolean) {
    a.update({ ...a.data, orders: [...a.data.orders, order] });
    setComposing(false);
    setVoiceSaved(!spoken);
    if (spoken) void a.start(true);
    else {
      a.navigate("orders");
      void a.announce(
        "Order saved. Choose Start checking when you are ready.",
        3,
      );
    }
  }
  function save() {
    const parsed = orderSchema.safeParse({
      id: editing ?? newId(),
      label,
      source,
      platform: editing
        ? a.data.orders.find((o) => o.id === editing)?.platform
        : undefined,
      items: draft.map((i) => ({ ...i, verified: 0 })),
    });
    if (!parsed.success) {
      void a.announce(
        "Check order and product names. Quantities must be whole numbers from 1 to 999, or blank if unknown.",
        3,
      );
      return;
    }
    a.update({
      orders: editing
        ? a.data.orders.map((o) => (o.id === editing ? parsed.data : o))
        : [...a.data.orders, parsed.data],
      attempts: a.data.attempts.map((event) =>
        event.orderId === editing ? { ...event, undone: true } : event,
      ),
    });
    setDraft([]);
    setText("");
    setImporting(false);
    setEditing(null);
    a.navigate("orders");
    a.phaseTo("idle");
    void a.announce(
      "Reference saved. Start checking your delivery when ready.",
    );
  }
  const canCheck =
    !a.pending &&
    ![
      "processing",
      "announcing-result",
      "paused",
      "requesting-permission",
    ].includes(a.phase);
  const sessionControls = (
    <section className="panel" aria-label="Session controls">
      <h2>Session controls</h2>
      <p>
        Session: {a.phase.replaceAll("-", " ")}. Camera:{" "}
        {a.camera ? "on" : "off"}. Microphone:{" "}
        {a.listening ? "listening" : "not listening"}. App speech:{" "}
        {a.speaking ? "speaking" : "silent"}.
      </p>
      <div className="button-row">
        <button
          className="primary"
          disabled={!a.ready}
          onClick={() => void a.start()}
        >
          Start
        </button>
        <button className="secondary" aria-keyshortcuts="Escape" onClick={stop}>
          Stop
        </button>
        <button
          className="secondary"
          disabled={composing}
          onClick={() => a.command("repeat")}
        >
          Repeat
        </button>
        <button
          className="secondary"
          onClick={() => a.command("stop speaking")}
        >
          Stop speaking
        </button>
        <button
          className="secondary"
          disabled={composing}
          onClick={() => a.command("read my orders")}
        >
          Read my orders
        </button>
        <button
          className="secondary"
          disabled={composing}
          onClick={() => a.command("read the result again")}
        >
          Read the result again
        </button>
        <button
          className="secondary"
          onClick={() => {
            a.navigate("overview");
            document.getElementById("hero-heading")?.focus();
          }}
        >
          Go back
        </button>
      </div>
      <label>
        <input
          type="checkbox"
          checked={consent}
          onChange={(e) => {
            setConsent(e.target.checked);
            if (!e.target.checked) a.stopListening();
          }}
        />{" "}
        I understand voice commands may send audio to my browser provider and
        need a network connection.
      </label>
      <p>
        Voice commands listen automatically during delivery checking and may
        request microphone permission. During speech, say Stop speaking or Stop.
        Start listening is available to retry. Buttons and keyboard remain
        available.
      </p>
      <div className="button-row">
        <button
          className="secondary"
          disabled={!consent || a.listening || composing}
          onClick={a.startListening}
        >
          Start listening
        </button>
        <button className="secondary" onClick={a.stopListening}>
          Stop listening
        </button>
      </div>
    </section>
  );

  return (
    <div
      data-text-size={a.prefs.size}
      data-contrast={a.prefs.contrast ? "high" : "normal"}
    >
      <a className="skip" href="#main">
        Skip to content
      </a>
      <div className="shell">
        <header>
          <a className="brand" href="#main">
            <span className="brand-icon">
              <CheckCheck aria-hidden="true" />
            </span>
            OrderCheck <span className="ai">AI</span>
          </a>
          <span className="header-note">Your pace. Your independence.</span>
        </header>
        <main id="main" tabIndex={-1}>
          <section className="hero" aria-labelledby="hero-heading">
            <p className="eyebrow">
              <AudioLines size={18} aria-hidden="true" /> A VOICE-FIRST DELIVERY
              ASSISTANT
            </p>
            <h1 id="hero-heading" tabIndex={-1}>
              Know what arrived.
              <br />
              <span>Without depending <em>on sight.</em></span>
            </h1>
            <p className="intro">
              A voice-first delivery assistant that helps you describe your
              order, scan each product, and find missing or incorrect items.
            </p>
            <button
              className="primary"
              disabled={!a.ready}
              onClick={
                a.data.orders.length ? () => void a.start() : openVoiceOrder
              }
            >
              {a.data.orders.length
                ? "Start checking my delivery"
                : "Tell OrderCheck what I ordered"}
            </button>
            <p className="hero-foot">
              Built around your voice. Buttons and keyboard are always
              available.
            </p>
            <div className="hero-box" aria-hidden="true">
              <svg viewBox="0 0 200 200" fill="none">
                <path d="M26 65 100 25 174 65 100 107Z" fill="#C27A4A" />
                <path d="M26 65 100 107 100 181 26 139Z" fill="#A9633B" />
                <path d="M100 107 174 65 174 139 100 181Z" fill="#5A3825" />
                <path d="M66 43 140 85 140 113 126 121 126 93 52 51Z" fill="#D49A68" />
                <path d="M26 65 100 107 174 65M100 107V181" stroke="#E8E2D9" strokeOpacity=".35" />
                <path d="m55 119 12 13 24-25" stroke="#E8E2D9" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </div>
          </section>
          <section className="steps" aria-label="How OrderCheck works">
            {[
              [
                "01",
                "Tell us what you ordered",
                "Describe your order naturally. OrderCheck listens, extracts the important details, and reads them back for confirmation.",
              ],
              [
                "02",
                "Scan your delivery",
                "Point your phone at each product. OrderCheck reads the barcode or label and tells you what was received.",
              ],
              [
                "03",
                "Hear what is missing",
                "When you’re finished, OrderCheck compares what you ordered with what was scanned and tells you what is complete, missing, or incorrect.",
              ],
            ].map(([number, title, copy]) => (
              <div className="step" key={number}>
                <span className="step-number" aria-hidden="true">
                  {number}
                </span>
                <div>
                  <h2>{title}</h2>
                  <p>{copy}</p>
                </div>
              </div>
            ))}
          </section>
          {a.storageError && <p role="alert">{a.storageError}</p>}
          {
            <>
              <section
                className="order-section"
                aria-labelledby="order-heading"
              >
                <div className="section-title">
                  <h2 id="order-heading" ref={orderHeading} tabIndex={-1}>
                    Your order
                  </h2>
                  {a.data.orders.length > 0 && (
                    <button className="text-button" onClick={openVoiceOrder}>
                      Add another order
                    </button>
                  )}
                </div>
                {composing && (
                  <VoiceOrder
                    save={saveVoiceOrder}
                    close={() => {
                      setComposing(false);
                      void a.announce("Order cancelled. Nothing saved.");
                    }}
                    announce={a.speakOrder}
                    stopSpeech={() => a.command("stop speaking")}
                  />
                )}
                <details>
                  <summary>Other ways to add an order</summary>
                  <p>
                    Import a purchase receipt or enter product lines manually.
                  </p>
                  <button className="secondary" onClick={openImport}>
                    Import an order
                  </button>
                </details>
                {importing && (
                  <section className="panel">
                    <h2>
                      {editing
                        ? "Correct this reference"
                        : "Bring in a purchase reference"}
                    </h2>
                    <p>
                      English receipts and explicit product lines are supported.
                      Extraction is a draft. Missing details stay blank, and
                      unknown quantities are not guessed.
                    </p>
                    <label>
                      Order name
                      <input
                        value={label}
                        maxLength={120}
                        onChange={(e) => setLabel(e.target.value)}
                      />
                    </label>
                    <label>
                      Reference source
                      <select
                        value={source}
                        onChange={(e) =>
                          setSource(e.target.value as typeof source)
                        }
                      >
                        <option value="purchase">
                          Original purchase confirmation or receipt
                        </option>
                        <option value="voice">Voice-created order</option>
                        <option value="receipt">Receipt</option>
                        <option value="manual">
                          I am entering what I originally ordered
                        </option>
                        <option value="packing-slip">
                          Packing slip / delivered contents only
                        </option>
                      </select>
                    </label>
                    {source === "packing-slip" && (
                      <p>
                        A packing slip cannot independently establish what was
                        originally ordered. Order verification remains
                        unable_to_verify.
                      </p>
                    )}
                    <label>
                      Confirmation text
                      <textarea
                        rows={6}
                        value={text}
                        maxLength={100000}
                        onChange={(e) => setText(e.target.value)}
                        placeholder={
                          "Product | Brand | Variant | Size | Quantity\nOat drink | Everyday | Original | 1 L | 2"
                        }
                      />
                    </label>
                    <p className="hint">
                      Enter Product | Brand | Variant | Size | Quantity, one
                      product per line, or paste a receipt. Leave unknown fields
                      blank. This does not retrieve purchases from retailers.
                    </p>
                    <label className="file-label">
                      Upload image, PDF or text
                      <input
                        type="file"
                        accept="image/png,image/jpeg,image/webp,application/pdf,text/plain"
                        disabled={busy}
                        onChange={(e) => void upload(e.target.files?.[0])}
                      />
                    </label>
                    {busy && (
                      <button
                        className="secondary"
                        onClick={() => {
                          importAbort.current?.abort();
                          setBusy(false);
                        }}
                      >
                        Cancel reading reference
                      </button>
                    )}
                    <div className="button-row">
                      <button
                        className="secondary"
                        disabled={busy || !text.trim()}
                        onClick={() => {
                          const items = extractOrder(text);
                          setDraft(items);
                          void a.announce(
                            items.length
                              ? "Draft products extracted. Review source lines and correct uncertain fields before saving."
                              : "No products could be extracted. Paste an explicit product line or enter details below.",
                          );
                        }}
                      >
                        Extract products
                      </button>
                      <button
                        className="text-button"
                        onClick={() =>
                          setDraft((d) => [
                            ...d,
                            {
                              id: newId(),
                              name: "",
                              brand: "",
                              variant: "",
                              size: "",
                              quantity: null,
                              verified: 0,
                            },
                          ])
                        }
                      >
                        Enter a product manually
                      </button>
                    </div>
                    {draft.map((i, index) => (
                      <fieldset key={i.id}>
                        <legend>Product {index + 1}</legend>
                        {i.source && (
                          <details>
                            <summary>Source and uncertain fields</summary>
                            <p>
                              Page {i.source.page}, line {i.source.line}:{" "}
                              {i.source.text}
                            </p>
                            <p>
                              Review:{" "}
                              {i.source.uncertain.join(", ") ||
                                "explicit fields"}
                              . Unit price: {i.source.unitPrice ?? "unknown"};
                              line total: {i.source.lineTotal ?? "unknown"}.
                            </p>
                          </details>
                        )}
                        <div className="field-grid">
                          {(
                            [
                              "name",
                              "brand",
                              "variant",
                              "size",
                              "quantity",
                            ] as const
                          ).map((key) => (
                            <label key={key}>
                              {key === "name"
                                ? "Product name"
                                : key === "quantity"
                                  ? "Quantity (blank means unknown)"
                                  : key.charAt(0).toUpperCase() + key.slice(1)}
                              <input
                                type={key === "quantity" ? "number" : "text"}
                                min={key === "quantity" ? 1 : undefined}
                                max={key === "quantity" ? 999 : undefined}
                                value={i[key] ?? ""}
                                onChange={(e) =>
                                  setDraft((d) =>
                                    d.map((x) =>
                                      x.id === i.id
                                        ? {
                                            ...x,
                                            [key]:
                                              key === "quantity"
                                                ? e.target.value === ""
                                                  ? null
                                                  : Number(e.target.value)
                                                : e.target.value,
                                          }
                                        : x,
                                    ),
                                  )
                                }
                              />
                            </label>
                          ))}
                        </div>
                        <button
                          className="text-button danger"
                          onClick={() =>
                            setDraft((d) => d.filter((x) => x.id !== i.id))
                          }
                        >
                          Remove product {index + 1}
                        </button>
                      </fieldset>
                    ))}
                    {draft.length > 0 && (
                      <button className="primary" onClick={save}>
                        {editing
                          ? "Save corrected reference and reset its checks"
                          : "Confirm and save order"}
                      </button>
                    )}
                  </section>
                )}
                {a.data.orders.map((o) => (
                  <section className="panel saved-order" key={o.id}>
                    <h3 className="order-label">{o.label}</h3>
                    {o.items.map((i) => (
                      <div className="order-line" key={i.id}>
                        <div>
                          <h3>{i.name}</h3>
                          <p>
                            {[
                              i.brand,
                              i.variant,
                              i.size,
                              ...Object.entries(i.attributes ?? {})
                                .filter(([, v]) => v)
                                .map(([k, v]) => `${k}: ${v}`),
                            ]
                              .filter(Boolean)
                              .join(" · ")}
                          </p>
                        </div>
                        <span>
                          {i.quantity !== null && (
                            <span className="quantity">Quantity: {i.quantity}. </span>
                          )}
                        </span>
                      </div>
                    ))}
                    <div className="button-row">
                      <button
                        className="secondary"
                        onClick={() => {
                          setEditing(o.id);
                          setDraft(o.items.map((i) => ({ ...i })));
                          setLabel(o.label);
                          setSource(o.source ?? "purchase");
                          setImporting(true);
                          void a.announce(
                            "Edit only the fields that need correction. Saving explicitly resets this order&apos;s checks.",
                          );
                        }}
                      >
                        Edit order
                      </button>
                      <button
                        ref={
                          voiceSaved && o.id === a.data.orders.at(-1)?.id
                            ? scanAfterSave
                            : undefined
                        }
                        className="primary"
                        onClick={() => void a.start()}
                      >
                        Start checking
                      </button>
                    </div>
                    <details>
                      <summary>Manage this order</summary>{" "}
                      <button
                        className="text-button danger"
                        onClick={() => {
                          stop();
                          a.update({
                            orders: a.data.orders.filter((x) => x.id !== o.id),
                            attempts: a.data.attempts.filter(
                              (event) => event.orderId !== o.id,
                            ),
                          });
                          void a.announce("Order removed by your request.");
                        }}
                      >
                        Remove order {o.label}
                      </button>
                    </details>
                  </section>
                ))}
                {a.ready &&
                  !a.data.orders.length &&
                  !importing &&
                  !composing && (
                    <p>No orders yet. Tell us what you ordered to begin.</p>
                  )}
              </section>
            </>
          }
          {(a.tab === "scan" || a.data.orders.length > 0) &&
            (!a.ready ? (
              <p role="status">Loading orders…</p>
            ) : !a.data.orders.length ? (
              <section className="panel" aria-label="Save an order first">
                <h2>Save an order before scanning a delivery.</h2>
                <button className="primary" onClick={openVoiceOrder}>
                  Create an order
                </button>
              </section>
            ) : (
              <>
                <section
                  className="scanner-section"
                  aria-labelledby="scanner-heading"
                >
                  <h2 id="scanner-heading" ref={heading} tabIndex={-1}>
                    Check your delivery
                  </h2>
                  <p>
                    Present one product at a time. OrderCheck will speak when it
                    finds a match.
                  </p>
                  <div className="scan-layout">
                    <section className="panel">
                      <div className="camera">
                        <video
                          ref={video}
                          autoPlay
                          muted
                          playsInline
                          aria-label="Live rear camera preview"
                          aria-describedby="camera-guidance"
                        />
                        {a.camera && (
                          <div className="label-guide" aria-hidden="true" />
                        )}
                        {!a.camera && (
                          <div className="camera-placeholder">
                            <ScanLine size={50} aria-hidden="true" />
                            <span>Your camera is off</span>
                          </div>
                        )}
                      </div>
                      <p className="scan-state">
                        {a.listening
                          ? "Listening"
                          : a.phase === "awaiting-next-item"
                            ? "Waiting for next product"
                            : a.phase === "announcing-result"
                              ? "Product found"
                              : a.camera
                                ? "Scanning"
                                : "Scanner ready"}
                      </p>
                      <p id="camera-guidance">
                        {a.phase === "awaiting-next-item"
                          ? "Say Next when you’re ready, or Finish if you’re done."
                          : a.cameraGuidance}
                      </p>
                    </section>
                    <section className="panel">
                      <h3>
                        {a.feedback?.title ?? "Ready for your first item"}
                      </h3>
                      {a.feedback ? (
                        <>
                          {a.feedback.product && (
                            <p>
                              <strong>{a.feedback.product}</strong>
                            </p>
                          )}
                          {a.feedback.description && (
                            <p>{a.feedback.description}</p>
                          )}
                          {a.feedback.lines.map((line) => (
                            <p key={line}>{line}</p>
                          ))}
                        </>
                      ) : (
                        <p>Show one product to check it against your order.</p>
                      )}
                      {a.pending?.verdict.candidates?.map((c) => (
                        <button
                          className="secondary"
                          key={`${c.orderId}:${c.itemId}`}
                          onClick={() => a.selectLine(c)}
                        >
                          {c.label}
                        </button>
                      ))}
                      {a.pending?.another && (
                        <section
                          className="clarification"
                          aria-label="Confirm physical unit"
                        >
                          <h3>Is this another physical unit?</h3>
                          <p>Say “Yes another unit” or “No retry this unit”.</p>
                          <button
                            className="primary"
                            onClick={a.confirmAnother}
                          >
                            Yes, another unit
                          </button>
                          <button className="secondary" onClick={a.retry}>
                            No, retry this unit
                          </button>
                        </section>
                      )}
                      <button
                        className="primary"
                        disabled={
                          a.phase === "requesting-permission" ||
                          a.phase === "processing"
                        }
                        onClick={a.finishChecking}
                      >
                        Finish checking delivery
                      </button>
                      <details>
                        <summary>More options</summary>
                        <div className="button-row">
                          <button
                            className="primary"
                            disabled={a.phase === "requesting-permission"}
                            onClick={() => (a.camera ? stop() : void a.start())}
                          >
                            {a.camera ? "Stop camera" : "Start camera"}
                          </button>
                          <button
                            className="secondary"
                            disabled={
                              !a.camera || a.phase !== "scanning" || !!a.pending
                            }
                            onClick={() => void a.ocr()}
                          >
                            Read label with OCR
                          </button>
                        </div>
                        <div className="button-row">
                          <button
                            className="secondary"
                            disabled={!commandAllowed("next", a.phase)}
                            onClick={a.nextItem}
                          >
                            Scan next product
                          </button>
                          <button
                            className="secondary"
                            disabled={!commandAllowed("retry", a.phase)}
                            onClick={a.retry}
                          >
                            Retry
                          </button>
                          <button
                            className="secondary"
                            disabled={
                              !a.data.attempts.some((event) => !event.undone)
                            }
                            onClick={a.undo}
                          >
                            Undo last checking event
                          </button>
                        </div>
                        <hr />
                        <h3>Use without a camera or voice</h3>
                        <label>
                          Enter a barcode
                          <input
                            value={barcode}
                            onChange={(e) => setBarcode(e.target.value)}
                            autoComplete="off"
                          />
                        </label>
                        <button
                          className="secondary"
                          disabled={!barcode.trim() || !canCheck}
                          onClick={() =>
                            a.check({
                              barcode: barcode.trim(),
                              source: "manual",
                            })
                          }
                        >
                          Check barcode
                        </button>
                        <label>
                          Read a label
                          <textarea
                            value={manualText}
                            onChange={(e) => setManualText(e.target.value)}
                            placeholder="Enter exactly the observed product name, brand, variant and size"
                          />
                        </label>
                        <button
                          className="secondary"
                          disabled={!manualText.trim() || !canCheck}
                          onClick={() =>
                            a.check({
                              text: manualText,
                              confidence: 100,
                              source: "manual",
                            })
                          }
                        >
                          Compare entered label
                        </button>
                      </details>
                    </section>
                  </div>
                </section>
                {a.phase === "finished" && (
                  <section className="panel delivery-summary">
                    <h2 ref={summaryHeading} tabIndex={-1}>
                      Delivery summary
                    </h2>
                    <section aria-label="Final delivery report">
                      {a.report.lines.map((line) => (
                        <div
                          className="summary-line"
                          key={`${line.orderId}:${line.itemId}`}
                        >
                          <h3>{line.product}</h3>
                          <p>
                            Ordered: {line.ordered ?? "unknown"} · Received:{" "}
                            {line.scanned}
                          </p>
                          <p>
                            {line.status === "complete"
                              ? "Complete."
                              : line.status === "missing"
                                ? `Missing: ${line.missing}`
                                : "Ordered quantity is unknown."}
                          </p>
                        </div>
                      ))}
                      <p>
                        <strong>
                          {a.report.missingUnits === 0 &&
                          a.report.unknownLines === 0
                            ? "Everything you ordered was received."
                            : `${a.report.missingUnits} ${a.report.missingUnits === 1 ? "item is" : "items are"} missing from your delivery.${a.report.unknownLines ? ` ${a.report.unknownLines} products have unknown quantities.` : ""}`}
                        </strong>
                      </p>
                    </section>
                  </section>
                )}
              </>
            ))}
          <details
            className="utility"
            open={a.tab === "settings" ? true : undefined}
          >
            <summary>Accessibility settings</summary>
            {
              <section className="panel help">
                <h2 ref={settingsHeading} tabIndex={-1}>
                  Choose your guidance
                </h2>
                <fieldset>
                  <legend>Output preference</legend>
                  <label>
                    <input
                      type="radio"
                      name="output"
                      checked={!a.prefs.spoken}
                      onChange={() =>
                        a.setPrefs((p) => ({ ...p, spoken: false }))
                      }
                    />{" "}
                    Screen-reader mode (default)
                  </label>
                  <label>
                    <input
                      type="radio"
                      name="output"
                      checked={a.prefs.spoken}
                      onChange={() =>
                        a.setPrefs((p) => ({ ...p, spoken: true }))
                      }
                    />{" "}
                    App spoken guidance
                  </label>
                </fieldset>
                <p>
                  Screen-reader mode keeps semantic text and restrained live
                  updates. Critical scan results and delivery summaries always
                  speak. The app never detects or controls your screen reader.
                  App spoken guidance pauses recognition while speaking. Stop
                  speaking and Stop remain available.
                </p>
                <label htmlFor="text-size">Text size</label>
                <select
                  id="text-size"
                  value={a.prefs.size}
                  onChange={(e) =>
                    a.setPrefs((p) => ({
                      ...p,
                      size: e.target.value as Preferences["size"],
                    }))
                  }
                >
                  <option value="normal">Normal</option>
                  <option value="large">Large</option>
                  <option value="extra-large">Extra large</option>
                </select>
                <label>
                  <input
                    type="checkbox"
                    checked={a.prefs.contrast}
                    onChange={(e) =>
                      a.setPrefs((p) => ({ ...p, contrast: e.target.checked }))
                    }
                  />{" "}
                  High contrast
                </label>
                <label htmlFor="speech-rate">Speech rate</label>
                <input
                  id="speech-rate"
                  type="range"
                  min="0.6"
                  max="1.4"
                  step="0.05"
                  value={a.prefs.rate}
                  onChange={(e) =>
                    a.setPrefs((p) => ({ ...p, rate: Number(e.target.value) }))
                  }
                />
                <output htmlFor="speech-rate">
                  {a.prefs.rate.toFixed(2)} times normal
                </output>
                <p>
                  Only these nonsensitive preferences are saved locally.
                  Receipts/photos are not stored with preferences. Speech output
                  depends on your browser and device service.
                </p>
              </section>
            }
          </details>
          <details
            className="utility"
            open={a.tab === "help" ? true : undefined}
          >
            <summary>Help &amp; guidance</summary>
            {
              <section className="panel help">
                <h2 ref={helpHeading} tabIndex={-1}>
                  Help &amp; guidance
                </h2>
                <ol>
                  <li>
                    Paste or upload a purchase confirmation, or enter product
                    details manually. Correct only uncertain fields. A packing
                    slip describes delivered contents; it cannot independently
                    establish what you ordered.
                  </li>
                  <li>
                    Choose Start checking my delivery. Allow the camera only
                    when ready. Use stable phone support while turning one
                    package at a time. For an unknown barcode, turn to its full
                    label and let automatic OCR try, or choose Read label with
                    OCR.
                  </li>
                  <li>
                    OrderCheck speaks the result automatically. Say Next or tap
                    Scan next product when ready. For identical products,
                    confirm another unit. Retry updates one attempt. Undo
                    reverses its event.
                  </li>
                </ol>
                <h2>Commands and equivalent controls</h2>
                <p>
                  Start, Stop, Repeat, Next, Finish, Help, Retry, Read my
                  orders, Read the result again, Go back, Stop speaking. Natural
                  phrases such as Finish checking, I’m done, and Scan next
                  product are also accepted in a valid state. Listening
                  continues during delivery checking while this page is visible.
                  No background or locked-phone operation is promised.
                </p>
                <p>
                  During app speech, only Stop speaking and Stop are accepted.
                  Stop speaking clears narration and keeps the session
                  listening. Stop ends scanning, speech and listening.
                  Screen-reader speech may itself be recognized; Stop listening
                  and screen controls remain available.
                </p>
                <h2>Results and recovery</h2>
                <p>
                  <strong>match:</strong> consistent identifying fields for one
                  reference line. Demo catalog identity or label fields were
                  checked; package contents, authenticity and safety were not
                  checked. <strong>mismatch:</strong> contrary identity or
                  excess quantity. <strong>unable_to_verify:</strong> missing
                  fields, low confidence, conflicting evidence, ambiguous order,
                  unknown quantity or dependent reference. Internal CONFLICT and
                  INCOMPLETE reasons remain available.
                </p>
                <p>
                  Rotate an unreadable label slowly and Retry, or enter observed
                  text/barcode. Next does not confirm a result or add a count.
                  Unknown quantities stay labelled. Checking complete may
                  include mismatches and unresolved units; it does not mean
                  everything matched. Unassigned scans never complete a random
                  order.
                </p>
                <h2>Privacy and browser limits</h2>
                <p>
                  Images and text are processed in this browser. English OCR
                  downloads worker/language assets from third-party CDNs; first
                  use may need a network connection. No retailer/email
                  integration or AI service is added. Voice recognition may send
                  audio to a browser-vendor service and may need a network
                  connection. Enable it only after reading the disclosure.
                  Camera needs HTTPS/localhost; microphone is requested after
                  spoken scan results or when you choose Listen for a command.
                </p>
                <p>
                  Orders stay in memory unless you opt into tab-session storage.
                  Clear orders removes those orders. Preferences are
                  nonsensitive local storage. Do not store orders on a shared
                  device. File limits: 10 MB, PDFs 20 pages, images/pages 12
                  megapixels, text 100,000 characters. English receipt layouts
                  vary; extracted fields remain drafts.
                </p>
                <p>
                  Real iPhone/VoiceOver, Android/TalkBack, Windows
                  screen-reader, camera, microphone and independent blind-user
                  tests remain required. Automated checks are not certification.
                </p>
              </section>
            }
          </details>
          <details className="utility">
            <summary>Voice &amp; session controls</summary>
            {sessionControls}
          </details>
          <details className="utility">
            <summary>Privacy &amp; stored orders</summary>
            <section className="session-controls" aria-label="Privacy controls">
              <label>
                <input
                  type="checkbox"
                  checked={a.remember}
                  onChange={(e) =>
                    e.target.checked ? a.setRemember(true) : a.storageOff()
                  }
                />{" "}
                Keep orders in this browser tab for this session
              </label>
              <button
                className="text-button danger"
                onClick={() => {
                  importAbort.current?.abort();
                  setBusy(false);
                  setComposing(false);
                  a.clear();
                  setText("");
                  setDraft([]);
                  setImporting(false);
                }}
              >
                Clear orders
              </button>
            </section>
          </details>
          <details className="utility" id="technical-details">
            <summary>Technical details</summary>
            <div id="voice-technical-details" />{" "}
            <section
              className="scanner-diagnostics"
              aria-label="Physical test diagnostics"
            >
              <h3>Physical test diagnostics (temporary)</h3>
              <p>Scanner phase: {a.phase}</p>
              <p>Live barcode attempts: {a.diagnostics.liveBarcodeAttempts}</p>
              <p>
                Last barcode decode status:{" "}
                {a.diagnostics.lastBarcodeDecodeStatus}
              </p>
              <p>Barcode detected: {a.diagnostics.barcode ?? "none"}</p>
              <p>Barcode known: {a.diagnostics.barcodeKnown}</p>
              <p>Product source: {a.diagnostics.productSource}</p>
              <p>
                OCR attempted: {a.diagnostics.ocrAttempts > 0 ? "yes" : "no"}
              </p>
              <p>OCR attempts: {a.diagnostics.ocrAttempts}</p>
              <p>
                Last OCR job: {a.ocrTime === null ? "none" : `${a.ocrTime} ms`}
              </p>
              <p>
                Last OCR confidence: {a.diagnostics.ocrConfidence ?? "none"}
              </p>
              <p>
                Last OCR text:{" "}
                <span data-testid="raw-ocr-text">
                  {a.diagnostics.ocrText || "none"}
                </span>
              </p>
              <p>Verification result: {a.diagnostics.verification}</p>
            </section>
            {a.result && (
              <>
                <p>{a.result.message}</p>
                <p>Reason: {a.result.reason}</p>
                {a.result.fields?.map((f) => (
                  <p key={f.field}>
                    {f.field}: {f.observed}. Source: {f.source}
                  </p>
                ))}
              </>
            )}
            {a.data.attempts.map((event) => (
              <p key={event.id}>
                Capture: {event.captureId}. Result: {event.status}. Reason:{" "}
                {event.reason}. {event.message}
              </p>
            ))}
          </details>
          <footer>
            <span>
              <ShieldCheck size={18} aria-hidden="true" /> Your pace. Your
              choice.
            </span>
            <button className="text-button" onClick={() => a.command("help")}>
              Help
            </button>
          </footer>
        </main>
        <div className="audio-status">
          <AudioLines aria-hidden="true" />
          <span
            role="status"
            aria-live={a.tab === "scan" || !a.prefs.spoken ? "polite" : "off"}
            aria-atomic="true"
          >
            <span key={a.noticeId}>{a.message}</span>
          </span>
        </div>
      </div>
    </div>
  );
}
