import { describe, expect, it, vi, afterEach } from "vitest";
import { confirmOrder, correctOrder, extractSpokenOrder, orderReadback } from "../src/lib/spoken-order";
import { orderSchema, savedStateSchema, verify } from "../src/lib/engine";
import { BrowserTranscription } from "../src/lib/order-transcription";
import type { Recognition } from "../src/lib/voice";

describe("spoken order extraction and confirmation", () => {
  it.each(["", "then ", "and then ", "next ", "also ", "Then "])("extracts quantity after a leading speech connector: %s", prefix => {
    const d = extractSpokenOrder(`${prefix}one Nescafe Classic coffee, 200 grams`);
    expect(d.items).toHaveLength(1);
    expect(d.items[0]).toMatchObject({ quantity: 1, name: "Nescafe Classic coffee", size: "200 g" });
    expect(d.unresolved).toEqual([]);
  });
  it.each(["; Then ", ". Next ", "\nAlso ", ", then ", " and then ", " and also "])("recognizes connectors at existing product boundaries: %s", separator => {
    const d = extractSpokenOrder(`two soaps${separator}one coffee 200 grams`);
    expect(d.items.map(i => [i.name, i.quantity, i.size])).toEqual([["soaps", 2, ""], ["coffee", 1, "200 g"]]);
    expect(d.unresolved).toEqual([]);
  });
  it.each(["then two soaps", "next 3 soaps", "also twelve soaps", "and then a soap", "then 999 soaps"])("accepts existing valid quantity forms after connectors: %s", text => {
    const d = extractSpokenOrder(text);
    expect(d.items[0].quantity).not.toBeNull();
    expect(d.unresolved).toEqual([]);
  });
  it.each(["Then soap", "Next Generation coffee", "Also tea", "then 0 soaps", "then 1000 soaps", "then -1 soaps", "then 1.5 soaps", "then thirteen soaps"])("preserves leading words without a valid quantity: %s", text => {
    expect(extractSpokenOrder(text).items[0]).toMatchObject({ name: text, quantity: null });
  });
  it.each(["one Better Then coffee", "one Next One coffee", "one Also One tea"])("preserves connectors inside product names: %s", text => {
    expect(extractSpokenOrder(text).items[0]).toMatchObject({ name: text.slice(4), quantity: 1 });
  });
  it("keeps a connector before a measurement and preserves ambiguous quantities", () => {
    expect(extractSpokenOrder("Next 200 grams coffee").items[0]).toMatchObject({ name: "Next coffee", size: "200 g", quantity: null });
    expect(extractSpokenOrder("then one or two soaps").items[0]).toMatchObject({ name: "soaps", quantity: null });
  });
  it.each([
    "I ordered from Daraz. I ordered",
    "I ordered from Daraz I ordered",
    "I ordered from Daraz and I ordered",
    "I bought from Daraz then I bought",
    "I purchased from Daraz and I purchased",
    "I ordered from Daraz I bought",
  ])("keeps the platform separate from speech-style products: %s", prefix => {
    const d = extractSpokenOrder(`${prefix} two Dove Hair Fall Rescue shampoos 400 millilitres and one Nescafe Classic coffee 200 grams`);
    expect(d.platform).toBe("Daraz");
    expect(d.items.map(i => [i.name, i.quantity, i.size])).toEqual([["Dove Hair Fall Rescue shampoos", 2, "400 ml"], ["Nescafe Classic coffee", 1, "200 g"]]);
    expect(d.unresolved).toEqual([]);
  });
  it("supports a quantity boundary without a repeated order clause", () => {
    const d = extractSpokenOrder("I ordered from Amazon two black shirts size medium and one pair of shoes size 7");
    expect(d.platform).toBe("Amazon");
    expect(d.items).toHaveLength(2);
    expect(d.items[0]).toMatchObject({ name: "shirts", quantity: 2, size: "medium", attributes: { color: "black" } });
    expect(d.items[1]).toMatchObject({ name: "pair of shoes", quantity: 1, size: "7" });
  });
  it.each(["I ordered from The Local Market I ordered two soaps", "I ordered from The Local Market two soaps"])("preserves multi-word platform names: %s", text => {
    expect(extractSpokenOrder(text)).toMatchObject({ platform: "The Local Market", items: [{ name: "soaps", quantity: 2 }] });
  });
  it("does not invent a missing platform or correct misheard brands", () => {
    const d = extractSpokenOrder("I ordered two Dove shampoos");
    expect(d.platform).toBeUndefined();
    expect(d.items[0]).toMatchObject({ name: "Dove shampoos", quantity: 2 });
    expect(extractSpokenOrder("I ordered from that house I ordered one Oneness Cafe")).toMatchObject({ platform: "that house", items: [{ name: "Oneness Cafe" }] });
  });
  it("prefers a repeated order clause when a multi-word shop includes a number word", () => {
    expect(extractSpokenOrder("I ordered from The One Shop I ordered two soaps")).toMatchObject({ platform: "The One Shop", items: [{ name: "soaps", quantity: 2 }] });
  });
  it("preserves repeated product clauses in existing order lists", () => {
    expect(extractSpokenOrder("I ordered one soap and I ordered two shirts").items.map(i => [i.name, i.quantity])).toEqual([["soap", 1], ["shirts", 2]]);
  });
  it.each(["I ordered from Daraz", "I ordered from Daraz I ordered", "I ordered from Daraz and I ordered"])("rejects a platform without products: %s", text => {
    expect(() => extractSpokenOrder(text)).toThrow("I found the platform");
  });
  it("extracts one product and never invents omitted information", () => {
    const d = extractSpokenOrder("I ordered Dove shampoo.");
    expect(d.platform).toBeUndefined();
    expect(d.items[0]).toMatchObject({ name: "Dove shampoo", quantity: null, brand: "", size: "", variant: "" });
    expect(d.items[0].productId).toBeUndefined();
    expect(d.items[0].attributes).toBeUndefined();
    expect(() => confirmOrder(d, true)).toThrow();
  });
  it("extracts a stated platform and several products with their own quantities and sizes", () => {
    const d = extractSpokenOrder("I ordered from Shop. I ordered two shampoos, 400 ml, and one coffee, 200 grams.");
    expect(d.platform).toBe("Shop");
    expect(d.items.map(i => [i.name, i.quantity, i.size])).toEqual([["shampoos", 2, "400 ml"], ["coffee", 1, "200 g"]]);
    expect(d.unresolved).toEqual([]);
    expect(orderReadback(d)).toContain("Platform: Shop");
  });
  it("keeps full-word units associated with the correct product", () => {
    const d = extractSpokenOrder("two shampoos, 1 litre, and one coffee, 2 kilograms");
    expect(d.items.map(i => [i.name, i.quantity, i.size])).toEqual([["shampoos", 2, "1 L"], ["coffee", 1, "2 kg"]]);
  });
  it("keeps multi-product colours and flavours associated", () => {
    const d = extractSpokenOrder("two blue shirts and three chocolate bars");
    expect(d.items).toHaveLength(2);
    expect(d.items[0]).toMatchObject({ name: "shirts", quantity: 2, attributes: { color: "blue" } });
    expect(d.items[1]).toMatchObject({ name: "bars", quantity: 3, attributes: { flavour: "chocolate" } });
  });
  it("extracts explicit type, variant, size and extensible attributes", () => {
    const d = extractSpokenOrder("one shampoo, type liquid, variant gentle, size 250 ml, color white, flavour vanilla");
    expect(d.items[0]).toMatchObject({ name: "shampoo", size: "250 ml", variant: "gentle", attributes: { type: "liquid", color: "white", flavour: "vanilla" } });
  });
  it("preserves descriptive product variants without catalog assumptions", () => {
    const d = extractSpokenOrder("two Hair Fall Rescue shampoos 400 ml");
    expect(d.items[0].name).toBe("Hair Fall Rescue shampoos");
    expect(d.items[0].variant).toBe("");
  });
  it.each(["one iPhone 16", "one 7Up", "one Formula 1 shirt", "one 3-in-1 shampoo"])("preserves numbers in product names: %s", text => {
    expect(extractSpokenOrder(text).items[0].name).toBe(text.slice(4));
  });
  it("does not consume a leading product size as quantity", () => {
    expect(extractSpokenOrder("400 ml shampoo").items[0]).toMatchObject({ quantity: null, size: "400 ml", name: "shampoo" });
  });
  it("preserves size uncertainty and only corrects the selected product field", () => {
    const d = extractSpokenOrder("two shampoos maybe 400 ml and one coffee 200 g");
    expect(d.unresolved).toContainEqual({ index: 0, field: "size" });
    expect(() => confirmOrder(d, true)).toThrow();
    const corrected = correctOrder(d, { index: 0, field: "size" }, "500 ml");
    expect(corrected.items[0].size).toBe("500 ml");
    expect(corrected.items[1]).toEqual(d.items[1]);
    expect(d.items[0].size).toBe("400 ml");
    expect(corrected.unresolved).toEqual([]);
    expect(confirmOrder(corrected, true).items[0].size).toBe("500 ml");
  });
  it("never treats an alternative quantity as a stated count", () => {
    const d = extractSpokenOrder("two or three soaps");
    expect(d.items[0]).toMatchObject({ name: "soaps", quantity: null });
    expect(d.unresolved).toContainEqual({ index: 0, field: "quantity" });
    expect(() => confirmOrder(d, true)).toThrow();
  });
  it("preserves uncertainty spoken after a size", () => {
    expect(extractSpokenOrder("one soap 200 g maybe").unresolved).toContainEqual({ index: 0, field: "size" });
  });
  it("does not infer colour from a product category", () => {
    expect(extractSpokenOrder("one orange juice").items[0]).toMatchObject({ name: "orange juice" });
    expect(extractSpokenOrder("one black coffee").items[0].attributes).toBeUndefined();
  });
  it("requires explicit confirmation and excludes transcript/audio from persisted data", () => {
    const d = extractSpokenOrder("one soap");
    expect(() => confirmOrder(d, false)).toThrow();
    const order = confirmOrder(d, true);
    expect(order.source).toBe("voice");
    expect(order).not.toHaveProperty("transcript");
    expect(orderSchema.safeParse(order).success).toBe(true);
  });
  it("requires a valid correction for missing quantity and preserves other uncertainty", () => {
    const d = extractSpokenOrder("shampoo maybe 400 ml");
    const invalid = correctOrder(d, { index: 0, field: "quantity" }, "0");
    expect(() => confirmOrder(invalid, true)).toThrow();
    const q = correctOrder(d, { index: 0, field: "quantity" }, "three");
    expect(q.items[0].quantity).toBe(3);
    expect(q.unresolved).toEqual([{ index: 0, field: "size" }]);
  });
  it("keeps an uncertain targeted correction unresolved", () => {
    const d = correctOrder(extractSpokenOrder("one soap 200 g"), { index: 0, field: "size" }, "maybe 300 g");
    expect(d.unresolved).toContainEqual({ index: 0, field: "size" });
    expect(() => confirmOrder(d, true)).toThrow();
  });
  it("can remove an uncertain optional detail without inventing a replacement", () => {
    const d = correctOrder(extractSpokenOrder("one soap maybe 200 g"), { index: 0, field: "size" }, "");
    expect(confirmOrder(d, true).items[0].size).toBe("");
  });
  it("rejects empty/overlong transcripts and platform-only statements", () => {
    for (const text of ["", "  ", "x".repeat(20001), "I ordered from Shop."]) expect(() => extractSpokenOrder(text)).toThrow();
  });
  it("loads legacy saved orders through the same schema", () => {
    expect(savedStateSchema.safeParse({ orders: [{ id: "old", label: "Old", source: "manual", items: [{ id: "i", name: "soap", quantity: 1, brand: "", size: "", variant: "", verified: 0 }] }], attempts: [] }).success).toBe(true);
  });
  it("uses existing verification without turning incomplete voice data into a match", () => {
    const order = confirmOrder(extractSpokenOrder("one soap"), true);
    expect(verify([order], { text: "soap", confidence: 99, source: "manual" }).status).toBe("INCOMPLETE");
    const complete = confirmOrder(extractSpokenOrder("two Oat drink, brand Everyday, variant Original, 1 L"), true);
    expect(verify([complete], { barcode: "DEMO-OAT-ORIGINAL-1L" }).status).toBe("MATCH");
  });
});
class FakeRecognition implements Recognition {
  static last: FakeRecognition;
  lang = ""; continuous = false; interimResults = false;
  onstart: Recognition["onstart"] = null; onend: Recognition["onend"] = null;
  onerror: Recognition["onerror"] = null; onresult: Recognition["onresult"] = null;
  constructor() { FakeRecognition.last = this; }
  start() { this.onstart?.(); }
  stop = vi.fn(() => this.onend?.());
  abort = vi.fn();
  result(text: string) { this.onresult?.({ resultIndex: 0, results: [{ isFinal: true, 0: { transcript: text } }] }); }
}
afterEach(() => vi.useRealTimers());
describe("bounded dictation provider", () => {
  const events = () => ({ started: vi.fn(), complete: vi.fn(), error: vi.fn() });
  it("configures Pakistani English and an explicit US fallback without guessing provider support", () => {
    const e = events();
    const p = new BrowserTranscription({ active: () => true, recognition: FakeRecognition });
    p.start(e);
    expect(FakeRecognition.last.lang).toBe("en-PK");
    FakeRecognition.last.onerror?.({ error: "language-not-supported" });
    expect(e.error).toHaveBeenCalledWith(expect.stringContaining("English (US) as a fallback"));
    const fallback = new BrowserTranscription({ active: () => true, recognition: FakeRecognition }, "en-US");
    fallback.start(e);
    expect(FakeRecognition.last.lang).toBe("en-US");
    fallback.cancel();
  });
  it("replaces interim slots with finals and removes withdrawn interim words", () => {
    const e = events(); const p = new BrowserTranscription({ active: () => true, recognition: FakeRecognition });
    p.start(e); const rec = FakeRecognition.last;
    const result = (texts: string[], resultIndex = 0, final = false) => rec.onresult?.({ resultIndex, results: texts.map(text => ({ isFinal: final, 0: { transcript: text } })) });
    result(["two wrong"]);
    result(["two soaps", "and one wrong"]);
    result(["two soaps", "and one coffee"], 1);
    result(["two soaps"], 1);
    result(["two soaps", "and one tea"], 1, true);
    p.stop();
    expect(e.complete).toHaveBeenCalledExactlyOnceWith("two soaps and one tea");
  });
  it("waits for the final phrase after Finish and completes only once", () => {
    vi.useFakeTimers(); const e = events();
    const p = new BrowserTranscription({ active: () => true, recognition: FakeRecognition });
    p.start(e); const rec = FakeRecognition.last;
    rec.stop.mockImplementation(() => {});
    rec.result("two soaps"); p.stop(); p.stop();
    expect(rec.stop).toHaveBeenCalledOnce();
    expect(e.complete).not.toHaveBeenCalled();
    rec.result("two soaps and one coffee"); rec.onend?.();
    vi.advanceTimersByTime(60001);
    expect(e.complete).toHaveBeenCalledExactlyOnceWith("two soaps and one coffee");
    expect(rec.abort).toHaveBeenCalledOnce();
  });
  it("bounds a missing end event and cancellation during finalization never completes", () => {
    vi.useFakeTimers(); const e = events();
    const p = new BrowserTranscription({ active: () => true, recognition: FakeRecognition });
    p.start(e); FakeRecognition.last.stop.mockImplementation(() => {});
    FakeRecognition.last.result("one soap"); p.stop(); vi.advanceTimersByTime(1501);
    expect(e.complete).toHaveBeenCalledExactlyOnceWith("one soap");
    e.complete.mockClear(); p.start(e); const rec = FakeRecognition.last;
    rec.stop.mockImplementation(() => {}); rec.result("cancelled soap"); p.stop();
    const lateEnd = rec.onend!; const lateResult = rec.onresult!; p.cancel();
    lateEnd(); lateResult({ resultIndex: 0, results: [{ isFinal: true, 0: { transcript: "late soap" } }] });
    vi.advanceTimersByTime(60001);
    expect(e.complete).not.toHaveBeenCalled();
    expect(rec.abort).toHaveBeenCalledOnce();
  });
  it("reports unsupported recognition and microphone permission denial", () => {
    const e = events();
    new BrowserTranscription({ active: () => true }).start(e);
    expect(e.error).toHaveBeenCalledWith(expect.stringContaining("unavailable"));
    const p = new BrowserTranscription({ active: () => true, recognition: FakeRecognition });
    p.start(e); FakeRecognition.last.onerror?.({ error: "not-allowed" });
    expect(e.error).toHaveBeenCalledWith(expect.stringContaining("permission denied"));
    expect(FakeRecognition.last.abort).toHaveBeenCalled();
  });
  it("completes naturally on silence and releases the microphone", () => {
    vi.useFakeTimers(); const e = events();
    const p = new BrowserTranscription({ active: () => true, recognition: FakeRecognition });
    p.start(e); const rec = FakeRecognition.last;
    expect(rec.continuous).toBe(true);
    rec.result("two soaps"); vi.advanceTimersByTime(4501);
    expect(e.complete).toHaveBeenCalledWith("two soaps");
    expect(rec.abort).toHaveBeenCalledOnce();
  });
  it("cancels and starts again without accepting late results or old timeouts", () => {
    vi.useFakeTimers(); const e = events();
    const p = new BrowserTranscription({ active: () => true, recognition: FakeRecognition });
    p.start(e); const old = FakeRecognition.last.onresult!;
    p.cancel(); old({ resultIndex: 0, results: [{ isFinal: true, 0: { transcript: "old" } }] });
    expect(e.complete).not.toHaveBeenCalled();
    p.start(e); FakeRecognition.last.result("new"); p.stop();
    expect(e.complete).toHaveBeenCalledExactlyOnceWith("new"); vi.advanceTimersByTime(60001);
    expect(e.complete).toHaveBeenCalledOnce();
  });
  it("rejects results after the host becomes inactive", () => {
    let active = true; const e = events();
    const p = new BrowserTranscription({ active: () => active, recognition: FakeRecognition });
    p.start(e); active = false; FakeRecognition.last.result("confirm stop recording");
    expect(e.complete).not.toHaveBeenCalled();
    expect(FakeRecognition.last.abort).toHaveBeenCalled();
  });
  it("handles empty results and a maximum listening deadline", () => {
    vi.useFakeTimers(); const e = events();
    const p = new BrowserTranscription({ active: () => true, recognition: FakeRecognition });
    p.start(e); vi.advanceTimersByTime(60001);
    expect(e.complete).toHaveBeenCalledWith("");
  });
  it("supports spoken finish, cancel and start again without background listening", () => {
    const e = events(); const p = new BrowserTranscription({ active: () => true, recognition: FakeRecognition });
    for (const [input, output] of [["two soaps stop recording", "two soaps"], ["Cancel", "Cancel"], ["Start again", "Start again"]]) {
      p.start(e); FakeRecognition.last.result(input); expect(e.complete).toHaveBeenLastCalledWith(output);
    }
  });
});
