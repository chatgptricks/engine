/** Reads a clip's length and picture size from its MP4/QuickTime header
 * (`moov` → `mvhd`, and the video track's `tkhd`), without decoding anything.
 * `read(offset, length)` returns up to `length` bytes at `offset`, so a file on
 * disk is read box by box and a clip with `moov` at the end costs two reads. */
export type Mp4Info = { duration: number; width: number; height: number; brand: string };
type Read = (offset: number, length: number) => Promise<Uint8Array>;

const MAX_MOOV_BYTES = 32 * 1024 * 1024;
const text = (bytes: Uint8Array, at: number) => String.fromCharCode(bytes[at], bytes[at + 1], bytes[at + 2], bytes[at + 3]);
const u32 = (bytes: Uint8Array, at: number) => ((bytes[at] << 24) >>> 0) + (bytes[at + 1] << 16) + (bytes[at + 2] << 8) + bytes[at + 3];
const u64 = (bytes: Uint8Array, at: number) => u32(bytes, at) * 2 ** 32 + u32(bytes, at + 4);
const s32 = (bytes: Uint8Array, at: number) => u32(bytes, at) | 0;

type Box = { type: string; start: number; size: number; header: number };
function boxes(bytes: Uint8Array, from: number, to: number): Box[] {
  const found: Box[] = [];
  let at = from;
  while (at + 8 <= to) {
    let size = u32(bytes, at), header = 8;
    if (size === 1) { if (at + 16 > to) break; size = u64(bytes, at + 8); header = 16; }
    else if (size === 0) size = to - at;
    if (size < header || at + size > to) break;
    found.push({ type: text(bytes, at + 4), start: at, size, header });
    at += size;
  }
  return found;
}
const child = (bytes: Uint8Array, parent: Box, type: string) => boxes(bytes, parent.start + parent.header, parent.start + parent.size).find(box => box.type === type);

/** The moov box's bytes and the file's brand, reading top-level box headers only. */
async function findMoov(read: Read, size: number): Promise<{ moov: Uint8Array; brand: string } | null> {
  let at = 0, brand = "";
  for (let count = 0; at + 8 <= size && count < 64; count++) {
    const head = await read(at, 16);
    if (head.length < 8) return null;
    let length = u32(head, 0), header = 8;
    if (length === 1) { if (head.length < 16) return null; length = u64(head, 8); header = 16; }
    else if (length === 0) length = size - at;
    const type = text(head, 4);
    if (length < header || at + length > size) return null;
    if (type === "ftyp" && head.length >= 12) brand = text(head, 8);
    if (type === "moov") {
      if (length > MAX_MOOV_BYTES) return null;
      const moov = await read(at, length);
      return moov.length === length ? { moov, brand } : null;
    }
    at += length;
  }
  return null;
}

export async function readMp4Info(read: Read, size: number): Promise<Mp4Info | null> {
  const found = await findMoov(read, size);
  if (!found) return null;
  const { moov, brand } = found;
  const root = boxes(moov, 0, moov.length)[0];
  if (!root || root.type !== "moov") return null;
  const mvhd = child(moov, root, "mvhd");
  if (!mvhd) return null;
  const body = mvhd.start + mvhd.header, version = moov[body];
  const timescale = version === 1 ? u32(moov, body + 20) : u32(moov, body + 12);
  const units = version === 1 ? u64(moov, body + 24) : u32(moov, body + 16);
  if (!timescale) return null;
  for (const trak of boxes(moov, root.start + root.header, root.start + root.size).filter(box => box.type === "trak")) {
    const mdia = child(moov, trak, "mdia"), hdlr = mdia && child(moov, mdia, "hdlr"), tkhd = child(moov, trak, "tkhd");
    if (!hdlr || !tkhd || text(moov, hdlr.start + hdlr.header + 8) !== "vide") continue;
    const start = tkhd.start + tkhd.header, matrix = start + (moov[start] === 1 ? 52 : 40);
    const width = u32(moov, matrix + 36) / 65536, height = u32(moov, matrix + 40) / 65536;
    // A phone clip filmed upright is stored sideways with a 90° matrix (a = 0, b = ±1).
    const turned = s32(moov, matrix) === 0 && Math.abs(s32(moov, matrix + 4)) === 65536;
    if (!width || !height) return null;
    return { duration: units / timescale, width: Math.round(turned ? height : width), height: Math.round(turned ? width : height), brand };
  }
  return null;
}

/** What kind of clip the first bytes say it is, or null for anything else. */
export function sniffVideo(head: Uint8Array): "video/mp4" | "video/quicktime" | "video/webm" | null {
  if (head.length >= 4 && head[0] === 0x1a && head[1] === 0x45 && head[2] === 0xdf && head[3] === 0xa3) return "video/webm";
  if (head.length >= 12 && text(head, 4) === "ftyp") return text(head, 8) === "qt  " ? "video/quicktime" : "video/mp4";
  return null;
}
