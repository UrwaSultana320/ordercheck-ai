import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

// Synthetic canvas stream exercises wiring and cleanup, not physical optics.
test("synthetic dark camera guidance is accessible, quiet, and preserves manual OCR and cleanup", async ({ page }) => {
  await page.addInitScript(() => {
    sessionStorage.setItem("ordercheck.v2", JSON.stringify({ orders: [{
      id: "camera-test", label: "Camera test", source: "purchase", items: [{
        id: "item", name: "Oat drink", brand: "Everyday", variant: "Original", size: "1 L", quantity: 1, verified: 0,
      }],
    }], attempts: [] }));
    const host = window as unknown as { __cameraStops: number; __cameraRequests: number; __cameraPattern: boolean };
    host.__cameraStops = 0;
    host.__cameraRequests = 0;
    host.__cameraPattern = false;
    Object.defineProperty(navigator.mediaDevices, "getUserMedia", { value: async () => {
      host.__cameraRequests++;
      const canvas = document.createElement("canvas");
      canvas.width = 320; canvas.height = 240;
      const ctx = canvas.getContext("2d")!;
      const paint = () => {
        ctx.fillStyle = host.__cameraPattern ? "rgb(140,140,140)" : "rgb(12,12,12)";
        ctx.fillRect(0, 0, 320, 240);
        if (host.__cameraPattern) {
          for (let y = 70; y < 175; y += 8) for (let x = 85; x < 235; x += 8) {
            ctx.fillStyle = ((x - 85 + y - 70) / 8) % 2 ? "rgb(70,70,70)" : "rgb(210,210,210)";
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
  });
  await page.goto("/");
  expect(await page.evaluate(() => (window as unknown as { __cameraRequests: number }).__cameraRequests)).toBe(0);
  await page.getByRole("button", { name: "Start checking my delivery", exact: true }).click();
  const status = page.getByRole("status");
  await expect(status).toContainText("More light is needed.", { timeout: 20000 });
  await expect(page.locator("#camera-guidance")).toHaveText("More light is needed.");
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
  await expect(page.locator("#camera-guidance")).toHaveText("Good position. Reading the label.", { timeout: 15000 });
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
