import { maxOrderAudioBytes, orderAudioExtension } from "../../../lib/order-audio";

export const runtime = "nodejs";
export const maxDuration = 60;

// Centralized language/context configuration; no expected shops or products.
const transcription = {
  model: "whisper-large-v3",
  language: "en",
  response_format: "json",
  prompt: "This is an e-commerce order spoken in Pakistani English. Preserve retailer names, brand names, product names, quantities, numbers, sizes, colours, flavours, shades, variants and product types exactly as spoken. Do not invent missing information.",
};
const maxBodyBytes = maxOrderAudioBytes + 64 * 1024;
const reply = (body: { error: string } | { text: string }, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });

/** Bound even chunked requests before parsing multipart data into memory. */
async function audioForm(request: Request): Promise<FormData | null> {
  if (!request.body) return null;
  const reader = request.body.getReader();
  const parts: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBodyBytes) { await reader.cancel(); return null; }
      parts.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const part of parts) { bytes.set(part, offset); offset += part.byteLength; }
  return new Response(bytes, { headers: { "Content-Type": request.headers.get("content-type")! } }).formData();
}

export async function POST(request: Request) {
  // Browser uploads must originate from this deployment. No permissive CORS.
  if (request.headers.get("origin") !== new URL(request.url).origin || request.headers.get("sec-fetch-site") === "cross-site") return reply({ error: "Start order recording from this OrderCheck page." }, 403);
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("multipart/form-data;")) return reply({ error: "Send an order audio recording." }, 415);
  const declaredLength = Number(request.headers.get("content-length"));
  if (declaredLength > maxBodyBytes) return reply({ error: "The recording is too large. Record a shorter order or type it below." }, 413);
  const key = process.env.GROQ_API_KEY;
  if (!key?.trim()) return reply({ error: "Order transcription is not configured for this Preview." }, 503);
  let audio: File;
  try {
    const form = await audioForm(request);
    if (!form) return reply({ error: "The recording is too large or missing. Record a shorter order or type it below." }, 413);
    const value = form.get("audio");
    if (!(value instanceof File) || form.getAll("audio").length !== 1 || !value.size) return reply({ error: "The recording is empty. Record your order again or type it below." }, 400);
    if (value.size > maxOrderAudioBytes) return reply({ error: "The recording is too large. Record a shorter order or type it below." }, 413);
    const extension = orderAudioExtension(value.type);
    if (!extension) return reply({ error: "The recorded audio format is unsupported. Use a browser that records WebM or MP4 audio, or type your order." }, 415);
    const head = new Uint8Array(await value.slice(0, 12).arrayBuffer());
    const valid = extension === "webm" ? head[0] === 0x1a && head[1] === 0x45 && head[2] === 0xdf && head[3] === 0xa3 : String.fromCharCode(...head.slice(4, 8)) === "ftyp";
    if (!valid) return reply({ error: "The audio content is invalid. Record your order again or type it below." }, 400);
    // Use our own filename, not user-supplied paths or extensions.
    audio = new File([value], `order.${extension}`, { type: value.type });
  } catch { return reply({ error: "Could not read the audio upload. Record your order again or type it below." }, 400); }
  const timeout = AbortSignal.timeout(30000);
  try {
    const body = new FormData();
    body.append("file", audio);
    for (const [name, value] of Object.entries(transcription)) body.append(name, value);
    const response = await fetch("https://api.groq.com/openai/v1/audio/transcriptions", {
      method: "POST",
      headers: { Authorization: `Bearer ${key.trim()}` },
      body,
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.any([request.signal, timeout]),
    });
    if (!response.ok) {
      // Only translate the HTTP status; never read, log or return provider errors.
      if (response.status === 401) return reply({ error: "Order transcription authentication failed." }, 502);
      if (response.status === 403) return reply({ error: "Order transcription access was denied." }, 502);
      if (response.status === 413) return reply({ error: "The recording is too large. Record a shorter order or type it below." }, 413);
      if (response.status === 429) return reply({ error: "Order transcription is temporarily rate limited. Retry shortly or type the order." }, 429);
      return reply({ error: "Order transcription is temporarily unavailable. Retry or type the order." }, 502);
    }
    let result: unknown;
    try { result = await response.json(); }
    catch (error) {
      if (timeout.aborted || request.signal.aborted) throw error;
      return reply({ error: "The transcription service returned an invalid response. Try again or type your order." }, 502);
    }
    if (!result || typeof result !== "object" || !("text" in result) || typeof result.text !== "string" || result.text.length > 20000) return reply({ error: "The transcription service returned an invalid response. Try again or type your order." }, 502);
    if (!result.text.trim()) return reply({ error: "No words were transcribed. Record your order again or type it below." }, 422);
    return reply({ text: result.text.trim() });
  } catch {
    // Never return exceptions, credentials, audio, transcripts or provider payloads.
    if (request.signal.aborted) return reply({ error: "Order transcription was cancelled." }, 499);
    if (timeout.aborted) return reply({ error: "Order transcription timed out. Retry or type the order." }, 504);
    return reply({ error: "Order transcription is temporarily unavailable. Retry or type the order." }, 502);
  }
}
