export async function readImage(source: File | string) {
  const { createWorker } = await import("tesseract.js");
  const worker = await createWorker("eng");
  try {
    const { data } = await worker.recognize(source);
    return { text: data.text, confidence: data.confidence };
  } finally {
    await worker.terminate();
  }
}
export async function readImport(file: File): Promise<string> {
  if (file.size > 10 * 1024 * 1024)
    throw new Error("Choose a file smaller than 10 MB.");
  if (file.type === "application/pdf") {
    const pdfjs = await import("pdfjs-dist");
    pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";
    const task = pdfjs.getDocument({ data: await file.arrayBuffer() });
    const pdf = await task.promise;
    try {
      if (pdf.numPages > 20)
        throw new Error("Use a PDF with 20 pages or fewer.");
      const pages: string[] = [];
      for (let n = 1; n <= pdf.numPages; n++) {
        const page = await pdf.getPage(n);
        const content = await page.getTextContent();
        let text = content.items
          .map((i) =>
            "str" in i ? i.str + ("hasEOL" in i && i.hasEOL ? "\n" : " ") : "",
          )
          .join("");
        if (!text.trim()) {
          const viewport = page.getViewport({ scale: 1.5 });
          const canvas = document.createElement("canvas");
          canvas.width = viewport.width;
          canvas.height = viewport.height;
          await page.render({
            canvas,
            canvasContext: canvas.getContext("2d")!,
            viewport,
          }).promise;
          text = (await readImage(canvas.toDataURL("image/png"))).text;
        }
        pages.push(text);
      }
      return pages.join("\n");
    } finally {
      await task.destroy();
    }
  }
  if (["image/jpeg", "image/png", "image/webp"].includes(file.type))
    return (await readImage(file)).text;
  if (file.type === "text/plain" || file.name.endsWith(".txt"))
    return file.text();
  throw new Error("Use a PNG, JPEG, WebP, PDF or text file.");
}
