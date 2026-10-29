"use client";
import { useEffect, useRef, useState } from "react";
import {
  ArrowRight,
  AudioLines,
  Check,
  CheckCheck,
  ChevronRight,
  CircleHelp,
  FileText,
  Headphones,
  Package,
  Plus,
  ScanLine,
  ShieldCheck,
  Upload,
  Volume2,
  VolumeX,
  X,
} from "lucide-react";
import {
  applyMatch,
  extractOrder,
  orderSchema,
  sessionSchema,
  verify,
  type Item,
  type Order,
  type Evidence,
  type Verdict,
} from "@/lib/engine";
import { readImage, readImport } from "@/lib/media";
type Tab = "overview" | "orders" | "scan" | "help";
export default function Home() {
  const [tab, setTab] = useState<Tab>("overview");
  const [orders, setOrders] = useState<Order[]>([]);
  const [voice, setVoice] = useState(true);
  const [message, setMessage] = useState("Ready when you are.");
  const [text, setText] = useState("");
  const [label, setLabel] = useState("My delivery");
  const [draft, setDraft] = useState<Item[]>([]);
  const [importing, setImporting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [camera, setCamera] = useState(false);
  const [barcode, setBarcode] = useState("");
  const [result, setResult] = useState<Verdict | null>(null);
  const [remember, setRemember] = useState(false);
  const [ready, setReady] = useState(false);
  const [armed, setArmed] = useState(true);
  const video = useRef<HTMLVideoElement>(null);
  const controls = useRef<{ stop: () => void } | null>(null);
  const ordersRef = useRef(orders);
  const voiceRef = useRef(voice);
  const armedRef = useRef(true);
  const mounted = useRef(true);
  const scanGeneration = useRef(0);
  const [lastMatch, setLastMatch] = useState<Order[] | null>(null);
  const lastScan = useRef({ code: "", at: 0 });
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    ordersRef.current = orders;
  }, [orders]);
  useEffect(() => {
    voiceRef.current = voice;
  }, [voice]);
  useEffect(() => {
    mounted.current = true;
    queueMicrotask(() => {
      if (!mounted.current) return;
      try {
        const saved = sessionStorage.getItem("ordercheck.v1");
        if (saved) {
          setOrders(sessionSchema.parse(JSON.parse(saved)));
          setRemember(true);
        }
      } catch {
        sessionStorage.removeItem("ordercheck.v1");
      }
      setReady(true);
    });
    return () => {
      mounted.current = false;
      controls.current?.stop();
    };
  }, []);
  useEffect(() => {
    if (ready) {
      if (remember)
        sessionStorage.setItem("ordercheck.v1", JSON.stringify(orders));
      else sessionStorage.removeItem("ordercheck.v1");
    }
  }, [orders, remember, ready]);
  function say(s: string) {
    setMessage(s);
    if (voiceRef.current && "speechSynthesis" in window) {
      speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(s);
      utterance.rate = 0.95;
      speechSynthesis.speak(utterance);
    }
  }
  function stopCamera() {
    scanGeneration.current++;
    controls.current?.stop();
    controls.current = null;
    if (video.current?.srcObject)
      (video.current.srcObject as MediaStream)
        .getTracks()
        .forEach((t) => t.stop());
    setCamera(false);
  }
  function navigate(next: Tab) {
    if (next !== "scan") stopCamera();
    setTab(next);
    requestAnimationFrame(() => heading.current?.focus());
  }
  function check(evidence: Evidence) {
    if (!armedRef.current) return;
    const verdict = verify(ordersRef.current, evidence);
    setResult(verdict);
    say(verdict.message);
    if (verdict.status === "MATCH") {
      setLastMatch(structuredClone(ordersRef.current));
      const next = applyMatch(ordersRef.current, verdict);
      ordersRef.current = next;
      setOrders(next);
      armedRef.current = false;
      setArmed(false);
      if (navigator.vibrate) navigator.vibrate(100);
      if (next.every((o) => o.items.every((i) => i.verified === i.quantity)))
        say(verdict.message + " All deliveries complete.");
    }
  }
  async function startCamera() {
    if (camera || controls.current) return;
    const generation = ++scanGeneration.current;
    setCamera(true);
    say(
      "Opening rear camera. Hold the package about 20 centimetres away. Slowly turn it until the barcode faces the camera.",
    );
    try {
      const { BrowserMultiFormatReader } = await import("@zxing/browser");
      if (!mounted.current || generation !== scanGeneration.current) return;
      const reader = new BrowserMultiFormatReader();
      const control = await reader.decodeFromConstraints(
        { video: { facingMode: { ideal: "environment" } }, audio: false },
        video.current!,
        (found) => {
          if (
            mounted.current &&
            generation === scanGeneration.current &&
            found &&
            armedRef.current
          ) {
            const code = found.getText();
            if (
              code !== lastScan.current.code ||
              Date.now() - lastScan.current.at > 6000
            ) {
              lastScan.current = { code, at: Date.now() };
              check({ barcode: code });
            }
          }
        },
      );
      if (!mounted.current || generation !== scanGeneration.current)
        control.stop();
      else controls.current = control;
    } catch {
      if (generation === scanGeneration.current) {
        setCamera(false);
        say(
          "Camera unavailable. Allow camera access in your browser, use HTTPS or localhost, or enter a barcode below.",
        );
      }
    }
  }
  async function ocr() {
    if (!video.current || !camera || !video.current.videoWidth) {
      say("Start the camera and wait for the preview before reading a label.");
      return;
    }
    setBusy(true);
    say("Reading label. Keep the package still in even lighting.");
    try {
      const canvas = document.createElement("canvas");
      canvas.width = video.current.videoWidth;
      canvas.height = video.current.videoHeight;
      canvas.getContext("2d")!.drawImage(video.current, 0, 0);
      check(await readImage(canvas.toDataURL("image/png")));
    } catch {
      say("Could not read the label. Try again with more light.");
    } finally {
      setBusy(false);
    }
  }
  async function upload(file?: File) {
    if (!file) return;
    setBusy(true);
    say("Reading your order. You will review extracted details before saving.");
    try {
      setText(await readImport(file));
      say("Text extracted. Review it, then choose Extract products.");
    } catch (e) {
      say(
        e instanceof Error
          ? e.message
          : "Could not read file. Paste the order text instead.",
      );
    } finally {
      setBusy(false);
    }
  }
  function save() {
    const parsed = orderSchema.safeParse({
      id: crypto.randomUUID(),
      label,
      items: draft,
    });
    if (!parsed.success) {
      say(
        "Check the order name, product names and quantities. Quantities must be whole numbers from 1 to 999.",
      );
      return;
    }
    setLastMatch(null);
    setOrders((previous) => [...previous, parsed.data]);
    setDraft([]);
    setText("");
    setImporting(false);
    say("Order saved. You can now scan your delivery.");
    navigate("orders");
  }
  const total = orders.reduce(
    (n, o) => n + o.items.reduce((a, i) => a + i.quantity, 0),
    0,
  );
  const complete = orders.reduce(
    (n, o) => n + o.items.reduce((a, i) => a + i.verified, 0),
    0,
  );
  const pending = orders.filter((o) =>
    o.items.some((i) => i.verified < i.quantity),
  );
  return (
    <>
      <a className="skip" href="#main">
        Skip to content
      </a>
      <aside className="sidebar">
        <a className="brand" href="#main" onClick={() => navigate("overview")}>
          <span className="brand-icon">
            <CheckCheck size={23} />
          </span>
          OrderCheck<span className="ai">AI</span>
        </a>
        <div className="workspace">YOUR EVERYDAY ASSISTANT</div>
        <nav aria-label="Main navigation">
          {(
            [
              ["overview", Package, "Overview"],
              ["orders", FileText, "My orders"],
              ["scan", ScanLine, "Scan a delivery"],
              ["help", CircleHelp, "Help & guidance"],
            ] as const
          ).map(([id, Icon, title]) => (
            <button
              key={id}
              className={tab === id ? "nav active" : "nav"}
              aria-current={tab === id ? "page" : undefined}
              onClick={() => navigate(id)}
            >
              <Icon size={20} />
              {title}
              {id === "orders" && pending.length > 0 && (
                <span className="badge">{pending.length}</span>
              )}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="privacy">
            <ShieldCheck size={22} />
            <strong>Your privacy comes first</strong>
            <p>Your orders stay on this device. You’re in control.</p>
          </div>
          <div className="profile">
            <span className="avatar">U</span>
            <div>
              <strong>Your personal space</strong>
              <small>No account needed</small>
            </div>
          </div>
        </div>
      </aside>
      <div className="shell">
        <header>
          <span>Every delivery. A little more independent.</span>
          <button
            className="voice-toggle"
            aria-pressed={voice}
            onClick={() => {
              setVoice(!voice);
              voiceRef.current = !voice;
              if (voice && "speechSynthesis" in window)
                speechSynthesis.cancel();
              else say("Voice guidance on.");
            }}
          >
            {voice ? <Volume2 size={18} /> : <VolumeX size={18} />}Voice
            guidance {voice ? "on" : "off"}
            <span className={voice ? "toggle on" : "toggle"} />
          </button>
        </header>
        <main id="main">
          <div className="page-heading">
            <div>
              <div className="eyebrow">
                A LITTLE CERTAINTY IN EVERY DELIVERY
              </div>
              <h1 ref={heading} tabIndex={-1}>
                {tab === "overview"
                  ? "Welcome to OrderCheck."
                  : tab === "orders"
                    ? "Your orders, all in one place."
                    : tab === "scan"
                      ? "Let’s check your delivery."
                      : "A helping hand, whenever you need it."}
              </h1>
              <p>
                {tab === "overview"
                  ? "Know what arrived. Feel confident about what’s next."
                  : tab === "orders"
                    ? "Review the details. We’ll take care of finding the match."
                    : tab === "scan"
                      ? "Point your camera at the barcode or read the full product label."
                      : "Simple steps, spoken guidance, and you in control."}
              </p>
            </div>
            <span className="local-pill">
              <span />
              Private on your device
            </span>
          </div>
          {tab === "overview" && (
            <>
              <section className="hero">
                <div className="hero-copy">
                  <span className="mini-label">
                    <AudioLines size={16} /> BUILT TO GUIDE YOU
                  </span>
                  <h2>
                    Your delivery.
                    <br />
                    Checked with confidence.
                  </h2>
                  <p>
                    Import your order, scan what’s arrived, and hear whether it
                    matches. One less thing to wonder about.
                  </p>
                  <div className="hero-actions">
                    <button
                      className="primary"
                      onClick={() => {
                        navigate("orders");
                        setImporting(true);
                      }}
                    >
                      <Plus size={19} />
                      Import an order
                      <ArrowRight size={18} />
                    </button>
                    <button
                      className="secondary"
                      onClick={() => navigate("scan")}
                    >
                      <ScanLine size={19} />
                      Scan a delivery
                    </button>
                  </div>
                  <div className="hero-foot">
                    <Headphones size={16} />
                    Voice-guided. Screen-reader friendly. Made for you.
                  </div>
                </div>
                <div className="parcel-scene" aria-hidden="true">
                  <div className="orbit orbit-one" />
                  <div className="orbit orbit-two" />
                  <div className="spark s1">+</div>
                  <div className="spark s2">+</div>
                  <div className="parcel">
                    <div className="tape" />
                    <div className="shipping-label">
                      <div className="label-line" />
                      <div className="label-line short" />
                      <div className="barcode-art" />
                    </div>
                    <div className="box-mark">↑ ↑</div>
                  </div>
                  <div className="verified-chip">
                    <span>
                      <Check size={19} />
                    </span>
                    <div>
                      <strong>A little peace of mind</strong>
                      <small>One scan at a time</small>
                    </div>
                  </div>
                </div>
              </section>
              <section className="stats" aria-label="Delivery progress">
                <div>
                  <span className="stat-icon">
                    <Package />
                  </span>
                  <div>
                    <span>Pending orders</span>
                    <strong>{pending.length}</strong>
                  </div>
                  <small>Ready to check</small>
                </div>
                <div>
                  <span className="stat-icon">
                    <ScanLine />
                  </span>
                  <div>
                    <span>Items to verify</span>
                    <strong>{total - complete}</strong>
                  </div>
                  <small>We’ll guide you through</small>
                </div>
                <div>
                  <span className="stat-icon">
                    <CheckCheck />
                  </span>
                  <div>
                    <span>Items verified</span>
                    <strong>{complete}</strong>
                  </div>
                  <small>A little more certainty</small>
                </div>
              </section>
              <div className="section-title">
                <h2>
                  Your pending orders <span>{pending.length}</span>
                </h2>
                <button
                  className="text-button"
                  onClick={() => navigate("orders")}
                >
                  View all orders
                  <ArrowRight size={16} />
                </button>
              </div>
              {pending.length ? (
                pending
                  .slice(0, 3)
                  .map((o) => (
                    <OrderCard
                      key={o.id}
                      order={o}
                      onScan={() => navigate("scan")}
                    />
                  ))
              ) : (
                <section className="empty">
                  <div className="empty-icon">
                    <Package size={30} />
                  </div>
                  <h3>A fresh start for your next delivery</h3>
                  <p>
                    Bring in an order confirmation and we’ll help you check
                    <br className="desktop-break" /> every item when it arrives.
                  </p>
                  <button
                    className="text-button"
                    onClick={() => {
                      navigate("orders");
                      setImporting(true);
                    }}
                  >
                    Import your first order
                    <ArrowRight size={17} />
                  </button>
                </section>
              )}
              <section className="how">
                <div>
                  <span className="mini-label">A SIMPLE ROUTINE</span>
                  <h2>From doorstep to peace of mind.</h2>
                </div>
                {[
                  [
                    "01",
                    "Bring in your order",
                    "Paste a confirmation or upload a file.",
                  ],
                  [
                    "02",
                    "Scan what’s arrived",
                    "Let your camera find the product details.",
                  ],
                  [
                    "03",
                    "Hear the result",
                    "Know what matches and what needs a look.",
                  ],
                ].map(([n, title, desc]) => (
                  <div className="step" key={n}>
                    <span>{n}</span>
                    <h3>{title}</h3>
                    <p>{desc}</p>
                  </div>
                ))}
              </section>
            </>
          )}
          {tab === "orders" && (
            <>
              <div className="toolbar">
                <h2>
                  {orders.length} saved{" "}
                  {orders.length === 1 ? "order" : "orders"}
                </h2>
                <button
                  className="primary"
                  onClick={() => setImporting(!importing)}
                >
                  <Plus size={18} />
                  Import an order
                </button>
              </div>
              {importing && (
                <section className="panel">
                  <h2>Bring in an order</h2>
                  <p>
                    Paste confirmation text or upload an image or PDF.
                    Extraction is a draft: confirm every product and quantity.
                    Missing information stays blank.
                  </p>
                  <label>
                    Order name
                    <input
                      value={label}
                      onChange={(e) => setLabel(e.target.value)}
                      maxLength={120}
                    />
                  </label>
                  <label>
                    Confirmation text
                    <textarea
                      rows={6}
                      value={text}
                      onChange={(e) => setText(e.target.value)}
                      placeholder={
                        "Product | Brand | Variant | Size | Quantity\nOat drink | Everyday | Original | 1 L | 2"
                      }
                    />
                  </label>
                  <p className="hint">
                    For reliable extraction, use one product per line. Optional
                    fields: Product | Brand | Variant | Size | Quantity. Unknown
                    quantities default to 1 for review.
                  </p>
                  <label className="file-label">
                    <Upload size={18} />
                    Upload image, PDF or text
                    <input
                      type="file"
                      accept="image/png,image/jpeg,image/webp,application/pdf,text/plain"
                      disabled={busy}
                      onChange={(e) => void upload(e.target.files?.[0])}
                    />
                  </label>
                  <button
                    className="primary"
                    disabled={busy || !text.trim()}
                    onClick={() => {
                      setDraft(extractOrder(text));
                      say(
                        "Review extracted products. Correct missing details and quantities before saving.",
                      );
                    }}
                  >
                    Extract products
                    <ArrowRight size={17} />
                  </button>
                  {draft.map((i, index) => (
                    <fieldset key={i.id}>
                      <legend>Product {index + 1}</legend>
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
                              : key.charAt(0).toUpperCase() + key.slice(1)}
                            <input
                              type={key === "quantity" ? "number" : "text"}
                              min={key === "quantity" ? 1 : undefined}
                              max={key === "quantity" ? 999 : undefined}
                              value={i[key]}
                              onChange={(e) =>
                                setDraft((d) =>
                                  d.map((x) =>
                                    x.id === i.id
                                      ? {
                                          ...x,
                                          [key]:
                                            key === "quantity"
                                              ? Number(e.target.value)
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
                      <Check size={18} />
                      Confirm and save order
                    </button>
                  )}
                </section>
              )}
              {orders.map((o) => (
                <section className="panel" key={o.id}>
                  <div className="toolbar">
                    <h2>{o.label}</h2>
                    <button
                      className="text-button danger"
                      onClick={() => {
                        setLastMatch(null);
                        setOrders((p) => p.filter((x) => x.id !== o.id));
                        say("Order removed.");
                      }}
                    >
                      Remove order
                    </button>
                  </div>
                  {o.items.map((i) => (
                    <div className="order-line" key={i.id}>
                      <div>
                        <strong>{i.name}</strong>
                        <p>
                          {[i.brand, i.variant, i.size]
                            .filter(Boolean)
                            .join(" · ") ||
                            "Details missing — complete them before relying on OCR."}
                        </p>
                      </div>
                      <span>
                        {i.verified} / {i.quantity} verified
                      </span>
                    </div>
                  ))}
                  <div className="toolbar">
                    <span>
                      {o.items.every((i) => i.verified === i.quantity)
                        ? "Delivery complete"
                        : "Awaiting verification"}
                    </span>
                    <button
                      className="secondary"
                      onClick={() => {
                        setDraft(
                          o.items.map((i) => ({
                            ...i,
                            id: crypto.randomUUID(),
                            verified: 0,
                          })),
                        );
                        setLabel(o.label + " (corrected)");
                        setImporting(true);
                        say(
                          "Correction creates a new order with counts reset. Remove the old order after saving to avoid conflicts.",
                        );
                      }}
                    >
                      Correct details
                    </button>
                    <button
                      className="primary"
                      onClick={() => navigate("scan")}
                    >
                      Scan delivery
                      <ScanLine size={18} />
                    </button>
                  </div>
                </section>
              ))}
              {!orders.length && !importing && (
                <div className="empty">
                  <Package />
                  <h2>No orders yet</h2>
                  <p>Import your order confirmation to get started.</p>
                </div>
              )}
            </>
          )}
          {tab === "scan" && (
            <div className="scan-layout">
              <section className="panel">
                <h2>
                  <ScanLine size={22} /> Your camera assistant
                </h2>
                <p>
                  Hold the label 15–25 cm away in even light. Slowly rotate the
                  package. A successful match counts one item and pauses
                  counting until you choose Next item.
                </p>
                <div className="camera">
                  <video
                    ref={video}
                    autoPlay
                    muted
                    playsInline
                    aria-label="Live rear camera preview"
                  />
                  {!camera && (
                    <div className="camera-placeholder">
                      <ScanLine size={54} />
                      <span>Your camera is off</span>
                      <small>Start when you’re ready</small>
                    </div>
                  )}
                </div>
                <div className="button-row">
                  <button
                    className="primary"
                    onClick={() => (camera ? stopCamera() : void startCamera())}
                  >
                    {camera ? "Stop camera" : "Start camera"}
                    <ScanLine size={18} />
                  </button>
                  <button
                    className="secondary"
                    disabled={!camera || busy || !armed}
                    onClick={() => void ocr()}
                  >
                    {busy ? "Reading label…" : "Read label with OCR"}
                  </button>
                </div>
                <p className="hint">
                  Unknown barcode? Try OCR. Recognition needs the product name,
                  brand, variant and size. Demo catalog only; real retailer
                  codes need catalog integration.
                </p>
              </section>
              <section className="panel">
                <span className="mini-label">YOUR SCAN RESULT</span>
                <h2>{result?.status ?? "Ready for your first item"}</h2>
                <p>
                  {result?.message ??
                    "We automatically compare each scan with all your pending orders."}
                </p>
                {!armed && (
                  <button
                    className="primary"
                    onClick={() => {
                      armedRef.current = true;
                      setArmed(true);
                      setResult(null);
                      say(
                        "Ready for the next item. Move the previous product away before scanning.",
                      );
                    }}
                  >
                    Next item
                    <ArrowRight size={18} />
                  </button>
                )}
                {lastMatch && (
                  <button
                    className="secondary"
                    onClick={() => {
                      const previous = lastMatch;
                      if (previous) {
                        setOrders(previous);
                        ordersRef.current = previous;
                        setLastMatch(null);
                        setResult(null);
                        armedRef.current = true;
                        setArmed(true);
                        say("Last verification undone. Ready to retry.");
                      }
                    }}
                  >
                    Undo last verification
                  </button>
                )}
                <hr />
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
                  disabled={!barcode.trim() || !armed}
                  onClick={() => check({ barcode: barcode.trim() })}
                >
                  Check barcode
                </button>
                <p className="hint">
                  Try DEMO-OAT-ORIGINAL-1L with a matching demo order.
                  Demonstration codes are not real product barcodes.
                </p>
                <div className="progress-summary">
                  <CheckCheck size={22} />
                  <strong>
                    {complete} of {total} items verified
                  </strong>
                </div>
              </section>
            </div>
          )}
          {tab === "help" && (
            <section className="panel help">
              <h2>Check a delivery in three steps</h2>
              <ol>
                <li>
                  Import a confirmation. Review product name, brand, variant,
                  size and quantity. Save your order.
                </li>
                <li>
                  Start the camera and point it at a barcode. For unknown codes,
                  turn to the full label and select Read label with OCR.
                </li>
                <li>
                  Listen for the result. After a match, move the product aside
                  and choose Next item. Use Undo for an accidental count.
                </li>
              </ol>
              <h2>What the results mean</h2>
              <p>
                <strong>MATCH:</strong> evidence identifies one outstanding
                order line. One unit is counted.
              </p>
              <p>
                <strong>MISMATCH:</strong> identified product is not
                outstanding, or the ordered quantity is complete.
              </p>
              <p>
                <strong>CONFLICT:</strong> more than one line could match, or
                evidence disagrees. Correct duplicate orders and retry.
              </p>
              <p>
                <strong>INCOMPLETE:</strong> evidence is missing or uncertain.
                Improve lighting, rotate the package, or complete order details.
              </p>
              <h2>Accessibility and privacy</h2>
              <p>
                Every control supports a keyboard and screen reader. Results are
                announced in a live region. Turn off built-in voice if your
                screen reader speaks the results twice. Voice guidance uses your
                device’s speech service, whose processing depends on your
                operating system.
              </p>
              <p>
                Images and order contents are processed in your browser. OCR
                downloads its worker and English language model from third-party
                CDNs on first use. No order data is sent to an AI service.
                Session storage is optional and cleared by Clear orders; do not
                use it on shared devices. Camera access requires HTTPS or
                localhost.
              </p>
              <p>
                This initial catalog contains illustrative products only. No
                medical, allergen or safety conclusions are made. Real product
                coverage requires a trusted retailer catalog.
              </p>
            </section>
          )}
          <footer>
            <span>
              <ShieldCheck size={15} />
              Designed for independence. Built with care.
            </span>
            <button className="text-button" onClick={() => navigate("help")}>
              Need a hand?
              <ChevronRight size={16} />
            </button>
          </footer>
          <section className="session-controls" aria-label="Privacy controls">
            <label>
              <input
                type="checkbox"
                checked={remember}
                onChange={(e) => setRemember(e.target.checked)}
              />
              Keep orders in this browser tab for this session
            </label>
            <button
              className="text-button danger"
              onClick={() => {
                stopCamera();
                setOrders([]);
                ordersRef.current = [];
                setDraft([]);
                setText("");
                setResult(null);
                setLastMatch(null);
                setRemember(false);
                sessionStorage.removeItem("ordercheck.v1");
                armedRef.current = true;
                setArmed(true);
                say("All orders and verification history cleared.");
              }}
            >
              <X size={14} />
              Clear orders
            </button>
          </section>
        </main>
        <div className="audio-status">
          <span>
            <AudioLines size={18} />
            <span role="status" aria-live="polite" aria-atomic="true">
              {message}
            </span>
          </span>
          <button
            aria-label="Repeat spoken guidance"
            onClick={() => say(message)}
          >
            <Volume2 size={19} />
          </button>
        </div>
      </div>
    </>
  );
}
function OrderCard({ order, onScan }: { order: Order; onScan: () => void }) {
  const done = order.items.reduce((n, i) => n + i.verified, 0);
  const total = order.items.reduce((n, i) => n + i.quantity, 0);
  return (
    <article className="order-card">
      <span className="stat-icon">
        <Package />
      </span>
      <div>
        <h3>{order.label}</h3>
        <p>
          {done} of {total} items verified
        </p>
      </div>
      <button className="secondary" onClick={onScan}>
        Check delivery
        <ArrowRight size={16} />
      </button>
    </article>
  );
}
