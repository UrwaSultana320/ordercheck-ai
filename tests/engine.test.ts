import { describe, it, expect } from "vitest";
import {
  applyMatch,
  deliveryReport,
  extractOrder,
  orderSchema,
  progress,
  recordAttempt,
  verify,
  type CheckState,
  type Order,
} from "../src/lib/engine";
const order = (): Order => ({
  id: "a",
  label: "Groceries",
  items: [
    {
      id: "1",
      name: "Oat drink",
      brand: "Everyday",
      variant: "Original",
      size: "1 L",
      quantity: 2,
      verified: 0,
    },
  ],
});
describe("evidence-aware verification", () => {
  it("matches a catalog code without manual line selection and counts exactly one unit", () => {
    const orders = [order()];
    const r = verify(orders, { barcode: "DEMO-OAT-ORIGINAL-1L" });
    expect(r.status).toBe("MATCH");
    expect(applyMatch(orders, r)[0].items[0].verified).toBe(1);
    expect(orders[0].items[0].verified).toBe(0);
  });
  it("rejects unknown barcodes", () =>
    expect(verify([order()], { barcode: "12345678" }).status).toBe(
      "INCOMPLETE",
    ));
  it("rejects a known incorrect variant", () =>
    expect(
      verify([order()], { barcode: "DEMO-OAT-UNSWEETENED-1L" }).status,
    ).toBe("MISMATCH"));
  it("requires high confidence OCR", () =>
    expect(
      verify([order()], {
        text: "Everyday Oat drink Original 1 L",
        confidence: 70,
      }).status,
    ).toBe("INCOMPLETE"));
  it("requires every explicit OCR field", () =>
    expect(
      verify([order()], { text: "Everyday Oat drink Original", confidence: 99 })
        .status,
    ).toBe("INCOMPLETE"));
  it("matches normalized size OCR", () =>
    expect(
      verify([order()], {
        text: "Everyday Oat drink Original 1L",
        confidence: 95,
      }).status,
    ).toBe("MATCH"));
  it("does not count conflicting evidence", () =>
    expect(
      verify([order()], {
        barcode: "DEMO-OAT-ORIGINAL-1L",
        text: "Everyday Oat drink Unsweetened 1 L",
        confidence: 99,
      }).status,
    ).toBe("CONFLICT"));
  it("detects ambiguity across orders", () =>
    expect(
      verify([order(), { ...order(), id: "b" }], {
        barcode: "DEMO-OAT-ORIGINAL-1L",
      }).status,
    ).toBe("CONFLICT"));
  it("does not overcount", () => {
    const o = order();
    o.items[0].verified = 2;
    expect(verify([o], { barcode: "DEMO-OAT-ORIGINAL-1L" }).status).toBe(
      "MISMATCH",
    );
  });
  it("ignores complete lines when finding the remaining order", () => {
    const o = order();
    o.items[0].verified = 2;
    expect(
      verify([o, { ...order(), id: "b" }], { barcode: "DEMO-OAT-ORIGINAL-1L" })
        .orderId,
    ).toBe("b");
  });
  it("does not confuse substring variants; a fully identified contrary variant mismatches", () => {
    const o = order();
    o.items[0].variant = "sweet";
    expect(
      verify([o], { text: "Everyday Oat drink unsweetened 1L", confidence: 99 })
        .status,
    ).toBe("MISMATCH");
  });
  it("requires review of unstructured extraction", () => {
    const [i] = extractOrder("Mystery item");
    expect(i.brand).toBe("");
    expect(i.variant).toBe("");
    expect(i.quantity).toBeNull();
  });
  it("extracts explicit fields and quantity", () =>
    expect(
      extractOrder("Oat drink | Everyday | Original | 1 L | 2")[0],
    ).toMatchObject({ brand: "Everyday", quantity: 2, size: "1 L" }));
  it("matches a known barcode when natural speech keeps brand and variant inside the product name", () => {
    const voiceOrder: Order = {
      id: "voice",
      label: "Voice order",
      source: "voice",
      items: [{
        id: "love",
        name: "Love Jojo Body Lotion Vitamin C Whitening",
        brand: "",
        variant: "",
        size: "500 ml",
        quantity: 1,
        verified: 0,
      }],
    };
    const result = verify([voiceOrder], { barcode: "4897099081562" });
    expect(result.status).toBe("MATCH");
    expect(result.itemId).toBe("love");
  });

  it("still rejects an explicit wrong variant for a known barcode", () => {
    const voiceOrder: Order = {
      id: "voice",
      label: "Voice order",
      source: "voice",
      items: [{
        id: "love",
        name: "Body Lotion",
        brand: "LOVE JOJO",
        variant: "Aloe Vera",
        size: "500 ml",
        quantity: 1,
        verified: 0,
      }],
    };
    expect(verify([voiceOrder], { barcode: "4897099081562" }).status).toBe("MISMATCH");
  });

  it("still rejects an explicit wrong size for a known barcode", () => {
    const voiceOrder: Order = {
      id: "voice",
      label: "Voice order",
      source: "voice",
      items: [{
        id: "love",
        name: "Body Lotion",
        brand: "LOVE JOJO",
        variant: "Vitamin C Whitening",
        size: "250 ml",
        quantity: 1,
        verified: 0,
      }],
    };
    expect(verify([voiceOrder], { barcode: "4897099081562" }).status).toBe("MISMATCH");
  });


  it("rejects a conflicting variant kept inside the spoken product name", () => {
    const voiceOrder: Order = {
      id: "voice",
      label: "Voice order",
      source: "voice",
      items: [{
        id: "love",
        name: "Love Jojo Body Lotion Aloe Vera",
        brand: "",
        variant: "",
        size: "500 ml",
        quantity: 2,
        verified: 0,
      }],
    };
    const result = verify([voiceOrder], {
      barcode: "4897099081562",
      productLookup: "resolved",
      productSource: "supabase",
      product: {
        id: "love-jojo-body-lotion-vitamin-c-500ml",
        barcode: "4897099081562",
        name: "Body Lotion",
        brand: "LOVE JOJO",
        variant: "Vitamin C Whitening",
        size: "500 ml",
      },
    });
    expect(result.status).toBe("MISMATCH");
    expect(result.reason).toBe("DIFFERENT_PRODUCT");
    expect(result.itemId).toBe("love");
  });

  it("does not let a mismatch consume ordered quantity progress", () => {
    const state: CheckState = { orders: [order()], attempts: [] };
    const next = recordAttempt(state, {
      id: "attempt-1",
      captureId: "capture-1",
      sessionId: "session-1",
      identity: "wrong-product",
      orderId: "a",
      itemId: "1",
      status: "MISMATCH",
      reason: "DIFFERENT_PRODUCT",
      message: "Wrong product",
      confirmedAnotherUnit: false,
      undone: false,
    });
    expect(next.orders[0].items[0].verified).toBe(0);
    expect(progress(next)).toMatchObject({
      total: 2,
      matched: 0,
      checked: 0,
      left: 2,
      mismatch: 1,
    });
  });

  it("final delivery report states the missing quantity after partial scanning", () => {
    const state: CheckState = {
      orders: [{
        ...order(),
        items: [{ ...order().items[0], quantity: 2, verified: 1 }],
      }],
      attempts: [],
    };
    const report = deliveryReport(state);
    expect(report.missingUnits).toBe(1);
    expect(report.lines[0]).toMatchObject({
      ordered: 2,
      scanned: 1,
      missing: 1,
      status: "missing",
    });
  });

  it("final delivery report marks a fully scanned quantity complete", () => {
    const state: CheckState = {
      orders: [{
        ...order(),
        items: [{ ...order().items[0], quantity: 2, verified: 2 }],
      }],
      attempts: [],
    };
    const report = deliveryReport(state);
    expect(report.missingUnits).toBe(0);
    expect(report.lines[0]).toMatchObject({
      ordered: 2,
      scanned: 2,
      missing: 0,
      status: "complete",
    });
  });

  it("validates counts and empty names", () => {
    const o = order();
    o.items[0].verified = 3;
    expect(orderSchema.safeParse(o).success).toBe(false);
    o.items[0].verified = 0;
    o.items[0].name = "";
    expect(orderSchema.safeParse(o).success).toBe(false);
  });
});
