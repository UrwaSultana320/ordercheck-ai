import { expand } from "./ui";
import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
async function openVoice(page: Page) {
  await page.goto("/");
  await expand(page, "Privacy & stored orders");
  await page.getByRole("button", { name: "Tell OrderCheck what I ordered", exact: true }).first().click();
  await expect(page.getByRole("heading", { name: "Tell OrderCheck what I ordered", exact: true })).toBeFocused();
}
async function review(page: Page, text: string) {
  await page.getByLabel("Order transcript", { exact: true }).fill(text);
  await page.getByRole("button", { name: "Review order", exact: true }).click();
}

test("explicit confirmation of heard name saves an order and offers scanning without requesting camera", async ({ page }, testInfo) => {
  if (testInfo.project.name === "mobile") await page.setViewportSize({ width: 320, height: 700 });
  await mockSpeech(page);
  await mockRecording(page, "one Head and shoulders anti-denture");
  await openVoice(page);
  await page.getByLabel("Keep orders in this browser tab for this session").check();
  await page.getByLabel("Allow order audio transcription", { exact: false }).check();
  await page.getByRole("button", { name: "Start order recording", exact: true }).click();
  await page.getByRole("button", { name: "Finish recording", exact: true }).click();
  await expect(page.getByText("Order microphone: listening.", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Cancel recording", exact: true }).click();
  const save = page.getByRole("button", { name: "Confirm and save voice order", exact: true });
  await expect(save).toBeDisabled();
  await expect(page.getByText("Confirm or correct the highlighted details before saving.", { exact: true })).toBeVisible();
  await expect(save).toHaveAttribute("aria-describedby", "voice-order-save-reason");
  const confirm = page.getByRole("button", { name: "Confirm current details", exact: true });
  await confirm.scrollIntoViewIfNeeded();
  await expect(confirm).toBeInViewport();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  expect((await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze()).violations).toEqual([]);
  await confirm.click();
  await expect(save).toBeEnabled();
  await save.click();
  await expect(page.getByRole("heading", { name: "Review your order", exact: true })).toHaveCount(0);
  await expect(page.locator(".saved-order")).toHaveCount(1);
  const saved = await page.evaluate(() => JSON.parse(sessionStorage.getItem("ordercheck.v2")!));
  expect(saved.orders[0].source).toBe("voice");
  expect(saved.orders[0].items[0]).toMatchObject({ name: "Head and shoulders anti-denture", quantity: 1 });
  const scan = page.getByRole("button", { name: "Start checking", exact: true });
  await expect(scan).toBeFocused();
  await expect(scan).toBeInViewport();
  await page.getByRole("heading", { name: "Check your delivery", exact: true }).focus();
  await page.getByText("More options", { exact: true }).click();
  await expect(page.getByRole("button", { name: "Start camera", exact: true })).toBeVisible();
  await expect(page.getByText("Your camera is off", { exact: true })).toBeVisible();
  expect(await page.evaluate(() => (window as unknown as { __micRequests: number }).__micRequests)).toBe(1);
});

test("missing quantity explains disabled save and requires a valid correction before confirming name", async ({ page }, testInfo) => {
  if (testInfo.project.name === "mobile") await page.setViewportSize({ width: 320, height: 700 });
  await openVoice(page);
  await review(page, "Head and shoulders anti-denture");
  const save = page.getByRole("button", { name: "Confirm and save voice order", exact: true });
  await expect(save).toBeDisabled();
  await expect(page.getByText("Quantity is required before this order can be saved.", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Confirm current details", exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Change", exact: true }).click();
  await expect(page.getByLabel("Field to change", { exact: true })).toHaveValue("0:quantity");
  await page.getByLabel("Correct value", { exact: true }).fill("0");
  await page.getByRole("button", { name: "Apply correction and review", exact: true }).click();
  await expect(save).toBeDisabled();
  await expect(page.getByRole("button", { name: "Confirm current details", exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Change", exact: true }).click();
  await page.getByLabel("Field to change", { exact: true }).selectOption("0:quantity");
  await page.getByLabel("Correct value", { exact: true }).fill("2");
  await page.getByRole("button", { name: "Apply correction and review", exact: true }).click();
  await expect(save).toBeDisabled();
  await page.getByRole("button", { name: "Confirm current details", exact: true }).click();
  await expect(save).toBeEnabled();
});

test("empty order starts the composer and exposes the scanner after confirmation", async ({ page }) => {
  await page.goto("/");
  await expand(page, "Privacy & stored orders");
  await expand(page, "Voice & session controls");
  await page.getByRole("button", { name: "Start", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Tell OrderCheck what I ordered", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Start camera", exact: true })).toHaveCount(0);
  await review(page, "one soap");
  await page.getByRole("button", { name: "Confirm and save voice order", exact: true }).click();
  await page.getByRole("heading", { name: "Check your delivery", exact: true }).focus();
  if (await page.getByText("More options", { exact: true }).locator("..").getAttribute("open") === null) await page.getByText("More options", { exact: true }).click();
  await expect(page.getByRole("button", { name: "Start camera", exact: true })).toBeEnabled();
  await expect(page.getByRole("button", { name: "Create an order", exact: true })).toHaveCount(0);
});
test("typed transcript requires confirmation, omits missing details, saves logical headings and persists only confirmed data", async ({ page }, testInfo) => {
  await openVoice(page);
  await expect(page.getByRole("button", { name: "Review order", exact: true })).toBeDisabled();
  await review(page, "I ordered from Market. two blue shirts and one soap 200 g");
  await expect(page.getByRole("heading", { name: "Review your order", exact: true })).toBeFocused();
  await expect(page.locator(".saved-order")).toHaveCount(0);
  expect(await page.evaluate(() => sessionStorage.getItem("ordercheck.v2"))).toBeNull();
  await page.screenshot({ path: testInfo.outputPath("voice-order-review.png"), fullPage: true });
  expect((await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze()).violations).toEqual([]);
  await page.getByRole("button", { name: "Confirm and save voice order", exact: true }).click();
  const order = page.locator(".saved-order").filter({ has: page.getByRole("heading", { name: "Market", exact: true }) });
  await expect(order.getByRole("heading", { name: "shirts", level: 3 })).toBeVisible();
  await expect(order.getByText(/color: blue/)).toBeVisible();
  await expect(order.getByText(/200 g/)).toBeVisible();
  await expect(order).not.toContainText("N/A");
  await expect(order).not.toContainText("Color: Unknown");
  await page.getByLabel("Keep orders in this browser tab for this session").check();
  const saved = await page.evaluate(() => JSON.parse(sessionStorage.getItem("ordercheck.v2")!));
  expect(saved.orders[0]).not.toHaveProperty("transcript");
  expect(saved.orders[0].source).toBe("manual");
  expect(saved.orders[0].items[0]).not.toHaveProperty("source");
  await page.reload();
  await page.locator("#order-heading").focus();
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
  await expect(page.locator(".saved-order")).toHaveCount(0);
});
test("unsupported dictation offers typed fallback", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, "MediaRecorder", { value: undefined, configurable: true });
  });
  await openVoice(page);
  await page.getByLabel("Allow order audio transcription", { exact: false }).check();
  await page.getByRole("button", { name: "Start order recording", exact: true }).click();
  await expect(page.getByText("Audio recording is unavailable in this browser. Type your order below.", { exact: true })).toBeVisible();
  await review(page, "one soap");
  await expect(page.getByRole("button", { name: "Confirm and save voice order", exact: true })).toBeEnabled();
});
async function mockSpeech(page: Page, denied = false) {
  await page.addInitScript(({ denied }) => {
    const host = window as unknown as Window & { __orderRec: MockRecognition; __spoken: string[]; __spokenEnded: string[]; __responseStarts: number; __holdReadback: boolean; __finishReadback?: () => void };
    host.__spoken = [];
    host.__spokenEnded = [];
    host.__responseStarts = 0;
    host.__holdReadback = false;
    class MockRecognition {
      lang = ""; continuous = false; interimResults = false;
      onstart: (() => void) | null = null; onend: (() => void) | null = null;
      onerror: ((e: { error: string }) => void) | null = null;
      onresult: ((e: { resultIndex: number; results: { isFinal: boolean; 0: { transcript: string } }[] }) => void) | null = null;
      constructor() { host.__orderRec = this; }
      start() { host.__responseStarts++; if (denied) this.onerror?.({ error: "not-allowed" }); else this.onstart?.(); }
      abort() { this.onend?.(); }
      stop() { this.onend?.(); }
      emit(text: string) { this.onresult?.({ resultIndex: 0, results: [{ isFinal: true, 0: { transcript: text } }] }); }
    }
    Object.defineProperty(window, "SpeechRecognition", { value: MockRecognition, configurable: true });
    Object.defineProperty(window.speechSynthesis, "speak", { value: (u: SpeechSynthesisUtterance) => { host.__spoken.push(u.text);
      const finish = () => { host.__spokenEnded.push(u.text); u.onend?.(new Event("end") as SpeechSynthesisEvent); };
      if (host.__holdReadback && u.text.includes("I heard:")) host.__finishReadback = finish;
      else setTimeout(finish, 20); } });
    Object.defineProperty(window.speechSynthesis, "cancel", { value: () => {} });
  }, { denied });
}
async function emit(page: Page, text: string) {
  await page.evaluate(text => (window as unknown as Window & { __orderRec: { emit(text: string): void } }).__orderRec.emit(text), text);
}

// Synthetic recorder/API fixtures test behavior, not physical microphone accuracy.
async function mockRecording(page: Page, text = "I ordered two soaps", denied = false) {
  await page.addInitScript(({ denied }) => {
    const host = window as unknown as { __orderRecorder: MockRecorder; __micRequests: number; __tracksStopped: number };
    host.__micRequests = 0; host.__tracksStopped = 0;
    class MockRecorder {
      static isTypeSupported(type: string) { return type === "audio/webm;codecs=opus"; }
      state = "inactive"; mimeType = "audio/webm;codecs=opus";
      ondataavailable: ((event: { data: Blob }) => void) | null = null;
      onstop: (() => void) | null = null; onerror: (() => void) | null = null;
      constructor() { host.__orderRecorder = this; }
      start() { this.state = "recording"; }
      stop() {
        this.state = "inactive";
        queueMicrotask(() => { this.ondataavailable?.({ data: new Blob([new Uint8Array([0x1a, 0x45, 0xdf, 0xa3]), "synthetic-audio"], { type: this.mimeType }) }); this.onstop?.(); });
      }
    }
    Object.defineProperty(window, "MediaRecorder", { value: MockRecorder, configurable: true });
    Object.defineProperty(navigator.mediaDevices, "getUserMedia", { configurable: true, value: async () => {
      host.__micRequests++;
      if (denied) throw new DOMException("denied", "NotAllowedError");
      return { getTracks: () => [{ stop: () => { host.__tracksStopped++; } }] };
    } });
  }, { denied });
  await page.route("**/api/order-transcription", async route => {
    expect(route.request().method()).toBe("POST");
    expect(route.request().headers()).not.toHaveProperty("authorization");
    expect(route.request().postDataBuffer()?.includes(Buffer.from('name="audio"'))).toBe(true);
    await route.fulfill({ json: { text } });
  });
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
  await expect(page.getByRole("heading", { name: "Product 2", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Confirm and save voice order", exact: true }).click();
  await expect(page.locator(".saved-order")).toHaveCount(1);
});

for (const ending of ["Finish recording", "recorder end", "maximum duration"] as const) {
  test(`server transcript completes readback then automatically listens after ${ending}`, async ({ page }) => {
    await mockSpeech(page);
    await mockRecording(page, "I ordered from Daraz and I ordered two Dove shampoos 400 ml and one Nescafe coffee 200 grams");
    if (ending === "maximum duration") await page.clock.install();
    await openVoice(page);
    await page.getByLabel("Allow order audio transcription", { exact: false }).check();
    await page.getByRole("button", { name: "Start order recording", exact: true }).click();
    await expect(page.getByText(/Listening to your order/)).toBeVisible();
    if (ending === "Finish recording") await page.getByRole("button", { name: ending, exact: true }).click();
    else if (ending === "recorder end") await page.evaluate(() => (window as unknown as { __orderRecorder: { stop(): void } }).__orderRecorder.stop());
    else await page.clock.fastForward(60001);
    await expect(page.getByRole("heading", { name: "Review your order", exact: true })).toBeFocused({ timeout: 10000 });
    await expect(page.getByRole("heading", { name: "Product 1", exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Product 2", exact: true })).toBeVisible();
    await expect(page.getByText("Order microphone: listening.", { exact: true })).toBeVisible();
    await expect.poll(() => page.evaluate(() => (window as unknown as { __spokenEnded: string[] }).__spokenEnded.some(s => s.includes("I heard:")))).toBe(true);
    expect(await page.evaluate(() => (window as unknown as { __responseStarts: number }).__responseStarts)).toBe(1);
    expect(await page.evaluate(() => (window as unknown as { __micRequests: number }).__micRequests)).toBe(1);
    expect(await page.evaluate(() => (window as unknown as { __tracksStopped: number }).__tracksStopped)).toBe(1);
    await expect(page.getByRole("button", { name: "Cancel recording", exact: true })).toBeEnabled();
  });
}

test("failed automatic parsing keeps speech editable with an inline error and typed retry", async ({ page }) => {
  await mockSpeech(page);
  await mockRecording(page, "I ordered from Daraz");
  await openVoice(page);
  await page.getByLabel("Allow order audio transcription", { exact: false }).check();
  await page.getByRole("button", { name: "Start order recording", exact: true }).click();
  await page.getByRole("button", { name: "Finish recording", exact: true }).click();
  await expect(page.getByRole("alert").filter({ hasText: /identify/ })).toBeFocused();
  await expect(page.getByRole("alert").filter({ hasText: /identify/ })).toContainText("I found the platform");
  await expect(page.getByText("Order microphone: off.", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Order transcript", { exact: true })).toHaveValue("I ordered from Daraz");
  await expect(page.getByLabel("Order transcript", { exact: true })).toBeEditable();
  await review(page, "I ordered two Dove shampoos");
  await expect(page.getByRole("heading", { name: "Review your order", exact: true })).toBeFocused();
});
test("server dictation, readback, explicit targeted voice correction and explicit spoken confirmation", async ({ page }) => {
  await mockSpeech(page);
  await mockRecording(page, "two shampoos maybe 400 ml and one coffee 200 g");
  await openVoice(page);
  await page.getByLabel("Keep orders in this browser tab for this session").check();
  await page.getByLabel("Allow order audio transcription", { exact: false }).check();
  await page.getByRole("button", { name: "Start order recording", exact: true }).click();
  await page.getByRole("button", { name: "Finish recording", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Review your order", exact: true })).toBeFocused();
  await expect(page.getByText("Order microphone: listening.", { exact: true })).toBeVisible();
  expect(await page.evaluate(() => (window as unknown as Window & { __spoken: string[] }).__spoken.some(s => s.includes("I heard:")))).toBe(true);
  await expect(page.getByText(/Listening for Confirm, Change/)).toBeVisible();
  await emit(page, "change size for product 0");
  await expect(page.getByText("That product number does not exist. Use Change to select a product.", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Speak response", exact: true }).click();
  await expect(page.getByText(/Listening for Confirm, Change/)).toBeVisible();
  await emit(page, "change size for product 1");
  await expect(page.getByRole("heading", { name: "Change one detail", exact: true })).toBeFocused();
  await expect(page.getByText("Order microphone: off.", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Speak this correction", exact: true }).click();
  await expect(page.getByText(/Listening for this correction/)).toBeVisible();
  await emit(page, "500 ml stop recording");
  await expect(page.getByRole("heading", { name: "Review your order", exact: true })).toBeFocused();
  await expect(page.getByText("Order microphone: listening.", { exact: true })).toBeVisible();
  await expect(page.getByText("500 ml", { exact: true })).toBeVisible();
  await emit(page, "confirm stop recording");
  await expect(page.getByRole("heading", { name: "Check your delivery", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Review your order", exact: true })).toHaveCount(0);
  const saved = await page.evaluate(() => JSON.parse(sessionStorage.getItem("ordercheck.v2")!));
  expect(saved.orders[0].source).toBe("voice");
  expect(saved.orders[0]).not.toHaveProperty("audio");
  expect(saved.orders[0]).not.toHaveProperty("transcript");
});
test("mocked permission denial, cancel, restart, and Escape leave microphone off without saving", async ({ page }) => {
  await mockSpeech(page, true);
  await mockRecording(page, "one soap", true);
  await openVoice(page);
  await page.getByLabel("Allow order audio transcription", { exact: false }).check();
  await page.getByRole("button", { name: "Start order recording", exact: true }).click();
  await expect(page.getByText(/Microphone permission denied\. Allow/)).toBeVisible();
  await expect(page.getByText("Order microphone: off.", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Cancel order", exact: true }).click();
  await mockSpeech(page);
  await mockRecording(page);
  await openVoice(page);
  await page.getByLabel("Allow order audio transcription", { exact: false }).check();
  await page.getByRole("button", { name: "Start order recording", exact: true }).click();
  await page.getByRole("button", { name: "Cancel recording", exact: true }).click();
  await expect(page.getByText("Order microphone: off.", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Start order recording", exact: true }).click();
  await page.getByRole("button", { name: "Start again", exact: true }).click();
  await expect(page.getByLabel("Order transcript", { exact: true })).toHaveValue("");
  await expect(page.getByText("Order microphone: off.", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Start order recording", exact: true }).click();
  await page.keyboard.press("Escape");
  await expect(page.getByText("Order microphone: off.", { exact: true })).toBeVisible();
  await expect(page.locator(".saved-order")).toHaveCount(0);
});

test("successful dictation can be inspected and edited; explicit save persists no audio or transcript", async ({ page }) => {
  const transcript = "I ordered from Shop.\nI ordered two soaps  and one coffee 200 g";
  await mockSpeech(page); await mockRecording(page, transcript);
  await openVoice(page);
  await page.getByLabel("Keep orders in this browser tab for this session").check();
  await page.getByLabel("Allow order audio transcription", { exact: false }).check();
  await page.getByRole("button", { name: "Start order recording", exact: true }).click();
  await page.getByRole("button", { name: "Finish recording", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Review your order", exact: true })).toBeFocused();
  await expand(page, "Technical details");
  const raw = page.getByRole("region", { name: "Raw transcription", exact: true });
  await expect(raw).toBeVisible();
  expect(await raw.locator("p").textContent()).toBe(transcript);
  await expect(raw.locator("p")).toHaveCSS("white-space", "pre-wrap");
  await expect(page.locator(".voice-order-platform")).toHaveText("Platform: Shop");
  await expect(page.getByText("Order microphone: listening.", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Cancel recording", exact: true }).click();
  await page.getByRole("button", { name: "Read back order", exact: true }).click();
  await expect(page.getByText("Order microphone: listening.", { exact: true })).toBeVisible();
  expect(await page.evaluate(() => (window as unknown as { __responseStarts: number }).__responseStarts)).toBe(2);
  await page.getByRole("button", { name: "Edit order transcript", exact: true }).click();
  await expect(page.getByLabel("Order transcript", { exact: true })).toBeEditable();
  await expect(raw).toHaveCount(0);
  await expect(page.getByLabel("Order transcript", { exact: true })).toHaveValue(transcript);
  await review(page, "I ordered from Shop I ordered three soaps and one coffee 200 g");
  expect(await raw.locator("p").textContent()).toBe("I ordered from Shop I ordered three soaps and one coffee 200 g");
  await page.getByRole("button", { name: "Confirm and save voice order", exact: true }).click();
  const saved = await page.evaluate(() => JSON.parse(sessionStorage.getItem("ordercheck.v2")!));
  expect(saved.orders[0].items.map((item: { quantity: number }) => item.quantity)).toEqual([3, 1]);
  expect(saved.orders[0]).not.toHaveProperty("transcript");
  expect(saved.orders[0]).not.toHaveProperty("audio");
  expect(JSON.stringify(saved)).not.toContain("synthetic-audio");
  expect(JSON.stringify(saved)).not.toContain("I ordered from");
});

test("transcription failure is an inline alert with microphone off and typed fallback", async ({ page }) => {
  await mockSpeech(page); await mockRecording(page);
  await page.route("**/api/order-transcription", route => route.fulfill({ status: 503, json: { error: "Order transcription is not configured. Add OPENAI_API_KEY in Vercel Preview and redeploy." } }));
  await openVoice(page);
  await page.getByLabel("Allow order audio transcription", { exact: false }).check();
  await page.getByRole("button", { name: "Start order recording", exact: true }).click();
  await page.getByRole("button", { name: "Finish recording", exact: true }).click();
  await expect(page.getByRole("alert").filter({ hasText: /OPENAI_API_KEY/ })).toBeFocused();
  await expect(page.getByText("Order microphone: off.", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Order transcript", { exact: true })).toBeEditable();
  expect((await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze()).violations).toEqual([]);
  await review(page, "one soap");
  await expect(page.getByRole("button", { name: "Confirm and save voice order", exact: true })).toBeEnabled();
});

test("transcribing state keeps microphone off and cancellation ignores a late transcript", async ({ page }) => {
  await mockSpeech(page); await mockRecording(page);
  let finish!: () => void;
  await page.route("**/api/order-transcription", async route => {
    await new Promise<void>(resolve => { finish = resolve; });
    await route.fulfill({ json: { text: "one cancelled soap" } }).catch(() => {});
  });
  await openVoice(page);
  await page.getByLabel("Allow order audio transcription", { exact: false }).check();
  await page.getByRole("button", { name: "Start order recording", exact: true }).click();
  await page.getByRole("button", { name: "Finish recording", exact: true }).click();
  await expect(page.getByText(/Transcribing your order/)).toBeVisible();
  await expect(page.getByText("Order microphone: off.", { exact: true })).toBeVisible();
  await expect.poll(() => typeof finish).toBe("function");
  await page.getByRole("button", { name: "Cancel recording", exact: true }).click(); finish();
  await expect(page.getByText("Recording cancelled. Nothing from this recording was saved.", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Order transcript", { exact: true })).toHaveValue("");
  await expect(page.getByLabel("Order transcript", { exact: true })).toBeEditable();
  await expect(page.getByRole("heading", { name: "Review your order", exact: true })).toHaveCount(0);
});

test("legacy saved orders load without new optional fields", async ({ page }) => {
  await page.addInitScript(() => sessionStorage.setItem("ordercheck.v1", JSON.stringify([{ id: "legacy", label: "Legacy order", source: "manual", items: [{ id: "legacy-item", name: "Legacy soap", brand: "", variant: "", size: "", quantity: 2, verified: 0 }] }])));
  await page.goto("/");
  await expand(page, "Privacy & stored orders");
  await page.locator("#order-heading").focus();
  await expect(page.getByRole("heading", { name: "Legacy order", level: 3 })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Legacy soap", level: 3 })).toBeVisible();
  await expect(page.locator(".saved-order").getByText("Quantity: 2.", { exact: true })).toBeVisible();
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

for (const denied of [false, true]) {
  test(`spoken Confirm confirms uncertain values, saves and requests camera; denied=${denied}`, async ({ page }) => {
    await mockSpeech(page);
    await mockRecording(page, "one Head and shoulders anti-denture");
    await page.addInitScript(({ denied }) => {
      const host = window as unknown as { __cameraRequests: MediaStreamConstraints[]; __releaseCamera: () => void };
      host.__cameraRequests = [];
      const microphone = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
      Object.defineProperty(navigator.mediaDevices, "getUserMedia", { configurable: true, value: async (constraints: MediaStreamConstraints) => {
        if (!constraints.video) return microphone(constraints);
        host.__cameraRequests.push(constraints);
        await new Promise<void>(resolve => { host.__releaseCamera = resolve; });
        if (denied) throw new DOMException("denied", "NotAllowedError");
        const canvas = document.createElement("canvas"); canvas.width = 320; canvas.height = 240;
        canvas.getContext("2d")!.fillRect(0, 0, 320, 240);
        return canvas.captureStream(10);
      } });
    }, { denied });
    await openVoice(page);
    await page.getByLabel("Keep orders in this browser tab for this session").check();
    await page.getByLabel("Allow order audio transcription", { exact: false }).check();
    await page.getByRole("button", { name: "Start order recording", exact: true }).click();
    await page.getByRole("button", { name: "Finish recording", exact: true }).click();
    await expect(page.getByText("Order microphone: listening.", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Confirm and save voice order", exact: true })).toBeDisabled();
    await emit(page, "confirm");
    await expect(page.getByRole("heading", { name: "Check your delivery", exact: true })).toBeVisible();
    await expect.poll(() => page.evaluate(() => (window as unknown as { __cameraRequests: unknown[] }).__cameraRequests.length)).toBe(1);
    const before = await page.evaluate(() => ({ speeches: (window as unknown as { __spoken: string[] }).__spoken, saved: JSON.parse(sessionStorage.getItem("ordercheck.v2")!) }));
    expect(before.saved.orders[0].items[0]).toMatchObject({ name: "Head and shoulders anti-denture", quantity: 1 });
    expect(before.speeches).toContain("Order confirmed and saved. Opening the delivery scanner. Your browser may ask for camera permission.");
    expect(before.speeches).not.toContain("Scanner ready. Present the first product.");
    expect(await page.evaluate(() => (window as unknown as { __cameraRequests: unknown[] }).__cameraRequests[0])).toEqual({ video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false });
    // Simulate a mobile permission dialog taking focus/visibility, then Allow.
    await page.evaluate(() => {
      window.dispatchEvent(new Event("blur"));
      Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" });
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await page.getByText("More options", { exact: true }).click();
    await expand(page, "Voice & session controls");
    await expect(page.getByRole("region", { name: "Session controls" })).toContainText("requesting permission");
    await page.evaluate(() => {
      Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
      document.dispatchEvent(new Event("visibilitychange")); window.dispatchEvent(new Event("focus"));
      (window as unknown as { __releaseCamera: () => void }).__releaseCamera();
    });
    if (denied) {
      await expect(page.getByRole("status")).toContainText("Camera permission was not granted.");
      await expect(page.getByRole("button", { name: "Start camera", exact: true })).toBeEnabled();
    } else {
      await expect(page.getByRole("button", { name: "Stop camera", exact: true })).toBeEnabled();
      await expect.poll(() => page.evaluate(() => (window as unknown as { __spoken: string[] }).__spoken.includes("Scanner ready. Present the first product."))).toBe(true);
      await expect(page.locator("#camera-guidance")).not.toBeEmpty();
      await expect(page.locator(".label-guide")).toBeVisible();
      await page.evaluate(() => {
        Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" });
        document.dispatchEvent(new Event("visibilitychange"));
        Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
      });
    }
    expect(await page.evaluate(() => (window as unknown as { __cameraRequests: unknown[] }).__cameraRequests.length)).toBe(1);
    const fallback = page.getByRole("button", { name: "Start camera", exact: true });
    await fallback.scrollIntoViewIfNeeded(); await expect(fallback).toBeInViewport();
    await expect(page.getByLabel("Enter a barcode")).toBeEnabled();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  });
}
test("spoken Confirm speaks the missing product quantity and leaves correction available without saving", async ({ page }) => {
  await mockSpeech(page); await openVoice(page);
  await page.getByLabel("Allow order audio transcription", { exact: false }).check();
  await review(page, "two soaps; Head and shoulders anti-denture");
  await page.getByRole("button", { name: "Speak response", exact: true }).click(); await emit(page, "confirm");
  await expect.poll(() => page.evaluate(() => (window as unknown as { __spoken: string[] }).__spoken.includes("I still need the quantity for product 2 before I can save this order."))).toBe(true);
  await expect(page.locator(".saved-order")).toHaveCount(0);
  await page.getByRole("button", { name: "Change", exact: true }).click();
  await expect(page.getByLabel("Correct value", { exact: true })).toBeEditable();
});

test("voice readback finishes before one automatic response window; timeout preserves draft and fallback", async ({ page }) => {
  await mockSpeech(page); await mockRecording(page, "one soap");
  await page.clock.install();
  await openVoice(page);
  await page.getByLabel("Allow order audio transcription", { exact: false }).check();
  await page.evaluate(() => { (window as unknown as { __holdReadback: boolean }).__holdReadback = true; });
  await page.getByRole("button", { name: "Start order recording", exact: true }).click();
  await page.getByRole("button", { name: "Finish recording", exact: true }).click();
  await expect.poll(() => page.evaluate(() => typeof (window as unknown as { __finishReadback?: unknown }).__finishReadback)).toBe("function");
  await expect(page.getByText("Order microphone: off.", { exact: true })).toBeVisible();
  expect(await page.evaluate(() => (window as unknown as { __responseStarts: number }).__responseStarts)).toBe(0);
  await page.clock.runFor(250);
  expect(await page.evaluate(() => (window as unknown as { __responseStarts: number }).__responseStarts)).toBe(0);
  await page.evaluate(() => (window as unknown as { __finishReadback: () => void }).__finishReadback());
  await expect(page.getByText("Order microphone: listening.", { exact: true })).toBeVisible();
  await expect(page.locator("#voice-order-save-reason")).toHaveText("Listening for your response. Say Confirm, Change, or Start again.");
  const result = await page.evaluate(() => ({ starts: (window as unknown as { __responseStarts: number }).__responseStarts, readback: (window as unknown as { __spokenEnded: string[] }).__spokenEnded }));
  expect(result.starts).toBe(1);
  expect(result.readback.some(text => text.includes("Say Confirm to save this order, Change to correct it, or Start again."))).toBe(true);
  await page.clock.fastForward(15001);
  await expect(page.getByText("No response heard. Use Speak response or the buttons to continue.", { exact: true })).toBeVisible();
  await expect(page.getByText("Order microphone: off.", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Product 1", exact: true })).toBeVisible();
  await expect(page.locator(".saved-order")).toHaveCount(0);
  await page.clock.fastForward(20000);
  expect(await page.evaluate(() => (window as unknown as { __responseStarts: number }).__responseStarts)).toBe(1);
  await page.getByRole("button", { name: "Speak response", exact: true }).click();
  await expect(page.getByText("Order microphone: listening.", { exact: true })).toBeVisible();
});
test("typed review and explicit readback never auto-listen; Speak response remains available", async ({ page }) => {
  await mockSpeech(page); await openVoice(page);
  await page.getByLabel("Allow order audio transcription", { exact: false }).check();
  await review(page, "one soap");
  await page.getByRole("button", { name: "Read back order", exact: true }).click();
  await expect.poll(() => page.evaluate(() => (window as unknown as { __spokenEnded: string[] }).__spokenEnded.some(s => s.includes("I heard:")))).toBe(true);
  expect(await page.evaluate(() => (window as unknown as { __responseStarts: number }).__responseStarts)).toBe(0);
  await expect(page.getByText("Order microphone: off.", { exact: true })).toBeVisible();
  await expand(page, "Technical details");
  const diagnostic = page.getByRole("region", { name: "Voice response diagnostic", exact: true });
  await expect(diagnostic).toContainText("Last voice response heard: no response yet");
  await expect(diagnostic).toContainText("Normalized command: not processed");
  await expect(diagnostic).toContainText("Voice response state: idle");
  await page.getByRole("button", { name: "Speak response", exact: true }).click();
  await expect(page.getByText("Order microphone: listening.", { exact: true })).toBeVisible();
});

for (const [raw, normalized] of [["confirm order", "confirm order"], ["  Confirm order.  ", "confirm order"], ["Confirm order stop recording.", "confirm order"], ["Unrecognized".repeat(40), "unrecognized".repeat(40)]]) {
  test(`short response diagnostic preserves raw browser text and draft: ${raw.slice(0, 40)}`, async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 700 });
    await mockSpeech(page); await mockRecording(page, "two soaps"); await openVoice(page);
    await page.getByLabel("Allow order audio transcription", { exact: false }).check();
    await page.getByRole("button", { name: "Start order recording", exact: true }).click();
    await page.getByRole("button", { name: "Finish recording", exact: true }).click();
    await expand(page, "Technical details");
    const diagnostic = page.getByRole("region", { name: "Voice response diagnostic", exact: true });
    await expect(diagnostic).toContainText("Voice response state: listening");
    await emit(page, raw);
    // textContent checks preserve spaces and punctuation exactly.
    expect(await diagnostic.locator("p").nth(0).textContent()).toBe(`Last voice response heard: "${raw}"`);
    expect(await diagnostic.locator("p").nth(1).textContent()).toBe(`Normalized command: "${normalized}"`);
    await expect(diagnostic).toContainText("Voice response state: received response");
    await expect(page.getByText(/^Command not recognized\./)).toBeVisible();
    await expect(page.getByRole("heading", { name: "Review your order", exact: true })).toBeVisible();
    await expect(page.getByText("soaps", { exact: true })).toBeVisible();
    await expect(page.getByText("2", { exact: true })).toBeVisible();
    await expect(page.locator(".saved-order")).toHaveCount(0);
    const speak = page.getByRole("button", { name: "Speak response", exact: true });
    await expect(speak).toBeEnabled();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect(await page.evaluate(() => (window as unknown as { __micRequests: number }).__micRequests)).toBe(1);
    expect((await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze()).violations).toEqual([]);
    await speak.click();
    await expect(diagnostic).toContainText("Voice response state: listening");
    await page.getByRole("button", { name: "Cancel recording", exact: true }).click();
    await page.getByRole("button", { name: "Edit order transcript", exact: true }).click();
    await review(page, "one coffee");
    await expect(diagnostic).toContainText("Last voice response heard: no response yet");
    await expect(diagnostic).toContainText("Normalized command: not processed");
    await expect(diagnostic).toContainText("Voice response state: idle");
  });
}

for (const outcome of ["no-speech", "not-allowed", "network", "end without speech", "timeout"] as const) {
  test(`short response diagnostic displays ${outcome} and preserves retry`, async ({ page }) => {
    await mockSpeech(page); await mockRecording(page, "one soap");
    if (outcome === "timeout") await page.clock.install();
    await openVoice(page);
    await page.getByLabel("Allow order audio transcription", { exact: false }).check();
    await page.getByRole("button", { name: "Start order recording", exact: true }).click();
    await page.getByRole("button", { name: "Finish recording", exact: true }).click();
    await expand(page, "Technical details");
    const diagnostic = page.getByRole("region", { name: "Voice response diagnostic", exact: true });
    await expect(diagnostic).toContainText("Voice response state: listening");
    if (outcome === "timeout") await page.clock.fastForward(15001);
    else await page.evaluate(outcome => {
      const rec = (window as unknown as { __orderRec: { onerror(e: { error: string }): void; onend(): void } }).__orderRec;
      if (outcome === "end without speech") rec.onend();
      else rec.onerror({ error: outcome });
    }, outcome);
    const noSpeech = ["no-speech", "end without speech", "timeout"].includes(outcome);
    await expect(diagnostic).toContainText(`Voice response state: ${noSpeech ? "no speech" : "recognition error"}`);
    await expect(diagnostic).toContainText(`Last voice response heard: ${noSpeech ? "nothing" : "no response yet"}`);
    await expect(diagnostic).toContainText(`Normalized command: ${noSpeech ? '""' : "not processed"}`);
    if (outcome !== "end without speech" && outcome !== "timeout") await expect(diagnostic).toContainText(`Voice response error: ${outcome}`);
    else await expect(diagnostic).not.toContainText("Voice response error:");
    await expect(page.getByRole("heading", { name: "Review your order", exact: true })).toBeVisible();
    await expect(page.getByText("soap", { exact: true })).toBeVisible();
    await expect(page.locator(".saved-order")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Speak response", exact: true })).toBeEnabled();
    expect(await page.evaluate(() => (window as unknown as { __responseStarts: number }).__responseStarts)).toBe(1);
  });
}
for (const interruption of ["Escape", "revoke consent"] as const) {
  test(`interrupted readback cannot open a late command listener: ${interruption}`, async ({ page }) => {
    await mockSpeech(page); await mockRecording(page, "one soap"); await openVoice(page);
    await page.getByLabel("Allow order audio transcription", { exact: false }).check();
    await page.evaluate(() => { (window as unknown as { __holdReadback: boolean }).__holdReadback = true; });
    await page.getByRole("button", { name: "Start order recording", exact: true }).click();
    await page.getByRole("button", { name: "Finish recording", exact: true }).click();
    await expect.poll(() => page.evaluate(() => typeof (window as unknown as { __finishReadback?: unknown }).__finishReadback)).toBe("function");
    if (interruption === "Escape") await page.keyboard.press("Escape");
    else await page.getByLabel("Allow order audio transcription", { exact: false }).uncheck();
    await page.evaluate(() => (window as unknown as { __finishReadback: () => void }).__finishReadback());
    await expect(page.getByText("Order microphone: off.", { exact: true })).toBeVisible();
    expect(await page.evaluate(() => (window as unknown as { __responseStarts: number }).__responseStarts)).toBe(0);
    await expect(page.getByRole("heading", { name: "Product 1", exact: true })).toBeVisible();
  });
}


test("compact voice review wraps long names and literal platform at phone widths", async ({ page }, testInfo) => {
  await mockSpeech(page);
  await openVoice(page);
  const text = "I ordered two Navier Deep Espresso detergent sprays 150ml each from Dharaj. Then I ordered three Dettol Original Soaps 30g each.";
  await review(page, text);
  for (const width of [320, 375, 390, 430]) {
    await page.setViewportSize({ width, height: 700 });
    await expect(page.locator(".voice-order-platform")).toHaveText("Platform: Dharaj");
    await expect(page.locator(".voice-order-name").first()).toHaveText("Navier Deep Espresso detergent sprays");
    await expect(page.locator(".voice-order-details dd").first()).toHaveText("2");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    for (const card of await page.locator(".voice-order-product").all()) {
      const box = await card.boundingBox();
      expect(box!.x).toBeGreaterThanOrEqual(0);
      expect(box!.x + box!.width).toBeLessThanOrEqual(width);
    }
    expect(await page.locator(".voice-order-details dd").first().evaluate(el => getComputedStyle(el).marginLeft)).toBe("0px");
    if (width === 320) await page.screenshot({ path: testInfo.outputPath("compact-review-320.png"), fullPage: true });
    const save = page.getByRole("button", { name: "Confirm and save voice order", exact: true });
    await save.scrollIntoViewIfNeeded();
    await expect(save).toBeInViewport();
  }
  await page.getByLabel("Allow order audio transcription", { exact: false }).check();
  await page.getByRole("button", { name: "Speak response", exact: true }).click();
  await expect(page.locator("#voice-order-save-reason")).toHaveText("Listening for your response. Say Confirm, Change, or Start again.");
  await expect(page.getByRole("button", { name: "Confirm and save voice order", exact: true })).toBeDisabled();
  await expect(page.getByText("Finish or cancel recording before saving.", { exact: true })).toHaveCount(0);
});
