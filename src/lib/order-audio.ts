/** Shared upload limits; keep the multipart request below Vercel's 4.5 MB cap. */
export const maxOrderAudioBytes = 4 * 1024 * 1024;
export const maxOrderRecordingMs = 60000;
export const orderAudioFormats = [
  "audio/webm;codecs=opus",
  "audio/webm",
  "audio/mp4;codecs=mp4a.40.2",
  "audio/mp4",
] as const;
export function orderAudioExtension(type: string): "webm" | "mp4" | null {
  const mime = type.split(";")[0].trim().toLowerCase();
  return mime === "audio/webm" ? "webm" : mime === "audio/mp4" ? "mp4" : null;
}
