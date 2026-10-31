import { z } from "zod";
import catalog from "../data/catalog.v1.json";
import { newId } from "./id";
const provenanceSchema = z.object({
  text: z.string().max(2000),
  line: z.number().int().positive(),
  page: z.number().int().positive(),
  uncertain: z.array(z.string()),
  unitPrice: z.number().nonnegative().optional(),
  lineTotal: z.number().nonnegative().optional(),
});
export const itemSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().trim().min(1).max(160),
    brand: z.string().trim().max(100),
    variant: z.string().trim().max(100),
    size: z.string().trim().max(60),
    quantity: z.number().int().min(1).max(999).nullable(),
    verified: z.number().int().min(0).max(999),
    attributes: z.record(z.string().max(60), z.string().trim().max(160)).optional(),
    productId: z.string().optional(),
    source: provenanceSchema.optional(),
  })
  .refine(
    (i) => (i.quantity === null ? i.verified === 0 : i.verified <= i.quantity),
    "Verified count exceeds ordered quantity",
  );
export const orderSchema = z.object({
  id: z.string().min(1),
  label: z.string().trim().min(1).max(120),
  source: z.enum(["purchase", "manual", "packing-slip", "voice", "receipt"]).optional(),
  platform: z.string().trim().max(120).optional(),
  items: z.array(itemSchema).min(1).max(200),
});
export const sessionSchema = z.array(orderSchema).max(100);
export type Item = z.infer<typeof itemSchema>;
export type Order = z.infer<typeof orderSchema>;
export type Evidence = {
  presentationId?: string;
  barcode?: string;
  text?: string;
  confidence?: number;
  captureId?: string;
  sessionId?: string;
  source?: "barcode" | "ocr" | "manual";
};
export type Verdict = {
  status: "MATCH" | "MISMATCH" | "CONFLICT" | "INCOMPLETE";
  message: string;
  reason?: string;
  orderId?: string;
  itemId?: string;
  identity?: string;
  fields?: { field: string; observed: string; source: string }[];
  candidates?: { orderId: string; itemId: string; label: string }[];
};
export const userStatus = (status: Verdict["status"]) =>
  status === "MATCH"
    ? "match"
    : status === "MISMATCH"
      ? "mismatch"
      : "unable_to_verify";
export const normalize = (s: string) =>
  s
    .toLowerCase()
    .replace(/(\d)\s+(?=[a-z])/g, "$1")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
const contains = (text: string, field: string) =>
  !!field && ` ${normalize(text)} `.includes(` ${normalize(field)} `);
export function sizes(text: string) {
  return [...text.matchAll(/\b(\d+(?:\.\d+)?)\s*(kg|ml|g|l)\b/gi)].map((m) => ({
    raw: m[0],
    dimension: /^(kg|g)$/i.test(m[2]) ? "weight" : "volume",
    amount: Number(m[1]) * (/^(kg|l)$/i.test(m[2]) ? 1000 : 1),
  }));
}
export function sameSize(a: string, b: string) {
  const [x] = sizes(a),
    [y] = sizes(b);
  return !!x && !!y && x.dimension === y.dimension && x.amount === y.amount;
}
function hasField(text: string, field: string) {
  if (!field) return false;
  const escaped = field.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  if (new RegExp(`\\b(?:no|not|without)\\s+${escaped}\\b`, "i").test(text))
    return false;
  return contains(text, field);
}
export function verify(orders: Order[], evidence: Evidence): Verdict {
  const reliable = !!evidence.text?.trim() && (evidence.confidence ?? 0) >= 85;
  const product = evidence.barcode
    ? catalog.products.find((p) => p.barcodes.includes(evidence.barcode!))
    : undefined;
  const text = reliable ? evidence.text! : "";
  const all = orders.flatMap((o) => o.items.map((i) => ({ o, i })));
  const identity = product?.id ?? (text ? normalize(text) : evidence.barcode);
  const result = (
    status: Verdict["status"],
    reason: string,
    message: string,
    line?: (typeof all)[number],
  ): Verdict => ({
    status,
    reason,
    message,
    identity,
    ...(line ? { orderId: line.o.id, itemId: line.i.id } : {}),
    fields: product
      ? ["name", "brand", "variant", "size"].map((field) => ({
          field,
          observed: product[field as "name" | "brand" | "variant" | "size"],
          source: `demonstration catalog v1 / ${evidence.captureId ?? "manual capture"}`,
        }))
      : text
        ? [
            {
              field: "label",
              observed: text,
              source: `${evidence.source === "manual" ? "user-entered label" : "OCR"} / ${evidence.captureId ?? "manual capture"}`,
            },
          ]
        : [],
  });
  if (!product && !reliable)
    return result(
      "INCOMPLETE",
      evidence.barcode ? "UNKNOWN_BARCODE" : "LOW_CONFIDENCE",
      evidence.barcode
        ? "Unknown barcode. Turn to the full label; automatic OCR can try to read it. Nothing counted."
        : "I couldn't read enough reliable label text. Rotate the package slowly and try again.",
    );
  if (product && text) {
    const contraryProduct = catalog.products.some(
      (p) =>
        p.id !== product.id &&
        p.name !== product.name &&
        hasField(text, p.name) &&
        hasField(text, p.brand),
    );
    const contraryVariant = catalog.products.some(
      (p) =>
        p.name === product.name &&
        p.variant !== product.variant &&
        hasField(text, p.variant),
    );
    if (
      contraryProduct ||
      contraryVariant ||
      sizes(text).some((s) => !sameSize(s.raw, product.size))
    )
      return result(
        "CONFLICT",
        "EVIDENCE_CONFLICT",
        "Barcode and label disagree. Isolate one package and retry; nothing counted.",
      );
  }
  if (
    !product &&
    catalog.products.filter(
      (p) =>
        [p.name, p.brand, p.variant].every((v) => hasField(text, v)) &&
        sizes(text).some((s) => sameSize(s.raw, p.size)),
    ).length > 1
  )
    return result(
      "CONFLICT",
      "EVIDENCE_CONFLICT",
      "The label contains more than one identity. Isolate one package and retry.",
    );
  const compatible = all.filter(({ i }) =>
    product
      ? [i.name, i.brand, i.variant, i.size].every(
          (v, j) =>
            !!v &&
            (j === 3
              ? sameSize(v, product.size)
              : normalize(v) ===
                normalize([product.name, product.brand, product.variant][j])),
        )
      : [i.name, i.brand, i.variant].every((v) => hasField(text, v)) &&
        !!i.size &&
        sizes(text).some((s) => sameSize(s.raw, i.size)),
  );
  const candidates = compatible.filter(
    ({ i }) => i.quantity === null || i.verified < i.quantity,
  );
  if (candidates.length > 1)
    return {
      ...result(
        "CONFLICT",
        "AMBIGUOUS_ORDER",
        "Which order line is this for? Choose one before checking it.",
      ),
      candidates: candidates.map(({ o, i }) => ({
        orderId: o.id,
        itemId: i.id,
        label: `${o.label}: ${i.name}`,
      })),
    };
  const line = candidates[0];
  if (line) {
    if (line.o.source === "packing-slip")
      return result(
        "INCOMPLETE",
        "DEPENDENT_REFERENCE",
        "A packing slip describes delivered contents. Add original purchase evidence before claiming an order match.",
        line,
      );
    if (line.i.quantity === null)
      return result(
        "INCOMPLETE",
        "UNKNOWN_QUANTITY",
        "The ordered quantity is unknown. Correct the order quantity before counting units.",
        line,
      );
    if (!product && sizes(text).some((s) => !sameSize(s.raw, line.i.size)))
      return result(
        "CONFLICT",
        "EVIDENCE_CONFLICT",
        "Conflicting sizes on the label. Isolate the product and retry.",
        line,
      );
    return result(
      "MATCH",
      product ? "DEMO_CATALOG_IDENTITY" : "COMPLETE_LABEL",
      `Match for ${line.i.brand} ${line.i.name}, ${line.i.variant}, ${line.i.size}, in ${line.o.label}. ${product ? "Demonstration catalog identity only; package contents were not checked." : "Label fields checked; contents were not checked."}`,
      line,
    );
  }
  if (compatible.length)
    return result(
      "MISMATCH",
      "EXCESS_QUANTITY",
      "The matching ordered quantity is already complete. No extra unit counted.",
    );
  const related = all.filter(({ i }) =>
    product
      ? normalize(i.name) === normalize(product.name)
      : contains(text, i.name),
  );
  const relatedLine = related.length === 1 ? related[0] : undefined;
  if (relatedLine?.o.source === "packing-slip")
    return result(
      "INCOMPLETE",
      "DEPENDENT_REFERENCE",
      "A packing slip is not independent purchase evidence. Add the original purchase reference.",
      relatedLine,
    );
  if (
    relatedLine &&
    [relatedLine.i.brand, relatedLine.i.variant, relatedLine.i.size].some(
      (v) => !v.trim(),
    )
  )
    return result(
      "INCOMPLETE",
      "MISSING_REFERENCE_FIELDS",
      "The purchase reference is missing identifying fields. Correct those fields before claiming a match or mismatch.",
      relatedLine,
    );
  if (product)
    return result(
      "MISMATCH",
      "DIFFERENT_PRODUCT",
      "The catalog identity differs from the requested product, variant or size. No verified unit added.",
      relatedLine,
    );
  if (relatedLine && hasField(text, relatedLine.i.brand)) {
    const knownIdentity = catalog.products.find(
      (p) =>
        [p.name, p.brand, p.variant].every((v) => hasField(text, v)) &&
        sizes(text).length === 1 &&
        sameSize(sizes(text)[0].raw, p.size),
    );
    const contrarySize =
      hasField(text, relatedLine.i.variant) &&
      sizes(text).length === 1 &&
      !!relatedLine.i.size &&
      !sameSize(sizes(text)[0].raw, relatedLine.i.size);
    if (knownIdentity || contrarySize)
      return result(
        "MISMATCH",
        "CONTRARY_LABEL",
        "The independently read label has a different variant or size from this purchase reference. No verified unit added.",
        relatedLine,
      );
  }
  return result(
    "INCOMPLETE",
    "MISSING_FIELDS",
    "Product identity is incomplete or contrary. I couldn't confirm name, brand, variant and size consistently; rotate the label and retry.",
    relatedLine,
  );
}
export function applyMatch(orders: Order[], result: Verdict): Order[] {
  if (result.status !== "MATCH") return orders;
  return orders.map((o) => ({
    ...o,
    items: o.items.map((i) =>
      o.id === result.orderId &&
      i.id === result.itemId &&
      i.quantity !== null &&
      i.verified < i.quantity
        ? { ...i, verified: i.verified + 1 }
        : i,
    ),
  }));
}
export const attemptSchema = z.object({
  presentationId: z.string().optional(),
  id: z.string(),
  captureId: z.string(),
  sessionId: z.string(),
  identity: z.string(),
  orderId: z.string().optional(),
  itemId: z.string().optional(),
  status: z.enum(["MATCH", "MISMATCH", "CONFLICT", "INCOMPLETE"]),
  reason: z.string(),
  message: z.string(),
  confirmedAnotherUnit: z.boolean(),
  undone: z.boolean().default(false),
  observation: z
    .object({
      barcode: z.string().max(1000).optional(),
      text: z.string().max(20000).optional(),
      confidence: z.number().optional(),
      source: z.enum(["barcode", "ocr", "manual"]).optional(),
    })
    .optional(),
});
export type Attempt = z.infer<typeof attemptSchema>;
export type CheckState = { orders: Order[]; attempts: Attempt[] };
export const savedStateSchema = z.object({
  orders: sessionSchema,
  attempts: z.array(attemptSchema).max(10000),
});
export function recordAttempt(
  state: CheckState,
  attempt: Attempt,
  retryId?: string,
): CheckState {
  if (state.attempts.length >= 10000) return state;
  if (
    state.attempts.some(
      (a) => a.id === attempt.id || a.captureId === attempt.captureId,
    )
  )
    return state;
  const old = retryId
    ? state.attempts.find((a) => a.id === retryId && !a.undone)
    : undefined;
  if (
    old?.itemId &&
    (old.itemId !== attempt.itemId || old.orderId !== attempt.orderId)
  )
    return state;
  const active = state.attempts.filter((a) => !a.undone && a.id !== old?.id);
  if (
    !old &&
    active.some(
      (a) =>
        a.identity === attempt.identity ||
        (attempt.itemId &&
          a.itemId === attempt.itemId &&
          a.orderId === attempt.orderId),
    ) &&
    !attempt.confirmedAnotherUnit
  )
    return state;
  const line = state.orders
    .find((o) => o.id === attempt.orderId)
    ?.items.find((i) => i.id === attempt.itemId);
  if (attempt.itemId && !line) return state;
  const previousNonmatches = active.filter(
    (a) =>
      a.orderId === attempt.orderId &&
      a.itemId === attempt.itemId &&
      a.status !== "MATCH",
  ).length;
  if (
    line &&
    line.quantity !== null &&
    line.verified - (old?.status === "MATCH" ? 1 : 0) + previousNonmatches >=
      line.quantity
  )
    return state;
  const orders = state.orders.map((o) => ({
    ...o,
    items: o.items.map((i) => {
      if (o.id !== attempt.orderId || i.id !== attempt.itemId) return i;
      const delta =
        Number(attempt.status === "MATCH") - Number(old?.status === "MATCH");
      return {
        ...i,
        verified: Math.max(0, Math.min(i.quantity ?? 0, i.verified + delta)),
      };
    }),
  }));
  return {
    orders,
    attempts: [
      ...state.attempts.map((a) =>
        a.id === old?.id ? { ...a, undone: true } : a,
      ),
      attempt,
    ],
  };
}
export function undoAttempt(state: CheckState, id: string): CheckState {
  const event = state.attempts.find((a) => a.id === id && !a.undone);
  if (!event) return state;
  return {
    orders: state.orders.map((o) => ({
      ...o,
      items: o.items.map((i) =>
        o.id === event.orderId &&
        i.id === event.itemId &&
        event.status === "MATCH"
          ? { ...i, verified: Math.max(0, i.verified - 1) }
          : i,
      ),
    })),
    attempts: state.attempts.map((a) =>
      a.id === id ? { ...a, undone: true } : a,
    ),
  };
}
export function progress(state: CheckState) {
  let total = 0,
    matched = 0,
    checked = 0,
    unknown = 0,
    waiting = 0,
    mismatch = 0,
    unresolved = 0;
  for (const o of state.orders) {
    let pending = false;
    for (const i of o.items) {
      const events = state.attempts.filter(
        (a) =>
          !a.undone &&
          a.orderId === o.id &&
          a.itemId === i.id &&
          a.status !== "MATCH",
      );
      if (i.quantity === null) {
        unknown++;
        pending = true;
        continue;
      }
      total += i.quantity;
      matched += i.verified;
      const done = Math.min(i.quantity, i.verified + events.length);
      checked += done;
      mismatch += events.filter((a) => a.status === "MISMATCH").length;
      unresolved += events.filter((a) => a.status !== "MISMATCH").length;
      if (done < i.quantity) pending = true;
    }
    if (pending) waiting++;
  }
  return {
    total,
    matched,
    checked,
    left: total - checked,
    unknown,
    waiting,
    mismatch,
    unresolved,
    unassigned: state.attempts.filter((a) => !a.undone && !a.itemId).length,
  };
}
export function extractOrder(text: string): Item[] {
  const output: Item[] = [];
  let page = 1,
    lineNumber = 0,
    inItems = false;
  const money =
    /(?:[$£€]|PKR\s*|Rs\.?\s*)?(\d+[.,]\d{2})(?!\d|\s*(?:kg|ml|g|l)\b)/gi;
  const receiptLines = text.slice(0, 100000).split(/\r?\n/);
  for (const [lineIndex, raw] of receiptLines.entries()) {
    lineNumber++;
    if (raw.includes("\f")) {
      page++;
      continue;
    }
    const line = raw.trim();
    if (!line) continue;
    if (
      /^(?:item|product|description)\s*(?:qty|quantity|price|\||$)/i.test(line)
    ) {
      inItems = true;
      continue;
    }
    const parts = line.split("|").map((p) => p.trim());
    const structured = parts.length >= 4;
    const metadata =
      /^(?:(?:sub\s*total|grand total|total|sales tax|tax|vat|shipping|delivery fee|service fee|discount|coupon|payment|paid|change|cash|card|balance)\b\s*(?::|[$£€]|-?\d)|(?:order|receipt|invoice)\s*(?:#|no\.?|number|id|:)|(?:date|time|address|phone|tel|customer|merchant|store)\s*:|thank you\b|have a nice day\b|www\.|https?:|\S+@\S+|\d{1,4}[/-]\d{1,2}[/-]\d{2,4}\b|\+?\d[\d\s()-]{8,}$|\d+\s+.*\b(?:street|road|avenue|lane)\b)/i.test(
        line,
      );
    if (!structured && metadata) {
      inItems = false;
      continue;
    }
    const size = structured ? (parts[3] ?? "") : (sizes(line)[0]?.raw ?? "");
    let explicitQty = structured
      ? parts[4]
      : (line.match(/\bqty\s*:?\s*(\d+)\b/i)?.[1] ??
        line.match(/\b(\d+)\s*[x×]\s*(?=[$£€\d])/i)?.[1] ??
        line.match(/\bx\s*(\d+)\b/i)?.[1]);
    const amounts = [...line.matchAll(money)].map((m) =>
      Number(m[1].replace(",", ".")),
    );
    if (!structured && !explicitQty && amounts.length >= 2)
      explicitQty =
        line.match(
          /\b(\d{1,3})\s+[$£€]?\d+[.,]\d{2}\s+[$£€]?\d+[.,]\d{2}\b/,
        )?.[1] ??
        (inItems ? line.match(/^(\d{1,3})\s+(?=[a-z])/i)?.[1] : undefined);
    const qty = explicitQty ? Number(explicitQty) : null;
    const quantity =
      qty !== null && Number.isInteger(qty) && qty > 0 && qty <= 999
        ? qty
        : null;
    const positive =
      structured || !!size || explicitQty !== undefined || amounts.length > 0;
    if (
      !positive &&
      !inItems &&
      !output.length &&
      /^(?:order\s*(?:#|id|number|:)|date\s*:|address\s*:)/i.test(
        receiptLines[lineIndex + 1]?.trim() ?? "",
      )
    )
      continue;
    if (!/[a-z]/i.test(line)) continue;
    if (!positive && /^\s{2,}/.test(raw) && inItems && output.length) {
      const last = output.at(-1)!;
      last.name = `${last.name} ${line}`.slice(0, 160);
      if (last.source) last.source.text += `\n${line}`;
      continue;
    }
    if (
      !positive &&
      !inItems &&
      /^(?:[A-Z][A-Z\s&'-]{3,}|\d+\s+\w+\s+(?:road|street|avenue|lane)\b)/.test(
        line,
      )
    )
      continue;
    let name = structured
      ? parts[0]
      : line
          .replace(/\bqty\s*:?\s*\d+\b|\b\d+\s*[x×]\s*|\bx\s*\d+\b/gi, "")
          .replace(money, "")
          .replace(/[$£€]/g, "")
          .replace(/\s{2,}/g, " ")
          .trim();
    let sourceText = line;
    const previous = output.at(-1);
    if (
      !structured &&
      positive &&
      previous?.source &&
      previous.quantity === null &&
      !previous.size &&
      !previous.brand &&
      previous.source.line === lineNumber - 1 &&
      previous.source.lineTotal === undefined
    ) {
      output.pop();
      name = `${previous.name} ${name}`;
      sourceText = `${previous.source.text}\n${line}`;
    }
    if (!name) continue;
    const uncertain = [
      !structured && "product identity",
      !parts[1] && "brand",
      !parts[2] && "variant",
      !size && "size",
      quantity === null && "quantity",
    ].filter((v): v is string => !!v);
    const unitPrice =
      amounts.length > 1 ? amounts[amounts.length - 2] : undefined;
    const lineTotal = amounts.at(-1);
    if (
      unitPrice !== undefined &&
      lineTotal !== undefined &&
      quantity !== null &&
      Math.abs(unitPrice * quantity - lineTotal) > 0.015
    )
      uncertain.push("price arithmetic");
    output.push({
      id: newId(),
      name: name.slice(0, 160),
      brand: structured ? parts[1].slice(0, 100) : "",
      variant: structured ? parts[2].slice(0, 100) : "",
      size: size.slice(0, 60),
      quantity,
      verified: 0,
      source: {
        text: sourceText.slice(0, 2000),
        line: sourceText.includes("\n") ? lineNumber - 1 : lineNumber,
        page,
        uncertain,
        unitPrice,
        lineTotal,
      },
    });
    if (output.length >= 200) break;
    inItems = true;
  }
  return output;
}
