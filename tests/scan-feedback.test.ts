import { describe, expect, it } from "vitest";
import { scanFeedback } from "../src/lib/scan-feedback";
import type { CheckState, Verdict } from "../src/lib/engine";
const verdict: Verdict = { status: "MATCH", reason: "DEMO_CATALOG_IDENTITY", message: "Internal catalog message", orderId: "order", itemId: "item", fields: [{ field: "name", observed: "Body Lotion", source: "demonstration catalog v1 / capture-uuid" }] };
const state = (quantity: number, verified: number): CheckState => ({ orders: [{ id: "order", label: "Order", items: [{ id: "item", name: "Body Lotion", brand: "LOVE JOJO", variant: "Vitamin C Whitening", size: "500 ml", quantity, verified }] }], attempts: [] });
describe("human scan feedback", () => {
  it.each([[2, 1, "1 of 2 received.", "1 more is still expected."], [2, 2, "2 of 2 received.", "This product is complete."], [1, 1, "1 of 1 received.", "This product is complete."], [3, 1, "1 of 3 received.", "2 more are still expected."]])("uses recorded quantities %i/%i", (quantity, verified, received, remaining) => {
    const feedback = scanFeedback(verdict, state(quantity, verified));
    expect(feedback.lines).toContain(received);
    expect(feedback.lines).toContain(remaining);
    expect(feedback.spoken).toContain(received);
    expect(feedback.spoken).toContain(remaining);
    expect(feedback.product).toBe("LOVE JOJO Body Lotion");
    expect(feedback.description).toBe("Vitamin C Whitening · 500 ml");
    expect(feedback.spoken).toContain("500 millilitres");
    expect(feedback.spoken).toContain("say Finish");
    expect(feedback.lines.join(" ")).toContain("“Finish”");
    expect(JSON.stringify(feedback)).not.toMatch(/DEMO_CATALOG|capture-uuid|catalog v1|Internal catalog|missing/i);
  });
  it.each(["MISMATCH", "INCOMPLETE", "CONFLICT"] as const)("explains %s without internal reasons", status => {
    const feedback = scanFeedback({ ...verdict, status }, state(2, 0));
    expect(feedback.spoken).toContain("Nothing was counted.");
    expect(feedback.spoken).not.toContain(verdict.reason!);
  });
  it("uses another order product without hardcoding the benchmark", () => {
    const data = state(1, 1); Object.assign(data.orders[0].items[0], { brand: "Everyday", name: "Oat drink", variant: "Original", size: "1 L" });
    expect(scanFeedback({ ...verdict, fields: [] }, data).spoken).toContain("Everyday Oat drink, Original, 1 litre");
  });

  it("speaks ordered and received variants separately on a mismatch", () => {
    const data = state(1, 0);
    data.orders[0].items[0].variant = "Aloe Vera";
    const mismatch: Verdict = {
      status: "MISMATCH",
      reason: "DIFFERENT_PRODUCT",
      message: "Internal mismatch",
      orderId: "order",
      itemId: "item",
      fields: [
        { field: "brand", observed: "LOVE JOJO", source: "product database / capture" },
        { field: "name", observed: "Body Lotion", source: "product database / capture" },
        { field: "variant", observed: "Vitamin C Whitening", source: "product database / capture" },
        { field: "size", observed: "500 ml", source: "product database / capture" },
      ],
    };
    const feedback = scanFeedback(mismatch, data);
    expect(feedback.lines).toContain(
      "Ordered: LOVE JOJO Body Lotion, Aloe Vera, 500 ml.",
    );
    expect(feedback.lines).toContain(
      "Received: LOVE JOJO Body Lotion, Vitamin C Whitening, 500 ml.",
    );
    expect(feedback.spoken).toContain(
      "You ordered LOVE JOJO Body Lotion, Aloe Vera, 500 millilitres.",
    );
    expect(feedback.spoken).toContain(
      "You received LOVE JOJO Body Lotion, Vitamin C Whitening, 500 millilitres.",
    );
    expect(feedback.spoken).toContain("Nothing was counted.");
  });

  it("speaks the exact received variant and size on a successful match", () => {
    const match: Verdict = {
      ...verdict,
      fields: [
        { field: "brand", observed: "LOVE JOJO", source: "product database / capture" },
        { field: "name", observed: "Body Lotion", source: "product database / capture" },
        { field: "variant", observed: "Vitamin C Whitening", source: "product database / capture" },
        { field: "size", observed: "500 ml", source: "product database / capture" },
      ],
    };
    const feedback = scanFeedback(match, state(1, 1));
    expect(feedback.spoken).toContain(
      "You received LOVE JOJO Body Lotion, Vitamin C Whitening, 500 millilitres.",
    );
    expect(feedback.spoken).toContain("They match.");
  });

});
