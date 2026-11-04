import { QRCodeWriter, BarcodeFormat } from "@zxing/library";
import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

// Synthetic canvas stream exercises wiring and cleanup, not physical optics.
async function installCamera(page: Page, speech = true, quantity = 1, benchmark = false) {
  await page.addInitScript(({ speech, quantity, benchmark }) => {
    sessionStorage.setItem("ordercheck.v2", JSON.stringify({ orders: [{
      id: "camera-test", label: "Camera test", source: "purchase", items: [{
        id: "item", ...(benchmark ? { name: "Body Lotion", brand: "LOVE JOJO", variant: "Vitamin C Whitening", size: "500 ml" } : { name: "Oat drink", brand: "Everyday", variant: "Original", size: "1 L" }), quantity, verified: 0,
      }],
    }], attempts: [] }));
    const host = window as unknown as {
      __cameraStops: number; __cameraRequests: number; __cameraPattern: boolean;
      __plain: boolean; __rotated: boolean; __ocrReads: number; __ocrError: boolean;
      __legacyJitter: boolean; __legacySamples: number;
      __barcodePoints?: [number, number][]; __ocrText?: string; __ocrDelay?: number; __ocrConfidence?: number;
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
          data: packet.action === "recognize" && host.__ocrError ? "Synthetic OCR failure" : { text: host.__ocrText ?? "", confidence: host.__ocrConfidence ?? (host.__ocrText ? 95 : 0) },
        } }), packet.action === "recognize" ? host.__ocrDelay ?? 100 : 100);
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
      const originalPaint = paint;
      const paintWithBarcode = () => {
        originalPaint();
        if (host.__barcodePoints) {
          ctx.fillStyle = "white"; ctx.fillRect(0, 0, 320, 240);
          ctx.fillStyle = "black";
          for (const [x, y] of host.__barcodePoints) ctx.fillRect(x + 60, y + 20, 1, 1);
        }
      };
      paintWithBarcode();
      const timer = setInterval(paintWithBarcode, 100);
      const stream = canvas.captureStream(10);
      for (const track of stream.getTracks()) {
        const stop = track.stop.bind(track);
        track.stop = () => { host.__cameraStops++; clearInterval(timer); stop(); };
      }
      return stream;
    } });
  }, { speech, quantity, benchmark });
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
    "Opening the delivery scanner. Your browser may ask for camera permission.",
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
  await expect.poll(() => page.evaluate(() => (window as unknown as { __speeches: { text: string }[] }).__speeches.some(s => s.text === "Frame is steady. Looking for a barcode or readable label.")), { timeout: 15000 }).toBe(true);
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
  await expect(page.locator("#camera-guidance")).toHaveText("Hold the product steady while the camera focuses.", { timeout: 4000 });
  const transition = await page.evaluate(() => ({ now: performance.now(), speeches: (window as unknown as { __speeches: { text: string; at: number }[] }).__speeches }));
  expect(transition.now - darkAt).toBeLessThan(5000);
  expect(transition.speeches.some(s => s.text === "Hold the product steady while the camera focuses.")).toBe(false);
  await page.evaluate(() => { (window as unknown as { __cameraPattern: boolean }).__cameraPattern = true; });
  await expect(page.locator("#camera-guidance")).toHaveText("I could not find a readable barcode or product label. Place the product label inside the guide.", { timeout: 15000 });
  const reads = () => page.evaluate(() => (window as unknown as { __ocrReads: number }).__ocrReads);
  expect(await reads()).toBe(1);
  expect(await page.evaluate(() => (window as unknown as { __legacySamples: number }).__legacySamples)).toBeGreaterThan(3);
  await page.waitForTimeout(4000);
  expect(await reads()).toBe(1);
  await expect(page.getByRole("button", { name: "Read label with OCR", exact: true })).toBeEnabled();
  await page.evaluate(() => { (window as unknown as { __rotated: boolean }).__rotated = true; });
  await expect.poll(reads, { timeout: 15000 }).toBe(2);
  await expect(page.locator("#camera-guidance")).toContainText("I could not find a readable barcode or product label.");
  await page.waitForTimeout(3000);
  expect(await reads()).toBe(2);
  await page.evaluate(() => { (window as unknown as { __ocrError: boolean }).__ocrError = true; });
  await page.getByRole("button", { name: "Read label with OCR", exact: true }).click();
  await expect.poll(reads).toBe(3);
  await expect(page.locator("#camera-guidance")).toContainText("I could not read this side.");
  await expect(page.getByRole("button", { name: "Read label with OCR", exact: true })).toBeEnabled();
  expect(await page.evaluate(() => (window as unknown as { __speeches: { text: string }[] }).__speeches.some(s => s.text === "Frame is steady. Looking for a barcode or readable label."))).toBe(true);
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

test("stable high-quality snapshot barcode uses real ZXing, skips OCR and deduplicates the same view", async ({ page }) => {
  await installCamera(page, true, 2);
  const matrix = new QRCodeWriter().encode("DEMO-OAT-ORIGINAL-1L", BarcodeFormat.QR_CODE, 200, 200, new Map());
  const points: [number, number][] = [];
  for (let y = 0; y < 200; y++) for (let x = 0; x < 200; x++) if (matrix.get(x, y)) points.push([x, y]);
  await page.addInitScript(({ points }) => {
    const host = window as unknown as { __snapshotReads: number; __cameraPattern: boolean };
    host.__snapshotReads = 0;
    const drawImage = CanvasRenderingContext2D.prototype.drawImage;
    CanvasRenderingContext2D.prototype.drawImage = function(...args: unknown[]) {
      Reflect.apply(drawImage, this, args);
      // App snapshots scale explicitly (five args). Live ZXing draws with three
      // args; the tiny guidance frames stay untouched. Only the snapshot sees QR.
      if (args.length === 5 && this.canvas.width >= 320) {
        host.__snapshotReads++;
        this.fillStyle = "white"; this.fillRect(0, 0, this.canvas.width, this.canvas.height);
        this.fillStyle = "black";
        for (const [x, y] of points) this.fillRect(x + 60, y + 20, 1, 1);
      }
    };
  }, { points });
  await page.goto("/");
  await page.evaluate(() => { (window as unknown as { __cameraPattern: boolean }).__cameraPattern = true; });
  await page.getByRole("button", { name: "Start checking my delivery", exact: true }).click();
  await expect.poll(() => page.evaluate(() => (window as unknown as { __snapshotReads: number }).__snapshotReads), { timeout: 15000 }).toBe(1);
  await expect.poll(() => page.evaluate(() => (window as unknown as { __speeches: { text: string }[] }).__speeches.some(s => s.text === "Barcode detected. Checking this product."))).toBe(true);
  expect(await page.evaluate(() => (window as unknown as { __ocrReads: number }).__ocrReads)).toBe(0);
  await expect(page.getByRole("status")).toContainText(/match/i);
  await page.waitForTimeout(3500);
  expect(await page.evaluate(() => (window as unknown as { __snapshotReads: number }).__snapshotReads)).toBe(1);
  expect(await page.evaluate(() => (window as unknown as { __ocrReads: number }).__ocrReads)).toBe(0);
  const saved = await page.evaluate(() => JSON.parse(sessionStorage.getItem("ordercheck.v2")!));
  expect(saved.orders[0].items[0].verified).toBe(1);
  expect(saved.attempts).toHaveLength(1);
  await page.getByRole("button", { name: "Stop camera", exact: true }).click();
});


test("unknown live barcode automatically reads label on the same presentation before finalizing", async ({ page }) => {
  await installCamera(page, true, 2);
  const matrix = new QRCodeWriter().encode("UNKNOWN-REAL-PACKAGE", BarcodeFormat.QR_CODE, 200, 200, new Map());
  const points: [number, number][] = [];
  for (let y = 0; y < 200; y++) for (let x = 0; x < 200; x++) if (matrix.get(x, y)) points.push([x, y]);
  await page.goto("/");
  await page.evaluate(points => {
    const host = window as unknown as { __barcodePoints: [number, number][]; __ocrText: string; __ocrDelay: number };
    host.__barcodePoints = points;
    host.__ocrText = "Everyday Oat drink Original 1 L";
    host.__ocrDelay = 1500;
  }, points);
  await page.getByRole("button", { name: "Start checking my delivery", exact: true }).click();
  await expect.poll(() => page.evaluate(() => (window as unknown as { __ocrReads: number }).__ocrReads), { timeout: 20000 }).toBe(1);
  await expect(page.getByRole("region", { name: "Physical test diagnostics" })).toContainText("Barcode known: no");
  await expect(page.getByRole("region", { name: "Physical test diagnostics" })).toContainText("Barcode detected: UNKNOWN-REAL-PACKAGE");
  expect(await page.evaluate(() => JSON.parse(sessionStorage.getItem("ordercheck.v2")!).attempts)).toHaveLength(0);
  await expect(page.locator("#camera-guidance")).toHaveText("Reading label.");
  await expect.poll(() => page.evaluate(() => JSON.parse(sessionStorage.getItem("ordercheck.v2")!).attempts.length)).toBe(1);
  const saved = await page.evaluate(() => JSON.parse(sessionStorage.getItem("ordercheck.v2")!));
  expect(saved.attempts[0].observation).toMatchObject({ barcode: "UNKNOWN-REAL-PACKAGE", source: "ocr", text: "Everyday Oat drink Original 1 L" });
  expect(saved.attempts[0].status).toBe("MATCH");
  expect(saved.orders[0].items[0].verified).toBe(1);
  await expect(page.locator("#camera-guidance")).not.toBeEmpty();
  await page.waitForTimeout(3500);
  expect(await page.evaluate(() => (window as unknown as { __ocrReads: number }).__ocrReads)).toBe(1);
  expect(await page.evaluate(() => (window as unknown as { __speeches: { text: string }[] }).__speeches.some(s => s.text.includes("barcode alone")))).toBe(true);
});

test("bounded imperfect view attempts once then keeps rotation status until the view changes", async ({ page }) => {
  await installCamera(page);
  await page.goto("/");
  await page.evaluate(() => { (window as unknown as { __plain: boolean }).__plain = true; });
  await page.getByRole("button", { name: "Start checking my delivery", exact: true }).click();
  await expect(page.locator("#camera-guidance")).not.toBeEmpty();
  await expect.poll(() => page.evaluate(() => (window as unknown as { __ocrReads: number }).__ocrReads), { timeout: 18000 }).toBe(1);
  await expect(page.locator("#camera-guidance")).toHaveText("I could not find a readable barcode or product label. Place the product label inside the guide.");
  expect(await page.evaluate(() => JSON.parse(sessionStorage.getItem("ordercheck.v2")!).attempts)).toHaveLength(0);
  await page.waitForTimeout(7000);
  expect(await page.evaluate(() => (window as unknown as { __ocrReads: number }).__ocrReads)).toBe(1);
});

test("benchmark EAN-13 is decoded by real ZXing, diagnosed and verified without OCR", async ({ page }) => {
  await installCamera(page, true, 1, true);
  // Synthetic EAN-13 bars for 4897099081562, with quiet zones. No decoder mock.
  const left = ["0001101", "0011001", "0010011", "0111101", "0100011", "0110001", "0101111", "0111011", "0110111", "0001011"];
  const inverse = (bits: string) => [...bits].map(b => b === "0" ? "1" : "0").join("");
  const code = "4897099081562";
  const bits = "101" + [...code.slice(1, 7)].map((digit, i) => {
    const pattern = left[Number(digit)];
    return "LGLLGG"[i] === "L" ? pattern : inverse([...pattern].reverse().join(""));
  }).join("") + "01010" + [...code.slice(7)].map(digit => inverse(left[Number(digit)])).join("") + "101";
  const points: [number, number][] = [];
  for (let x = 0; x < bits.length; x++) if (bits[x] === "1")
    for (let y = 40; y < 160; y++) for (let dx = 0; dx < 2; dx++) points.push([x * 2 + dx, y]);
  await page.goto("/");
  await page.evaluate(points => { (window as unknown as { __barcodePoints: [number, number][] }).__barcodePoints = points; }, points);
  await page.getByRole("button", { name: "Start checking my delivery", exact: true }).click();
  const diagnostics = page.getByRole("region", { name: "Physical test diagnostics" });
  await expect(diagnostics).toContainText("Barcode detected: 4897099081562", { timeout: 20000 });
  await expect(diagnostics).toContainText("Barcode known: yes");
  await expect(diagnostics).toContainText("Verification result: match");
  await expect(diagnostics).toContainText("OCR attempts: 0");
  expect(await page.evaluate(() => (window as unknown as { __ocrReads: number }).__ocrReads)).toBe(0);
  const saved = await page.evaluate(() => JSON.parse(sessionStorage.getItem("ordercheck.v2")!));
  expect(saved.orders[0].items[0].verified).toBe(1);
  expect(saved.attempts[0].observation.barcode).toBe(code);
});

for (const confidence of [95, 70, 20]) test(`front-label raw OCR diagnostics preserve worker output at confidence ${confidence}`, async ({ page }) => {
  await installCamera(page, true, 1, true);
  await page.setViewportSize({ width: 320, height: 700 });
  await page.goto("/");
  const raw = "  LOVE JOJO\nBODY LOTION\nVITAMIN C\nVITAMIN C WHITENING\nNet: 500ml  \n" + "X".repeat(220);
  await page.evaluate(({ raw, confidence }) => {
    const host = window as unknown as { __cameraPattern: boolean; __ocrText: string; __ocrConfidence: number };
    host.__cameraPattern = true; host.__ocrText = raw; host.__ocrConfidence = confidence;
  }, { raw, confidence });
  await page.getByRole("button", { name: "Start checking my delivery", exact: true }).click();
  const diagnostics = page.getByRole("region", { name: "Physical test diagnostics" });
  await expect(diagnostics).toContainText("OCR attempts: 1", { timeout: 20000 });
  await expect(diagnostics).toContainText("OCR attempted: yes");
  await expect(diagnostics).toContainText(`Last OCR confidence: ${confidence}`);
  expect(await page.getByTestId("raw-ocr-text").textContent()).toBe(raw);
  await expect(diagnostics).toContainText("Barcode detected: none");
  await expect(diagnostics).toContainText(`Verification result: ${confidence >= 85 ? "match" : "unable"}`);
  expect(await page.evaluate(() => JSON.parse(sessionStorage.getItem("ordercheck.v2")!).orders[0].items[0].verified)).toBe(confidence >= 85 ? 1 : 0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  expect(await diagnostics.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
  if (confidence === 70) await diagnostics.screenshot({ path: "test-results/benchmark-diagnostics-320.png" });
});

test("stable empty view reports no readable evidence, speaks recovery and never counts", async ({ page }) => {
  await installCamera(page, true, 1, true);
  await page.goto("/");
  await page.evaluate(() => { (window as unknown as { __plain: boolean }).__plain = true; });
  await page.getByRole("button", { name: "Start checking my delivery", exact: true }).click();
  const diagnostics = page.getByRole("region", { name: "Physical test diagnostics" });
  await expect(diagnostics).toContainText("OCR attempts: 0");
  await expect(diagnostics).toContainText("Verification result: not checked");
  const recovery = "I could not find a readable barcode or product label. Place the product label inside the guide.";
  await expect(page.locator("#camera-guidance")).toHaveText(recovery, { timeout: 20000 });
  await expect(diagnostics).toContainText("OCR attempts: 1");
  await expect(diagnostics).toContainText("Last OCR confidence: 0");
  await expect(diagnostics).toContainText("Last OCR text: none");
  await expect(diagnostics).toContainText("Verification result: unable");
  await expect(page.getByRole("heading", { name: "unable_to_verify", exact: true })).toBeVisible();
  const saved = await page.evaluate(() => JSON.parse(sessionStorage.getItem("ordercheck.v2")!));
  expect(saved.orders[0].items[0].verified).toBe(0);
  expect(saved.attempts).toHaveLength(0);
  const speeches = await page.evaluate(() => (window as unknown as { __speeches: { text: string }[] }).__speeches.map(s => s.text));
  expect(speeches).toContain(recovery);
  expect(speeches.join(" ")).not.toMatch(/good position|product detected|product found|match/i);
});

test("unknown decoded barcode with empty OCR retains existing rotation recovery", async ({ page }) => {
  await installCamera(page, true, 1, true);
  const matrix = new QRCodeWriter().encode("UNKNOWN-REAL-PACKAGE", BarcodeFormat.QR_CODE, 200, 200, new Map());
  const points: [number, number][] = [];
  for (let y = 0; y < 200; y++) for (let x = 0; x < 200; x++) if (matrix.get(x, y)) points.push([x, y]);
  await page.goto("/");
  await page.evaluate(points => { (window as unknown as { __barcodePoints: [number, number][] }).__barcodePoints = points; }, points);
  await page.getByRole("button", { name: "Start checking my delivery", exact: true }).click();
  await expect(page.locator("#camera-guidance")).toHaveText("I could not read this side. Slowly rotate the product.", { timeout: 20000 });
  const diagnostics = page.getByRole("region", { name: "Physical test diagnostics" });
  await expect(diagnostics).toContainText("Barcode detected: UNKNOWN-REAL-PACKAGE");
  await expect(diagnostics).toContainText("Barcode known: no");
  await expect(diagnostics).toContainText("OCR attempts: 1");
  const saved = await page.evaluate(() => JSON.parse(sessionStorage.getItem("ordercheck.v2")!));
  expect(saved.orders[0].items[0].verified).toBe(0);
  expect(saved.attempts).toHaveLength(0);
});
