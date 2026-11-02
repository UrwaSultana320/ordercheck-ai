import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const groqFetch = vi.fn();
import { POST } from "../src/app/api/order-transcription/route";
import { maxOrderAudioBytes } from "../src/lib/order-audio";

const webm = new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 0, 0, 0, 0, 0, 0, 0, 0]);
const mp4 = new Uint8Array([0, 0, 0, 24, 102, 116, 121, 112, 109, 112, 52, 50]);
function request(file: Blob = new Blob([webm], { type: "audio/webm;codecs=opus" }), headers: Record<string, string> = {}) {
  const form = new FormData(); form.append("audio", file, "untrusted-name");
  return new Request("https://ordercheck.test/api/order-transcription", { method: "POST", body: form, headers: { origin: "https://ordercheck.test", ...headers } });
}
beforeEach(() => {
  vi.stubEnv("GROQ_API_KEY", "test-only-not-a-real-key");
  vi.stubEnv("OPENAI_API_KEY", "");
  vi.stubGlobal("fetch", groqFetch);
  vi.clearAllMocks();
  groqFetch.mockResolvedValue(Response.json({ text: "I ordered from Shop I ordered two soaps" }));
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("server-only order transcription route", () => {
  it.each([["audio/webm;codecs=opus", webm, "order.webm"], ["audio/mp4", mp4, "order.mp4"]] as const)("transcribes supported %s through the exact model with neutral English context", async (type, bytes, name) => {
    const response = await POST(request(new Blob([bytes], { type })));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({ text: "I ordered from Shop I ordered two soaps" });
    expect(groqFetch).toHaveBeenCalledTimes(1);
    const [url, options] = groqFetch.mock.calls[0];
    expect(url).toBe("https://api.groq.com/openai/v1/audio/transcriptions");
    expect(options).toMatchObject({ method: "POST", headers: { Authorization: "Bearer test-only-not-a-real-key" }, cache: "no-store", redirect: "error" });
    const body = options.body as FormData;
    expect(body.get("model")).toBe("whisper-large-v3");
    expect(body.get("language")).toBe("en");
    expect(body.get("response_format")).toBe("json");
    const file = body.get("file") as File;
    expect(file.name).toBe(name);
    expect(file.type).toBe(type);
    expect(new Uint8Array(await file.arrayBuffer())).toEqual(bytes);
    expect(body.get("prompt")).toContain("Pakistani English");
    expect(body.get("prompt")).toContain("Do not invent missing information");
    expect(body.get("prompt")).not.toMatch(/Daraz|Dove|Nescafe|JSON/i);
    expect(options.signal).toBeInstanceOf(AbortSignal);
  });
  it("returns an actionable missing-key error without contacting Groq", async () => {
    vi.stubEnv("GROQ_API_KEY", "");
    const response = await POST(request());
    expect(response.status).toBe(503);
    expect((await response.json()).error).toBe("Order transcription is not configured for this Preview.");
    expect(groqFetch).not.toHaveBeenCalled();
  });
  it.each(["https://other.test", "null", ""])("rejects a foreign or missing browser origin: %s", async origin => {
    expect((await POST(request(undefined, { origin }))).status).toBe(403);
    expect(groqFetch).not.toHaveBeenCalled();
  });
  it("rejects non-multipart, empty, unsupported and invalid audio without contacting Groq", async () => {
    const nonMultipart = new Request("https://ordercheck.test/api/order-transcription", { method: "POST", headers: { origin: "https://ordercheck.test" }, body: "invalid" });
    expect((await POST(nonMultipart)).status).toBe(415);
    expect((await POST(request(new Blob([], { type: "audio/webm" })))).status).toBe(400);
    expect((await POST(request(new Blob([webm], { type: "text/plain" })))).status).toBe(415);
    expect((await POST(request(new Blob(["wrong format"], { type: "audio/webm" })))).status).toBe(400);
    expect(groqFetch).not.toHaveBeenCalled();
  });
  it("rejects oversized files and declared oversized requests", async () => {
    expect((await POST(request(new Blob([new Uint8Array(maxOrderAudioBytes + 1)], { type: "audio/webm" })))).status).toBe(413);
    expect((await POST(request(undefined, { "content-length": String(maxOrderAudioBytes * 2) }))).status).toBe(413);
    expect(groqFetch).not.toHaveBeenCalled();
  });
  it("bounds chunked requests that omit Content-Length", async () => {
    const stream = new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(maxOrderAudioBytes + 65537)); } });
    const r = new Request("https://ordercheck.test/api/order-transcription", { method: "POST", headers: { origin: "https://ordercheck.test", "content-type": "multipart/form-data; boundary=test" }, body: stream, duplex: "half" } as RequestInit);
    expect((await POST(r)).status).toBe(413);
    expect(groqFetch).not.toHaveBeenCalled();
  });
  it("handles malformed multipart without leaking exceptions", async () => {
    const r = new Request("https://ordercheck.test/api/order-transcription", { method: "POST", headers: { origin: "https://ordercheck.test", "content-type": "multipart/form-data; boundary=missing" }, body: "wrong" });
    expect((await POST(r)).status).toBe(400);
    expect(groqFetch).not.toHaveBeenCalled();
  });
  it.each([null, {}, { text: "" }, { text: "  " }, { text: 123 }, { text: "x".repeat(20001) }])("handles an empty or malformed provider response", async result => {
    groqFetch.mockResolvedValue(Response.json(result));
    const response = await POST(request());
    expect([422, 502]).toContain(response.status);
    expect(await response.json()).toHaveProperty("error");
  });
  it("rejects invalid provider JSON", async () => {
    groqFetch.mockResolvedValue(new Response("private invalid provider body"));
    const response = await POST(request());
    expect(response.status).toBe(502);
    expect(await response.text()).toContain("invalid response");
  });
  it.each([
    [401, 502, "authentication failed"],
    [403, 502, "access was denied"],
    [413, 413, "too large"],
    [429, 429, "temporarily rate limited"],
    [500, 502, "temporarily unavailable"],
    [503, 502, "temporarily unavailable"],
  ])("safely maps provider HTTP %s", async (providerStatus, status, message) => {
    const provider = new Response("private provider payload and key", { status: providerStatus });
    const read = vi.spyOn(provider, "text");
    groqFetch.mockResolvedValue(provider);
    const response = await POST(request());
    expect(response.status).toBe(status);
    const body = await response.text();
    expect(body).toContain(message);
    expect(body).not.toMatch(/private provider|test-only-not-a-real-key/);
    expect(read).not.toHaveBeenCalled();
    expect(groqFetch).toHaveBeenCalledOnce();
  });
  it("bounds a stalled provider request with the 30-second timeout", async () => {
    // Control the timeout signal without relying on Node's native timer clock.
    const controller = new AbortController();
    const timeout = vi.spyOn(AbortSignal, "timeout").mockReturnValue(controller.signal);
    groqFetch.mockImplementation((_url, options) => new Promise((_resolve, reject) => {
      options.signal.addEventListener("abort", () => reject(options.signal.reason), { once: true });
    }));
    const pending = POST(request());
    await vi.waitFor(() => expect(groqFetch).toHaveBeenCalledOnce());
    expect(timeout).toHaveBeenCalledWith(30000);
    controller.abort(new DOMException("private timeout", "TimeoutError"));
    const response = await pending;
    expect(response.status).toBe(504);
    expect(await response.text()).toContain("timed out");
  });
  it("propagates upload cancellation to Groq", async () => {
    const controller = new AbortController();
    const r = new Request(request(), { signal: controller.signal });
    groqFetch.mockImplementation((_url, options) => new Promise((_resolve, reject) => {
      options.signal.addEventListener("abort", () => reject(options.signal.reason), { once: true });
    }));
    const pending = POST(r);
    await vi.waitFor(() => expect(groqFetch).toHaveBeenCalledOnce());
    controller.abort();
    const response = await pending;
    expect(response.status).toBe(499);
    expect(await response.text()).toContain("cancelled");
  });
  it("reports API failure without exposing the key, audio or raw exception", async () => {
    groqFetch.mockRejectedValue(new Error("private provider payload and key"));
    const log = vi.spyOn(console, "log"), error = vi.spyOn(console, "error");
    const response = await POST(request());
    expect(response.status).toBe(502);
    const body = await response.text();
    expect(body).toContain("Order transcription is temporarily unavailable");
    expect(body).not.toContain("private provider payload");
    expect(body).not.toContain("test-only-not-a-real-key");
    expect(log).not.toHaveBeenCalled(); expect(error).not.toHaveBeenCalled();
    log.mockRestore(); error.mockRestore();
  });
});
