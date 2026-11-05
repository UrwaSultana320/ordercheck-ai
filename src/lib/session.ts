export type SessionState =
  | "idle"
  | "awaiting-reference"
  | "requesting-permission"
  | "scanning"
  | "processing"
  | "announcing-result"
  | "awaiting-next-item"
  | "needs-clarification"
  | "paused"
  | "finished"
  | "error";
export type Command =
  | "start"
  | "stop"
  | "repeat"
  | "finish"
  | "next"
  | "help"
  | "retry"
  | "read my orders"
  | "read the result again"
  | "go back"
  | "stop speaking"
  | "yes another unit"
  | "no retry this unit";
export function commandFrom(text: string): Command | null {
  const phrase = text.toLowerCase()
    .replace(/[’']/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ").trim()
    .replace(/^(?:please |okay |ok )+/, "")
    .replace(/ please$/, "");
  const aliases: [Command, string[]][] = [
    ["stop speaking", ["stop speaking", "stop talking", "be quiet", "silence"]],
    ["stop", ["stop", "stop scanning", "stop scanner", "stop camera", "stop checking"]],
    ["start", ["start", "start scanning", "start scan", "start checking", "start checking delivery", "begin", "begin scanning"]],
    ["repeat", ["repeat", "repeat that", "say that again", "repeat again"]],
    ["next", ["next", "next product", "scan next", "scan next product", "continue", "continue scanning"]],
    ["finish", ["finish", "finish checking", "finish checking delivery", "finish delivery", "done", "im done", "i am done", "thats all", "that is all", "complete checking"]],
    ["retry", ["retry", "try again", "scan again"]],
    ...(["help", "read my orders", "read the result again", "go back", "yes another unit", "no retry this unit"] as Command[])
      .map((c): [Command, string[]] => [c, [c]]),
  ];
  return aliases.find(([, phrases]) => phrases.includes(phrase))?.[0] ?? null;
}
export function commandAllowed(command: Command, state: SessionState) {
  if (command === "yes another unit" || command === "no retry this unit")
    return state === "needs-clarification";
  if (command === "finish")
    return ["scanning", "awaiting-next-item", "needs-clarification"].includes(state);
  if (command === "retry" || command === "next")
    return [
      "awaiting-next-item",
      "needs-clarification",
      "finished",
      "error",
      "paused",
    ].includes(state);
  if (command === "start")
    return ![
      "requesting-permission",
      "scanning",
      "processing",
      "announcing-result",
    ].includes(state);
  return true;
}
// A changed image is only a presentation boundary, never proof of another physical unit.
export class PresentationGate {
  epoch = 0;
  private seen = new Set<string>();
  private prior: number[] | null = null;
  private moving = false;
  private stable = 0;
  sample(pixels: number[]) {
    if (!this.prior) {
      this.prior = pixels;
      return false;
    }
    const difference = this.prior
      ? pixels.reduce((n, v, i) => n + Math.abs(v - this.prior![i]), 0) /
        pixels.length
      : Infinity;
    this.prior = pixels;
    if (difference > 16) {
      this.moving = true;
      this.stable = 0;
    } else if (difference < 6) this.stable++;
    else this.stable = 0;
    if (this.moving && this.stable >= 3) {
      this.epoch++;
      this.seen.clear();
      this.moving = false;
    }
    return this.stable >= 3;
  }
  accept(identity: string) {
    if (this.seen.has(identity)) return false;
    this.seen.add(identity);
    return true;
  }
  next() {
    this.epoch++;
    this.seen.clear();
    this.stable = 0;
  }
}
