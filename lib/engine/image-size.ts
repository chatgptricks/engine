import sharp from "sharp";
import { publicHttpUrl } from "./public-url";

const MAX_IMAGE_BYTES = 12 * 1024 * 1024;

/** The upright pixel size of a public JPEG, PNG, WebP or GIF, or null when it
 * can't be fetched or read. Only a cancelled `signal` throws. */
export async function imageSize(address: string, signal?: AbortSignal, fetcher: typeof fetch = fetch): Promise<{ width: number; height: number } | null> {
  const url = publicHttpUrl(address);
  if (!url) return null;
  try {
    const timeout = AbortSignal.timeout(8000);
    const response = await fetcher(url, { headers: { "User-Agent": "EngineBot/1.0 (+https://github.com/chatgptricks/engine)", Accept: "image/*" }, redirect: "follow", signal: signal ? AbortSignal.any([signal, timeout]) : timeout });
    if (!response.ok || !/^image\/(jpeg|png|webp|gif)\b/i.test(response.headers.get("content-type") ?? "") || Number(response.headers.get("content-length") ?? 0) > MAX_IMAGE_BYTES) { await response.body?.cancel().catch(() => undefined); return null; }
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length > MAX_IMAGE_BYTES) return null;
    const { width = 0, height = 0, orientation } = await sharp(bytes).metadata();
    if (!width || !height) return null;
    // EXIF orientations 5 to 8 turn the picture a quarter, as browsers show it.
    return orientation && orientation >= 5 ? { width: height, height: width } : { width, height };
  } catch (error) {
    if (signal?.aborted) throw error;
    return null;
  }
}
