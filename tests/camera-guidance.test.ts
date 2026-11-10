import { describe, expect, it } from "vitest";
import { analyzeFrame, BoundedAutomaticRead, AutomaticOcrViews, CameraGuidance, frameGuidance, GuidanceAnnouncements, GUIDANCE, type FrameMetrics } from "../src/lib/camera-guidance";
import { PresentationGate } from "../src/lib/session";

const good: FrameMetrics = { brightness: 120, motion: 1, changedFraction: 0.01, edgeDensity: 0.12, centralEdgeDensity: 0.25, borderEdgeDensity: 0, borderShare: 0, sharpness: 400, centerShare: 0.4, centroidX: 0.5, centroidY: 0.5 };
function frame(pixel: (x: number, y: number) => number) {
  const rgba = new Uint8ClampedArray(96 * 72 * 4);
  for (let y = 0; y < 72; y++) for (let x = 0; x < 96; x++) {
    const i = (y * 96 + x) * 4;
    rgba[i] = rgba[i + 1] = rgba[i + 2] = pixel(x, y);
    rgba[i + 3] = 255;
  }
  return rgba;
}
const textured = frame((x, y) => x > 25 && x < 70 && y > 20 && y < 52 ? ((x + y) % 4 < 2 ? 70 : 210) : 140);
describe("camera frame analysis", () => {
  it("detects clearly dark frames without demanding bright studio lighting", () => {
    expect(frameGuidance(analyzeFrame(frame(() => 15), 96, 72).metrics)).toBe(GUIDANCE.dark);
    expect(frameGuidance({ ...good, brightness: 65 })).toBeNull();
  });
  it("measures motion and demands a previous frame", () => {
    const first = analyzeFrame(textured, 96, 72);
    expect(frameGuidance(first.metrics)).toBe(GUIDANCE.moving);
    const moved = analyzeFrame(frame(() => 220), 96, 72, first.luminance);
    expect(moved.metrics.motion).toBeGreaterThan(7);
    expect(frameGuidance(moved.metrics)).toBe(GUIDANCE.moving);
    // Local motion cannot be hidden by a low average difference.
    expect(frameGuidance({ ...good, motion: 5, changedFraction: 0.2 })).toBe(GUIDANCE.moving);
  });
  it("accepts stable detailed frames and rejects stable featureless frames", () => {
    const first = analyzeFrame(textured, 96, 72);
    const stable = analyzeFrame(textured, 96, 72, first.luminance);
    expect(stable.metrics.motion).toBe(0);
    expect(frameGuidance(stable.metrics)).toBeNull();
    const plain = analyzeFrame(frame(() => 140), 96, 72);
    expect(frameGuidance(analyzeFrame(frame(() => 140), 96, 72, plain.luminance).metrics)).toBe(GUIDANCE.blur);
    expect(frameGuidance({ ...good, sharpness: 20 })).toBe(GUIDANCE.blur);
  });
  it("measures a displaced content centroid, requiring strong evidence for centering", () => {
    const side = frame((x, y) => x < 20 ? ((x + y) % 4 < 2 ? 70 : 210) : 140);
    const first = analyzeFrame(side, 96, 72);
    const second = analyzeFrame(side, 96, 72, first.luminance);
    expect(second.metrics.centroidX).toBeLessThan(0.25);
    expect(frameGuidance(second.metrics)).toBe(GUIDANCE.right);
    expect(frameGuidance({ ...good, centroidX: 0.1 })).toBeNull();
    expect(frameGuidance({ ...good, centerShare: 0.01 })).toBe(GUIDANCE.center);
    expect(frameGuidance({ ...good, centroidX: 0.1, centerShare: 0.01, edgeDensity: 0.03 })).toBeNull();
  });
  it("rejects invalid frame dimensions", () => {
    expect(() => analyzeFrame([], 96, 72)).toThrow();
  });
});
describe("readiness and announcements", () => {
  it("measures small central content and border clipping, prioritizing dark and motion", () => {
    const small = frame((x, y) => x > 44 && x < 51 && y > 32 && y < 39 ? ((x + y) % 4 < 2 ? 70 : 210) : 140);
    const first = analyzeFrame(small, 96, 72);
    const far = analyzeFrame(small, 96, 72, first.luminance).metrics;
    expect(far.centralEdgeDensity).toBeLessThan(0.045);
    expect(frameGuidance(far)).toBe(GUIDANCE.detail);
    const full = frame((x, y) => (x + y) % 4 < 2 ? 70 : 210);
    const prior = analyzeFrame(full, 96, 72);
    const close = analyzeFrame(full, 96, 72, prior.luminance).metrics;
    expect(close.borderEdgeDensity).toBeGreaterThan(0.22);
    expect(close.borderShare).toBeGreaterThan(0.32);
    expect(frameGuidance(close)).toBe(GUIDANCE.clipped);
    expect(frameGuidance({ ...close, brightness: 15, motion: 30 })).toBe(GUIDANCE.dark);
    expect(frameGuidance({ ...far, motion: 30 })).toBe(GUIDANCE.moving);
    expect(frameGuidance({ ...good, centerShare: 0.01, sharpness: 20 })).toBe(GUIDANCE.blur);
  });
  it("does not alternate distance instructions for single noisy samples", () => {
    const guidance = new CameraGuidance();
    const far = { ...good, edgeDensity: 0.01 };
    const close = { ...good, borderEdgeDensity: 0.5, borderShare: 0.5 };
    expect(guidance.sample(far).message).toBe(GUIDANCE.moving);
    expect(guidance.sample(far).message).toBe(GUIDANCE.detail);
    expect(guidance.sample(close).message).toBe(GUIDANCE.detail);
    expect(guidance.sample(far).message).toBe(GUIDANCE.detail);
    guidance.sample(close);
    expect(guidance.sample(close).message).toBe(GUIDANCE.clipped);
    expect(guidance.sample({ ...good, brightness: 10 }).message).toBe(GUIDANCE.dark);
  });
  it("allows ready OCR even when the legacy gate rejects handheld stability", () => {
    const guidance = new CameraGuidance(), legacy = new PresentationGate();
    const views = new AutomaticOcrViews();
    legacy.sample([100]);
    for (let i = 0; i < 3; i++) {
      expect(legacy.sample([i % 2 ? 100 : 107])).toBe(false);
      expect(guidance.sample({ ...good, motion: 7 }).ready).toBe(i === 2);
    }
    expect(views.canAttempt()).toBe(true);
  });
  it("blocks repeated attempts on an unreadable view until a sustained different view", () => {
    const views = new AutomaticOcrViews();
    const same = new Float32Array(100).fill(120);
    views.mark(same);
    for (let i = 0; i < 20; i++) views.observe(same);
    expect(views.canAttempt()).toBe(false);
    views.observe(new Float32Array(100).fill(170));
    views.observe(new Float32Array(100).fill(170));
    expect(views.canAttempt()).toBe(false); // Exposure alone is not a new view.
    const rotated = Float32Array.from({ length: 100 }, (_, i) => i % 2 ? 70 : 210);
    views.observe(rotated);
    expect(views.canAttempt()).toBe(false);
    views.observe(same);
    expect(views.canAttempt()).toBe(false);
    views.observe(rotated); views.observe(rotated);
    expect(views.canAttempt()).toBe(true);
    views.mark(rotated);
    expect(views.canAttempt()).toBe(false);
  });
  it("requires three consecutive good frames and resets on any bad sample or session reset", () => {
    const guidance = new CameraGuidance();
    expect(guidance.sample(good).ready).toBe(false);
    expect(guidance.sample(good).ready).toBe(false);
    expect(guidance.sample({ ...good, motion: 20 }).ready).toBe(false);
    expect(guidance.sample(good).ready).toBe(false);
    expect(guidance.sample(good).ready).toBe(false);
    expect(guidance.sample(good)).toEqual({ ready: true, message: GUIDANCE.ready });
    expect(GUIDANCE.ready).toBe("Frame is steady. Looking for a barcode or readable label.");
    expect(GUIDANCE.ready).not.toMatch(/good position|product detected|product found/i);
    guidance.reset();
    expect(guidance.sample(good).ready).toBe(false);
  });
  it("debounces transitions, deduplicates repeats and throttles alternating guidance", () => {
    const speech = new GuidanceAnnouncements();
    expect(speech.next(GUIDANCE.dark, 0)).toBeNull();
    expect(speech.next(GUIDANCE.dark, 700)).toBe(GUIDANCE.dark);
    expect(speech.next(GUIDANCE.dark, 1400)).toBeNull();
    expect(speech.next(GUIDANCE.moving, 2100)).toBeNull();
    expect(speech.next(GUIDANCE.moving, 2800)).toBeNull();
    expect(speech.next(GUIDANCE.moving, 5700)).toBe(GUIDANCE.moving);
    expect(speech.next(GUIDANCE.moving, 11000)).toBeNull();
    expect(speech.next(GUIDANCE.moving, 20700)).toBe(GUIDANCE.moving);
    expect(speech.next(GUIDANCE.dark, 26000)).toBeNull();
    expect(speech.next(GUIDANCE.center, 26700)).toBeNull();
    expect(speech.next(GUIDANCE.center, 27400)).toBe(GUIDANCE.center);
  });
});

it("requires stable blur plus broad framing evidence for farther guidance", () => {
  const close = { ...good, sharpness: 12, broadBorderDensity: 0.4, broadCentralDensity: 0.3 };
  const g = new CameraGuidance();
  expect(g.sample(close).message).toBe(GUIDANCE.moving);
  expect(g.sample(close).message).toBe(GUIDANCE.clipped);
  expect(frameGuidance({ ...close, motion: 20 })).toBe(GUIDANCE.moving);
  expect(frameGuidance({ ...close, brightness: 20 })).toBe(GUIDANCE.dark);
  expect(frameGuidance({ ...good, sharpness: 12 })).toBe(GUIDANCE.blur);
  expect(frameGuidance({ ...good, sharpness: 0, edgeDensity: 0, centralEdgeDensity: 0 })).toBe(GUIDANCE.blur);
});
it("requires persistent directional evidence and does not alternate on noise", () => {
  const g = new CameraGuidance();
  const left = { ...good, centerShare: 0.01, centroidX: 0.85 };
  const right = { ...left, centroidX: 0.15 };
  expect(g.sample(left).message).toBe(GUIDANCE.moving);
  expect(g.sample(left).message).toBe(GUIDANCE.left);
  expect(g.sample(right).message).toBe(GUIDANCE.left);
  expect(g.sample(left).message).toBe(GUIDANCE.left);
  g.sample(right);
  expect(g.sample(right).message).toBe(GUIDANCE.right);
  expect(frameGuidance({ ...good, centerShare: 0.01, centroidY: 0.85 })).toBe(GUIDANCE.up);
  expect(frameGuidance({ ...good, centerShare: 0.01, centroidY: 0.15 })).toBe(GUIDANCE.down);
});

it("retains broad framing evidence in a smooth defocused synthetic frame", () => {
  const blurred = frame((x, y) => 140 + 40 * Math.sin(x / 5) + 20 * Math.sin(y / 5));
  const first = analyzeFrame(blurred, 96, 72);
  const metrics = analyzeFrame(blurred, 96, 72, first.luminance).metrics;
  expect(metrics.sharpness).toBeLessThan(55);
  expect(metrics.broadBorderDensity).toBeGreaterThan(0.28);
  expect(frameGuidance(metrics)).toBe(GUIDANCE.clipped);
});


describe("bounded automatic reading", () => {
  it("attempts a bright stable imperfect view after six seconds", () => {
    const read = new BoundedAutomaticRead();
    const imperfect = { ...good, sharpness: 20 };
    expect(frameGuidance(imperfect)).toBe(GUIDANCE.blur);
    expect(read.sample(imperfect, 0)).toBe(false);
    expect(read.sample(imperfect, 5900)).toBe(false);
    expect(read.sample(imperfect, 6000)).toBe(true);
  });
  it.each([{ brightness: 10 }, { motion: 12 }, { changedFraction: .3 }])("restarts the bound after unusable samples %s", problem => {
    const read = new BoundedAutomaticRead();
    read.sample(good, 0);
    expect(read.sample({ ...good, ...problem }, 5900)).toBe(false);
    expect(read.sample(good, 6000)).toBe(false);
    expect(read.sample(good, 12000)).toBe(true);
    read.reset();
    expect(read.sample(good, 15000)).toBe(false);
  });
});
