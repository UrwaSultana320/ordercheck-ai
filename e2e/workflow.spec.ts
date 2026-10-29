import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
test("import, review, scan, pause, undo and privacy recovery", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Voice guidance on" }).click();
  await page
    .getByRole("button", { name: "Import an order", exact: true })
    .click();
  await page
    .getByLabel("Confirmation text")
    .fill("Oat drink | Everyday | Original | 1 L | 2");
  await page.getByRole("button", { name: "Extract products" }).click();
  await page.getByRole("button", { name: "Confirm and save order" }).click();
  await expect(page.getByText("0 / 2 verified")).toBeVisible();
  await page
    .getByRole("button", { name: "Scan delivery", exact: true })
    .click();
  await page.getByLabel("Enter a barcode").fill("DEMO-OAT-ORIGINAL-1L");
  await page
    .getByRole("button", { name: "Check barcode", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "MATCH", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Check barcode", exact: true }),
  ).toBeDisabled();
  await page.getByRole("button", { name: "Next item", exact: true }).click();
  await page
    .getByRole("button", { name: "Check barcode", exact: true })
    .click();
  await expect(
    page.getByText("2 of 2 items verified", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Undo last verification" }).click();
  await expect(
    page.getByText("1 of 2 items verified", { exact: true }),
  ).toBeVisible();
  await page
    .getByLabel("Keep orders in this browser tab for this session")
    .check();
  await page.reload();
  await page.getByRole("button", { name: "My orders" }).click();
  await expect(page.getByText("1 / 2 verified")).toBeVisible();
  await page.getByRole("button", { name: "Clear orders", exact: true }).click();
  await page.reload();
  await page.getByRole("button", { name: "My orders" }).click();
  await expect(
    page.getByRole("heading", { name: "No orders yet" }),
  ).toBeVisible();
});
test("overview and application views meet automated WCAG checks", async ({
  page,
}) => {
  await page.goto("/");
  for (const nav of [
    "Overview",
    "My orders",
    "Scan a delivery",
    "Help & guidance",
  ]) {
    await page.getByRole("button", { name: nav, exact: true }).click();
    const result = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
      .analyze();
    expect(result.violations).toEqual([]);
  }
});
