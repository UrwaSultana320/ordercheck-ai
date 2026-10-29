import { describe, it, expect } from "vitest";
import {
  applyMatch,
  extractOrder,
  orderSchema,
  verify,
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
  it("does not use substring variant matches", () => {
    const o = order();
    o.items[0].variant = "sweet";
    expect(
      verify([o], { text: "Everyday Oat drink unsweetened 1L", confidence: 99 })
        .status,
    ).toBe("INCOMPLETE");
  });
  it("requires review of unstructured extraction", () => {
    const [i] = extractOrder("Mystery item");
    expect(i.brand).toBe("");
    expect(i.variant).toBe("");
    expect(i.quantity).toBe(1);
  });
  it("extracts explicit fields and quantity", () =>
    expect(
      extractOrder("Oat drink | Everyday | Original | 1 L | 2")[0],
    ).toMatchObject({ brand: "Everyday", quantity: 2, size: "1 L" }));
  it("validates counts and empty names", () => {
    const o = order();
    o.items[0].verified = 3;
    expect(orderSchema.safeParse(o).success).toBe(false);
    o.items[0].verified = 0;
    o.items[0].name = "";
    expect(orderSchema.safeParse(o).success).toBe(false);
  });
});
