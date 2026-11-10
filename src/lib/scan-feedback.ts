import type { CheckState, Verdict } from "./engine";

const instruction = "Say “Next” to scan another product, or “Finish” if you're done.";
const spokenInstruction = "Move this product away. Say Next when you're ready to scan another product, or say Finish if you're done.";
const spokenSize = (size: string) => size.replace(/(\d+(?:\.\d+)?)\s*(ml|kg|g|l)\b/gi, (_, amount: string, unit: string) => {
  const name = ({ ml: "millilitre", kg: "kilogram", g: "gram", l: "litre" })[unit.toLowerCase()]!;
  return `${amount} ${name}${Number(amount) === 1 ? "" : "s"}`;
});
const compact = (parts: (string | undefined)[]) =>
  parts.map(part => part?.trim()).filter(Boolean).join(", ");
const displayCompact = (parts: (string | undefined)[]) =>
  parts.map(part => part?.trim()).filter(Boolean).join(" · ");

export function scanFeedback(verdict: Verdict, state: CheckState) {
  const item = state.orders
    .find(order => order.id === verdict.orderId)
    ?.items.find(item => item.id === verdict.itemId);
  const field = (name: string) =>
    verdict.fields?.find(field => field.field === name)?.observed;

  const receivedBrand =
    field("brand") ?? (verdict.status === "MATCH" ? item?.brand : undefined);
  const receivedName =
    field("name") ?? (verdict.status === "MATCH" ? item?.name : undefined);
  const receivedProduct = [receivedBrand, receivedName].filter(Boolean).join(" ");
  const receivedVariant =
    field("variant") ?? (verdict.status === "MATCH" ? item?.variant : "") ?? "";
  const receivedSize =
    field("size") ?? (verdict.status === "MATCH" ? item?.size : "") ?? "";
  const receivedDisplay = compact([
    receivedProduct || undefined,
    receivedVariant || undefined,
    receivedSize || undefined,
  ]);
  const receivedSpoken = compact([
    receivedProduct || undefined,
    receivedVariant || undefined,
    receivedSize ? spokenSize(receivedSize) : undefined,
  ]);

  const expectedProduct = item
    ? [item.brand, item.name].filter(Boolean).join(" ")
    : "";
  const expectedDisplay = item
    ? compact([
        expectedProduct || undefined,
        item.variant || undefined,
        item.size || undefined,
      ])
    : "";
  const expectedSpoken = item
    ? compact([
        expectedProduct || undefined,
        item.variant || undefined,
        item.size ? spokenSize(item.size) : undefined,
      ])
    : "";

  if (verdict.status !== "MATCH") {
    const mismatch = verdict.status === "MISMATCH";
    if (mismatch) {
      const lines = [
        expectedDisplay ? `Ordered: ${expectedDisplay}.` : "",
        receivedDisplay ? `Received: ${receivedDisplay}.` : "",
        "This product does not match the expected order item. Nothing was counted.",
      ].filter(Boolean);
      const comparison = [
        expectedSpoken ? `You ordered ${expectedSpoken}.` : "",
        receivedSpoken ? `You received ${receivedSpoken}.` : "",
      ].filter(Boolean).join(" ");
      const spoken = `Mismatch. ${comparison} This product does not match your order. Nothing was counted.`
        .replace(/\s+/g, " ")
        .trim();
      return {
        title: "Product does not match",
        product: receivedProduct,
        description: displayCompact([receivedVariant, receivedSize]),
        lines,
        spoken,
      };
    }

    const message = "I couldn't verify this product yet. Nothing was counted. Try again or show another side of the label.";
    return {
      title: "Unable to verify this product",
      product: "",
      description: "",
      lines: [message],
      spoken: message,
    };
  }

  const product = receivedProduct || expectedProduct;
  const variant = receivedVariant || item?.variant || "";
  const size = receivedSize || item?.size || "";
  const description = displayCompact([variant, size]);
  const received = item?.quantity != null
    ? `${item.verified} of ${item.quantity} received.`
    : "Product received. Ordered quantity is unknown.";
  const remaining = item?.quantity != null
    ? Math.max(0, item.quantity - item.verified)
    : null;
  const completion = remaining === null
    ? "Check the ordered quantity before finishing."
    : remaining === 0
      ? "This product is complete."
      : `${remaining} more ${remaining === 1 ? "is" : "are"} still expected.`;

  const matchedReceivedDisplay = receivedDisplay || compact([
    product || undefined,
    variant || undefined,
    size || undefined,
  ]);
  const matchedReceivedSpoken = receivedSpoken || compact([
    product || undefined,
    variant || undefined,
    size ? spokenSize(size) : undefined,
  ]);

  return {
    title: "Product scanned successfully",
    product,
    description,
    lines: [
      expectedDisplay ? `Ordered: ${expectedDisplay}.` : "",
      matchedReceivedDisplay ? `Received: ${matchedReceivedDisplay}.` : "",
      received,
      completion,
      instruction,
    ].filter(Boolean),
    spoken: `Match. ${expectedSpoken ? `You ordered ${expectedSpoken}. ` : ""}${matchedReceivedSpoken ? `You received ${matchedReceivedSpoken}. They match. ` : ""}${received} ${completion} ${spokenInstruction}`
      .replace(/\s+/g, " ")
      .trim(),
  };
}
