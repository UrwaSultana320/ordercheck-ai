let sequence = 0;
// Event IDs are not credentials. Keep manual workflows usable when secure-context
// randomUUID is unavailable; a monotonic suffix also separates same-tick events.
export function newId() {
  return typeof globalThis.crypto?.randomUUID === "function"
    ? globalThis.crypto.randomUUID()
    : `local-${Date.now().toString(36)}-${++sequence}-${Math.random().toString(36).slice(2)}`;
}
