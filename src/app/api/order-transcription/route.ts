import OpenAI from "openai";
import { maxOrderAudioBytes, orderAudioExtension } from "../../../lib/order-audio";

export const runtime = "nodejs";
export const maxDuration = 60;

// Centralized language/context configuration; no expected shops or products.
const transcription = {
  model: "gpt-transcribe",
  languages: ["en"],
  prompt: "This is an e-commerce shopping order dictated by a user speaking Pakistani English. Preserve retailer names, brand names, product names, quantities, numbers, sizes (ml, g, kg, L, oz), colours, flavours, shades, variants and product types exactly as spoken. Do not invent missing information.",
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
  const key = process.env.OPENAI_API_KEY;
  if (!key?.trim()) return reply({ error: "Order transcription is not configured. Add OPENAI_API_KEY to the Vercel project's Preview environment and redeploy the Preview. You can type your order meanwhile." }, 503);
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
  try {
    const client = new OpenAI({ apiKey: key, timeout: 30000, maxRetries: 0 });
    const result = await client.audio.transcriptions.create({ ...transcription, file: audio }, {
      signal: AbortSignal.any([request.signal, AbortSignal.timeout(30000)]),
    });
    if (typeof result.text !== "string" || result.text.length > 20000) return reply({ error: "The transcription service returned an invalid response. Try again or type your order." }, 502);
    if (!result.text.trim()) return reply({ error: "No words were transcribed. Record your order again or type it below." }, 422);
    return reply({ text: result.text.trim() });
  } catch {
    // Never return SDK exceptions, credentials, audio or provider payloads.
    return reply({ error: "The transcription service could not transcribe this recording. Check the server API key, model access and service availability, or type your order." }, 502);
  }
}
