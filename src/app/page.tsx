"use client";
import { useEffect, useRef, useState } from "react";
import {
  AudioLines,
  CheckCheck,
  CircleHelp,
  FileText,
  Package,
  ScanLine,
  Settings,
  ShieldCheck,
} from "lucide-react";
import {
  extractOrder,
  orderSchema,
  userStatus,
  type Item,
  type Order,
} from "@/lib/engine";
import { readImport } from "@/lib/media";
import { VoiceOrder } from "@/components/voice-order";
import { newId } from "@/lib/id";
import { useAssistant, type Tab, type Preferences } from "@/lib/use-assistant";
import { commandAllowed } from "@/lib/session";
const titles: Record<Tab, string> = {
  overview: "Let's check your delivery",
  orders: "My Orders",
  scan: "Check your delivery",
  help: "Help & guidance",
  settings: "Accessibility settings",
};
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
  const [menuOpen, setMenuOpen] = useState(false);
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
      queueMicrotask(() => { setImporting(false); setComposing(true); });
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
    void a.announce("Create your order above. Review and confirm before saving.");
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
  function save() {
    const parsed = orderSchema.safeParse({
      id: editing ?? newId(),
      label,
      source,
      platform: editing ? a.data.orders.find(o => o.id === editing)?.platform : undefined,
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
  return (
    <div
      data-text-size={a.prefs.size}
      data-contrast={a.prefs.contrast ? "high" : "normal"}
    >
      <a className="skip" href="#main">
        Skip to content
      </a>
      <aside className="sidebar">
        <a
          className="brand"
          href="#main"
          onClick={() => a.navigate("overview")}
        >
          <span className="brand-icon">
            <CheckCheck aria-hidden="true" />
          </span>
          OrderCheck<span className="ai">AI</span>
        </a>
        <button
          className="menu-toggle secondary"
          aria-expanded={menuOpen}
          aria-controls="primary-navigation"
          onClick={() => setMenuOpen((v) => !v)}
        >
          Menu
        </button>
        <p className="workspace">YOUR DELIVERY ASSISTANT</p>
        <nav
          id="primary-navigation"
          className={menuOpen ? "expanded" : ""}
          aria-label="Main navigation"
        >
          {(
            [
              ["overview", Package, "Overview"],
              ["orders", FileText, "My orders"],
              ["scan", ScanLine, "Scan a delivery"],
              ["help", CircleHelp, "Help & guidance"],
              ["settings", Settings, "Accessibility settings"],
            ] as const
          ).map(([id, Icon, title]) => (
            <button
              key={id}
              className={a.tab === id ? "nav active" : "nav"}
              aria-current={a.tab === id ? "page" : undefined}
              onClick={() => {
                a.navigate(id);
                setMenuOpen(false);
              }}
            >
              <Icon size={20} aria-hidden="true" />
              {title}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom privacy">
          <ShieldCheck aria-hidden="true" />
          <strong>Your reference, your control</strong>
          <p>
            Orders stay in this tab unless you choose session storage. Speech
            services may use a network. See Help for details.
          </p>
        </div>
      </aside>
      <div className="shell">
        <header>
          <span>One package. One clear next step.</span>
          <span>Press Escape to stop.</span>
        </header>
        <main id="main" tabIndex={-1}>
          <div className="page-heading">
            <div>
              <p className="eyebrow">A LITTLE CERTAINTY IN EVERY DELIVERY</p>
              <h1 ref={heading} tabIndex={-1}>
                {titles[a.tab]}
              </h1>
              <p>
                Compare the product label with your purchase reference. Keep
                uncertain results visible.
              </p>
            </div>
          </div>
          {a.storageError && <p role="alert">{a.storageError}</p>}
          {a.tab === "overview" && (
            <>
              <section className="hero">
                <div className="hero-copy">
                  <span className="mini-label">
                    <AudioLines aria-hidden="true" /> AT YOUR PACE
                  </span>
                  <div className="hero-actions">
                    <button
                      className="primary"
                      disabled={!a.ready}
                      onClick={openVoiceOrder}
                    >
                      Tell OrderCheck what I ordered
                    </button>
                    <button className="secondary" onClick={() => void a.start()}>
                      Start checking my delivery
                    </button>
                  </div>
                  <h2>Create an order with your voice.</h2>
                  <p>
                    Describe your order naturally. Include the product name, quantity, size and variant when you know them. Review and confirm before saving.
                  </p>
                  <p className="hero-foot">
                    Screen-reader mode is the default. App spoken guidance is
                    optional in Accessibility settings.
                  </p>
                </div>
                <div className="parcel-scene" aria-hidden="true">
                  <div className="orbit" />
                  <Package size={100} />
                </div>
              </section>
              <section
                className="panel session-summary"
                aria-label="Current session"
              >
                <h2>Current session</h2>
                <p>{a.phase.replaceAll("-", " ")}</p>
                <p>
                  {a.ready
                    ? a.data.orders.length
                      ? `${a.stats.waiting} orders waiting. ${a.stats.unknown} lines have unknown quantities.`
                      : "No reference yet. Paste a confirmation, enter product details, or upload an image, PDF or text file."
                    : "Loading orders…"}
                </p>
              </section>
              <section className="stats" aria-label="Delivery progress">
                {[
                  ["Orders waiting to be checked", a.stats.waiting],
                  ["Items left to check", a.stats.left],
                  ["Items checked", a.stats.checked],
                ].map(([title, value]) => (
                  <div key={title}>
                    <div>
                      <span>{title}</span>
                      <strong>{a.ready ? value : "Loading…"}</strong>
                    </div>
                  </div>
                ))}
              </section>
              <p>
                Items are expected physical units with known quantities.{" "}
                {a.stats.unknown} lines have unknown quantities.{" "}
                {a.stats.matched} matching · {a.stats.mismatch} mismatching ·{" "}
                {a.stats.unresolved} unable to verify · {a.stats.unassigned}{" "}
                unassigned scans.
              </p>
              <div className="section-title">
                <h2>My Orders</h2>
                <button
                  className="text-button"
                  onClick={() => a.navigate("orders")}
                >
                  View all orders
                </button>
              </div>
              {a.ready && !a.data.orders.length ? (
                <section className="empty">
                  <Package aria-hidden="true" />
                  <h2>No orders yet</h2>
                  <p>
                    A purchase reference tells us what you expected. An order
                    number alone cannot retrieve an order.
                  </p>
                  <button className="primary" onClick={openVoiceOrder}>
                    Tell OrderCheck what I ordered
                  </button>
                </section>
              ) : (
                a.data.orders.map((o) => (
                  <article className="order-card" key={o.id}>
                    <div>
                      <h3>{o.label}</h3>
                      <p>
                        {o.items.length} product lines ·{" "}
                        {o.items.reduce((n, i) => n + i.verified, 0)} matching
                        units
                      </p>
                    </div>
                    <button
                      className="secondary"
                      onClick={() => void a.start()}
                    >
                      Check delivery
                    </button>
                  </article>
                ))
              )}
            </>
          )}
          {a.tab === "orders" && (
            <>
              <div className="toolbar">
                <h2>
                  {a.ready
                    ? `${a.data.orders.length} saved orders`
                    : "Loading orders…"}
                </h2>
                <button className="primary" disabled={!a.ready} onClick={openVoiceOrder}>Tell OrderCheck what I ordered</button>
              </div>
              {composing && <VoiceOrder
                save={(order, spoken) => { a.update({ ...a.data, orders: [...a.data.orders, order] }); setComposing(false); setVoiceSaved(true); a.navigate("orders"); void a.announce("Order saved in My Orders. Choose Scan this delivery, then Start camera when ready.", 3, spoken); }}
                close={() => { setComposing(false); void a.announce("Order cancelled. Nothing saved."); }}
                announce={a.speakOrder}
                stopSpeech={() => a.command("stop speaking")}
              />}
              {voiceSaved && !composing && a.data.orders.length > 0 && <section className="panel" aria-label="Order saved">
                <h2>Order saved. Ready to scan?</h2>
                <button ref={scanAfterSave} className="primary" onClick={() => a.navigate("scan")}>Scan this delivery</button>
              </section>}
              <details><summary>Other ways to add an order</summary><p>Import a purchase receipt or enter product lines manually.</p><button className="secondary" onClick={openImport}>Import an order</button></details>
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
                            {i.source.uncertain.join(", ") || "explicit fields"}
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
                <section className="panel" key={o.id}>
                  <div className="toolbar">
                    <h2>{o.label}</h2>
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
                  </div>
                  {o.platform && <p>Platform: {o.platform}</p>}
                  <p>
                    Reference:{" "}
                    {o.source ?? "previously saved purchase reference"}
                  </p>
                  {o.items.map((i) => (
                    <div className="order-line" key={i.id}>
                      <div>
                        <h3>{i.name}</h3>
                        <p>
                          {[i.brand && `Brand: ${i.brand}`, i.variant && `Variant: ${i.variant}`, i.size && `Size: ${i.size}`, ...Object.entries(i.attributes ?? {}).filter(([,v]) => v).map(([k,v]) => `${k}: ${v}`)].filter(Boolean).join(" · ")}
                        </p>
                      </div>
                      <span>
                        {i.quantity !== null && <span>Quantity: {i.quantity}. </span>}
                        <span>{i.verified} / {i.quantity ?? "unknown"} matching</span>
                      </span>
                    </div>
                  ))}
                  <p>
                    {o.items.every(
                      (i) => i.quantity !== null && i.verified === i.quantity,
                    )
                      ? "All expected units have matching evidence; contents were not checked."
                      : "Unmatched, unchecked or unresolved units remain."}
                  </p>
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
                      Correct details for {o.label}
                    </button>
                    <button className="primary" onClick={() => void a.start()}>
                      Scan delivery
                    </button>
                  </div>
                </section>
              ))}
              {a.ready && !a.data.orders.length && !importing && !composing && (
                <section className="empty">
                  <h2>No orders yet</h2>
                  <p>Import or enter a purchase reference first.</p>
                  <button className="secondary" onClick={openVoiceOrder}>
                    Tell OrderCheck what I ordered
                  </button>
                </section>
              )}
            </>
          )}
          {a.tab === "scan" && (!a.ready ? <p role="status">Loading orders…</p> : !a.data.orders.length ? <section className="panel" aria-label="Save an order first">
            <h2>Save an order before scanning a delivery.</h2>
            <button className="primary" onClick={openVoiceOrder}>Create an order</button>
          </section> : (
            <>
              <div className="scan-layout">
                <section className="panel">
                  <h2>Your camera assistant</h2>
                  <p>
                    Camera access is only for scanning. Hold the phone steady
                    with the rear camera toward one product. Follow the camera
                    guidance and rotate the product slowly when asked. Different products can
                    continue automatically. Repeated identities need
                    confirmation.
                  </p>
                  <div className="camera">
                    <video
                      ref={video}
                      autoPlay
                      muted
                      playsInline
                      aria-label="Live rear camera preview"
                      aria-describedby="camera-guidance"
                    />
                    {!a.camera && (
                      <div className="camera-placeholder">
                        <ScanLine size={50} aria-hidden="true" />
                        <span>Your camera is off</span>
                      </div>
                    )}
                  </div>
                  <p id="camera-guidance">{a.cameraGuidance}</p>
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
                        !a.camera || a.phase === "processing" || !!a.pending
                      }
                      onClick={() => void a.ocr()}
                    >
                      Read label with OCR
                    </button>
                  </div>
                  <p>
                    Automatic OCR reads well-lit, steady, detailed snapshots, one at a time. Camera instructions speak during scanning, even when general narration is off. Guidance uses image detail to suggest framing; it cannot measure distance. You can always choose Read label with OCR.{" "}
                    {a.ocrTime !== null &&
                      `Last OCR job: ${a.ocrTime} ms on this device.`}{" "}
                    Unknown codes require a readable label. The catalog contains
                    demonstration products only.
                  </p>
                </section>
                <section className="panel">
                  <span className="mini-label">YOUR CHECKING RESULT</span>
                  <h2>
                    {a.result
                      ? userStatus(a.result.status)
                      : "Ready for your first item"}
                  </h2>
                  <p>
                    {a.result?.message ??
                      "We compare observations with pending purchase references. Missing evidence never counts as a match."}
                  </p>
                  {a.result?.reason && <p>Reason: {a.result.reason}</p>}
                  {a.result?.fields && a.result.fields.length > 0 && (
                    <details>
                      <summary>What was checked</summary>
                      {a.result.fields.map((f) => (
                        <p key={f.field}>
                          {f.field}: {f.observed}. Source: {f.source}
                        </p>
                      ))}
                    </details>
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
                      <p>
                        A barcode cannot distinguish identical packages. Your
                        answer records quantity confirmation separately from
                        identity evidence.
                      </p>
                      <button className="primary" onClick={a.confirmAnother}>
                        Yes, another unit
                      </button>
                      <button className="secondary" onClick={a.retry}>
                        No, retry this unit
                      </button>
                    </section>
                  )}
                  <div className="button-row">
                    <button
                      className="secondary"
                      disabled={!commandAllowed("next", a.phase)}
                      onClick={a.nextItem}
                    >
                      Next item
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
                      disabled={!a.data.attempts.some((event) => !event.undone)}
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
                      a.check({ barcode: barcode.trim(), source: "manual" })
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
                  <p className="hint">
                    Entered label text is user-observed evidence, not machine
                    OCR. Example demo code: DEMO-OAT-ORIGINAL-1L.
                  </p>
                </section>
              </div>
              <section className="panel">
                <h2>
                  {a.phase === "finished"
                    ? "Checking complete"
                    : "Checking progress"}
                </h2>
                <p>
                  {a.stats.checked} of {a.stats.total} expected units checked.{" "}
                  {a.stats.matched} matching · {a.stats.mismatch} mismatching ·{" "}
                  {a.stats.unresolved} unable to verify · {a.stats.left} not yet
                  checked. {a.stats.unknown} lines have unknown quantities.{" "}
                  {a.stats.unassigned} scans are unassigned and do not reduce
                  any order&apos;s quantity.
                </p>
                {a.data.attempts
                  .filter((event) => !event.undone)
                  .map((event) => (
                    <p key={event.id}>
                      {userStatus(event.status)}: {event.message}{" "}
                      {event.confirmedAnotherUnit
                        ? "Another physical unit confirmed by user."
                        : ""}
                    </p>
                  ))}
              </section>
            </>
          ))}
          {a.tab === "settings" && (
            <section className="panel help">
              <h2>Choose your guidance</h2>
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
                    onChange={() => a.setPrefs((p) => ({ ...p, spoken: true }))}
                  />{" "}
                  App spoken guidance
                </label>
              </fieldset>
              <p>
                Screen-reader mode keeps semantic text and restrained live
                updates with no automatic app speech. The app never detects or
                controls your screen reader. App spoken guidance pauses
                recognition while speaking. Stop speaking and Stop remain
                available.
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
          )}
          {a.tab === "help" && (
            <section className="panel help">
              <h2>Start with what you ordered</h2>
              <ol>
                <li>
                  Paste or upload a purchase confirmation, or enter product
                  details manually. Correct only uncertain fields. A packing
                  slip describes delivered contents; it cannot independently
                  establish what you ordered.
                </li>
                <li>
                  Choose Start checking my delivery. Allow the camera only when
                  ready. Use stable phone support while turning one package at a
                  time. For an unknown barcode, turn to its full label and let
                  automatic OCR try, or choose Read label with OCR.
                </li>
                <li>
                  Read the result or opt into app spoken guidance. Different
                  identifiable products advance automatically. For identical
                  products, confirm another unit. Retry updates one attempt.
                  Undo reverses its event.
                </li>
              </ol>
              <h2>Commands and equivalent controls</h2>
              <p>
                Start, Stop, Repeat, Next, Help, Retry, Read my orders, Read the
                result again, Go back, Stop speaking. Only final, exact command
                phrases are accepted in a valid state. Choose Start listening
                for one window of up to 15 seconds. It ends after a command,
                silence or service failure. No background or locked-phone
                operation is promised.
              </p>
              <p>
                Recognition pauses during app speech, so voice interruption is
                unavailable during that pause. Use Stop speaking, Stop, or
                keyboard/assistive controls. Screen-reader speech may itself be
                recognized: start a listening window only when ready.
              </p>
              <h2>Results and recovery</h2>
              <p>
                <strong>match:</strong> consistent identifying fields for one
                reference line. Demo catalog identity or label fields were
                checked; package contents, authenticity and safety were not
                checked. <strong>mismatch:</strong> contrary identity or excess
                quantity. <strong>unable_to_verify:</strong> missing fields, low
                confidence, conflicting evidence, ambiguous order, unknown
                quantity or dependent reference. Internal CONFLICT and
                INCOMPLETE reasons remain available.
              </p>
              <p>
                Rotate an unreadable label slowly and Retry, or enter observed
                text/barcode. Next does not confirm a result or add a count.
                Unknown quantities stay labelled. Checking complete may include
                mismatches and unresolved units; it does not mean everything
                matched. Unassigned scans never complete a random order.
              </p>
              <h2>Privacy and browser limits</h2>
              <p>
                Images and text are processed in this browser. English OCR
                downloads worker/language assets from third-party CDNs; first
                use may need a network connection. No retailer/email integration
                or AI service is added. Voice recognition may send audio to a
                browser-vendor service and may need a network connection. Enable
                it only after reading the disclosure. Camera needs
                HTTPS/localhost; microphone is requested only when you
                explicitly start listening.
              </p>
              <p>
                Orders stay in memory unless you opt into tab-session storage.
                Clear orders removes those orders. Preferences are nonsensitive
                local storage. Do not store orders on a shared device. File
                limits: 10 MB, PDFs 20 pages, images/pages 12 megapixels, text
                100,000 characters. English receipt layouts vary; extracted
                fields remain drafts.
              </p>
              <p>
                Real iPhone/VoiceOver, Android/TalkBack, Windows screen-reader,
                camera, microphone and independent blind-user tests remain
                required. Automated checks are not certification.
              </p>
            </section>
          )}
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
              <button
                className="secondary"
                aria-keyshortcuts="Escape"
                onClick={stop}
              >
                Stop
              </button>
              <button className="secondary" disabled={composing} onClick={() => a.command("repeat")}>
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
                onClick={() => a.navigate("overview")}
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
              I understand voice commands may send audio to my browser provider
              and need a network connection.
            </label>
            <p>
              Start listening requests microphone permission when needed and
              opens a command window of up to 15 seconds. Listening pauses
              during app speech. Buttons and keyboard remain available.
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
            aria-live={a.prefs.spoken ? "off" : "polite"}
            aria-atomic="true"
          >
            <span key={a.noticeId}>{a.message}</span>
          </span>
        </div>
      </div>
    </div>
  );
}
