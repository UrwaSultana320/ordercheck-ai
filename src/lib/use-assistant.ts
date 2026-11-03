"use client";
import { useEffect, useRef, useState, type RefObject } from "react";
import {
  verify,
  recordAttempt,
  undoAttempt,
  progress,
  savedStateSchema,
  sessionSchema,
  type CheckState,
  type Evidence,
  type Verdict,
  type Attempt,
} from "./engine";
import { OcrReader } from "./media";
import { analyzeFrame, CameraGuidance, GuidanceAnnouncements, GUIDANCE } from "./camera-guidance";
import { orderStorage } from "./order-storage";
import { newId } from "./id";
import { VoiceController, browserVoiceHost } from "./voice";
import {
  PresentationGate,
  commandAllowed,
  type Command,
  type SessionState,
} from "./session";

export type Tab = "overview" | "orders" | "scan" | "help" | "settings";
export type Preferences = {
  spoken: boolean;
  size: "normal" | "large" | "extra-large";
  contrast: boolean;
  rate: number;
};
type Pending = {
  evidence: Evidence;
  verdict: Verdict;
  another: boolean;
  retry?: string;
};
const initial: CheckState = { orders: [], attempts: [] };
export function useAssistant(
  video: RefObject<HTMLVideoElement | null>,
  heading: RefObject<HTMLHeadingElement | null>,
) {
  const [tab, setTab] = useState<Tab>("overview");
  const [data, setData] = useState<CheckState>(initial),
    dataRef = useRef(data);
  const [prefs, setPrefs] = useState<Preferences>({
    spoken: false,
    size: "normal",
    contrast: false,
    rate: 0.95,
  });
  const [ready, setReady] = useState(false),
    [remember, setRemember] = useState(false);
  const [storageError, setStorageError] = useState("");
  const [message, setMessage] = useState("Loading saved orders…"),
    messageRef = useRef(message);
  const [noticeId, setNoticeId] = useState(0);
  const [phase, setPhase] = useState<SessionState>("idle"),
    phaseRef = useRef<SessionState>("idle");
  const [listening, setListening] = useState(false),
    [speaking, setSpeaking] = useState(false);
  const [camera, setCamera] = useState(false),
    [result, setResult] = useState<Verdict | null>(null);
  const [pending, setPending] = useState<Pending | null>(null),
    pendingRef = useRef<Pending | null>(null);
  const retryId = useRef<string | undefined>(undefined);
  const [cameraGuidance, setCameraGuidance] = useState("");
  const [ocrTime, setOcrTime] = useState<number | null>(null);
  const voice = useRef<VoiceController | null>(null),
    stream = useRef<MediaStream | null>(null);
  const controls = useRef<{ stop(): void } | null>(null),
    reader = useRef<OcrReader | null>(null);
  const snapshotDecoder = useRef<{
    decodeFromCanvas(canvas: HTMLCanvasElement): { getText(): string };
  } | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null),
    ocrBusy = useRef(false);
  const generation = useRef(0),
    sessionId = useRef(""),
    mounted = useRef(false);
  const gate = useRef(new PresentationGate());
  const actions = useRef<{
    command(c: Command): void;
    stop(): void;
    check(e: Evidence): void;
    ocr(automatic?: boolean): Promise<void>;
  } | null>(null);
  function phaseTo(next: SessionState) {
    phaseRef.current = next;
    setPhase(next);
  }
  function update(next: CheckState) {
    dataRef.current = next;
    setData(next);
  }
  function announce(s: string, priority = 1, explicit = false) {
    if (priority === 0 && messageRef.current === s) return Promise.resolve();
    messageRef.current = s;
    setMessage(s);
    setNoticeId((n) => n + 1);
    return voice.current?.say(s, priority, explicit) ?? Promise.resolve();
  }
  function pendingTo(next: Pending | null) {
    pendingRef.current = next;
    setPending(next);
  }
  function releaseCamera() {
    generation.current++;
    controls.current?.stop();
    controls.current = null;
    snapshotDecoder.current = null;
    stream.current?.getTracks().forEach((t) => t.stop());
    stream.current = null;
    if (video.current) video.current.srcObject = null;
    if (timer.current) clearInterval(timer.current);
    timer.current = null;
    reader.current?.close();
    reader.current = null;
    ocrBusy.current = false;
    setCamera(false);
    setCameraGuidance("");
  }
  function stop() {
    releaseCamera();
    voice.current?.stop();
    pendingTo(null);
    retryId.current = undefined;
    phaseTo("paused");
    messageRef.current =
      "Stopped scanning and listening. Confirmed results are preserved.";
    setMessage(messageRef.current);
  }
  function navigate(next: Tab) {
    if (next !== "scan") {
      releaseCamera();
      if (
        [
          "scanning",
          "processing",
          "requesting-permission",
          "announcing-result",
        ].includes(phaseRef.current)
      )
        phaseTo("paused");
    }
    voice.current?.stopListening();
    setTab(next);
    requestAnimationFrame(() => heading.current?.focus());
  }
  useEffect(() => {
    actions.current = { command, stop, check, ocr };
  });
  useEffect(() => {
    mounted.current = true;
    voice.current = new VoiceController(browserVoiceHost(), {
      command: (c) => actions.current?.command(c),
      listening: setListening,
      speaking: setSpeaking,
      error: (s) => {
        if (mounted.current) {
          messageRef.current = s;
          setMessage(s);
        }
      },
    });
    queueMicrotask(() => {
      if (!mounted.current) return;
      try {
        const raw = orderStorage.getPreference();
        if (raw) {
          const p = JSON.parse(raw);
          setPrefs({
            spoken: p.spoken === true,
            contrast: p.contrast === true,
            size: ["normal", "large", "extra-large"].includes(p.size)
              ? p.size
              : "normal",
            rate:
              typeof p.rate === "number" && p.rate >= 0.6 && p.rate <= 1.4
                ? p.rate
                : 0.95,
          });
        }
      } catch {
        setStorageError(
          "Preferences could not be loaded; controls still work for this visit.",
        );
      }
      try {
        const saved = orderStorage.getSession(),
          legacy = orderStorage.getLegacySession();
        if (saved || legacy) {
          const parsed = saved
            ? savedStateSchema.parse(JSON.parse(saved))
            : {
                orders: sessionSchema.parse(JSON.parse(legacy!)),
                attempts: [],
              };
          dataRef.current = parsed;
          setData(parsed);
          setRemember(true);
        }
      } catch {
        setStorageError(
          "Saved orders could not be loaded. Stored data was preserved; you can import a reference for this visit.",
        );
      }
      setReady(true);
      setMessage(
        "Ready. Start checking, or add your purchase reference first.",
      );
    });
    const pause = () => {
      if (document.visibilityState !== "visible") actions.current?.stop();
    };
    const blur = () => actions.current?.stop();
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") actions.current?.stop();
    };
    document.addEventListener("visibilitychange", pause);
    window.addEventListener("blur", blur);
    window.addEventListener("keydown", escape);
    const invalidatePendingCaptures = () => {
      generation.current++;
    };
    return () => {
      mounted.current = false;
      invalidatePendingCaptures();
      voice.current?.stop();
      controls.current?.stop();
      stream.current?.getTracks().forEach((t) => t.stop());
      if (timer.current) clearInterval(timer.current);
      reader.current?.close();
      document.removeEventListener("visibilitychange", pause);
      window.removeEventListener("blur", blur);
      window.removeEventListener("keydown", escape);
    };
  }, []);
  useEffect(() => {
    if (voice.current) {
      voice.current.enabled = prefs.spoken;
      voice.current.rate = prefs.rate;
      if (!prefs.spoken) voice.current.cancelSpeech();
    }
    if (ready)
      try {
        orderStorage.setPreference(JSON.stringify(prefs));
      } catch {
        queueMicrotask(() =>
          setStorageError(
            "Preferences cannot be saved; they apply for this visit.",
          ),
        );
      }
  }, [prefs, ready]);
  useEffect(() => {
    if (ready && remember)
      try {
        orderStorage.setSession(JSON.stringify(data));
      } catch {
        queueMicrotask(() =>
          setStorageError(
            "Orders could not be saved in this tab. They remain until you close or reload it.",
          ),
        );
      }
  }, [data, remember, ready]);
  function storageOff() {
    setRemember(false);
    try {
      orderStorage.clearSession();
    } catch {
      setStorageError(
        "Storage could not be cleared. Use browser site-data controls.",
      );
    }
  }
  async function start() {
    if (!ready) return;
    if (!dataRef.current.orders.length) {
      navigate("orders");
      phaseTo("awaiting-reference");
      void announce(
        "Welcome. No purchase reference yet. Tell OrderCheck what you ordered, then review and confirm. Receipt import remains available under Other ways to add an order.",
      );
      return;
    }
    navigate("scan");
    void announce(
      `Welcome. ${progress(dataRef.current).waiting} orders waiting to be checked. Camera is requested only for scanning. Put the phone on a stable support, rear camera toward one package about 20 centimetres away. Rotate the package slowly.`,
    );
    const intent = ++generation.current;
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => resolve()),
    );
    if (mounted.current && intent === generation.current) await startCamera();
  }
  async function startCamera() {
    if (stream.current || phaseRef.current === "requesting-permission") return;
    const epoch = ++generation.current;
    sessionId.current = newId();
    gate.current = new PresentationGate();
    phaseTo("requesting-permission");
    try {
      if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia)
        throw new Error(
          "Camera requires HTTPS or localhost and a supported browser.",
        );
      const acquired = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: "environment" } },
        audio: false,
      });
      if (!mounted.current || epoch !== generation.current) {
        acquired.getTracks().forEach((t) => t.stop());
        return;
      }
      stream.current = acquired;
      const { BrowserMultiFormatReader } = await import("@zxing/browser");
      if (epoch !== generation.current || !video.current) {
        acquired.getTracks().forEach((t) => t.stop());
        return;
      }
      const decoder = new BrowserMultiFormatReader();
      snapshotDecoder.current = decoder;
      const control = await decoder.decodeFromStream(
        acquired,
        video.current,
        (found) => {
          if (
            !found ||
            epoch !== generation.current ||
            !mounted.current ||
            !["scanning", "awaiting-next-item"].includes(phaseRef.current)
          )
            return;
          const code = found.getText();
          if (gate.current.accept(`barcode:${code}`))
            actions.current?.check({
              barcode: code,
              captureId: newId(),
              sessionId: sessionId.current,
              source: "barcode",
              presentationId: `${sessionId.current}:${gate.current.epoch}`,
            });
        },
      );
      if (epoch !== generation.current) {
        control.stop();
        acquired.getTracks().forEach((t) => t.stop());
        return;
      }
      controls.current = control;
      reader.current = new OcrReader();
      setCamera(true);
      phaseTo("scanning");
      setCameraGuidance("Camera started. Hold one label in view.");
      const analysis = document.createElement("canvas");
      analysis.width = 96;
      analysis.height = 72;
      const ctx = analysis.getContext("2d", { willReadFrequently: true });
      const tiny = document.createElement("canvas");
      tiny.width = tiny.height = 16;
      const tinyContext = tiny.getContext("2d", { willReadFrequently: true });
      const guidance = new CameraGuidance();
      const announcements = new GuidanceAnnouncements();
      let previous: Float32Array | undefined;
      let presentation = gate.current.epoch;
      let analysisFailed = false;
      let guidanceSpeaking = false;
      timer.current = setInterval(() => {
        const v = video.current;
        if (!v?.videoWidth || epoch !== generation.current ||
          document.visibilityState !== "visible") return;
        const scanning = !ocrBusy.current &&
          ["scanning", "awaiting-next-item"].includes(phaseRef.current);
        if (!scanning) guidance.reset();
        if (analysisFailed) return;
        try {
          if (!ctx || !tinyContext) throw new Error("Canvas unavailable");
          ctx.drawImage(v, 0, 0, 96, 72);
          const frame = analyzeFrame(ctx.getImageData(0, 0, 96, 72).data, 96, 72, previous);
          previous = frame.luminance;
          // Preserve the existing presentation/duplicate boundary independently.
          tinyContext.drawImage(v, 0, 0, 16, 16);
          const rgba = tinyContext.getImageData(0, 0, 16, 16).data;
          const pixels = Array.from({ length: 256 }, (_, i) =>
            (rgba[i * 4] + rgba[i * 4 + 1] + rgba[i * 4 + 2]) / 3);
          const stable = gate.current.sample(pixels);
          if (presentation !== gate.current.epoch) {
            presentation = gate.current.epoch;
            guidance.reset();
          }
          if (!scanning) return;
          const quality = guidance.sample(frame.metrics);
          if (quality.ready && stable) {
            if (gate.current.accept("ocr-frame")) void actions.current?.ocr(true);
          } else {
            const instruction = !guidanceSpeaking && announcements.next(
              quality.ready ? GUIDANCE.moving : quality.message,
              performance.now(),
            );
            if (instruction) {
              setCameraGuidance(instruction);
              guidanceSpeaking = true;
              void announce(instruction, 0).finally(() => { guidanceSpeaking = false; });
            }
          }
        } catch {
          analysisFailed = true;
          guidance.reset();
          if (scanning) {
            setCameraGuidance(GUIDANCE.unavailable);
            void announce(GUIDANCE.unavailable, 0);
          }
        }
      }, 700);
    } catch (error) {
      if (epoch === generation.current) {
        releaseCamera();
        phaseTo("error");
        void announce(
          `${error instanceof Error ? error.message : "Camera unavailable."} Allow camera access or enter a barcode or label below.`,
          3,
        );
      }
    }
  }
  async function ocr(automatic = false) {
    if (!["scanning", "awaiting-next-item"].includes(phaseRef.current)) return;
    const v = video.current;
    if (!v?.videoWidth || !reader.current || !stream.current || ocrBusy.current)
      return;
    const epoch = generation.current,
      canvas = document.createElement("canvas");
    const scale = Math.min(1, 1600 / Math.max(v.videoWidth, v.videoHeight));
    canvas.width = Math.round(v.videoWidth * scale);
    canvas.height = Math.round(v.videoHeight * scale);
    canvas.getContext("2d")!.drawImage(v, 0, 0, canvas.width, canvas.height);
    const presentationId = `${sessionId.current}:${gate.current.epoch}`;
    let snapshotBarcode: string | undefined;
    try {
      snapshotBarcode = snapshotDecoder.current
        ?.decodeFromCanvas(canvas)
        .getText();
    } catch {
      /* This frame need not contain a readable barcode. */
    }
    ocrBusy.current = true;
    phaseTo("processing");
    if (automatic) setCameraGuidance(GUIDANCE.ready);
    try {
      if (automatic) {
        await announce(GUIDANCE.ready, 1);
        if (epoch !== generation.current || !mounted.current) return;
      } else void announce("Reading a stable label. Stop remains available.", 0);
      const observed = await reader.current.read(canvas);
      if (epoch !== generation.current || !mounted.current) return;
      setOcrTime(observed.elapsedMs);
      const before = document.createElement("canvas"),
        after = document.createElement("canvas");
      before.width = before.height = after.width = after.height = 16;
      before.getContext("2d")!.drawImage(canvas, 0, 0, 16, 16);
      after.getContext("2d")!.drawImage(v, 0, 0, 16, 16);
      const a = before.getContext("2d")!.getImageData(0, 0, 16, 16).data,
        b = after.getContext("2d")!.getImageData(0, 0, 16, 16).data;
      if (a.reduce((n, x, i) => n + Math.abs(x - b[i]), 0) / a.length > 16) {
        phaseTo("scanning");
        void announce(
          "Package moved while reading. Hold one label steady and retry.",
        );
        return;
      }
      if (
        !gate.current.accept(
          `ocr:${observed.text.toLowerCase().replace(/\s+/g, " ").trim()}`,
        )
      ) {
        phaseTo("awaiting-next-item");
        return;
      }
      check({
        ...observed,
        barcode: snapshotBarcode,
        presentationId,
        captureId: newId(),
        sessionId: sessionId.current,
        source: "ocr",
      });
    } catch (error) {
      if (epoch === generation.current) {
        phaseTo("error");
        void announce(
          error instanceof Error
            ? `Label reading failed: ${error.message}. Rotate the package and Retry, or enter a barcode.`
            : "Label reading failed. Use Retry or enter a barcode.",
          3,
        );
      }
    } finally {
      canvas.width = canvas.height = 0;
      if (epoch === generation.current) ocrBusy.current = false;
    }
  }
  function check(
    raw: Evidence,
    selected?: { orderId: string; itemId: string },
  ) {
    if (
      pendingRef.current ||
      ["paused", "requesting-permission", "announcing-result"].includes(
        phaseRef.current,
      )
    )
      return;
    const evidence = {
      ...raw,
      captureId: raw.captureId ?? newId(),
      sessionId: raw.sessionId ?? (sessionId.current ||= newId()),
    };
    const old = retryId.current
      ? dataRef.current.attempts.find(
          (a) => a.id === retryId.current && !a.undone,
        )
      : undefined;
    let comparable = dataRef.current.orders.map((o) => ({
      ...o,
      items: o.items.map((i) =>
        old?.status === "MATCH" && old.orderId === o.id && old.itemId === i.id
          ? { ...i, verified: Math.max(0, i.verified - 1) }
          : i,
      ),
    }));
    if (selected)
      comparable = comparable
        .filter((o) => o.id === selected.orderId)
        .map((o) => ({
          ...o,
          items: o.items.filter((i) => i.id === selected.itemId),
        }));
    const verdict = verify(comparable, evidence);
    // A user-requested retry identifies the unit slot, not the observed product fields.
    if (old?.itemId && !verdict.itemId && !verdict.candidates?.length) {
      verdict.orderId = old.orderId;
      verdict.itemId = old.itemId;
    }
    setResult(verdict);
    // Revise catalog-only evidence only from barcode+OCR read from one snapshot
    // in the same observed presentation, never from unrelated captures.
    if (
      verdict.status === "CONFLICT" &&
      evidence.source === "ocr" &&
      evidence.barcode &&
      evidence.presentationId
    ) {
      const previous = [...dataRef.current.attempts]
        .reverse()
        .find(
          (a) =>
            !a.undone &&
            a.presentationId === evidence.presentationId &&
            a.observation?.barcode === evidence.barcode &&
            a.status === "MATCH",
        );
      if (previous) {
        verdict.orderId = previous.orderId;
        verdict.itemId = previous.itemId;
        commit({ evidence, verdict, another: false, retry: previous.id });
        return;
      }
    }
    const identityKey = verdict.itemId
      ? `${verdict.orderId}:${verdict.itemId}`
      : verdict.identity;
    if (
      evidence.source !== "manual" &&
      identityKey &&
      !gate.current.accept(`identity:${identityKey}`)
    ) {
      phaseTo("awaiting-next-item");
      return;
    }
    if (verdict.candidates?.length) {
      pendingTo({ evidence, verdict, another: false, retry: retryId.current });
      phaseTo("needs-clarification");
      void announce(verdict.message, 3);
      return;
    }
    const seen = dataRef.current.attempts.some(
      (a) =>
        !a.undone &&
        a.id !== old?.id &&
        ((verdict.itemId &&
          a.itemId === verdict.itemId &&
          a.orderId === verdict.orderId) ||
          (verdict.identity && a.identity === verdict.identity)),
    );
    if (seen && !old) {
      pendingTo({ evidence, verdict, another: true, retry: retryId.current });
      phaseTo("needs-clarification");
      void announce(
        "Is this another physical unit? A barcode or label cannot distinguish identical packages. Choose Yes, another unit, or No, retry this unit.",
        3,
      );
      return;
    }
    commit({ evidence, verdict, another: false, retry: retryId.current });
  }
  function commit(p: Pending) {
    const attempt: Attempt = {
      id: newId(),
      captureId: p.evidence.captureId!,
      presentationId: p.evidence.presentationId,
      sessionId: p.evidence.sessionId!,
      identity: p.verdict.identity ?? "unknown",
      orderId: p.verdict.orderId,
      itemId: p.verdict.itemId,
      status: p.verdict.status,
      reason: p.verdict.reason ?? "UNKNOWN",
      message: p.verdict.message,
      confirmedAnotherUnit: p.another,
      undone: false,
      observation: {
        text: p.evidence.text?.slice(0, 20000),
        barcode: p.evidence.barcode,
        source: p.evidence.source,
        confidence: p.evidence.confidence,
      },
    };
    const next = recordAttempt(dataRef.current, attempt, p.retry);
    pendingTo(null);
    retryId.current = undefined;
    setResult(p.verdict);
    if (next === dataRef.current) {
      phaseTo("needs-clarification");
      void announce(
        "This attempt could not be allocated without repeating or exceeding a unit. Retry the previous unit or correct the reference; nothing counted.",
        3,
      );
      return;
    }
    update(next);
    const counts = progress(next),
      finished = counts.total > 0 && counts.left === 0 && counts.unknown === 0;
    const summary = finished
      ? ` Checking complete: ${counts.matched} matching, ${counts.mismatch} mismatching, ${counts.unresolved} unable to verify; ${counts.unassigned} unassigned scans remain separate.`
      : " Present a different product when ready. Identical units need confirmation.";
    phaseTo("announcing-result");
    const epoch = generation.current;
    void announce(p.verdict.message + summary, 3).then(() => {
      if (
        mounted.current &&
        epoch === generation.current &&
        phaseRef.current === "announcing-result"
      ) {
        if (finished) releaseCamera();
        phaseTo(finished ? "finished" : "awaiting-next-item");
      }
    });
  }
  function nextItem() {
    pendingTo(null);
    retryId.current = undefined;
    gate.current.next();
    phaseTo(stream.current ? "scanning" : "awaiting-next-item");
    void announce(
      "Present the next item. This action does not count a unit. Identical products need confirmation.",
    );
  }
  function retry() {
    const p = pendingRef.current;
    const last = [...dataRef.current.attempts]
      .reverse()
      .find(
        (a) =>
          !a.undone &&
          (!p ||
            (p.verdict.itemId
              ? a.itemId === p.verdict.itemId && a.orderId === p.verdict.orderId
              : a.identity === p.verdict.identity)),
      );
    retryId.current = p
      ? (p.retry ?? (p.another ? last?.id : undefined))
      : last?.id;
    pendingTo(null);
    gate.current.next();
    phaseTo(stream.current ? "scanning" : "awaiting-next-item");
    void announce(
      "Retrying the current unit. New evidence replaces its attempt without adding another checked unit.",
    );
  }
  function command(c: Command) {
    if (!commandAllowed(c, phaseRef.current)) {
      void announce(
        `The ${c} command is unavailable in this state. Stop is always available.`,
      );
      return;
    }
    switch (c) {
      case "yes another unit":
        if (pendingRef.current?.another) commit(pendingRef.current);
        break;
      case "no retry this unit":
        if (pendingRef.current?.another) retry();
        break;
      case "start":
        void start();
        break;
      case "stop":
        stop();
        break;
      case "stop speaking":
        voice.current?.cancelSpeech();
        break;
      case "repeat":
      case "read the result again":
        void announce(
          c === "read the result again"
            ? (result?.message ?? "No result yet.")
            : messageRef.current,
          3,
        );
        break;
      case "next":
        nextItem();
        break;
      case "retry":
        retry();
        break;
      case "help":
        navigate("help");
        void announce(
          "Commands: Start, Stop, Repeat, Next, Help, Retry, Read my orders, Read the result again, Go back, Stop speaking. Named controls offer equivalent actions. Recognition pauses during app speech.",
        );
        break;
      case "read my orders":
        navigate("orders");
        void announce(
          dataRef.current.orders.length
            ? dataRef.current.orders
                .map(
                  (o) =>
                    `${o.label}. ${o.items.map((i) => `${i.quantity ?? "Unknown quantity of"} ${i.brand} ${i.name}, ${i.variant}, ${i.size}`).join(". ")}`,
                )
                .join(". ")
            : "No orders. Paste or upload a purchase reference.",
        );
        break;
      case "go back":
        navigate("overview");
        break;
    }
  }
  return {
    cameraGuidance,
    tab,
    navigate,
    data,
    update,
    prefs,
    setPrefs,
    ready,
    remember,
    setRemember,
    storageOff,
    storageError,
    message,
    noticeId,
    phase,
    phaseTo,
    listening,
    speaking,
    camera,
    result,
    pending,
    ocrTime,
    stats: progress(data),
    announce,
    speakOrder: (text: string, explicit = false) => voice.current?.say(text, 3, explicit) ?? Promise.resolve(),
    start,
    stop,
    check,
    ocr,
    command,
    nextItem,
    retry,
    confirmAnother: () => {
      if (pending) commit(pending);
    },
    selectLine: (selected: { orderId: string; itemId: string }) => {
      if (pending) {
        const e = pending.evidence;
        pendingTo(null);
        phaseTo("awaiting-next-item");
        check(e, selected);
      }
    },
    undo: () => {
      const last = [...dataRef.current.attempts]
        .reverse()
        .find((a) => !a.undone);
      if (last) {
        update(undoAttempt(dataRef.current, last.id));
        pendingTo(null);
        retryId.current = undefined;
        phaseTo("awaiting-next-item");
        void announce(
          "Last checking event undone; its unit count was reversed.",
        );
      }
    },
    clear: () => {
      stop();
      update(initial);
      storageOff();
      setResult(null);
      phaseTo("idle");
      void announce("All orders and checking history cleared at your request.");
    },
    startListening: () => {
      if (window.isSecureContext) voice.current?.startListening();
      else void announce("Voice commands require HTTPS or localhost.");
    },
    stopListening: () => voice.current?.stopListening(),
  };
}
