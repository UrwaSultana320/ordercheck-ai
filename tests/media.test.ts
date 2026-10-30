import { afterEach, describe, it, expect, vi } from "vitest";
import { readImport, OcrReader } from "../src/lib/media";
const fake = vi.hoisted(() => ({
  recognize: vi.fn(),
  terminate: vi.fn().mockResolvedValue(undefined),
  create: vi.fn(),
}));
vi.mock("tesseract.js", () => ({ createWorker: fake.create }));
afterEach(() => vi.clearAllMocks());
describe("bounded media processing (mocked OCR)", () => {
  it("rejects empty, large, corrupt and unsupported files and honors cancellation", async () => {
    await expect(
      readImport(new File([], "empty.txt", { type: "text/plain" })),
    ).rejects.toThrow("empty");
    await expect(
      readImport(
        new File([new Uint8Array(11 * 1024 * 1024)], "large.txt", {
          type: "text/plain",
        }),
      ),
    ).rejects.toThrow("10 MB");
    await expect(
      readImport(new File(["not PDF"], "bad.pdf", { type: "application/pdf" })),
    ).rejects.toThrow("invalid");
    await expect(
      readImport(new File(["<script/>"], "bad.html", { type: "text/html" })),
    ).rejects.toThrow("Use a PNG");
    const abort = new AbortController();
    abort.abort();
    await expect(
      readImport(
        new File(["text"], "order.txt", { type: "text/plain" }),
        abort.signal,
      ),
    ).rejects.toMatchObject({ name: "AbortError" });
  });
  it("reuses one worker and rejects concurrent work", async () => {
    let finish!: (value: {
      data: { text: string; confidence: number };
    }) => void;
    fake.create.mockResolvedValue({
      recognize: fake.recognize,
      terminate: fake.terminate,
    });
    fake.recognize
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finish = resolve;
          }),
      )
      .mockResolvedValue({ data: { text: "label", confidence: 90 } });
    const reader = new OcrReader(),
      first = reader.read("image");
    await vi.waitFor(() => expect(fake.recognize).toHaveBeenCalled());
    await expect(reader.read("another")).rejects.toThrow("already");
    finish({ data: { text: "label", confidence: 90 } });
    await first;
    await reader.read("second");
    expect(fake.create).toHaveBeenCalledTimes(1);
    reader.close();
    expect(fake.terminate).toHaveBeenCalledTimes(1);
  });
  it("discards OCR returned after Stop", async () => {
    let finish!: (value: {
      data: { text: string; confidence: number };
    }) => void;
    fake.create.mockResolvedValue({
      recognize: fake.recognize,
      terminate: fake.terminate,
    });
    fake.recognize.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const reader = new OcrReader(),
      result = reader.read("image");
    const rejection = expect(result).rejects.toMatchObject({
      name: "AbortError",
    });
    await vi.waitFor(() => expect(fake.recognize).toHaveBeenCalled());
    reader.close();
    finish({ data: { text: "stale package", confidence: 99 } });
    await rejection;
  });
});
