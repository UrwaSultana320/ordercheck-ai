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
  const command = text
    .toLowerCase()
    .trim()
    .replace(/[.!?]+$/, "");
  return (
    (
      [
        "start",
        "stop",
        "repeat",
        "next",
        "help",
        "retry",
        "read my orders",
        "read the result again",
        "go back",
        "stop speaking",
        "yes another unit",
        "no retry this unit",
      ] as Command[]
    ).find((c) => c === command) ?? null
  );
}
export function commandAllowed(command: Command, state: SessionState) {
  if (command === "yes another unit" || command === "no retry this unit")
    return state === "needs-clarification";
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
