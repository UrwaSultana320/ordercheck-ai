import type { CheckState, Verdict } from "./engine";

const instruction = "Move this product away. Say “Next” or tap “Scan next product” when you're ready.";
const spokenInstruction = "Move this product away. Say Next when you are ready to scan another product.";
const spokenSize = (size: string) => size.replace(/(\d+(?:\.\d+)?)\s*(ml|kg|g|l)\b/gi, (_, amount: string, unit: string) => {
  const name = ({ ml: "millilitre", kg: "kilogram", g: "gram", l: "litre" })[unit.toLowerCase()]!;
  return `${amount} ${name}${Number(amount) === 1 ? "" : "s"}`;
});

// Presentation only: counts come from the existing recorded order state.
export function scanFeedback(verdict: Verdict, state: CheckState) {
  if (verdict.status !== "MATCH") {
    const mismatch = verdict.status === "MISMATCH";
    const message = mismatch
      ? "This product does not match the expected order item. Nothing was counted."
      : "I couldn't verify this product yet. Nothing was counted. Try again or show another side of the label.";
    return { title: mismatch ? "Product does not match" : "Unable to verify this product", product: "", description: "", lines: [message], spoken: message };
  }
  const item = state.orders.find(order => order.id === verdict.orderId)?.items.find(item => item.id === verdict.itemId);
  const field = (name: string) => verdict.fields?.find(field => field.field === name)?.observed;
  const product = [field("brand") ?? item?.brand, field("name") ?? item?.name].filter(Boolean).join(" ");
  const variant = field("variant") ?? item?.variant ?? "";
  const size = field("size") ?? item?.size ?? "";
  const description = [variant, size].filter(Boolean).join(" · ");
  const received = item?.quantity != null ? `${item.verified} of ${item.quantity} received.` : "Product received. Ordered quantity is unknown.";
  const remaining = item?.quantity != null ? Math.max(0, item.quantity - item.verified) : null;
  const completion = remaining === null ? "Check the ordered quantity before finishing." : remaining === 0 ? "This product is complete." : `${remaining} more ${remaining === 1 ? "is" : "are"} still expected.`;
  return {
    title: "Product scanned successfully", product, description,
    lines: [received, completion, instruction],
    spoken: `${[product, variant, spokenSize(size)].filter(Boolean).join(", ")} scanned successfully. ${received} ${completion} ${spokenInstruction}`,
  };
}
