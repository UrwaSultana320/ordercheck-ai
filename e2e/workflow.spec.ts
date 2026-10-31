import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
async function openMenu(page: Page) {
  const menu = page.getByRole("button", { name: "Menu", exact: true });
  if (
    (await menu.isVisible()) &&
    (await menu.getAttribute("aria-expanded")) === "false"
  )
    await menu.click();
}
async function navigate(page: Page, name: string) {
  await openMenu(page);
  await page
    .getByRole("navigation")
    .getByRole("button", { name, exact: true })
    .click();
}
async function addOrder(
  page: Page,
  products = "Oat drink | Everyday | Original | 1 L | 2",
  label = "My delivery",
) {
  await navigate(page, "My orders");
  if (await page.getByText("Other ways to add an order", { exact: true }).locator("..").getAttribute("open") === null)
    await page.getByText("Other ways to add an order", { exact: true }).click();
  await page
    .getByRole("button", { name: "Import an order", exact: true })
    .click();
  await page.getByLabel("Order name", { exact: true }).fill(label);
  await page.getByLabel("Confirmation text").fill(products);
  await page
    .getByRole("button", { name: "Extract products", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Confirm and save order", exact: true })
    .click();
}
async function scanManually(page: Page, code = "DEMO-OAT-ORIGINAL-1L") {
  await navigate(page, "Scan a delivery");
  await page.getByLabel("Enter a barcode").fill(code);
  await page
    .getByRole("button", { name: "Check barcode", exact: true })
    .click();
}
test("import, duplicate confirmation, retry, Undo and optional session storage", async ({
  page,
}, testInfo) => {
  await page.goto("/");
  await expect(
    page.getByRole("button", {
      name: "Start checking my delivery",
      exact: true,
    }),
  ).toBeEnabled();
  await page.screenshot({
    path: testInfo.outputPath("overview.png"),
    fullPage: false,
  });
  await addOrder(page);
  await expect(page.getByText("0 / 2 matching", { exact: true })).toBeVisible();
  await scanManually(page);
  await expect(
    page.getByRole("heading", { name: "match", exact: true }),
  ).toBeVisible();
  await expect(page.getByText(/1 of 2 expected units checked/)).toBeVisible();
  await page
    .getByRole("button", { name: "Check barcode", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Is this another physical unit?" }),
  ).toBeVisible();
  await expect(page.getByText(/1 of 2 expected units checked/)).toBeVisible();
  await page
    .getByRole("button", { name: "No, retry this unit", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Check barcode", exact: true })
    .click();
  await expect(page.getByText(/1 of 2 expected units checked/)).toBeVisible();
  await page.getByRole("button", { name: "Next item", exact: true }).click();
  await page
    .getByRole("button", { name: "Check barcode", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Yes, another unit", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Checking complete", exact: true }),
  ).toBeVisible();
  await expect(page.getByText(/2 of 2 expected units checked/)).toBeVisible();
  await page
    .getByRole("button", { name: "Undo last checking event", exact: true })
    .click();
  await expect(page.getByText(/1 of 2 expected units checked/)).toBeVisible();
  await page
    .getByLabel("Keep orders in this browser tab for this session")
    .check();
  await page.reload();
  await navigate(page, "My orders");
  await expect(page.getByText("1 / 2 matching", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Clear orders", exact: true }).click();
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "No orders yet", exact: true }),
  ).toBeVisible();
});
test("no automatic speech, no-order start, denied camera and unsupported voice preserve fallback controls", async ({
  page,
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, "SpeechRecognition", {
      value: undefined,
      configurable: true,
    });
    Object.defineProperty(window, "webkitSpeechRecognition", {
      value: undefined,
      configurable: true,
    });
    Object.defineProperty(navigator.mediaDevices, "getUserMedia", {
      value: () =>
        Promise.reject(
          new DOMException("Camera permission denied", "NotAllowedError"),
        ),
    });
    Object.defineProperty(window.speechSynthesis, "speak", {
      value: () => {
        throw new Error("Unrequested speech");
      },
    });
  });
  await page.goto("/");
  await page
    .getByRole("button", { name: "Start checking my delivery", exact: true })
    .click();
  await expect(page.getByRole("status")).toContainText("No purchase reference");
  await addOrder(page);
  await page.getByRole("button", { name: "Start", exact: true }).click();
  await expect(page.getByRole("status")).toContainText(
    "Camera permission denied",
  );
  await page.getByLabel("Enter a barcode").fill("DEMO-OAT-ORIGINAL-1L");
  await page
    .getByRole("button", { name: "Check barcode", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "match", exact: true }),
  ).toBeVisible();
  await page
    .getByLabel("I understand voice commands", { exact: false })
    .check();
  await page
    .getByRole("button", { name: "Start listening", exact: true })
    .click();
  await expect(page.getByRole("status")).toContainText("unavailable");
  await page.getByRole("button", { name: "Stop", exact: true }).click();
  await expect(page.getByRole("status")).toContainText(
    "Confirmed results are preserved",
  );
});
test("packing-slip provenance and unknown quantity never become a verified delivery", async ({
  page,
}) => {
  await page.goto("/");
  await navigate(page, "My orders");
  await page.getByText("Other ways to add an order", { exact: true }).click();
  await page.getByRole("button", { name: "Import an order", exact: true }).click();
  await page.getByLabel("Reference source").selectOption("packing-slip");
  await page
    .getByLabel("Confirmation text")
    .fill("Oat drink | Everyday | Original | 1 L | 2");
  await page
    .getByRole("button", { name: "Extract products", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Confirm and save order", exact: true })
    .click();
  await scanManually(page);
  await expect(
    page.getByRole("heading", { name: "unable_to_verify", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Reason: DEPENDENT_REFERENCE", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText(/0 matching · 0 mismatching · 1 unable to verify/),
  ).toBeVisible();
});
test("preferences persist without storing receipts; views reflow and meet automated axe checks", async ({
  page,
}) => {
  await page.goto("/");
  await navigate(page, "Accessibility settings");
  await expect(page.getByLabel("Screen-reader mode (default)")).toBeChecked();
  await page
    .getByLabel("Text size", { exact: true })
    .selectOption("extra-large");
  await page.getByLabel("High contrast", { exact: true }).check();
  await page.reload();
  await page.setViewportSize({ width: 320, height: 900 });
  await page.addStyleTag({
    content:
      "* { letter-spacing: .12em !important; word-spacing: .16em !important; line-height: 1.5 !important; } p { margin-bottom: 2em !important; }",
  });
  for (const nav of [
    "Overview",
    "My orders",
    "Scan a delivery",
    "Help & guidance",
    "Accessibility settings",
  ]) {
    await navigate(page, nav);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth + 1,
      ),
    ).toBe(true);
    const result = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
      .analyze();
    expect(result.violations).toEqual([]);
  }
  await expect(page.getByLabel("Text size", { exact: true })).toHaveValue(
    "extra-large",
  );
  await expect(page.getByLabel("High contrast", { exact: true })).toBeChecked();
  expect(
    await page.evaluate(() => sessionStorage.getItem("ordercheck.v2")),
  ).toBeNull();
});
test("keyboard skip link, navigation focus and nonvoice completion", async ({
  page,
}) => {
  await page.goto("/");
  await page.keyboard.press("Tab");
  await expect(
    page.getByRole("link", { name: "Skip to content" }),
  ).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.locator("#main")).toBeFocused();
  await addOrder(page, "Oat drink | Everyday | Original | 1 L | 1");
  await openMenu(page);
  const scan = page
    .getByRole("navigation")
    .getByRole("button", { name: "Scan a delivery", exact: true });
  await scan.focus();
  await page.keyboard.press("Enter");
  await expect(
    page.getByRole("heading", { name: "Check your delivery", exact: true }),
  ).toBeFocused();
  await page.getByLabel("Enter a barcode").focus();
  await page.keyboard.type("DEMO-OAT-ORIGINAL-1L");
  await page.keyboard.press("Tab");
  await expect(
    page.getByRole("button", { name: "Check barcode", exact: true }),
  ).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(
    page.getByRole("heading", { name: "Checking complete", exact: true }),
  ).toBeVisible();
});
test("ambiguous orders require explicit selection and unrelated scans stay unassigned", async ({
  page,
}) => {
  await page.goto("/");
  await addOrder(page, "Oat drink | Everyday | Original | 1 L | 1", "First");
  await addOrder(page, "Oat drink | Everyday | Original | 1 L | 1", "Second");
  await scanManually(page);
  await expect(
    page.getByText("Reason: AMBIGUOUS_ORDER", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Second: Oat drink", exact: true })
    .click();
  await expect(page.getByText(/1 of 2 expected units checked/)).toBeVisible();
  await page.getByLabel("Enter a barcode").fill("unknown");
  await page
    .getByRole("button", { name: "Check barcode", exact: true })
    .click();
  await expect(page.getByText(/1 scans are unassigned/)).toBeVisible();
});

test("default colors pass axe; 200 percent text and narrow layout preserve reflow", async ({
  page,
}) => {
  await page.goto("/");
  for (const name of [
    "Overview",
    "My orders",
    "Scan a delivery",
    "Help & guidance",
    "Accessibility settings",
  ]) {
    await navigate(page, name);
    expect(
      (
        await new AxeBuilder({ page })
          .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
          .analyze()
      ).violations,
    ).toEqual([]);
  }
  await page.setViewportSize({ width: 320, height: 900 });
  await page.addStyleTag({ content: "html { font-size:200%; }" });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth + 1,
    ),
  ).toBe(true);
});

test("mocked voice commands drive navigation; app speech pauses and Stop speaking restores intended listening", async ({
  page,
}) => {
  await page.addInitScript(() => {
    type FakeWindow = Window & {
      __voice?: { emit(text: string): void };
      __speeches?: SpeechSynthesisUtterance[];
    };
    const host = window as FakeWindow;
    host.__speeches = [];
    class MockRecognition {
      lang = "";
      continuous = false;
      interimResults = false;
      onstart: (() => void) | null = null;
      onend: (() => void) | null = null;
      onerror: ((event: { error: string }) => void) | null = null;
      onresult:
        | ((event: {
            resultIndex: number;
            results: { isFinal: boolean; 0: { transcript: string } }[];
          }) => void)
        | null = null;
      constructor() {
        host.__voice = this;
      }
      start() {
        this.onstart?.();
      }
      abort() {
        this.onend?.();
      }
      emit(text: string) {
        this.onresult?.({
          resultIndex: 0,
          results: [{ isFinal: true, 0: { transcript: text } }],
        });
      }
    }
    Object.defineProperty(window, "SpeechRecognition", {
      value: MockRecognition,
      configurable: true,
    });
    Object.defineProperty(window.speechSynthesis, "speak", {
      value: (utterance: SpeechSynthesisUtterance) => {
        host.__speeches!.push(utterance);
        utterance.onstart?.(new Event("start") as SpeechSynthesisEvent);
      },
    });
    Object.defineProperty(window.speechSynthesis, "cancel", {
      value: () => {},
    });
  });
  await page.goto("/");
  await page
    .getByLabel("I understand voice commands", { exact: false })
    .check();
  await page
    .getByRole("button", { name: "Start listening", exact: true })
    .click();
  await expect(
    page.getByRole("region", { name: "Session controls" }),
  ).toContainText("Microphone: listening");
  await page.evaluate(() =>
    (
      window as unknown as Window & { __voice: { emit(text: string): void } }
    ).__voice.emit("Help"),
  );
  await expect(
    page.getByRole("heading", { name: "Help & guidance", exact: true }),
  ).toBeVisible();
  await navigate(page, "Accessibility settings");
  await page.getByLabel("App spoken guidance", { exact: true }).check();
  await page
    .getByRole("button", { name: "Start listening", exact: true })
    .click();
  await page.getByRole("button", { name: "Repeat", exact: true }).click();
  await expect(
    page.getByRole("region", { name: "Session controls" }),
  ).toContainText("App speech: speaking");
  await expect(
    page.getByRole("region", { name: "Session controls" }),
  ).toContainText("Microphone: not listening");
  await page
    .getByRole("button", { name: "Stop speaking", exact: true })
    .click();
  await expect(
    page.getByRole("region", { name: "Session controls" }),
  ).toContainText("Microphone: listening");
  await page.keyboard.press("Escape");
  await expect(
    page.getByRole("region", { name: "Session controls" }),
  ).toContainText("Microphone: not listening");
});

test("Stop cancels a pending mocked camera permission and releases a late stream", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const host = window as unknown as Window & {
      __resolveCamera?: () => void;
      __trackStopped?: boolean;
    };
    Object.defineProperty(navigator.mediaDevices, "getUserMedia", {
      value: () =>
        new Promise((resolve) => {
          host.__resolveCamera = () =>
            resolve({
              getTracks: () => [
                {
                  stop: () => {
                    host.__trackStopped = true;
                  },
                },
              ],
            });
        }),
    });
  });
  await page.goto("/");
  await addOrder(page);
  await page.getByRole("button", { name: "Start", exact: true }).click();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          typeof (window as unknown as Window & { __resolveCamera?: unknown })
            .__resolveCamera,
      ),
    )
    .toBe("function");
  await page.getByRole("button", { name: "Stop", exact: true }).click();
  await page.evaluate(() =>
    (
      window as unknown as Window & { __resolveCamera: () => void }
    ).__resolveCamera(),
  );
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as unknown as Window & { __trackStopped?: boolean })
            .__trackStopped,
      ),
    )
    .toBe(true);
  await expect(
    page.getByRole("region", { name: "Session controls" }),
  ).toContainText("Camera: off");
});
