import { orderSchema, type Item, type Order } from "./engine";
import { newId } from "./id";

export const orderFields = ["name", "quantity", "size", "color", "flavour", "type", "variant", "brand"] as const;
export type OrderField = typeof orderFields[number];
export type Correction = { index: number; field: OrderField } | { field: "platform" };
export type OrderCandidate = {
  platform?: string;
  items: Item[];
  unresolved: Correction[];
};
const words: Record<string, number> = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12 };
export function parseQuantity(value: string): number | null {
  const clean = value.trim().toLowerCase().replace(/[.!?]+$/, "");
  const n = words[clean] ?? (/^\d+$/.test(clean) ? Number(clean) : NaN);
  return Number.isInteger(n) && n >= 1 && n <= 999 ? n : null;
}
const uncertain = /\b(?:maybe|perhaps|possibly|not sure|I think|about|approximately|either|unsure|around|not)\b/i;
const sizePattern = /\b\d+(?:\.\d+)?\s*(?:millilitres?|milliliters?|kilograms?|grams?|litres?|liters?|ml|kg|g|l|oz)\b/i;
const quantityStart = "(?:\\d+|a|an|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\\s+(?!ml\\b|g\\b|kg\\b|l\\b|grams?\\b|kilograms?\\b|lit(?:re|er)s?\\b|oz\\b|millilit(?:re|er)s?\\b)";
const sameTarget = (a: Correction, b: Correction) =>
  a.field === b.field && ("index" in a ? "index" in b && a.index === b.index : !("index" in b));
const clean = (s: string) => s.replace(/^[\s,.:;-]+|[\s,.:;-]+$/g, "").trim();
const speechConnector = "(?:and\\s+then|then|next|also)\\s+";
/** Conservative English extraction: no catalog lookups or implicit quantity/attributes. */
export function extractSpokenOrder(transcript: string): OrderCandidate {
  if (!transcript.trim() || transcript.length > 20000) throw new Error("Enter an order transcript of 1 to 20,000 characters.");
  const candidate: OrderCandidate = { items: [], unresolved: [] };
  let text = transcript.trim();
  // Speech providers often omit punctuation. Stop before another order clause
  // or an explicit product quantity; never use a product catalog to infer a shop.
  const platform = text.match(/^(?:I\s+)?(?:ordered|bought|purchased)\s+from\s+([^.!?,;\n]+)/i);
  if (platform) {
    const tail = platform[1];
    const clause = tail.search(/\s+(?:(?:and|then)\s+)?I\s+(?:ordered|bought|purchased)\b/i);
    // Prefer an explicit clause boundary, even if the shop name includes a
    // number word. Without one, a stated quantity can introduce the products.
    const boundary = clause >= 0 ? clause : tail.search(new RegExp("\\s+" + quantityStart, "i"));
    const name = boundary >= 0 ? tail.slice(0, boundary) : tail;
    candidate.platform = clean(name);
    if (uncertain.test(name)) candidate.unresolved.push({ field: "platform" });
    text = text.slice(platform[0].length - tail.length + name.length);
  }
  text = clean(text).replace(/^(?:(?:and|then)\s+)?(?:I\s+)?(?:ordered|bought|purchased)\b\s*/i, "");
  text = text.replace(/\b(?:I\s+)?(?:ordered|bought|purchased)\s+/gi, "");
  // Split only at a stated new quantity or an explicit new sentence/line.
  // Ambiguous lists stay visible and require correction instead of guessing associations.
  const pieces = text.split(new RegExp("(?:,?\\s+and\\s+|,\\s*)(?=(?:" + speechConnector + ")?" + quantityStart + ")|[;\\n]+|[.!?]\\s+(?!\\d)", "i"));
  for (const raw of pieces.filter(s => clean(s))) {
    let rest = clean(raw);
    // A connector is disposable only at this clause's start before a valid
    // quantity, never inside a product name or before a size measurement.
    const connector = rest.match(new RegExp("^" + speechConnector + "(?=" + quantityStart + ")", "i"));
    if (connector && parseQuantity(rest.slice(connector[0].length).split(/\s/)[0]) !== null) rest = rest.slice(connector[0].length);
    const item: Item = { id: newId(), name: "", brand: "", variant: "", size: "", quantity: null, verified: 0 };
    const index = candidate.items.length;
    const alternateQuantity = rest.match(/^(?:\d+|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\s+(?:or|to)\s+(?:\d+|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\s+/i);
    if (alternateQuantity) rest = rest.slice(alternateQuantity[0].length);
    const q = alternateQuantity ? null : rest.match(/^(\d+|a|an|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\s+/i);
    // Numbers followed by a unit or a hyphen belong to the product, not quantity.
    if (q && !sizePattern.test(q[0] + rest.slice(q[0].length).split(/\s/)[0])) {
      item.quantity = parseQuantity(q[1]);
      rest = rest.slice(q[0].length);
    }
    if (item.quantity === null) candidate.unresolved.push({ index, field: "quantity" });
    const size = rest.match(sizePattern);
    if (size) {
      item.size = size[0].replace(/millilit(?:re|er)s?/i, "ml").replace(/kilograms?/i, "kg").replace(/grams?/i, "g").replace(/lit(?:re|er)s?/i, "L");
      const near = rest.slice(Math.max(0, size.index! - 25), size.index! + size[0].length + 15);
      const multipleSizes = new RegExp(sizePattern.source, "gi");
      if (uncertain.test(near) || [...rest.matchAll(multipleSizes)].length > 1) candidate.unresolved.push({ index, field: "size" });
      rest = rest.slice(0, size.index).replace(/\bsize\s*(?::|is)?\s*$/i, "") + rest.slice(size.index! + size[0].length);
    }
    // Explicit labels let any product category supply its own attribute vocabulary.
    rest = rest.replace(/\b(color|colour|flavou?r|type|variant|formulation|brand|size|shade)\s*(?::|is\b)?\s+([^,;]+)/gi, (_all, key: string, value: string) => {
      const field = ({ colour: "color", flavor: "flavour", formulation: "variant", shade: "color" } as Record<string, OrderField>)[key.toLowerCase()] ?? key.toLowerCase() as OrderField;
      const target = field === "color" || field === "flavour" || field === "type" ? (item.attributes ??= {}) : item;
      Object.assign(target, { [field]: clean(value) });
      if (uncertain.test(value)) candidate.unresolved.push({ index, field });
      return "";
    });
    // Only literal, unambiguous colour/flavour words are separated from names.
    for (const [field, pattern] of [["color", /\b(red|blue|green|black|white|pink|yellow|purple|orange|brown|grey|gray)\b(?=\s+(?:shirts?|t-shirts?|pants|trousers|dress|dresses|shoes|jackets?)\b)/i], ["flavour", /\b(chocolate|vanilla|strawberry)\b(?=\s+(?:bars?|milk|ice cream|cookies?|biscuits?|yog[hu]rt|cake)\b)/i]] as const) {
      const match = rest.match(pattern);
      if (match && !item.attributes?.[field]) {
        (item.attributes ??= {})[field] = match[0];
        rest = rest.replace(match[0], "");
        if (uncertain.test(raw)) candidate.unresolved.push({ index, field });
      }
    }
    rest = clean(rest.replace(uncertain, "").replace(/\s*,\s*(?:,\s*)*/g, ", ").replace(/\s+/g, " "));
    item.name = rest;
    if (!rest || /\band\b/i.test(rest) || (uncertain.test(raw) && !candidate.unresolved.some(t => "index" in t && t.index === index && t.field !== "quantity"))) candidate.unresolved.push({ index, field: "name" });
    candidate.items.push(item);
  }
  if (!candidate.items.length) throw new Error(candidate.platform ? "I found the platform, but I couldn't identify the products. Check the transcript and try again." : "I couldn't identify any products. Check the transcript and try again.");
  return candidate;
}
export function fieldValue(item: Item, field: OrderField): string {
  return String((field === "color" || field === "flavour" || field === "type" ? item.attributes?.[field] : item[field]) ?? "");
}
export function correctOrder(candidate: OrderCandidate, target: Correction, value: string): OrderCandidate {
  const next: OrderCandidate = { ...candidate, items: candidate.items.map(i => ({ ...i, attributes: i.attributes ? { ...i.attributes } : undefined })), unresolved: candidate.unresolved.filter(t => !sameTarget(t, target)) };
  if (target.field === "platform") next.platform = value.trim() || undefined;
  else if ("index" in target) {
    const item = next.items[target.index];
    if (target.field === "quantity") {
      item.quantity = parseQuantity(value);
      if (item.quantity === null) next.unresolved.push(target);
    } else if (["color", "flavour", "type"].includes(target.field)) (item.attributes ??= {})[target.field] = value.trim();
    else Object.assign(item, { [target.field]: value.trim() });
    if (target.field === "name" && !value.trim()) next.unresolved.push(target);
  }
  if (value.trim() && uncertain.test(value) && !next.unresolved.some(t => sameTarget(t, target))) next.unresolved.push(target);
  return next;
}
export function orderReadback(candidate: OrderCandidate): string {
  return `I heard: ${candidate.items.map(i => `${i.quantity ?? "Unconfirmed quantity of"} ${i.name}${[i.brand, i.variant, i.size, ...Object.entries(i.attributes ?? {}).map(([k,v]) => `${k}: ${v}`)].filter(Boolean).map(v => `, ${v}`).join("")}`).join("; ")}.${candidate.platform ? ` Platform: ${candidate.platform}.` : ""}${candidate.unresolved.length ? " Some fields need confirmation. Choose Change." : " Say Confirm, Change, or Start again."}`;
}
export function confirmOrder(candidate: OrderCandidate, confirmed: boolean, source: "voice" | "manual" = "voice"): Order {
  if (!confirmed || candidate.unresolved.length) throw new Error("Review and confirm all uncertain fields before saving.");
  // Transcripts and audio are deliberately excluded from the saved canonical order.
  return orderSchema.parse({ id: newId(), label: candidate.platform || "My order", platform: candidate.platform, source, items: candidate.items });
}
