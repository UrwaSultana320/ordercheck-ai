import { describe, expect, it } from "vitest";
import catalog from "../src/data/catalog.v1.json";
import { applyMatch, isKnownBarcode, verify, type Order } from "../src/lib/engine";

const order: Order = { id: "benchmark", label: "Physical benchmark", source: "manual", items: [{
  id: "lotion", name: "Body Lotion", brand: "LOVE JOJO", variant: "Vitamin C Whitening",
  size: "500 ml", quantity: 1, verified: 0,
}] };
const text = "LOVE JOJO\nBODY LOTION\nVITAMIN C\nVITAMIN C WHITENING\nMOISTURIZING AFTER BATHING\nNet: 500ml\n";

describe("controlled physical benchmark", () => {
  it("resolves the supplied barcode to exactly the supplied product fields", () => {
    expect(isKnownBarcode("4897099081562")).toBe(true);
    expect(catalog.products.find(p => p.barcodes.includes("4897099081562"))).toEqual({
      id: "love-jojo-body-lotion-vitamin-c-500ml", name: "Body Lotion", brand: "LOVE JOJO",
      variant: "Vitamin C Whitening", size: "500 ml", barcodes: ["4897099081562"],
    });
  });
  it("verifies and counts the known barcode through the normal path without OCR", () => {
    const verdict = verify([order], { barcode: "4897099081562", source: "barcode" });
    expect(verdict).toMatchObject({ status: "MATCH", identity: "love-jojo-body-lotion-vitamin-c-500ml" });
    expect(applyMatch([order], verdict)[0].items[0].verified).toBe(1);
  });
  it("retains the current OCR confidence and complete-field requirements", () => {
    expect(verify([order], { text, confidence: 85 }).status).toBe("MATCH");
    expect(verify([order], { text, confidence: 84 }).status).toBe("INCOMPLETE");
    expect(verify([order], { text: "LOVE JOJO BODY LOTION VITAMIN C 500ml", confidence: 99 }).status).toBe("INCOMPLETE");
  });
  it("never matches or counts empty label evidence", () => {
    for (const confidence of [0, 99]) {
      const verdict = verify([order], { text: " \n", confidence });
      expect(verdict.status).toBe("INCOMPLETE");
      expect(applyMatch([order], verdict)[0].items[0].verified).toBe(0);
    }
  });
});
