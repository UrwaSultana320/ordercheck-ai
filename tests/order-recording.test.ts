import { afterEach, describe, expect, it, vi } from "vitest";
import { RecordedOrderTranscription, type OrderRecordingHost } from "../src/lib/order-recording";
import { maxOrderAudioBytes } from "../src/lib/order-audio";

class FakeRecorder {
  static last: FakeRecorder;
  static supported = ["audio/webm;codecs=opus"];
  static data = new Blob([new Uint8Array([0x1a, 0x45, 0xdf, 0xa3])], { type: "audio/webm" });
  static isTypeSupported(type: string) { return this.supported.includes(type); }
  state = "inactive";
  mimeType: string;
  ondataavailable: ((event: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(_stream: MediaStream, options: MediaRecorderOptions) { FakeRecorder.last = this; this.mimeType = options.mimeType!; }
  start = vi.fn(() => { this.state = "recording"; });
  stop = vi.fn(() => { this.state = "inactive"; this.ondataavailable?.({ data: FakeRecorder.data }); this.onstop?.(); });
}
const providers: RecordedOrderTranscription[] = [];
function fixture() {
  FakeRecorder.supported = ["audio/webm;codecs=opus"];
  FakeRecorder.data = new Blob([new Uint8Array([0x1a, 0x45, 0xdf, 0xa3])], { type: "audio/webm" });
  const track = { stop: vi.fn() };
  const stream = { getTracks: () => [track] } as unknown as MediaStream;
  const microphone = vi.fn(async () => stream);
  const upload = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ text: "I ordered two soaps" }));
  const host: OrderRecordingHost = { microphone, recorder: FakeRecorder as unknown as typeof MediaRecorder, upload, active: () => true };
  const provider = new RecordedOrderTranscription(host); providers.push(provider);
  const events = { started: vi.fn(), transcribing: vi.fn(), complete: vi.fn(), error: vi.fn() };
  return { provider, events, track, microphone, upload, host, stream };
}
afterEach(() => { providers.splice(0).forEach(p => p.cancel()); vi.useRealTimers(); });

describe("bounded server-backed order recorder", () => {
  it("records once, releases the microphone before upload and returns only transcript text", async () => {
    const f = fixture(); f.provider.start(f.events);
    await vi.waitFor(() => expect(f.events.started).toHaveBeenCalledOnce());
    const rec = FakeRecorder.last;
    expect(rec.mimeType).toBe("audio/webm;codecs=opus"); expect(rec.start).toHaveBeenCalledWith(1000);
    const oldEnd = rec.onstop!;
    f.provider.stop(); f.provider.stop(); oldEnd();
    expect(f.track.stop).toHaveBeenCalledOnce();
    expect(f.events.transcribing).toHaveBeenCalledOnce();
    await vi.waitFor(() => expect(f.events.complete).toHaveBeenCalledExactlyOnceWith("I ordered two soaps"));
    expect(f.upload).toHaveBeenCalledOnce();
    const [url, options] = f.upload.mock.calls[0];
    expect(url).toBe("/api/order-transcription");
    expect(options).toMatchObject({ method: "POST", credentials: "same-origin", cache: "no-store", signal: expect.any(AbortSignal) });
    const file = (options!.body as FormData).get("audio") as File;
    expect(file.name).toBe("order.webm"); expect(file.type).toBe("audio/webm;codecs=opus");
    expect(f.events.error).not.toHaveBeenCalled();
  });
  it("uses supported MP4 for browsers that cannot record WebM", async () => {
    const f = fixture(); FakeRecorder.supported = ["audio/mp4"];
    f.provider.start(f.events); await vi.waitFor(() => expect(f.events.started).toHaveBeenCalledOnce());
    expect(FakeRecorder.last.mimeType).toBe("audio/mp4");
    f.provider.stop(); await vi.waitFor(() => expect(f.events.complete).toHaveBeenCalledOnce());
    expect(((f.upload.mock.calls[0][1]!.body as FormData).get("audio") as File).name).toBe("order.mp4");
  });
  it("offers typed fallback when recording or formats are unsupported without opening the microphone", () => {
    const f = fixture(); f.host.recorder = undefined; f.provider.start(f.events);
    expect(f.events.error).toHaveBeenLastCalledWith(expect.stringContaining("unavailable"));
    f.host.recorder = FakeRecorder as unknown as typeof MediaRecorder; FakeRecorder.supported = [];
    f.provider.start(f.events);
    expect(f.events.error).toHaveBeenLastCalledWith(expect.stringContaining("supported order audio format"));
    expect(f.microphone).not.toHaveBeenCalled();
  });
  it("handles microphone denial", async () => {
    const f = fixture(); f.microphone.mockRejectedValue(new DOMException("denied", "NotAllowedError"));
    f.provider.start(f.events); await vi.waitFor(() => expect(f.events.error).toHaveBeenCalledWith(expect.stringContaining("permission denied")));
    expect(f.upload).not.toHaveBeenCalled(); expect(f.events.started).not.toHaveBeenCalled();
  });
  it("releases a late permission stream after cancellation without recording or uploading", async () => {
    const f = fixture(); let resolve!: (stream: MediaStream) => void;
    f.microphone.mockImplementation(() => new Promise(r => { resolve = r; }));
    f.provider.start(f.events); f.provider.cancel(); resolve(f.stream);
    await vi.waitFor(() => expect(f.track.stop).toHaveBeenCalledOnce());
    expect(f.events.started).not.toHaveBeenCalled(); expect(f.events.complete).not.toHaveBeenCalled(); expect(f.upload).not.toHaveBeenCalled();
  });
  it("bounds permission waits and releases a stream arriving after timeout", async () => {
    vi.useFakeTimers(); const f = fixture(); let resolve!: (stream: MediaStream) => void;
    f.microphone.mockImplementation(() => new Promise(r => { resolve = r; }));
    f.provider.start(f.events); await vi.advanceTimersByTimeAsync(20001);
    expect(f.events.error).toHaveBeenCalledWith(expect.stringContaining("permission is taking too long"));
    resolve(f.stream); await vi.waitFor(() => expect(f.track.stop).toHaveBeenCalledOnce());
    expect(f.upload).not.toHaveBeenCalled();
  });
  it.each([0, maxOrderAudioBytes + 1])("rejects empty or oversized audio (%s bytes)", async size => {
    const f = fixture(); FakeRecorder.data = new Blob([new Uint8Array(size)], { type: "audio/webm" });
    f.provider.start(f.events); await vi.waitFor(() => expect(f.events.started).toHaveBeenCalledOnce()); f.provider.stop();
    expect(f.events.error).toHaveBeenCalledWith(expect.stringContaining(size ? "too large" : "empty"));
    expect(f.track.stop).toHaveBeenCalledOnce(); expect(f.upload).not.toHaveBeenCalled();
  });
  it("cancels recording, discards chunks and ignores late recorder events", async () => {
    const f = fixture(); f.provider.start(f.events); await vi.waitFor(() => expect(f.events.started).toHaveBeenCalledOnce());
    const rec = FakeRecorder.last, lateData = rec.ondataavailable!, lateEnd = rec.onstop!;
    rec.ondataavailable?.({ data: FakeRecorder.data }); f.provider.cancel();
    lateData({ data: FakeRecorder.data }); lateEnd();
    expect(f.track.stop).toHaveBeenCalledOnce(); expect(rec.state).toBe("inactive");
    expect(f.upload).not.toHaveBeenCalled(); expect(f.events.complete).not.toHaveBeenCalled();
  });
  it("aborts an in-flight upload and ignores its late transcription", async () => {
    const f = fixture(); let resolve!: (response: Response) => void;
    f.upload.mockImplementation(() => new Promise(r => { resolve = r; }));
    f.provider.start(f.events); await vi.waitFor(() => expect(f.events.started).toHaveBeenCalledOnce()); f.provider.stop();
    const signal = f.upload.mock.calls[0][1]!.signal!;
    f.provider.cancel(); expect(signal.aborted).toBe(true);
    resolve(Response.json({ text: "cancelled order" })); await Promise.resolve();
    expect(f.events.complete).not.toHaveBeenCalled(); expect(f.events.error).not.toHaveBeenCalled();
  });
  it("enforces the 60-second maximum without automatically opening another microphone", async () => {
    vi.useFakeTimers(); const f = fixture(); f.provider.start(f.events, 120000);
    await vi.waitFor(() => expect(f.events.started).toHaveBeenCalledOnce());
    await vi.advanceTimersByTimeAsync(60001);
    expect(f.events.complete).toHaveBeenCalledExactlyOnceWith("I ordered two soaps");
    await vi.advanceTimersByTimeAsync(60001);
    expect(f.microphone).toHaveBeenCalledOnce(); expect(f.upload).toHaveBeenCalledOnce(); expect(f.track.stop).toHaveBeenCalledOnce();
  });
  it("ignores cancellation while the response body is still being decoded", async () => {
    const f = fixture(); let resolve!: (body: unknown) => void;
    const response = Response.json({ text: "placeholder" });
    const json = vi.spyOn(response, "json").mockImplementation(() => new Promise(r => { resolve = r; }));
    f.upload.mockResolvedValue(response); f.provider.start(f.events);
    await vi.waitFor(() => expect(f.events.started).toHaveBeenCalledOnce()); f.provider.stop();
    await vi.waitFor(() => expect(json).toHaveBeenCalledOnce()); f.provider.cancel();
    resolve({ text: "cancelled late order" }); await Promise.resolve();
    expect(f.events.complete).not.toHaveBeenCalled(); expect(f.events.error).not.toHaveBeenCalled();
  });
  it.each([
    [() => Response.json({ error: "Order transcription is not configured for this Preview." }, { status: 503 }), "not configured"],
    [() => Response.json({ error: "Transcription API failed" }, { status: 502 }), "API failed"],
    [() => new Response("invalid json"), "malformed response"],
    [() => Response.json({ text: 5 }), "malformed response"],
    [() => Response.json({ text: " " }), "No words"],
  ])("surfaces server and malformed/empty response errors", async (response, message) => {
    const f = fixture(); f.upload.mockResolvedValue(response()); f.provider.start(f.events);
    await vi.waitFor(() => expect(f.events.started).toHaveBeenCalledOnce()); f.provider.stop();
    await vi.waitFor(() => expect(f.events.error).toHaveBeenCalledWith(expect.stringContaining(message)));
    expect(f.events.complete).not.toHaveBeenCalled(); expect(f.track.stop).toHaveBeenCalledOnce();
  });
  it("handles network failure and releases the microphone", async () => {
    const f = fixture(); f.upload.mockRejectedValue(new TypeError("network")); f.provider.start(f.events);
    await vi.waitFor(() => expect(f.events.started).toHaveBeenCalledOnce()); f.provider.stop();
    await vi.waitFor(() => expect(f.events.error).toHaveBeenCalledWith(expect.stringContaining("Check your connection")));
    expect(f.track.stop).toHaveBeenCalledOnce();
  });
  it("bounds both recorder finalization and stalled server responses", async () => {
    vi.useFakeTimers(); const f = fixture(); f.provider.start(f.events);
    await vi.waitFor(() => expect(f.events.started).toHaveBeenCalledOnce());
    FakeRecorder.last.stop.mockImplementation(() => { FakeRecorder.last.state = "inactive"; }); f.provider.stop();
    await vi.advanceTimersByTimeAsync(3001);
    expect(f.events.error).toHaveBeenCalledWith(expect.stringContaining("Recording could not finish"));
    const g = fixture(); g.upload.mockImplementation(() => new Promise(() => {})); g.provider.start(g.events);
    await vi.waitFor(() => expect(g.events.started).toHaveBeenCalledOnce()); g.provider.stop();
    await vi.advanceTimersByTimeAsync(45001);
    expect(g.events.error).toHaveBeenCalledWith(expect.stringContaining("Transcription timed out"));
    expect(g.upload.mock.calls[0][1]!.signal!.aborted).toBe(true);
  });
});
