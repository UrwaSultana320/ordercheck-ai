import type { Worker } from "tesseract.js";
const abortError = () => new DOMException("Cancelled", "AbortError");
export class OcrReader {
  private worker: Worker | null = null;
  private pending: Promise<Worker> | null = null;
  private generation = 0;
  private working = false;
  async read(source: File | string | HTMLCanvasElement) {
    if (this.working) throw new Error("A label is already being read.");
    this.working = true;
    const generation = this.generation;
    try {
      if (!this.pending)
        this.pending = import("tesseract.js").then(({ createWorker }) =>
          createWorker("eng"),
        );
      const worker = await this.pending;
      if (generation !== this.generation) throw abortError();
      this.worker = worker;
      const started = performance.now();
      const { data } = await worker.recognize(source);
      if (generation !== this.generation) throw abortError();
      return {
        text: data.text,
        confidence: data.confidence,
        elapsedMs: Math.round(performance.now() - started),
      };
    } catch (error) {
      if (generation === this.generation) this.close();
      throw error;
    } finally {
      if (generation === this.generation) this.working = false;
    }
  }
  close() {
    this.generation++;
    this.working = false;
    const worker = this.worker,
      pending = this.pending;
    this.worker = null;
    this.pending = null;
    if (worker) void worker.terminate().catch(() => {});
    else if (pending) void pending.then((w) => w.terminate()).catch(() => {});
  }
}
export async function readImage(source: File | string) {
  const reader = new OcrReader();
  try {
    return await reader.read(source);
  } finally {
    reader.close();
  }
}
export async function readImport(
  file: File,
  signal?: AbortSignal,
): Promise<string> {
  if (!file.size)
    throw new Error(
      "This file is empty. Paste purchase text or choose another file.",
    );
  if (file.size > 10 * 1024 * 1024)
    throw new Error("Choose a file smaller than 10 MB.");
  const check = () => {
    if (signal?.aborted) throw abortError();
  };
  check();
  const bytes = new Uint8Array(await file.slice(0, 12).arrayBuffer());
  const signature = String.fromCharCode(...bytes);
  const reader = new OcrReader();
  const cancel = () => reader.close();
  signal?.addEventListener("abort", cancel, { once: true });
  try {
    check();
    if (file.type === "application/pdf") {
      if (!signature.startsWith("%PDF-"))
        throw new Error("The PDF content is invalid.");
      const pdfjs = await import("pdfjs-dist");
      check();
      pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";
      const task = pdfjs.getDocument({ data: await file.arrayBuffer() });
      const stop = () => {
        void task.destroy();
      };
      signal?.addEventListener("abort", stop, { once: true });
      try {
        const pdf = await task.promise;
        check();
        if (pdf.numPages > 20)
          throw new Error("Use a PDF with 20 pages or fewer.");
        const pages: string[] = [];
        for (let n = 1; n <= pdf.numPages; n++) {
          check();
          const page = await pdf.getPage(n);
          const content = await page.getTextContent();
          let text = content.items
            .map((i) =>
              "str" in i
                ? i.str + ("hasEOL" in i && i.hasEOL ? "\n" : " ")
                : "",
            )
            .join("");
          if (!text.trim()) {
            const viewport = page.getViewport({ scale: 1.5 });
            if (viewport.width * viewport.height > 12000000)
              throw new Error(
                "PDF page is too large. Use pages below 12 megapixels.",
              );
            const canvas = document.createElement("canvas");
            canvas.width = viewport.width;
            canvas.height = viewport.height;
            await page.render({
              canvas,
              canvasContext: canvas.getContext("2d")!,
              viewport,
            }).promise;
            text = (await reader.read(canvas)).text;
            canvas.width = canvas.height = 0;
          }
          pages.push(text);
          page.cleanup();
          if (pages.join("").length > 100000)
            throw new Error("Use a shorter order, below 100,000 characters.");
        }
        check();
        return pages.join("\n\f\n");
      } finally {
        signal?.removeEventListener("abort", stop);
        await task.destroy();
      }
    }
    if (["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
      const valid =
        file.type === "image/jpeg"
          ? bytes[0] === 255 && bytes[1] === 216
          : file.type === "image/png"
            ? bytes[0] === 137 && signature.slice(1, 4) === "PNG"
            : signature.startsWith("RIFF") && signature.endsWith("WEBP");
      if (!valid)
        throw new Error(
          "The image content does not match the selected file type.",
        );
      const bitmap = await createImageBitmap(file);
      try {
        if (bitmap.width * bitmap.height > 12000000)
          throw new Error("Use an image below 12 megapixels.");
        check();
        const result = await reader.read(file);
        check();
        return result.text;
      } finally {
        bitmap.close();
      }
    }
    if (
      file.type === "text/plain" ||
      (!file.type && /\.txt$/i.test(file.name))
    ) {
      const text = await file.text();
      check();
      if (text.length > 100000 || text.includes("\0"))
        throw new Error("Use plain text below 100,000 characters.");
      return text;
    }
    throw new Error("Use a PNG, JPEG, WebP, PDF or plain text file.");
  } finally {
    signal?.removeEventListener("abort", cancel);
    reader.close();
  }
}

// Ideal constraints permit lower-resolution devices to negotiate a usable stream.
export const deliveryCameraConstraints: MediaStreamConstraints = {
  video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 720 } },
  audio: false,
};
export async function focusCamera(track?: MediaStreamTrack) {
  try {
    const capabilities = track?.getCapabilities?.() as (MediaTrackCapabilities & { focusMode?: string[] }) | undefined;
    if (capabilities?.focusMode?.includes("continuous"))
      await track?.applyConstraints({ advanced: [{ focusMode: "continuous" } as MediaTrackConstraintSet] });
  } catch { /* Optional optics controls must never prevent scanning. */ }
}
