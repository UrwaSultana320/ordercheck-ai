import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
async function openVoice(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: "Tell OrderCheck what I ordered", exact: true }).first().click();
  await expect(page.getByRole("heading", { name: "Tell OrderCheck what I ordered", exact: true })).toBeFocused();
}
async function review(page: Page, text: string) {
  await page.getByLabel("Order transcript", { exact: true }).fill(text);
  await page.getByRole("button", { name: "Review order", exact: true }).click();
}
test("typed transcript requires confirmation, omits missing details, saves logical headings and persists only confirmed data", async ({ page }, testInfo) => {
  await openVoice(page);
  await expect(page.getByRole("button", { name: "Review order", exact: true })).toBeDisabled();
  await review(page, "I ordered from Market. two blue shirts and one soap 200 g");
  await expect(page.getByRole("heading", { name: "Review your order", exact: true })).toBeFocused();
  await expect(page.getByText("0 saved orders", { exact: true })).toBeVisible();
  expect(await page.evaluate(() => sessionStorage.getItem("ordercheck.v2"))).toBeNull();
  await page.screenshot({ path: testInfo.outputPath("voice-order-review.png"), fullPage: true });
  expect((await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze()).violations).toEqual([]);
  await page.getByRole("button", { name: "Confirm and save voice order", exact: true }).click();
  const order = page.getByRole("heading", { name: "Market", exact: true }).locator("../..");
  await expect(order.getByRole("heading", { name: "shirts", level: 3 })).toBeVisible();
  await expect(order.getByText(/color: blue/)).toBeVisible();
  await expect(order.getByText(/Size: 200 g/)).toBeVisible();
  await expect(order).not.toContainText("N/A");
  await expect(order).not.toContainText("Color: Unknown");
  await page.getByLabel("Keep orders in this browser tab for this session").check();
  const saved = await page.evaluate(() => JSON.parse(sessionStorage.getItem("ordercheck.v2")!));
  expect(saved.orders[0]).not.toHaveProperty("transcript");
  expect(saved.orders[0].source).toBe("manual");
  expect(saved.orders[0].items[0]).not.toHaveProperty("source");
  await page.reload();
  const menu = page.getByRole("button", { name: "Menu", exact: true });
  if (await menu.isVisible()) await menu.click();
  await page.getByRole("navigation").getByRole("button", { name: "My orders", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Market", exact: true })).toBeVisible();
});
test("targeted size correction preserves other products; start again and cancel never save", async ({ page }) => {
  await openVoice(page);
  await review(page, "two shampoos maybe 400 ml and one coffee 200 g");
  await expect(page.getByRole("button", { name: "Confirm and save voice order", exact: true })).toBeDisabled();
  await page.getByRole("button", { name: "Change", exact: true }).click();
  await expect(page.getByLabel("Field to change", { exact: true })).toHaveValue("0:size");
  await page.getByLabel("Correct value", { exact: true }).fill("500 ml");
  await page.getByRole("button", { name: "Apply correction and review", exact: true }).click();
  await expect(page.getByText("500 ml", { exact: true })).toBeVisible();
  await expect(page.getByText("200 g", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Confirm and save voice order", exact: true })).toBeEnabled();
  await page.getByRole("button", { name: "Start again", exact: true }).click();
  await expect(page.getByLabel("Order transcript", { exact: true })).toHaveValue("");
  await page.getByRole("button", { name: "Cancel order", exact: true }).click();
  await expect(page.getByText("0 saved orders", { exact: true })).toBeVisible();
});
test("unsupported dictation offers typed fallback", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, "SpeechRecognition", { value: undefined, configurable: true });
    Object.defineProperty(window, "webkitSpeechRecognition", { value: undefined, configurable: true });
  });
  await openVoice(page);
  await page.getByLabel("Allow order speech recognition", { exact: false }).check();
  await page.getByRole("button", { name: "Start order recording", exact: true }).click();
  await expect(page.getByText("Speech recognition is unavailable. Type your order below.", { exact: true })).toBeVisible();
  await review(page, "one soap");
  await expect(page.getByRole("button", { name: "Confirm and save voice order", exact: true })).toBeEnabled();
});
async function mockSpeech(page: Page, denied = false) {
  await page.addInitScript(({ denied }) => {
    const host = window as unknown as Window & { __orderRec: MockRecognition; __spoken: string[] };
    host.__spoken = [];
    class MockRecognition {
      lang = ""; continuous = false; interimResults = false;
      onstart: (() => void) | null = null; onend: (() => void) | null = null;
      onerror: ((e: { error: string }) => void) | null = null;
      onresult: ((e: { resultIndex: number; results: { isFinal: boolean; 0: { transcript: string } }[] }) => void) | null = null;
      constructor() { host.__orderRec = this; }
      start() { if (denied) this.onerror?.({ error: "not-allowed" }); else this.onstart?.(); }
      abort() { this.onend?.(); }
      stop() { this.onend?.(); }
      emit(text: string) { this.onresult?.({ resultIndex: 0, results: [{ isFinal: true, 0: { transcript: text } }] }); }
    }
    Object.defineProperty(window, "SpeechRecognition", { value: MockRecognition, configurable: true });
    Object.defineProperty(window.speechSynthesis, "speak", { value: (u: SpeechSynthesisUtterance) => { host.__spoken.push(u.text); setTimeout(() => u.onend?.(new Event("end") as SpeechSynthesisEvent), 20); } });
    Object.defineProperty(window.speechSynthesis, "cancel", { value: () => {} });
  }, { denied });
}
async function emit(page: Page, text: string) {
  await page.evaluate(text => (window as unknown as Window & { __orderRec: { emit(text: string): void } }).__orderRec.emit(text), text);
}

test("failed review focuses an inline alert and an edited speech-style transcript can be reviewed and saved", async ({ page }, testInfo) => {
  await openVoice(page);
  await review(page, "I ordered from Daraz");
  const error = page.getByRole("alert").filter({ hasText: /identify/ });
  await expect(error).toContainText("I found the platform, but I couldn't identify the products");
  await expect(error).toBeFocused();
  await expect(page.getByLabel("Order transcript", { exact: true })).toBeEditable();
  await expect(page.getByLabel("Order transcript", { exact: true })).toHaveAttribute("aria-describedby", "order-transcript-error");
  await page.screenshot({ path: testInfo.outputPath("voice-order-inline-error.png"), fullPage: true });
  expect((await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze()).violations).toEqual([]);
  await review(page, "I ordered");
  await expect(error).toContainText("I couldn't identify any products");
  await expect(error).toBeFocused();
  await review(page, "I ordered from Daraz I ordered two Dove Hair Fall Rescue shampoos 400 millilitres and one Nescafe Classic coffee 200 grams");
  await expect(page.getByRole("heading", { name: "Review your order", exact: true })).toBeFocused();
  await expect(page.getByText("Platform: Daraz", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Product 2: Nescafe Classic coffee", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Confirm and save voice order", exact: true }).click();
  await expect(page.getByText("1 saved orders", { exact: true })).toBeVisible();
});

for (const ending of ["Finish recording", "browser end", "silence"] as const) {
  test(`successful mocked speech automatically focuses review after ${ending}`, async ({ page }) => {
    await mockSpeech(page);
    await openVoice(page);
    await page.getByLabel("Order speech language", { exact: true }).selectOption("en-US");
    await page.getByLabel("Allow order speech recognition", { exact: false }).check();
    await page.getByRole("button", { name: "Start order recording", exact: true }).click();
    expect(await page.evaluate(() => (window as unknown as { __orderRec: { lang: string } }).__orderRec.lang)).toBe("en-US");
    await emit(page, "I ordered from Daraz and I ordered two Dove shampoos 400 ml and one Nescafe coffee 200 grams");
    if (ending === "Finish recording") await page.getByRole("button", { name: ending, exact: true }).click();
    else if (ending === "browser end") await page.evaluate(() => (window as unknown as { __orderRec: { onend(): void } }).__orderRec.onend());
    await expect(page.getByRole("heading", { name: "Review your order", exact: true })).toBeFocused({ timeout: 10000 });
    await expect(page.getByRole("heading", { name: "Product 1: Dove shampoos", exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Product 2: Nescafe coffee", exact: true })).toBeVisible();
    await expect(page.getByText(/Listening for Confirm, Change/)).toBeVisible();
    await page.getByRole("button", { name: "Cancel recording", exact: true }).click();
    await expect(page.getByText("Order microphone: off.", { exact: true })).toBeVisible();
  });
}

test("failed automatic parsing keeps speech editable with an inline error and typed retry", async ({ page }) => {
  await mockSpeech(page);
  await openVoice(page);
  await page.getByLabel("Allow order speech recognition", { exact: false }).check();
  await page.getByRole("button", { name: "Start order recording", exact: true }).click();
  expect(await page.evaluate(() => (window as unknown as { __orderRec: { lang: string } }).__orderRec.lang)).toBe("en-PK");
  await emit(page, "I ordered from Daraz stop recording");
  await expect(page.getByRole("alert").filter({ hasText: /identify/ })).toBeFocused();
  await expect(page.getByRole("alert").filter({ hasText: /identify/ })).toContainText("I found the platform");
  await expect(page.getByText("Order microphone: off.", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Order transcript", { exact: true })).toHaveValue("I ordered from Daraz");
  await expect(page.getByLabel("Order transcript", { exact: true })).toBeEditable();
  await review(page, "I ordered two Dove shampoos");
  await expect(page.getByRole("heading", { name: "Review your order", exact: true })).toBeFocused();
});
test("mocked dictation, spoken readback, targeted voice correction and spoken confirmation", async ({ page }) => {
  await mockSpeech(page);
  await openVoice(page);
  await page.getByLabel("Allow order speech recognition", { exact: false }).check();
  await page.getByRole("button", { name: "Start order recording", exact: true }).click();
  await emit(page, "two shampoos maybe 400 ml and one coffee 200 g stop recording");
  await expect(page.getByText(/Listening for Confirm, Change/)).toBeVisible();
  expect(await page.evaluate(() => (window as unknown as Window & { __spoken: string[] }).__spoken.some(s => s.includes("I heard:")))).toBe(true);
  await emit(page, "change size for product 0");
  await expect(page.getByText("That product number does not exist. Use Change to select a product.", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Read back and listen for confirmation", exact: true }).click();
  await expect(page.getByText(/Listening for Confirm, Change/)).toBeVisible();
  await emit(page, "change size for product 1");
  await expect(page.getByText(/Listening\. Pause when finished/)).toBeVisible();
  await emit(page, "500 ml stop recording");
  await expect(page.getByText(/Listening for Confirm, Change/)).toBeVisible();
  await expect(page.getByText("500 ml", { exact: true })).toBeVisible();
  await emit(page, "confirm stop recording");
  await expect(page.getByText("1 saved orders", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "shampoos", exact: true })).toBeVisible();
});
test("mocked permission denial, cancel, restart, and Escape leave microphone off without saving", async ({ page }) => {
  await mockSpeech(page, true);
  await openVoice(page);
  await page.getByLabel("Allow order speech recognition", { exact: false }).check();
  await page.getByRole("button", { name: "Start order recording", exact: true }).click();
  await expect(page.getByText(/Microphone permission denied\. Allow/)).toBeVisible();
  await expect(page.getByText("Order microphone: off.", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Cancel order", exact: true }).click();
  await mockSpeech(page);
  await openVoice(page);
  await page.getByLabel("Allow order speech recognition", { exact: false }).check();
  await page.getByRole("button", { name: "Start order recording", exact: true }).click();
  await page.getByRole("button", { name: "Cancel recording", exact: true }).click();
  await expect(page.getByText("Order microphone: off.", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Start order recording", exact: true }).click();
  await emit(page, "start again");
  await expect(page.getByLabel("Order transcript", { exact: true })).toHaveValue("");
  await page.keyboard.press("Escape");
  await expect(page.getByText("Order microphone: off.", { exact: true })).toBeVisible();
  await expect(page.getByText("0 saved orders", { exact: true })).toBeVisible();
});

test("legacy saved orders load without new optional fields", async ({ page }) => {
  await page.addInitScript(() => sessionStorage.setItem("ordercheck.v1", JSON.stringify([{ id: "legacy", label: "Legacy order", source: "manual", items: [{ id: "legacy-item", name: "Legacy soap", brand: "", variant: "", size: "", quantity: 2, verified: 0 }] }])));
  await page.goto("/");
  await page.getByRole("button", { name: "View all orders", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Legacy order", level: 2 })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Legacy soap", level: 3 })).toBeVisible();
  await expect(page.getByText("0 / 2 matching", { exact: true })).toBeVisible();
  await expect(page.getByText(/Size: N\/A|Color: Unknown|Variant: -/)).toHaveCount(0);
});
test("voice review reflows with large text and high contrast and passes axe", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("ordercheck.preferences.v1", JSON.stringify({ spoken: false, size: "extra-large", contrast: true, rate: 0.95 })));
  await openVoice(page);
  await page.setViewportSize({ width: 320, height: 900 });
  await review(page, "two blue shirts and one coffee 200 g");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
  expect((await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze()).violations).toEqual([]);
});
