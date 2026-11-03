// Frame-content heuristics, never object detection or a distance measurement.
export const GUIDANCE = {
  started: "Camera started. Hold one product in front of the camera.",
  dark: "More light is needed.",
  moving: "Hold still.",
  detail: "Move the product closer.",
  clipped: "Move the product farther away.",
  unreadable: "I could not read the label. Slowly rotate the product and hold it steady.",
  blur: "Hold the product steady.",
  center: "Center the product in the camera.",
  ready: "Good position. Reading the label.",
  unavailable: "Camera guidance is unavailable. Use Read label with OCR or enter a barcode.",
} as const;
export type FrameMetrics = {
  brightness: number;
  motion: number | null;
  changedFraction: number;
  edgeDensity: number;
  centralEdgeDensity: number;
  borderEdgeDensity: number;
  borderShare: number;
  sharpness: number;
  centerShare: number;
  centroidX: number;
  centroidY: number;
};
export function analyzeFrame(
  rgba: ArrayLike<number>, width: number, height: number,
  previous?: Float32Array,
) {
  if (width < 3 || height < 3 || rgba.length !== width * height * 4)
    throw new Error("Invalid analysis frame");
  const luminance = new Float32Array(width * height);
  let brightness = 0, motion = 0, changed = 0;
  const comparable = previous?.length === luminance.length;
  for (let i = 0; i < luminance.length; i++) {
    const value = rgba[i * 4] * 0.299 + rgba[i * 4 + 1] * 0.587 + rgba[i * 4 + 2] * 0.114;
    luminance[i] = value;
    brightness += value;
    if (comparable) {
      const difference = Math.abs(value - previous![i]);
      motion += difference;
      if (difference > 20) changed++;
    }
  }
  let edges = 0, weight = 0, center = 0, weightedX = 0, weightedY = 0;
  let centralEdges = 0, centralCount = 0, borderEdges = 0, borderCount = 0, borderWeight = 0;
  let laplace = 0, laplaceSquared = 0;
  const count = (width - 2) * (height - 2);
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const i = y * width + x;
      const nx = x / (width - 1), ny = y / (height - 1);
      const central = nx >= 0.25 && nx <= 0.75 && ny >= 0.25 && ny <= 0.75;
      const border = nx < 0.12 || nx > 0.88 || ny < 0.12 || ny > 0.88;
      if (central) centralCount++;
      if (border) borderCount++;
      const edge = Math.abs(luminance[i + 1] - luminance[i - 1]) +
        Math.abs(luminance[i + width] - luminance[i - width]);
      const lap = 4 * luminance[i] - luminance[i - 1] - luminance[i + 1] -
        luminance[i - width] - luminance[i + width];
      laplace += lap;
      laplaceSquared += lap * lap;
      // Ignore weak noise; cap contrast so a single boundary cannot dominate.
      if (edge > 24) {
        const w = Math.min(edge, 100);
        edges++;
        weight += w;
        weightedX += nx * w;
        weightedY += ny * w;
        if (central) { center += w; centralEdges++; }
        if (border) { borderWeight += w; borderEdges++; }
      }
    }
  }
  const metrics: FrameMetrics = {
    brightness: brightness / luminance.length,
    motion: comparable ? motion / luminance.length : null,
    changedFraction: changed / luminance.length,
    edgeDensity: edges / count,
    centralEdgeDensity: centralEdges / Math.max(1, centralCount),
    borderEdgeDensity: borderEdges / Math.max(1, borderCount),
    borderShare: weight ? borderWeight / weight : 0,
    sharpness: Math.max(0, laplaceSquared / count - (laplace / count) ** 2),
    centerShare: weight ? center / weight : 0,
    centroidX: weight ? weightedX / weight : 0.5,
    centroidY: weight ? weightedY / weight : 0.5,
  };
  return { metrics, luminance };
}
export function frameGuidance(m: FrameMetrics): string | null {
  if (m.brightness < 40) return GUIDANCE.dark;
  if (m.motion === null || m.motion > 7 || m.changedFraction > 0.12) return GUIDANCE.moving;
  // Abundant detail at the border AND centre suggests clipping; a single
  // displaced patch instead needs centering. These are not distance estimates.
  if (m.borderEdgeDensity > 0.22 && m.borderShare > 0.32 && m.centralEdgeDensity > 0.12)
    return GUIDANCE.clipped;
  if (m.edgeDensity < 0.018 || (m.centralEdgeDensity < 0.045 && m.edgeDensity < 0.04))
    return GUIDANCE.detail;
  // Only suggest centering when abundant detail is strongly displaced and the
  // centre lacks detail, or almost all detail is outside the centre (even if
  // balanced on both sides). Background texture can still fool this heuristic.
  if (m.edgeDensity > 0.045 && m.centerShare < 0.08 &&
    (Math.abs(m.centroidX - 0.5) > 0.23 || Math.abs(m.centroidY - 0.5) > 0.23 || m.centerShare < 0.03))
    return GUIDANCE.center;
  if (m.sharpness < 55) return GUIDANCE.blur;
  return null;
}
export class CameraGuidance {
  private good = 0;
  private distance = "";
  private candidate = "";
  private samples = 0;
  sample(metrics: FrameMetrics) {
    const problem = frameGuidance(metrics);
    this.good = problem ? 0 : this.good + 1;
    // Require two samples to enter/leave a distance instruction. Never switch
    // closer/farther on a single fluctuating sample; bad frames still block OCR.
    const distance = problem === GUIDANCE.detail || problem === GUIDANCE.clipped ? problem : "";
    if (distance !== this.candidate) { this.candidate = distance; this.samples = 0; }
    this.samples++;
    if (this.samples >= 2) this.distance = distance;
    if (distance || (!problem && this.distance))
      return { ready: false, message: this.distance || GUIDANCE.moving };
    return { ready: this.good >= 3, message: problem ?? (this.good >= 3 ? GUIDANCE.ready : GUIDANCE.moving) };
  }
  reset() { this.good = 0; this.distance = this.candidate = ""; this.samples = 0; }
}
// One automatic attempt per view, independent of PresentationGate's old
// stability threshold. Compare against the attempted view, not adjacent frames,
// so a slow rotation can qualify. A transient wobble that returns cannot rearm.
export class AutomaticOcrViews {
  private attempted?: Float32Array;
  private changed = 0;
  observe(view: Float32Array) {
    if (!this.attempted) return;
    // Ignore a uniform lighting/exposure change as evidence of a new view.
    const offset = view.reduce((sum, value, i) => sum + value - this.attempted![i], 0) / view.length;
    let difference = 0, changed = 0;
    for (let i = 0; i < view.length; i++) {
      const delta = Math.abs(view[i] - this.attempted[i] - offset);
      difference += delta;
      if (delta > 20) changed++;
    }
    this.changed = difference / view.length > 16 && changed / view.length > 0.18 ? this.changed + 1 : 0;
  }
  canAttempt() { return !this.attempted || this.changed >= 2; }
  mark(view: Float32Array) { this.attempted = view.slice(); this.changed = 0; }
}
// Debounce state changes and rate-limit even alternating instructions. Ready is
// announced separately, once per accepted presentation, by the OCR action.
export class GuidanceAnnouncements {
  private candidate = "";
  private samples = 0;
  private last = "";
  private at = -Infinity;
  next(message: string, now: number) {
    if (message !== this.candidate) { this.candidate = message; this.samples = 0; }
    this.samples++;
    if (this.samples < 2 || now - this.at < 5000 || (message === this.last && now - this.at < 15000)) return null;
    this.last = message;
    this.at = now;
    return message;
  }
}
