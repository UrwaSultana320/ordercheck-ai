import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

// Synthetic canvas stream exercises wiring and cleanup, not physical optics.
async function installCamera(page: Page, speech = true) {
  await page.addInitScript(({ speech }) => {
    sessionStorage.setItem("ordercheck.v2", JSON.stringify({ orders: [{
      id: "camera-test", label: "Camera test", source: "purchase", items: [{
        id: "item", name: "Oat drink", brand: "Everyday", variant: "Original", size: "1 L", quantity: 1, verified: 0,
      }],
    }], attempts: [] }));
    const host = window as unknown as {
      __cameraStops: number; __cameraRequests: number; __cameraPattern: boolean;
      __plain: boolean; __rotated: boolean; __ocrReads: number; __ocrError: boolean;
      __legacyJitter: boolean; __legacySamples: number;
      __speeches: { text: string; at: number }[];
    };
    host.__plain = host.__rotated = host.__ocrError = false;
    host.__ocrReads = 0;
    host.__legacyJitter = false;
    host.__legacySamples = 0;
    const getImageData = CanvasRenderingContext2D.prototype.getImageData;
    CanvasRenderingContext2D.prototype.getImageData = function(sx, sy, sw, sh, settings) {
      const image = getImageData.call(this, sx, sy, sw, sh, settings);
      if (host.__legacyJitter && this.canvas.width === 16 && this.canvas.height === 16) {
        // The old <6 stability threshold never passes; the usable 96x72
        // quality samples and OCR snapshot are unaffected by this narrow stub.
        const value = host.__legacySamples++ % 2 ? 107 : 100;
        for (let i = 0; i < image.data.length; i += 4)
          image.data[i] = image.data[i + 1] = image.data[i + 2] = value;
      }
      return image;
    };
    host.__speeches = [];
    Object.defineProperty(window, "speechSynthesis", { configurable: true, value: speech ? {
      speak: (utterance: SpeechSynthesisUtterance) => {
        host.__speeches.push({ text: utterance.text, at: performance.now() });
        setTimeout(() => utterance.onend?.({} as SpeechSynthesisEvent), 10);
      },
      cancel: () => {},
    } : undefined });
    // Mock only the OCR worker protocol, exercising the real reader/hook wiring.
    class OcrWorker {
      onmessage: ((event: { data: unknown }) => void) | null = null;
      postMessage(packet: { action: string; jobId: string; workerId: string }) {
        if (packet.action === "recognize") host.__ocrReads++;
        setTimeout(() => this.onmessage?.({ data: { ...packet,
          status: packet.action === "recognize" && host.__ocrError ? "reject" : "resolve",
          data: packet.action === "recognize" && host.__ocrError ? "Synthetic OCR failure" : { text: "", confidence: 0 },
        } }), 100);
      }
      terminate() {}
    }
    Object.defineProperty(window, "Worker", { value: OcrWorker });
    host.__cameraStops = 0;
    host.__cameraRequests = 0;
    host.__cameraPattern = false;
    Object.defineProperty(navigator.mediaDevices, "getUserMedia", { value: async () => {
      host.__cameraRequests++;
      const canvas = document.createElement("canvas");
      canvas.width = 320; canvas.height = 240;
      const ctx = canvas.getContext("2d")!;
      const paint = () => {
        ctx.fillStyle = host.__cameraPattern || host.__plain ? "rgb(140,140,140)" : "rgb(12,12,12)";
        ctx.fillRect(0, 0, 320, 240);
        if (host.__cameraPattern) {
          for (let y = 70; y < 175; y += 8) for (let x = 85; x < 235; x += 8) {
            ctx.fillStyle = (((x - 85 + y - 70) / 8) % 2 === 0) !== host.__rotated ? "rgb(70,70,70)" : "rgb(210,210,210)";
            ctx.fillRect(x, y, 8, 8);
          }
        }
      };
      paint();
      const timer = setInterval(paint, 100);
      const stream = canvas.captureStream(10);
      for (const track of stream.getTracks()) {
        const stop = track.stop.bind(track);
        track.stop = () => { host.__cameraStops++; clearInterval(timer); stop(); };
      }
      return stream;
    } });
  }, { speech });
}

test("synthetic dark camera guidance is accessible, quiet, and preserves manual OCR and cleanup", async ({ page }) => {
  test.setTimeout(60000);
  await installCamera(page);
  await page.goto("/");
  expect(await page.evaluate(() => (window as unknown as { __cameraRequests: number }).__cameraRequests)).toBe(0);
  await page.getByRole("button", { name: "Start checking my delivery", exact: true }).click();
  const status = page.getByRole("status");
  await expect(status).toContainText("More light is needed.", { timeout: 20000 });
  await expect(page.locator("#camera-guidance")).toHaveText("More light is needed.");
  expect(await page.evaluate(() => (window as unknown as { __speeches: { text: string }[] }).__speeches.map(s => s.text))).toEqual([
    "Camera started. Hold one product in front of the camera.", "More light is needed.",
  ]);
  await expect(page.getByRole("button", { name: "Read label with OCR", exact: true })).toBeEnabled();
  await expect(page.getByLabel("Enter a barcode")).toBeEnabled();
  // Watch live-region mutations over several samples: no repeated notices.
  await status.evaluate((el) => {
    const host = window as unknown as { __guidanceMutations: number };
    host.__guidanceMutations = 0;
    new MutationObserver(() => host.__guidanceMutations++).observe(el, { childList: true, subtree: true, characterData: true });
  });
  await page.waitForTimeout(2200);
  expect(await page.evaluate(() => (window as unknown as { __guidanceMutations: number }).__guidanceMutations)).toBe(0);
  expect((await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze()).violations).toEqual([]);
  await page.evaluate(() => { (window as unknown as { __cameraPattern: boolean }).__cameraPattern = true; });
  await expect.poll(() => page.evaluate(() => (window as unknown as { __speeches: { text: string }[] }).__speeches.some(s => s.text === "Good position. Reading the label.")), { timeout: 15000 }).toBe(true);
  await page.getByRole("button", { name: "Stop camera", exact: true }).click();
  await expect(page.getByRole("button", { name: "Start camera", exact: true })).toBeEnabled();
  await expect(page.locator("#camera-guidance")).toBeEmpty();
  expect(await page.evaluate(() => (window as unknown as { __cameraStops: number }).__cameraStops)).toBeGreaterThan(0);
  await page.getByRole("button", { name: "Start camera", exact: true }).click();
  await expect(page.getByRole("button", { name: "Stop camera", exact: true })).toBeEnabled();
  await page.evaluate(() => window.dispatchEvent(new Event("blur")));
  await expect(page.getByRole("button", { name: "Start camera", exact: true })).toBeEnabled();
  await page.getByRole("button", { name: "Start camera", exact: true }).click();
  await expect(page.getByRole("button", { name: "Stop camera", exact: true })).toBeEnabled();
  const menu = page.getByRole("button", { name: "Menu", exact: true });
  if (await menu.isVisible() && await menu.getAttribute("aria-expanded") === "false") await menu.click();
  await page.getByRole("navigation").getByRole("button", { name: "My orders", exact: true }).click();
  await expect(page.getByRole("region", { name: "Session controls" })).toContainText("Camera: off");
});

test("visual transitions bypass speech throttling; failed OCR retries only a new view or manual request", async ({ page }) => {
  test.setTimeout(60000);
  await installCamera(page);
  await page.goto("/");
  await page.evaluate(() => { (window as unknown as { __legacyJitter: boolean }).__legacyJitter = true; });
  await page.getByRole("button", { name: "Start checking my delivery", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("More light is needed.");
  const darkAt = await page.evaluate(() => (window as unknown as { __speeches: { text: string; at: number }[] }).__speeches.find(s => s.text === "More light is needed.")!.at);
  await page.evaluate(() => { (window as unknown as { __plain: boolean }).__plain = true; });
  await expect(page.locator("#camera-guidance")).toHaveText("Move the product closer.", { timeout: 4000 });
  const transition = await page.evaluate(() => ({ now: performance.now(), speeches: (window as unknown as { __speeches: { text: string; at: number }[] }).__speeches }));
  expect(transition.now - darkAt).toBeLessThan(5000);
  expect(transition.speeches.some(s => s.text === "Move the product closer.")).toBe(false);
  await page.evaluate(() => { (window as unknown as { __cameraPattern: boolean }).__cameraPattern = true; });
  await expect(page.locator("#camera-guidance")).toHaveText("I could not read the label. Slowly rotate the product and hold it steady.", { timeout: 15000 });
  const reads = () => page.evaluate(() => (window as unknown as { __ocrReads: number }).__ocrReads);
  expect(await reads()).toBe(1);
  expect(await page.evaluate(() => (window as unknown as { __legacySamples: number }).__legacySamples)).toBeGreaterThan(3);
  await page.waitForTimeout(4000);
  expect(await reads()).toBe(1);
  await expect(page.getByRole("button", { name: "Read label with OCR", exact: true })).toBeEnabled();
  await page.evaluate(() => { (window as unknown as { __rotated: boolean }).__rotated = true; });
  await expect.poll(reads, { timeout: 15000 }).toBe(2);
  await expect(page.locator("#camera-guidance")).toContainText("I could not read the label.");
  await page.waitForTimeout(3000);
  expect(await reads()).toBe(2);
  await page.evaluate(() => { (window as unknown as { __ocrError: boolean }).__ocrError = true; });
  await page.getByRole("button", { name: "Read label with OCR", exact: true }).click();
  await expect.poll(reads).toBe(3);
  await expect(page.locator("#camera-guidance")).toContainText("I could not read the label.");
  await expect(page.getByRole("button", { name: "Read label with OCR", exact: true })).toBeEnabled();
  expect(await page.evaluate(() => (window as unknown as { __speeches: { text: string }[] }).__speeches.some(s => s.text === "Good position. Reading the label."))).toBe(true);
  await page.getByRole("button", { name: "Stop camera", exact: true }).click();
});

test("camera instructions remain visible without speech synthesis", async ({ page }) => {
  await installCamera(page, false);
  await page.goto("/");
  await page.getByRole("button", { name: "Start checking my delivery", exact: true }).click();
  await expect(page.locator("#camera-guidance")).toHaveText("More light is needed.");
  await expect(page.getByRole("button", { name: "Read label with OCR", exact: true })).toBeEnabled();
  await page.getByRole("button", { name: "Stop camera", exact: true }).click();
});
