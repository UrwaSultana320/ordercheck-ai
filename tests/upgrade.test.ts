import { describe, it, expect, vi } from "vitest";
import { newId } from "../src/lib/id";
import {
  extractOrder,
  verify,
  sameSize,
  userStatus,
  recordAttempt,
  undoAttempt,
  progress,
  type CheckState,
  type Attempt,
} from "../src/lib/engine";
import {
  commandFrom,
  commandAllowed,
  PresentationGate,
} from "../src/lib/session";
const state = (): CheckState => ({
  orders: [
    {
      id: "order",
      label: "Purchase",
      source: "purchase",
      items: [
        {
          id: "item",
          name: "Oat drink",
          brand: "Everyday",
          variant: "Original",
          size: "1 L",
          quantity: 2,
          verified: 0,
        },
      ],
    },
  ],
  attempts: [],
});
const event = (id: string, overrides: Partial<Attempt> = {}): Attempt => ({
  id,
  captureId: `capture-${id}`,
  sessionId: "session",
  identity: "oat",
  orderId: "order",
  itemId: "item",
  status: "MATCH",
  reason: "COMPLETE_LABEL",
  message: "Label matched",
  confirmedAnotherUnit: false,
  undone: false,
  ...overrides,
});
describe("receipt extraction", () => {
  it("separates receipt metadata from priced products and retains source", () => {
    const items = extractOrder(
      "Merchant: Corner Shop\nOrder #123\nDate: 2026-10-30\nAddress: 1 Test Street\nPhone: 0123456789\nDescription Qty Price\nEveryday Oat drink Original 1 L 2 x 3.00 6.00\nTax 0.20\nDiscount -1.00\nDelivery fee 0.50\nSubtotal 6.00\nTotal 5.70\nCard 5.70\nThank you",
    );
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      quantity: 2,
      size: "1 L",
      source: { line: 7, page: 1, unitPrice: 3, lineTotal: 6 },
    });
    expect(items[0].brand).toBe("");
  });
  it("does not blacklist product names containing tax", () => {
    expect(
      extractOrder("Tax Relief Soap | Good | Original | 250 g | 2"),
    ).toHaveLength(1);
    expect(extractOrder("Tax Relief Soap 250 g 2 x 3.00 6.00")).toHaveLength(1);
  });
  it("keeps unknown quantities unknown and distinguishes decimal sizes from prices", () => {
    const [item] = extractOrder("Water 1.25 L 3.00");
    expect(item.quantity).toBeNull();
    expect(item.size).toBe("1.25 L");
    expect(item.source?.lineTotal).toBe(3);
    expect(item.source?.unitPrice).toBeUndefined();
    expect(item.source?.uncertain).toContain("quantity");
  });
  it("preserves a wrapped description and marks arithmetic uncertainty", () => {
    const [item] = extractOrder(
      "Everyday Oat drink\nOriginal 1 L 2 x 3.00 9.00",
    );
    expect(item.name).toContain("Everyday Oat drink Original");
    expect(item.source?.text).toContain("\n");
    expect(item.source?.line).toBe(1);
    expect(item.source?.uncertain).toContain("price arithmetic");
  });
  it("handles empty, non-text and multipage inputs conservatively", () => {
    expect(extractOrder("")).toEqual([]);
    expect(extractOrder("12345\n???")).toEqual([]);
    expect(
      extractOrder("\f\nTea | Garden | Jasmine | 100 g | 1")[0].source?.page,
    ).toBe(2);
  });
});
describe("comparison and provenance", () => {
  it("reports independently read contrary label fields as mismatch, but never treats missing reference fields as contrary", () => {
    expect(
      verify(state().orders, {
        text: "Everyday Oat drink Unsweetened 1 L",
        confidence: 99,
      }).status,
    ).toBe("MISMATCH");
    const s = state();
    s.orders[0].items[0].brand = "";
    expect(verify(s.orders, { barcode: "DEMO-OAT-ORIGINAL-1L" }).reason).toBe(
      "MISSING_REFERENCE_FIELDS",
    );
  });
  it("supports explicit equivalent units without mixing dimensions", () => {
    expect(sameSize("1 L", "1000 ml")).toBe(true);
    expect(sameSize("250 ml", "250 g")).toBe(false);
    expect(
      verify(state().orders, {
        text: "Everyday Oat drink Original 1000 ml",
        confidence: 99,
      }).status,
    ).toBe("MATCH");
  });
  it("does not equate negated variants or fragrance-free and unscented", () => {
    const s = state();
    s.orders[0].items[0].variant = "scented";
    expect(
      verify(s.orders, {
        text: "Everyday Oat drink not scented 1 L",
        confidence: 99,
      }).status,
    ).toBe("INCOMPLETE");
    s.orders[0].items[0].variant = "unscented";
    expect(
      verify(s.orders, {
        text: "Everyday Oat drink fragrance-free 1 L",
        confidence: 99,
      }).status,
    ).toBe("INCOMPLETE");
  });
  it("blocks dependent references and unknown quantities", () => {
    const s = state();
    s.orders[0].source = "packing-slip";
    expect(verify(s.orders, { barcode: "DEMO-OAT-ORIGINAL-1L" }).reason).toBe(
      "DEPENDENT_REFERENCE",
    );
    s.orders[0].source = "purchase";
    s.orders[0].items[0].quantity = null;
    expect(verify(s.orders, { barcode: "DEMO-OAT-ORIGINAL-1L" }).reason).toBe(
      "UNKNOWN_QUANTITY",
    );
  });
  it("retains conflict reasons, offers explicit association and leaves unknown products unassigned", () => {
    const orders = [...state().orders, { ...state().orders[0], id: "second" }];
    expect(
      verify(orders, { barcode: "DEMO-OAT-ORIGINAL-1L" }).candidates,
    ).toHaveLength(2);
    const conflict = verify(state().orders, {
      barcode: "DEMO-OAT-ORIGINAL-1L",
      text: "Everyday Oat drink Original 250 ml",
      confidence: 99,
    });
    expect(conflict.reason).toBe("EVIDENCE_CONFLICT");
    expect(userStatus(conflict.status)).toBe("unable_to_verify");
    expect(
      verify(state().orders, { barcode: "unknown" }).itemId,
    ).toBeUndefined();
  });
});
describe("physical-unit ledger", () => {
  it("retracts a catalog-only match when a same-frame conflict replaces that attempt", () => {
    const first = recordAttempt(state(), event("barcode"));
    const revised = recordAttempt(
      first,
      event("same-frame-label", {
        status: "CONFLICT",
        reason: "EVIDENCE_CONFLICT",
      }),
      "barcode",
    );
    expect(progress(revised)).toMatchObject({
      matched: 0,
      checked: 1,
      unresolved: 1,
      left: 1,
    });
  });
  it("rejects event/capture replay and repeated identity without confirmation", () => {
    const first = recordAttempt(state(), event("a"));
    expect(recordAttempt(first, event("a"))).toBe(first);
    expect(
      recordAttempt(
        first,
        event("b", { captureId: "capture-a", confirmedAnotherUnit: true }),
      ),
    ).toBe(first);
    expect(recordAttempt(first, event("b"))).toBe(first);
    expect(
      recordAttempt(
        first,
        event("b", { identity: "OCR alternative text for same line" }),
      ),
    ).toBe(first);
    expect(progress(first).checked).toBe(1);
  });
  it("counts another user-confirmed unit, prevents excess and supports event-specific Undo", () => {
    let s = recordAttempt(state(), event("a"));
    s = recordAttempt(s, event("b", { confirmedAnotherUnit: true }));
    expect(progress(s)).toMatchObject({ checked: 2, matched: 2, left: 0 });
    expect(recordAttempt(s, event("c", { confirmedAnotherUnit: true }))).toBe(
      s,
    );
    const undone = undoAttempt(s, "a");
    expect(progress(undone).matched).toBe(1);
    expect(undoAttempt(undone, "a")).toBe(undone);
  });
  it("replaces retries, counts unresolved checks separately and never reduces arbitrary orders", () => {
    const s = recordAttempt(state(), event("a", { status: "INCOMPLETE" }));
    expect(progress(s)).toMatchObject({
      checked: 1,
      matched: 0,
      unresolved: 1,
      left: 1,
    });
    const retry = recordAttempt(s, event("b"), "a");
    expect(progress(retry)).toMatchObject({
      checked: 1,
      matched: 1,
      unresolved: 0,
    });
    const unknown = recordAttempt(
      retry,
      event("c", {
        orderId: undefined,
        itemId: undefined,
        identity: "unknown",
        status: "INCOMPLETE",
      }),
    );
    expect(progress(unknown)).toMatchObject({ checked: 1, unassigned: 1 });
    expect(recordAttempt(retry, event("d", { itemId: "another" }), "b")).toBe(
      retry,
    );
  });
});
describe("command and presentation gates", () => {
  it("keeps event IDs distinct without secure-context randomUUID", () => {
    vi.stubGlobal("crypto", undefined);
    try {
      expect(newId()).not.toBe(newId());
    } finally {
      vi.unstubAllGlobals();
    }
  });
  it("accepts only exact final phrases and valid transitions", () => {
    expect(commandFrom(" Stop speaking! ")).toBe("stop speaking");
    expect(commandFrom("please delete all orders and start")).toBeNull();
    expect(commandAllowed("next", "processing")).toBe(false);
    expect(commandAllowed("stop", "processing")).toBe(true);
  });
  it("does not reopen a presentation just because time passes or frames repeat", () => {
    const gate = new PresentationGate();
    const frame = Array(256).fill(10);
    gate.sample(frame);
    expect(gate.accept("same")).toBe(true);
    for (let i = 0; i < 20; i++) gate.sample(frame);
    // Initial stabilization may establish a boundary once; subsequent stable frames cannot.
    gate.accept("same");
    for (let i = 0; i < 20; i++) gate.sample(frame);
    expect(gate.accept("same")).toBe(false);
    expect(gate.accept("different")).toBe(true);
  });
});
