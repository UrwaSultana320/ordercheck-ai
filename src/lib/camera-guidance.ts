// Frame-content heuristics, never object detection or a distance measurement.
export const GUIDANCE = {
  started: "Camera started. Hold one product in front of the camera.",
  dark: "More light is needed.",
  moving: "Hold still.",
  detail: "Move the product closer.",
  clipped: "Move the product slightly farther away.",
  unreadable: "I could not read this side. Slowly rotate the product.",
  blur: "Hold the product steady while the camera focuses.",
  left: "Move the product slightly left.",
  right: "Move the product slightly right.",
  up: "Move the product slightly up.",
  down: "Move the product slightly down.",
  center: "Center the product in the camera.",
  ready: "Frame is steady. Looking for a barcode or readable label.",
  noLabel: "I could not find a readable barcode or product label. Place the product label inside the guide.",
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
  broadBorderDensity?: number;
  broadCentralDensity?: number;
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
  let laplace = 0, laplaceSquared = 0, broadBorder = 0, broadCenter = 0;
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
      if (edge > 8) { if (border) broadBorder++; if (central) broadCenter++; }
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
    broadBorderDensity: broadBorder / Math.max(1, borderCount),
    broadCentralDensity: broadCenter / Math.max(1, centralCount),
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
  // Low-frequency detail survives defocus: require widespread border AND
  // central content, acceptable light and stability; blur alone says focus.
  if (m.sharpness < 55 && (m.broadBorderDensity ?? m.borderEdgeDensity) > 0.28 &&
    (m.broadCentralDensity ?? m.centralEdgeDensity) > 0.16) return GUIDANCE.clipped;
  if (m.sharpness < 55) return GUIDANCE.blur;
  if (m.edgeDensity < 0.018 || (m.centralEdgeDensity < 0.045 && m.edgeDensity < 0.04))
    return GUIDANCE.detail;
  // Only suggest centering when abundant detail is strongly displaced and the
  // centre lacks detail, or almost all detail is outside the centre (even if
  // balanced on both sides). Background texture can still fool this heuristic.
  if (m.edgeDensity > 0.045 && m.centerShare < 0.08 &&
    (Math.abs(m.centroidX - 0.5) > 0.23 || Math.abs(m.centroidY - 0.5) > 0.23 || m.centerShare < 0.03))
    {
      const dx = m.centroidX - 0.5, dy = m.centroidY - 0.5;
      if (Math.max(Math.abs(dx), Math.abs(dy)) > 0.23) {
        if (Math.abs(dx) > Math.abs(dy) + 0.08) return dx > 0 ? GUIDANCE.left : GUIDANCE.right;
        if (Math.abs(dy) > Math.abs(dx) + 0.08) return dy > 0 ? GUIDANCE.up : GUIDANCE.down;
      }
      return GUIDANCE.center;
    }
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
    // Distance and direction both require two consistent samples; a noisy
    // opposite sample retains the prior instruction and still blocks capture.
    const positioning = [GUIDANCE.detail, GUIDANCE.clipped, GUIDANCE.left,
      GUIDANCE.right, GUIDANCE.up, GUIDANCE.down, GUIDANCE.center];
    const distance = positioning.some(message => message === problem) ? problem ?? "" : "";
    if (distance !== this.candidate) { this.candidate = distance; this.samples = 0; }
    this.samples++;
    if (this.samples >= 2) this.distance = distance;
    if (distance || (!problem && this.distance))
      return { ready: false, message: this.distance || GUIDANCE.moving };
    return { ready: this.good >= 3, message: problem ?? (this.good >= 3 ? GUIDANCE.ready : GUIDANCE.moving) };
  }
  reset() { this.good = 0; this.distance = this.candidate = ""; this.samples = 0; }
}
// Relax framing after six seconds of usable samples, while still requiring
// reasonable light and stability. The view gate owns retry/duplicate limits.
export class BoundedAutomaticRead {
  private since: number | null = null;
  sample(m: FrameMetrics, now: number) {
    if (m.brightness < 40 || m.motion === null || m.motion > 7 || m.changedFraction > 0.12) {
      this.since = null;
      return false;
    }
    this.since ??= now;
    return now - this.since >= 6000;
  }
  reset() { this.since = null; }
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
