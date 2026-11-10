import type { Page } from "@playwright/test";

export async function expand(page: Page, name: string) {
  const summary = page
    .locator("summary")
    .filter({ hasText: new RegExp(`^${name}$`) });
  if ((await summary.locator("..").getAttribute("open")) === null)
    await summary.click();
}
