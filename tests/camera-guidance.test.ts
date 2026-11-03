import { describe, expect, it } from "vitest";
import { analyzeFrame, CameraGuidance, frameGuidance, GuidanceAnnouncements, GUIDANCE, type FrameMetrics } from "../src/lib/camera-guidance";

const good: FrameMetrics = { brightness: 120, motion: 1, changedFraction: 0.01, edgeDensity: 0.12, sharpness: 400, centerShare: 0.4, centroidX: 0.5, centroidY: 0.5 };
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
    expect(frameGuidance(analyzeFrame(frame(() => 140), 96, 72, plain.luminance).metrics)).toBe(GUIDANCE.detail);
    expect(frameGuidance({ ...good, sharpness: 20 })).toBe(GUIDANCE.blur);
  });
  it("measures a displaced content centroid, requiring strong evidence for centering", () => {
    const side = frame((x, y) => x < 20 ? ((x + y) % 4 < 2 ? 70 : 210) : 140);
    const first = analyzeFrame(side, 96, 72);
    const second = analyzeFrame(side, 96, 72, first.luminance);
    expect(second.metrics.centroidX).toBeLessThan(0.25);
    expect(frameGuidance(second.metrics)).toBe(GUIDANCE.center);
    expect(frameGuidance({ ...good, centroidX: 0.1 })).toBeNull();
    expect(frameGuidance({ ...good, centerShare: 0.01 })).toBe(GUIDANCE.center);
    expect(frameGuidance({ ...good, centroidX: 0.1, centerShare: 0.01, edgeDensity: 0.03 })).toBeNull();
  });
  it("rejects invalid frame dimensions", () => {
    expect(() => analyzeFrame([], 96, 72)).toThrow();
  });
});
describe("readiness and announcements", () => {
  it("requires three consecutive good frames and resets on any bad sample or session reset", () => {
    const guidance = new CameraGuidance();
    expect(guidance.sample(good).ready).toBe(false);
    expect(guidance.sample(good).ready).toBe(false);
    expect(guidance.sample({ ...good, motion: 20 }).ready).toBe(false);
    expect(guidance.sample(good).ready).toBe(false);
    expect(guidance.sample(good).ready).toBe(false);
    expect(guidance.sample(good)).toEqual({ ready: true, message: GUIDANCE.ready });
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
