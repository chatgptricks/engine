import {imageResolution} from "./property-utils";

/** Export rendered snapshots, with preflight and cancellable downloads. */
export function saveBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob), anchor = document.createElement("a");
  anchor.href = url; anchor.download = name; document.body.appendChild(anchor); anchor.click(); anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}
export const fileName = (name: string) => name.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 80) || "design";
export type ExportFormat = "png" | "jpeg" | "webp" | "pdf" | "svg";
export interface ExportOptions {
  format?: ExportFormat;
  /** Pixels per canonical canvas pixel; 3 gives a 1080 px wide post. */
  scale?: number; quality?: number; transparent?: boolean; backgroundColor?: string;
  signal?: AbortSignal; onWarnings?: (warnings: string[]) => void;
}
export function validateExportOptions(options: ExportOptions = {}) {
  const format = options.format ?? "png", scale = options.scale ?? 3, quality = options.quality ?? .92;
  if (!["png", "jpeg", "webp", "pdf", "svg"].includes(format)) throw new Error("Choose a supported export format.");
  if (!Number.isFinite(scale) || scale < .25 || scale > 24) throw new Error("Export scale must be between 0.25 and 24.");
  if (!Number.isFinite(quality) || quality < .1 || quality > 1) throw new Error("Export quality must be between 10% and 100%.");
  return {format, scale, quality, transparent: Boolean(options.transparent && format !== "jpeg" && format !== "pdf")};
}
async function bounded<T>(task: Promise<T>, signal?: AbortSignal, timeout = 20_000): Promise<T> {
  signal?.throwIfAborted();
  let timer: ReturnType<typeof setTimeout> | undefined, abort: (() => void) | undefined;
  try { return await Promise.race([task, new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("Export timed out while loading artwork. Try again when images and fonts are available.")), timeout);
    abort = () => reject(signal?.reason ?? new DOMException("Export cancelled", "AbortError"));
    signal?.addEventListener("abort", abort, {once: true});
  })]); } finally { clearTimeout(timer); if (abort) signal?.removeEventListener("abort", abort); }
}
export async function preflightFrames(frames: HTMLElement[], options: ExportOptions = {}): Promise<string[]> {
  if (!frames.length) throw new Error("No pages to export.");
  const {scale, format} = validateExportOptions(options);
  await bounded(document.fonts.ready, options.signal);
  const warnings: string[] = [];
  for (const [index, frame] of frames.entries()) {
    options.signal?.throwIfAborted();
    if (!frame.offsetWidth || !frame.offsetHeight || (format !== "svg" && frame.offsetWidth * frame.offsetHeight * scale * scale > 40_000_000) || Math.max(frame.offsetWidth, frame.offsetHeight) * scale > 16384) throw new Error(`Page ${index + 1} exceeds the export pixel limit. Choose a smaller scale.`);
    for (const img of Array.from(frame.querySelectorAll("img"))) {
      try { await bounded(img.decode(), options.signal, 15_000); }
      catch (cause) { options.signal?.throwIfAborted(); throw new Error(`Page ${index + 1} has an image that could not load. Replace it and try again.`, {cause}); }
      if (!img.naturalWidth || !img.naturalHeight) throw new Error(`Page ${index + 1} has an empty image.`);
      const texture = img.dataset?.engineTexturePreload === "true", textureId = img.dataset?.engineTextureId;
      const layer = texture ? img.closest<HTMLElement>("[data-element-id]") : null;
      const painted = texture ? textureId === "whole" ? layer?.querySelector<HTMLElement>(".te-canvas-text") : Array.from(layer?.querySelectorAll<HTMLElement>("[data-texture-id]") ?? []).find(node => node.dataset.textureId === textureId) : img;
      // Hidden texture preloads validate readiness; their visible text/range
      // supplies the raster size, rather than their zero-size loading node.
      if (!painted) continue;
      const style = getComputedStyle(painted);
      const width = Number.parseFloat(style.width) || painted.offsetWidth, height = Number.parseFloat(style.height) || painted.offsetHeight;
      const fit = texture ? img.dataset.engineImageFit : style.objectFit;
      let zoom = texture ? Number(img.dataset.engineImageCropScale) || 1 : 1, node: HTMLElement | null = painted;
      // Ignore rotations/flip while measuring the true painted raster scale;
      // nested crop zoom is the only additional scale in the canvas renderer.
      while (node && node !== frame) {
        const transform = getComputedStyle(node).transform;
        if (transform && transform !== "none") {
          const matrix = new DOMMatrixReadOnly(transform);
          zoom *= Math.max(Math.hypot(matrix.a, matrix.b), Math.hypot(matrix.c, matrix.d));
        }
        node = node.parentElement;
      }
      if (width > 0 && height > 0 && imageResolution({width,height,intrinsicWidth:img.naturalWidth,intrinsicHeight:img.naturalHeight,cropScale:zoom,fit:fit === "contain" ? "contain" : "cover"},scale)?.low) warnings.push(`Page ${index + 1}: an image may look soft at this export resolution.`);
    }
  }
  return [...new Set(warnings)];
}
/** PDF 1.4 encoder with one RGB JPEG per page and exact byte offsets. */
export function encodeImagePdf(pages: {data: Uint8Array; width: number; height: number}[]): Blob {
  if (!pages.length) throw new Error("A PDF needs at least one page.");
  const encoder = new TextEncoder(), chunks: Uint8Array<ArrayBuffer>[] = [], offsets = [0];
  let length = 0;
  const append = (value: string | Uint8Array) => { const bytes = typeof value === "string" ? encoder.encode(value) : new Uint8Array(value); chunks.push(bytes); length += bytes.length; };
  const object = (id: number, body: string, stream?: Uint8Array) => {
    offsets[id] = length; append(`${id} 0 obj\n${body}`);
    if (stream) { append("\nstream\n"); append(stream); append("\nendstream"); } append("\nendobj\n");
  };
  append("%PDF-1.4\n%Engine\n");
  object(1, "<< /Type /Catalog /Pages 2 0 R >>");
  object(2, `<< /Type /Pages /Count ${pages.length} /Kids [${pages.map((_, i) => `${3 + i * 3} 0 R`).join(" ")}] >>`);
  pages.forEach((page, index) => {
    const id = 3 + index * 3;
    object(id, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${page.width} ${page.height}] /Resources << /XObject << /Im0 ${id + 1} 0 R >> >> /Contents ${id + 2} 0 R >>`);
    object(id + 1, `<< /Type /XObject /Subtype /Image /Width ${page.width} /Height ${page.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${page.data.length} >>`, page.data);
    const content = encoder.encode(`q ${page.width} 0 0 ${page.height} 0 0 cm /Im0 Do Q`);
    object(id + 2, `<< /Length ${content.length} >>`, content);
  });
  const start = length;
  append(`xref\n0 ${offsets.length}\n0000000000 65535 f \n`);
  offsets.slice(1).forEach(offset => append(`${String(offset).padStart(10, "0")} 00000 n \n`));
  append(`trailer\n<< /Size ${offsets.length} /Root 1 0 R >>\nstartxref\n${start}\n%%EOF\n`);
  return new Blob(chunks, {type: "application/pdf"});
}
export async function exportFrames(frames: HTMLElement[], name: string, caption: string, progress: (value: number) => void, options: ExportOptions = {}) {
  const settings = validateExportOptions(options), warnings = await preflightFrames(frames, options);
  options.onWarnings?.(warnings); options.signal?.throwIfAborted();
  const {domToBlob, domToForeignObjectSvg} = await import("modern-screenshot"), outputs: Blob[] = [];
  const pdfPages: {data: Uint8Array; width: number; height: number}[] = [];
  const extension = settings.format === "jpeg" ? "jpg" : settings.format;
  for (let i = 0; i < frames.length; i++) {
    options.signal?.throwIfAborted();
    const width = Number.parseFloat(frames[i].style.width) || frames[i].offsetWidth, height = Number.parseFloat(frames[i].style.height) || frames[i].offsetHeight;
    const outputWidth = Math.round(width * settings.scale), outputHeight = Math.round(height * settings.scale);
    const capture = {
      width: (outputWidth + .000001) / settings.scale, height: (outputHeight + .000001) / settings.scale,
      scale: settings.scale, quality: settings.quality, type: settings.format === "pdf" ? "image/jpeg" : `image/${settings.format}`,
      backgroundColor: settings.transparent ? null : options.backgroundColor ?? "#ffffff",
      style: {backgroundColor: settings.transparent ? "transparent" : options.backgroundColor ?? "#ffffff"},
      onCloneEachNode: settings.transparent ? (node: Node) => { if (node instanceof HTMLElement && node.matches(".te-frame,.te-canvas-scene,.gf-tpl")) {node.style.background = "transparent"; node.style.backgroundImage = "none";} } : undefined,
      fetch: {placeholderImage: "", requestInit: {signal: options.signal}}, timeout: 15_000,
    };
    let blob: Blob;
    if (settings.format === "svg") {
      const svg = await bounded(domToForeignObjectSvg(frames[i], capture), options.signal, 60_000);
      svg.setAttribute("width", String(outputWidth)); svg.setAttribute("height", String(outputHeight));
      blob = new Blob([new XMLSerializer().serializeToString(svg)], {type: "image/svg+xml"});
    } else blob = await bounded(domToBlob(frames[i], capture), options.signal, 60_000);
    options.signal?.throwIfAborted();
    if (!blob.size) throw new Error(`Could not export page ${i + 1}.`);
    if (settings.format === "pdf") pdfPages.push({data: new Uint8Array(await blob.arrayBuffer()), width: outputWidth, height: outputHeight});
    else { if (blob.type !== `image/${settings.format}`) throw new Error(`This browser does not support ${settings.format.toUpperCase()} export. Choose PNG.`); outputs.push(blob); }
    progress(Math.round(((i + 1) / frames.length) * 90));
  }
  options.signal?.throwIfAborted();
  const base = fileName(name);
  if (settings.format === "pdf") saveBlob(encodeImagePdf(pdfPages), `${base}.pdf`);
  else if (outputs.length === 1) saveBlob(outputs[0], `${base}.${extension}`);
  else {
    const JSZip = (await import("jszip")).default, zip = new JSZip();
    outputs.forEach((blob, i) => zip.file(`${String(i + 1).padStart(2, "0")}-${base}.${extension}`, blob));
    if (caption.trim()) zip.file("caption.txt", caption.trim());
    if (warnings.length) zip.file("export-notes.txt", warnings.join("\n"));
    const blob = await zip.generateAsync({type: "blob"}, metadata => { options.signal?.throwIfAborted(); progress(90 + Math.round(metadata.percent / 10)); });
    options.signal?.throwIfAborted(); saveBlob(blob, `${base}.zip`);
  }
  progress(100);
}
