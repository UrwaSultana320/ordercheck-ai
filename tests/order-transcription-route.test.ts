import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const sdk = vi.hoisted(() => ({ create: vi.fn(), options: vi.fn() }));
vi.mock("openai", () => ({ default: class {
  constructor(options: unknown) { sdk.options(options); }
  audio = { transcriptions: { create: sdk.create } };
} }));
import { POST } from "../src/app/api/order-transcription/route";
import { maxOrderAudioBytes } from "../src/lib/order-audio";

const webm = new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 0, 0, 0, 0, 0, 0, 0, 0]);
const mp4 = new Uint8Array([0, 0, 0, 24, 102, 116, 121, 112, 109, 112, 52, 50]);
function request(file: Blob = new Blob([webm], { type: "audio/webm;codecs=opus" }), headers: Record<string, string> = {}) {
  const form = new FormData(); form.append("audio", file, "untrusted-name");
  return new Request("https://ordercheck.test/api/order-transcription", { method: "POST", body: form, headers: { origin: "https://ordercheck.test", ...headers } });
}
beforeEach(() => { vi.stubEnv("OPENAI_API_KEY", "test-only-not-a-real-key"); vi.clearAllMocks(); sdk.create.mockResolvedValue({ text: "I ordered from Shop I ordered two soaps" }); });
afterEach(() => vi.unstubAllEnvs());

describe("server-only order transcription route", () => {
  it.each([["audio/webm;codecs=opus", webm, "order.webm"], ["audio/mp4", mp4, "order.mp4"]] as const)("transcribes supported %s through the exact model with neutral English context", async (type, bytes, name) => {
    const response = await POST(request(new Blob([bytes], { type })));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({ text: "I ordered from Shop I ordered two soaps" });
    expect(sdk.options).toHaveBeenCalledWith({ apiKey: "test-only-not-a-real-key", timeout: 30000, maxRetries: 0 });
    const [body, options] = sdk.create.mock.calls[0];
    expect(body).toMatchObject({ model: "gpt-transcribe", languages: ["en"], file: expect.any(File) });
    expect(body).not.toHaveProperty("language");
    expect(body.file.name).toBe(name);
    expect(body.prompt).toContain("Pakistani English");
    expect(body.prompt).toContain("Do not invent missing information");
    expect(body.prompt).not.toMatch(/Daraz|Dove|Nescafe|JSON/i);
    expect(options.signal).toBeInstanceOf(AbortSignal);
  });
  it("returns an actionable missing-key error without constructing the SDK", async () => {
    vi.stubEnv("OPENAI_API_KEY", "");
    const response = await POST(request());
    expect(response.status).toBe(503);
    expect((await response.json()).error).toMatch(/OPENAI_API_KEY.*Preview.*redeploy/);
    expect(sdk.options).not.toHaveBeenCalled();
  });
  it.each(["https://other.test", "null", ""])("rejects a foreign or missing browser origin: %s", async origin => {
    expect((await POST(request(undefined, { origin }))).status).toBe(403);
    expect(sdk.create).not.toHaveBeenCalled();
  });
  it("rejects non-multipart, empty, unsupported and invalid audio without contacting OpenAI", async () => {
    const nonMultipart = new Request("https://ordercheck.test/api/order-transcription", { method: "POST", headers: { origin: "https://ordercheck.test" }, body: "invalid" });
    expect((await POST(nonMultipart)).status).toBe(415);
    expect((await POST(request(new Blob([], { type: "audio/webm" })))).status).toBe(400);
    expect((await POST(request(new Blob([webm], { type: "text/plain" })))).status).toBe(415);
    expect((await POST(request(new Blob(["wrong format"], { type: "audio/webm" })))).status).toBe(400);
    expect(sdk.create).not.toHaveBeenCalled();
  });
  it("rejects oversized files and declared oversized requests", async () => {
    expect((await POST(request(new Blob([new Uint8Array(maxOrderAudioBytes + 1)], { type: "audio/webm" })))).status).toBe(413);
    expect((await POST(request(undefined, { "content-length": String(maxOrderAudioBytes * 2) }))).status).toBe(413);
    expect(sdk.create).not.toHaveBeenCalled();
  });
  it("bounds chunked requests that omit Content-Length", async () => {
    const stream = new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(maxOrderAudioBytes + 65537)); } });
    const r = new Request("https://ordercheck.test/api/order-transcription", { method: "POST", headers: { origin: "https://ordercheck.test", "content-type": "multipart/form-data; boundary=test" }, body: stream, duplex: "half" } as RequestInit);
    expect((await POST(r)).status).toBe(413);
    expect(sdk.create).not.toHaveBeenCalled();
  });
  it("handles malformed multipart without leaking exceptions", async () => {
    const r = new Request("https://ordercheck.test/api/order-transcription", { method: "POST", headers: { origin: "https://ordercheck.test", "content-type": "multipart/form-data; boundary=missing" }, body: "wrong" });
    expect((await POST(r)).status).toBe(400);
    expect(sdk.create).not.toHaveBeenCalled();
  });
  it.each([{ text: "" }, { text: "  " }, { text: 123 }, { text: "x".repeat(20001) }])("handles an empty or malformed provider response", async result => {
    sdk.create.mockResolvedValue(result);
    const response = await POST(request());
    expect([422, 502]).toContain(response.status);
    expect(await response.json()).toHaveProperty("error");
  });
  it("reports API failure without exposing the key, audio or raw exception", async () => {
    sdk.create.mockRejectedValue(new Error("private provider payload and key"));
    const log = vi.spyOn(console, "log"), error = vi.spyOn(console, "error");
    const response = await POST(request());
    expect(response.status).toBe(502);
    const body = await response.text();
    expect(body).toContain("transcription service could not transcribe");
    expect(body).not.toContain("private provider payload");
    expect(body).not.toContain("test-only-not-a-real-key");
    expect(log).not.toHaveBeenCalled(); expect(error).not.toHaveBeenCalled();
    log.mockRestore(); error.mockRestore();
  });
});
