import { z } from "zod";
import catalog from "../data/catalog.v1.json";
export const itemSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().trim().min(1).max(160),
    brand: z.string().trim().max(100),
    variant: z.string().trim().max(100),
    size: z.string().trim().max(60),
    quantity: z.number().int().min(1).max(999),
    verified: z.number().int().min(0).max(999),
    productId: z.string().optional(),
  })
  .refine(
    (i) => i.verified <= i.quantity,
    "Verified count exceeds ordered quantity",
  );
export const orderSchema = z.object({
  id: z.string().min(1),
  label: z.string().trim().min(1).max(120),
  items: z.array(itemSchema).min(1).max(200),
});
export const sessionSchema = z.array(orderSchema).max(100);
export type Item = z.infer<typeof itemSchema>;
export type Order = z.infer<typeof orderSchema>;
export type Evidence = { barcode?: string; text?: string; confidence?: number };
export type Verdict = {
  status: "MATCH" | "MISMATCH" | "CONFLICT" | "INCOMPLETE";
  message: string;
  orderId?: string;
  itemId?: string;
};
export const normalize = (s: string) =>
  s
    .toLowerCase()
    .replace(/(\d)\s+(?=[a-z])/g, "$1")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
const contains = (text: string, field: string) =>
  ` ${normalize(text)} `.includes(` ${normalize(field)} `);
export function verify(orders: Order[], evidence: Evidence): Verdict {
  if (!evidence.barcode && (!evidence.text || (evidence.confidence ?? 0) < 85))
    return {
      status: "INCOMPLETE",
      message:
        "Not enough reliable evidence. Hold the label steady in good light and scan again.",
    };
  const product = evidence.barcode
    ? catalog.products.find((p) => p.barcodes.includes(evidence.barcode!))
    : undefined;
  if (evidence.barcode && !product)
    return {
      status: "INCOMPLETE",
      message:
        "Barcode is not in the verified catalog. Read the full product label with OCR.",
    };
  if (product && evidence.text && (evidence.confidence ?? 0) >= 85) {
    const alternatives = catalog.products.filter(
      (p) =>
        p.id !== product.id && normalize(p.name) === normalize(product.name),
    );
    if (
      alternatives.some(
        (p) =>
          contains(evidence.text!, p.variant) &&
          !contains(evidence.text!, product.variant),
      )
    )
      return {
        status: "CONFLICT",
        message:
          "Barcode and label evidence disagree. Nothing was counted. Check the label again.",
      };
  }
  const all = orders.flatMap((o) => o.items.map((i) => ({ o, i })));
  if (!product && evidence.text) {
    const identities = catalog.products.filter((p) =>
      [p.name, p.brand, p.variant, p.size].every((v) =>
        contains(evidence.text!, v),
      ),
    );
    if (identities.length > 1)
      return {
        status: "CONFLICT",
        message:
          "The label contains conflicting product identities. Isolate one product and read its label again.",
      };
  }
  const compatible = all.filter(({ i }) =>
    product
      ? i.productId === product.id ||
        [i.name, i.brand, i.variant, i.size].every(
          (v, j) =>
            !!v &&
            normalize(v) ===
              normalize(
                [product.name, product.brand, product.variant, product.size][j],
              ),
        )
      : [i.name, i.brand, i.variant, i.size].every(
          (v) => !!v && contains(evidence.text!, v),
        ),
  );
  const candidates = compatible.filter(({ i }) => i.verified < i.quantity);
  if (candidates.length > 1)
    return {
      status: "CONFLICT",
      message:
        "This product matches more than one pending order line. Resolve the duplicate in Orders before scanning again.",
    };
  if (candidates.length === 1) {
    const { o, i } = candidates[0];
    return {
      status: "MATCH",
      message: `Match. ${i.brand} ${i.name}, ${i.variant}, ${i.size}. ${i.verified + 1} of ${i.quantity} verified in ${o.label}.`,
      orderId: o.id,
      itemId: i.id,
    };
  }
  if (compatible.length)
    return {
      status: "MISMATCH",
      message:
        "The ordered quantity of this product is already complete. Nothing was counted.",
    };
  if (!product && all.some(({ i }) => contains(evidence.text!, i.name)))
    return {
      status: "INCOMPLETE",
      message:
        "Product name detected, but brand, variant or size could not be confirmed. Scan the complete label.",
    };
  return product
    ? {
        status: "MISMATCH",
        message:
          "This identified product does not match any pending order. Nothing was counted.",
      }
    : {
        status: "INCOMPLETE",
        message:
          "Could not establish a complete product identity from this label. Read the full label and try again.",
      };
}
export function applyMatch(orders: Order[], result: Verdict): Order[] {
  if (result.status !== "MATCH") return orders;
  return orders.map((o) => ({
    ...o,
    items: o.items.map((i) =>
      o.id === result.orderId &&
      i.id === result.itemId &&
      i.verified < i.quantity
        ? { ...i, verified: i.verified + 1 }
        : i,
    ),
  }));
}
export function extractOrder(text: string): Item[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .filter(
      (line) =>
        !/^(order\s*#|total\b|subtotal\b|shipping\b|delivery\b|thank you\b)/i.test(
          line,
        ),
    )
    .slice(0, 200)
    .map((line) => {
      const parts = line.split("|").map((p) => p.trim());
      const quantityText =
        parts[4] ?? line.match(/(?:qty\s*:?\s*|\bx\s*)(\d+)\b/i)?.[1];
      const parsed = Number(quantityText);
      const quantity =
        Number.isInteger(parsed) && parsed >= 1 && parsed <= 999 ? parsed : 1;
      return {
        id: crypto.randomUUID(),
        name: parts[0].slice(0, 160),
        brand: parts[1]?.slice(0, 100) ?? "",
        variant: parts[2]?.slice(0, 100) ?? "",
        size:
          parts[3]?.slice(0, 60) ??
          line.match(/\b\d+(?:\.\d+)?\s*(?:kg|ml|g|l)\b/i)?.[0] ??
          "",
        quantity,
        verified: 0,
      };
    });
}
