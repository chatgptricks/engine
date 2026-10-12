import { domToCanvas } from "modern-screenshot";

/**
 * Export a slide whose media is a VIDEO as a composited video file.
 *
 * Approach: the static layers are captured once as two stills — everything
 * UNDER the video (backgrounds, other collage slots) and everything OVER it
 * (text, gradients, scrims, credit) with a transparent backdrop — then the
 * <video> is drawn between them on a 1080×1350 canvas per frame.
 *
 * Encoding paths, fastest first:
 *  1. WebCodecs (VideoEncoder + mp4-muxer): the clip is SEEKED frame by frame
 *     and encoded as fast as the encoder drains — several times faster than
 *     realtime, full clip length, exact frame times. H.264 MP4 out.
 *  2. Fallback (no WebCodecs): MediaRecorder over a live canvas stream —
 *     realtime, Safari→MP4 / Chromium→WebM.
 *
 * The video's on-screen geometry (box position/size, cover crop, inner
 * pan/zoom, clip radius, opacity) is read from the live export-frame DOM, so
 * whatever the curator styled is exactly what gets recorded.
 */

/** Layers that paint ABOVE the media in every template. */
const OVERLAY_SEL =
  ".gf-tpl-text,.gf-tpl-grad,.gf-tpl-darken,.gf-tpl-credit,.gf-tpl-stacktext,.gf-tpl-blurcap,.gf-tpl-quotebody,.gf-tpl-coverhead";
/** Media-ish layers (the video's own box plus other slots + backgrounds). */
const MEDIA_SEL =
  ".gf-tpl-mediabox,.gf-tpl-medialayer,.gf-tpl-splithalf,.gf-tpl-slot,.gf-tpl-card,.gf-tpl-bcard,.gf-tpl-blurbg,.gf-tpl-blurtint,.gf-tpl-bgfill";

function inSel(n: Node, sel: string): boolean {
  return n instanceof Element && (n.matches(sel) || n.closest(sel) !== null);
}

/** Nearest ancestor that clips (overflow hidden) — the video's visible box. */
function clipAncestor(video: HTMLVideoElement): HTMLElement {
  let el: HTMLElement | null = video.parentElement;
  while (el) {
    const o = getComputedStyle(el).overflow;
    if (o.includes("hidden") || o.includes("clip")) return el;
    el = el.parentElement;
  }
  return video.parentElement ?? video;
}

export interface SlideVideoResult {
  blob: Blob;
  ext: string;
  /** Human-readable note about whether the clip's audio made it in — shown in
   * the UI so a silent export is explainable without the dev console. */
  audioNote?: string;
}

/** Set by the audio demux so the export can surface WHY a clip came out
 * silent (single export runs at a time, so a module-level value is fine). */
let lastAudioReason = "no audio";

export async function exportSlideVideo(
  frame: HTMLElement,
  opts: {
    width?: number;
    height?: number;
    fps?: number;
    maxSeconds?: number;
    onProgress?: (fraction: number) => void;
  } = {},
): Promise<SlideVideoResult> {
  const width = opts.width ?? 1080;
  const height = opts.height ?? 1350;
  const fps = opts.fps ?? 30;
  // Full clip length by default; the cap is only a runaway-safety wall.
  const maxSeconds = opts.maxSeconds ?? 600;

  // The FOCAL video — never the blurred background copy. Card templates
  // (blur / stacked) render a full-frame `.gf-tpl-blurbg` video BEFORE the
  // card's own video, so a plain querySelector("video") grabbed the background
  // and composited that full-frame instead of the designed card (the "video
  // reverts to its original layout" bug).
  const video =
    frame.querySelector<HTMLVideoElement>("video:not(.gf-tpl-blurbg)") ??
    frame.querySelector("video");
  if (!video) throw new Error("This slide has no video.");
  if (video.readyState < 2) {
    await new Promise<void>((res, rej) => {
      video.addEventListener("loadeddata", () => res(), { once: true });
      video.addEventListener("error", () => rej(new Error("Video failed to load.")), {
        once: true,
      });
    });
  }

  const frameRect = frame.getBoundingClientRect();
  const S = width / (frameRect.width || 1);
  const clip = clipAncestor(video);

  // ── Static layers (captured once) ──
  // UNDER: everything except overlays and the video's own clip box.
  const under = await domToCanvas(frame, {
    scale: S,
    backgroundColor: "#000",
    filter: (n: Node) =>
      !(n instanceof Element) || (!inSel(n, OVERLAY_SEL) && n !== clip),
  });
  // OVER: only the overlay layers, on transparency. The structural containers
  // we keep (the frame, template root) carry OPAQUE backgrounds — e.g. the
  // frame is solid black, the cover template is cream — which modern-screenshot
  // would paint, masking the video underneath (the "only the detail text
  // exported" bug). So strip the background off every element that ISN'T an
  // overlay (or inside one) for the duration of this capture, then restore.
  // Overlay elements keep their own paint (gradients, scrims, credit chip).
  const stripped: Array<[HTMLElement, string, string]> = [];
  frame.querySelectorAll<HTMLElement>("*").forEach((el) => {
    if (el.matches(OVERLAY_SEL) || el.closest(OVERLAY_SEL)) return;
    stripped.push([el, el.style.backgroundColor, el.style.backgroundImage]);
    el.style.backgroundColor = "transparent";
    el.style.backgroundImage = "none";
  });
  const frameBg = frame.style.backgroundColor;
  const frameBgImg = frame.style.backgroundImage;
  frame.style.backgroundColor = "transparent";
  frame.style.backgroundImage = "none";
  let over: HTMLCanvasElement;
  try {
    over = await domToCanvas(frame, {
      scale: S,
      backgroundColor: undefined,
      filter: (n: Node) => {
        if (!(n instanceof Element)) return true;
        if (inSel(n, MEDIA_SEL)) return false;
        if (inSel(n, OVERLAY_SEL)) return true;
        // keep structural containers that hold overlays
        return n.querySelector(OVERLAY_SEL) !== null || n === frame;
      },
    });
  } finally {
    frame.style.backgroundColor = frameBg;
    frame.style.backgroundImage = frameBgImg;
    for (const [el, bc, bi] of stripped) {
      el.style.backgroundColor = bc;
      el.style.backgroundImage = bi;
    }
  }

  // ── Video geometry, read from the live DOM ──
  const cs = getComputedStyle(video);
  const m = new DOMMatrixReadOnly(cs.transform === "none" ? undefined : cs.transform);
  const sc = m.a || 1; // our inner zoom is a pure scale
  const [opxRaw, opyRaw] = (cs.objectPosition || "50% 50%").split(" ");
  const opx = parseFloat(opxRaw) / 100 || 0;
  const opy = parseFloat(opyRaw) / 100 || 0;
  const vRect = video.getBoundingClientRect(); // transformed bounds
  // Un-transform to recover the layout box (scale happens about the
  // object-position point, matching the slide editor's zoom).
  const bw = vRect.width / sc;
  const bh = vRect.height / sc;
  const oxPx = opx * bw;
  const oyPx = opy * bh;
  const bx = vRect.left - oxPx * (1 - sc) - frameRect.left;
  const by = vRect.top - oyPx * (1 - sc) - frameRect.top;
  const cRect = clip.getBoundingClientRect();
  const clipX = cRect.left - frameRect.left;
  const clipY = cRect.top - frameRect.top;
  const clipR = parseFloat(getComputedStyle(clip).borderRadius) || 0;
  // Effective opacity along the chain (clip box × video).
  let alpha = 1;
  for (let el: HTMLElement | null = video; el && el !== frame; el = el.parentElement) {
    alpha *= Number(getComputedStyle(el).opacity) || 1;
  }

  const drawVideo = (ctx: CanvasRenderingContext2D) => {
    const vw = video.videoWidth || 1;
    const vh = video.videoHeight || 1;
    // cover-fit into the layout box, placed by object-position…
    const f0 = Math.max(bw / vw, bh / vh);
    const dw0 = vw * f0;
    const dh0 = vh * f0;
    const dx0 = (bw - dw0) * opx;
    const dy0 = (bh - dh0) * opy;
    // …then scaled about the object-position point.
    const ox = bx + oxPx;
    const oy = by + oyPx;
    const dx = ox + (bx + dx0 - ox) * sc;
    const dy = oy + (by + dy0 - oy) * sc;
    const dw = dw0 * sc;
    const dh = dh0 * sc;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.beginPath();
    if (typeof ctx.roundRect === "function") {
      ctx.roundRect(clipX * S, clipY * S, cRect.width * S, cRect.height * S, clipR * S);
    } else {
      ctx.rect(clipX * S, clipY * S, cRect.width * S, cRect.height * S);
    }
    ctx.clip();
    ctx.drawImage(video, dx * S, dy * S, dw * S, dh * S);
    ctx.restore();
  };

  const raw =
    Number.isFinite(video.duration) && video.duration > 0
      ? video.duration
      : maxSeconds;
  // The slide's trim window (set in the Layout panel) — MediaEl stamps it on
  // the element so the export renders exactly what the preview loops.
  const trimStart = Math.min(
    Math.max(0, Number(video.dataset.trimStart) || 0),
    Math.max(0, raw - 0.1),
  );
  const trimEndRaw = Number(video.dataset.trimEnd);
  const trimEnd =
    Number.isFinite(trimEndRaw) && trimEndRaw > trimStart
      ? Math.min(trimEndRaw, raw)
      : raw;
  const duration = Math.min(Math.max(0.1, trimEnd - trimStart), maxSeconds);

  // ── Primary: WebCodecs seek-and-encode (fast, never plays in real time, so
  // a large/networked clip can't stall it) + the clip's audio copied in ──
  if (typeof window !== "undefined" && "VideoEncoder" in window) {
    try {
      return await encodeWithWebCodecs({
        video,
        under,
        over,
        drawVideo,
        width,
        height,
        fps,
        duration,
        startAt: trimStart,
        onProgress: opts.onProgress,
      });
    } catch (err) {
      console.error(
        "[gf-export-video] WebCodecs path failed, falling back to realtime:",
        err,
      );
    }
  }

  // ── Fallback: realtime MediaRecorder (for browsers without WebCodecs) ──
  const mime =
    [
      "video/mp4;codecs=avc1,mp4a.40.2",
      "video/mp4",
      "video/webm;codecs=vp9,opus",
      "video/webm;codecs=vp8,opus",
      "video/webm",
    ].find(
      (t) => typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(t),
    ) ?? "";
  if (!mime) throw new Error("This browser can’t export video.");
  return recordRealtime({
    video,
    under,
    over,
    drawVideo,
    width,
    height,
    fps,
    duration,
    trimStart,
    mime,
    onProgress: opts.onProgress,
  });
}

/** Realtime capture: play the clip from the trim point and record the
 * composited canvas plus the clip's live audio (tapped into the recording, not
 * the speakers). Reliable sound across browsers; wall-clock duration. */
async function recordRealtime(args: {
  video: HTMLVideoElement;
  under: HTMLCanvasElement;
  over: HTMLCanvasElement;
  drawVideo: (ctx: CanvasRenderingContext2D) => void;
  width: number;
  height: number;
  fps: number;
  duration: number;
  trimStart: number;
  mime: string;
  onProgress?: (fraction: number) => void;
}): Promise<SlideVideoResult> {
  const { video, under, over, drawVideo, width, height, fps, duration, trimStart, mime } =
    args;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas unavailable.");

  const stream = canvas.captureStream(fps);

  // Tap the clip's audio into the recording. createMediaElementSource reroutes
  // the element's audio into the graph (so connecting only to the stream
  // destination keeps it silent to the user). The element must be unmuted for
  // the source to emit. CORS is already satisfied (crossOrigin on the video).
  let audioCtx: AudioContext | null = null;
  video.pause();
  video.loop = false;
  try {
    video.currentTime = trimStart;
  } catch {
    /* live streams — fine */
  }
  try {
    const Ctx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext;
    if (Ctx) {
      audioCtx = new Ctx();
      // Safari starts an AudioContext SUSPENDED until resumed — without this the
      // tapped audio (and the element's playback) can stall. Fire-and-forget.
      void audioCtx.resume().catch(() => {});
      video.muted = false;
      const srcNode = audioCtx.createMediaElementSource(video);
      const dest = audioCtx.createMediaStreamDestination();
      srcNode.connect(dest);
      for (const track of dest.stream.getAudioTracks()) stream.addTrack(track);
    } else {
      video.muted = true;
    }
  } catch (e) {
    console.error("[gf-export-video] audio tap failed, recording silent:", e);
    video.muted = true;
  }

  const rec = new MediaRecorder(stream, {
    mimeType: mime,
    videoBitsPerSecond: 10_000_000,
    audioBitsPerSecond: 128_000,
  });
  const chunks: Blob[] = [];
  rec.ondataavailable = (e) => {
    if (e.data.size > 0) chunks.push(e.data);
  };
  const stopped = new Promise<void>((res) => {
    rec.onstop = () => res();
  });

  await video.play().catch(() => {});
  rec.start(250);
  const t0 = performance.now();
  await new Promise<void>((resolve) => {
    let timer = 0;
    const tick = () => {
      // Never let a transient draw error (a stalled/seeking video frame) kill
      // the loop — that would orphan this Promise and freeze the export. Swallow
      // it; the next tick redraws. The loop only ends on the wall-clock
      // deadline (or the clip ending), so it ALWAYS terminates.
      let done = false;
      try {
        const elapsed = (performance.now() - t0) / 1000;
        ctx.drawImage(under, 0, 0, width, height);
        try {
          drawVideo(ctx);
        } catch {
          /* frame not ready this tick — keep the previous one */
        }
        ctx.drawImage(over, 0, 0, width, height);
        args.onProgress?.(Math.min(1, elapsed / duration));
        if (elapsed >= duration || video.ended) done = true;
      } catch {
        /* defensive: never throw out of the tick */
      }
      if (done) {
        resolve();
        return;
      }
      timer = window.setTimeout(tick, 1000 / fps);
    };
    timer = window.setTimeout(tick, 0);
    void timer;
  });
  rec.stop();
  video.pause();
  await stopped;
  if (audioCtx) await audioCtx.close().catch(() => {});

  const type = rec.mimeType || mime;
  return {
    blob: new Blob(chunks, { type }),
    ext: type.includes("mp4") ? "mp4" : "webm",
  };
}

interface DemuxedAudio {
  config: {
    codec: string;
    sampleRate: number;
    numberOfChannels: number;
    description?: Uint8Array;
  };
  chunks: Array<{
    data: Uint8Array;
    type: "key" | "delta";
    timestamp: number;
    duration: number;
  }>;
}

const AAC_RATES = [
  96000, 88200, 64000, 48000, 44100, 32000, 24000, 22050, 16000, 12000, 11025,
  8000, 7350,
];

/** Compute a standard AAC-LC AudioSpecificConfig from rate + channels. This is
 * what a decoder needs to play the track; computing it (rather than scraping it
 * out of the file's esds, which varies by encoder) makes playback reliable. */
function aacAsc(sampleRate: number, channels: number): Uint8Array {
  const objType = 2; // AAC-LC
  let idx = AAC_RATES.indexOf(sampleRate);
  if (idx < 0) idx = 4; // default 44.1k
  const ch = Math.min(Math.max(channels, 1), 7);
  return new Uint8Array([
    (objType << 3) | (idx >> 1),
    ((idx & 1) << 7) | (ch << 3),
  ]);
}

const AUDIO_LOG = "[gf-export-video audio]";

/**
 * Extract the source clip's COMPRESSED AAC audio for the trim window, by
 * demuxing the file (mp4box) — no decode to PCM, no re-encode. Copies the audio
 * bytes straight through, so it's memory-light AND works on Safari (no
 * AudioEncoder). The decoder config is COMPUTED (reliable) rather than scraped.
 * Fail-open: returns null for no-audio / non-AAC / fetch or parse failure (the
 * export stays silent), logging the reason so silent exports are diagnosable.
 */
async function demuxAudioChunks(
  url: string,
  startAt: number,
  duration: number,
): Promise<DemuxedAudio | null> {
  lastAudioReason = "no audio added";
  if (!url) {
    console.warn(`${AUDIO_LOG} no source url`);
    lastAudioReason = "no clip source";
    return null;
  }
  let ab: ArrayBuffer;
  try {
    const resp = await fetch(url);
    if (!resp.ok) {
      console.warn(`${AUDIO_LOG} fetch not ok (${resp.status})`);
      lastAudioReason = `couldn't read clip (HTTP ${resp.status})`;
      return null;
    }
    ab = await resp.arrayBuffer();
  } catch (e) {
    console.warn(`${AUDIO_LOG} fetch failed (CORS?):`, e);
    lastAudioReason = "couldn't read the clip's audio (CORS/network)";
    return null;
  }
  if (ab.byteLength > 400 * 1024 * 1024) {
    console.warn(`${AUDIO_LOG} source too large to demux:`, ab.byteLength);
    lastAudioReason = "clip too large to read audio";
    return null;
  }
  let MP4Box: { createFile: () => unknown };
  try {
    const mod = (await import("mp4box")) as unknown as {
      default?: { createFile: () => unknown };
      createFile?: () => unknown;
    };
    const factory = mod.default ?? mod;
    if (!factory.createFile) {
      console.warn(`${AUDIO_LOG} mp4box has no createFile`);
      lastAudioReason = "audio demuxer unavailable";
      return null;
    }
    MP4Box = factory as { createFile: () => unknown };
  } catch (e) {
    console.warn(`${AUDIO_LOG} mp4box import failed:`, e);
    lastAudioReason = "audio demuxer failed to load";
    return null;
  }
  return new Promise<DemuxedAudio | null>((resolve) => {
    let settled = false;
    const cleanups: Array<() => void> = [];
    const finish = (v: DemuxedAudio | null) => {
      if (settled) return;
      settled = true;
      for (const fn of cleanups) fn();
      resolve(v);
    };
    let config: DemuxedAudio["config"] | null = null;
    let expected = 0;
    let delivered = 0;
    let lastDelivered = -1;
    let stableTicks = 0;
    const chunks: DemuxedAudio["chunks"] = [];
    const mp4 = MP4Box.createFile() as {
      onReady?: (info: unknown) => void;
      onSamples?: (id: number, user: unknown, samples: unknown[]) => void;
      onError?: (e: unknown) => void;
      getTrackById: (id: number) => unknown;
      setExtractionOptions: (id: number, user: unknown, opts: unknown) => void;
      start: () => void;
      appendBuffer: (b: ArrayBuffer) => void;
      flush: () => void;
    };
    mp4.onError = (e) => {
      console.warn(`${AUDIO_LOG} mp4box parse error:`, e);
      finish(null);
    };
    mp4.onReady = (info) => {
      try {
        const at = (info as { audioTracks?: Array<Record<string, unknown>> })
          .audioTracks?.[0];
        if (!at) {
          console.warn(`${AUDIO_LOG} no audio track in the clip`);
          lastAudioReason = "source has no audio track";
          return finish(null);
        }
        const codec = String(at.codec ?? "");
        if (!/^mp4a/.test(codec)) {
          console.warn(`${AUDIO_LOG} audio codec not AAC, can't copy:`, codec);
          lastAudioReason = `audio is ${codec || "non-AAC"}, can't copy`;
          return finish(null);
        }
        const audio = at.audio as
          | { sample_rate?: number; channel_count?: number }
          | undefined;
        const sampleRate = audio?.sample_rate ?? 48000;
        const numberOfChannels = audio?.channel_count ?? 2;
        expected = Number(at.nb_samples) || 0;
        config = {
          codec,
          sampleRate,
          numberOfChannels,
          description: aacAsc(sampleRate, numberOfChannels),
        };
        mp4.setExtractionOptions(Number(at.id), null, { nbSamples: 1_000_000 });
        mp4.start();
      } catch (e) {
        console.warn(`${AUDIO_LOG} onReady failed:`, e);
        finish(null);
      }
    };
    mp4.onSamples = (_id, _user, samples) => {
      for (const raw of samples) {
        delivered++;
        const s = raw as {
          cts: number;
          duration: number;
          timescale: number;
          is_sync: boolean;
          data: Uint8Array;
        };
        const ts = s.cts / s.timescale;
        const dur = s.duration / s.timescale;
        if (ts + dur <= startAt) continue; // before the window
        if (ts >= startAt + duration) continue; // after the window
        chunks.push({
          data: s.data,
          type: s.is_sync ? "key" : "delta",
          timestamp: Math.round((ts - startAt) * 1_000_000),
          duration: Math.round(dur * 1_000_000),
        });
      }
      if (expected > 0 && delivered >= expected) {
        console.log(
          `${AUDIO_LOG} done: ${chunks.length} chunks in window (of ${delivered} samples), codec ${config?.codec}`,
        );
        finish(config && chunks.length ? { config, chunks } : null);
      }
    };
    // Completion watchdog (set up BEFORE appending so a sample-driven finish can
    // clear it): large files may deliver samples across ticks. Finish when
    // delivery stops advancing, so we never resolve early with an empty set or
    // leak a running interval.
    const poll = setInterval(() => {
      if (settled) {
        clearInterval(poll);
        return;
      }
      if (delivered === lastDelivered) {
        stableTicks++;
        if (stableTicks >= 4) {
          console.log(
            `${AUDIO_LOG} settled: ${chunks.length} chunks (${delivered}/${expected} samples)`,
          );
          finish(config && chunks.length ? { config, chunks } : null);
        }
      } else {
        stableTicks = 0;
        lastDelivered = delivered;
      }
    }, 120);
    cleanups.push(() => clearInterval(poll));
    const hardStop = setTimeout(() => {
      console.warn(
        `${AUDIO_LOG} hard timeout — using ${chunks.length} chunks gathered`,
      );
      finish(config && chunks.length ? { config, chunks } : null);
    }, 25_000);
    cleanups.push(() => clearTimeout(hardStop));
    try {
      (ab as ArrayBuffer & { fileStart?: number }).fileStart = 0;
      mp4.appendBuffer(ab);
      mp4.flush();
    } catch (e) {
      console.warn(`${AUDIO_LOG} append/flush failed:`, e);
      finish(null);
    }
  });
}

/** Seek-and-encode: step the clip frame by frame, composite, and feed the
 * hardware encoder as fast as it drains. Backpressure waits on the encoder's
 * `dequeue` event and seeks wait on `seeked` — no timers, so the pipeline is
 * immune to background-tab throttling and runs several × realtime. The source
 * clip's audio (trimmed to the same window) is muxed in as an AAC track. */
async function encodeWithWebCodecs(args: {
  video: HTMLVideoElement;
  under: HTMLCanvasElement;
  over: HTMLCanvasElement;
  drawVideo: (ctx: CanvasRenderingContext2D) => void;
  width: number;
  height: number;
  fps: number;
  duration: number;
  /** Trim offset: encoding starts at this source-clip time (output stays 0-based). */
  startAt: number;
  onProgress?: (fraction: number) => void;
}): Promise<SlideVideoResult> {
  const {
    video,
    under,
    over,
    drawVideo,
    width,
    height,
    fps,
    duration,
    startAt,
    onProgress,
  } = args;
  const { Muxer, ArrayBufferTarget } = await import("mp4-muxer");

  // Even dimensions are required by H.264.
  const W = width - (width % 2);
  const H = height - (height % 2);
  const config: VideoEncoderConfig = {
    codec: "avc1.640028", // H.264 High — broadly decodable, IG-friendly
    width: W,
    height: H,
    bitrate: 10_000_000,
    framerate: fps,
  };
  const support = await VideoEncoder.isConfigSupported(config);
  if (!support.supported) throw new Error("H.264 encoding unsupported here.");

  // ── Source audio: copy the clip's compressed AAC track (no decode/encode,
  // so it works on Safari and is memory-light), trimmed to the window ──
  const demuxed = await demuxAudioChunks(
    video.currentSrc || video.src,
    startAt,
    duration,
  );
  const useAudio = Boolean(demuxed && demuxed.chunks.length);
  const audioNote = useAudio ? "sound included" : lastAudioReason;
  console.log(
    `[gf-export-video] audio track: ${useAudio ? "ADDED" : "none — " + audioNote}`,
  );

  const muxer = new Muxer({
    target: new ArrayBufferTarget(),
    video: { codec: "avc", width: W, height: H },
    ...(useAudio && demuxed
      ? {
          audio: {
            codec: "aac" as const,
            numberOfChannels: demuxed.config.numberOfChannels,
            sampleRate: demuxed.config.sampleRate,
          },
        }
      : {}),
    fastStart: "in-memory",
  });
  let encodeError: unknown = null;
  const encoder = new VideoEncoder({
    output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
    error: (e) => {
      encodeError = e;
    },
  });
  encoder.configure(config);

  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas unavailable.");

  video.pause();
  video.muted = true;
  video.loop = false;
  // Seek to a frame and WAIT for it to actually decode. `seeked` fires once the
  // frame at the new time is available to drawImage. The earlier shortcut
  // (compare currentTime to the target right after assigning) resolved before
  // ANY decode — currentTime reflects the requested value immediately — so every
  // composited frame was blank. Now we always wait for `seeked`, with a timeout
  // fallback so a no-op seek (same time → no event) can't hang the loop.
  const seekTo = (t: number) =>
    new Promise<void>((res) => {
      const target = Math.min(
        Math.max(0, t),
        Math.max(0, (video.duration || t) - 1 / fps),
      );
      // No-op seek (already at this time): the frame is already decoded, so
      // draw immediately — `seeked` would never fire to release us. We compare
      // BEFORE assigning; the old code compared the just-assigned value to the
      // target (always equal) and so never waited for a real decode → blank.
      if (Math.abs(video.currentTime - target) < 1e-4) {
        res();
        return;
      }
      let settled = false;
      let timer = 0;
      const finish = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        video.removeEventListener("seeked", finish);
        res();
      };
      video.addEventListener("seeked", finish);
      // Generous safety only — a real seek fires `seeked` once the frame
      // decodes (well under this even on a throttled tab); the timeout exists
      // solely so a pathological missing event can't hang the encode loop.
      timer = window.setTimeout(finish, 4000);
      video.currentTime = target;
    });
  const drained = () =>
    new Promise<void>((res) => {
      if (encoder.encodeQueueSize <= 4) return res();
      const onDeq = () => {
        if (encoder.encodeQueueSize <= 4) {
          encoder.removeEventListener("dequeue", onDeq);
          res();
        }
      };
      encoder.addEventListener("dequeue", onDeq);
    });

  const totalFrames = Math.max(1, Math.round(duration * fps));
  for (let i = 0; i < totalFrames; i++) {
    if (encodeError) throw encodeError;
    const t = i / fps;
    await seekTo(startAt + t);
    ctx.drawImage(under, 0, 0, W, H);
    drawVideo(ctx);
    ctx.drawImage(over, 0, 0, W, H);
    const frame = new VideoFrame(canvas, {
      timestamp: Math.round(t * 1_000_000),
      duration: Math.round(1_000_000 / fps),
    });
    encoder.encode(frame, { keyFrame: i % (fps * 4) === 0 });
    frame.close();
    await drained();
    onProgress?.((i + 1) / totalFrames);
  }

  // Mux the copied audio chunks (raw compressed AAC + the source's decoder
  // config). Output timestamps are already 0-based to the trim window.
  if (useAudio && demuxed) {
    try {
      const meta = {
        decoderConfig: {
          codec: demuxed.config.codec,
          sampleRate: demuxed.config.sampleRate,
          numberOfChannels: demuxed.config.numberOfChannels,
          description: demuxed.config.description,
        },
      };
      const m = muxer as unknown as {
        addAudioChunkRaw: (
          data: Uint8Array,
          type: "key" | "delta",
          timestamp: number,
          duration: number,
          meta?: unknown,
        ) => void;
      };
      for (const c of demuxed.chunks) {
        m.addAudioChunkRaw(c.data, c.type, c.timestamp, c.duration, meta);
      }
    } catch (e) {
      console.error("[gf-export-video] audio mux failed, exporting silent:", e);
    }
  }

  await encoder.flush();
  muxer.finalize();
  if (encodeError) throw encodeError;
  const { buffer } = muxer.target as InstanceType<typeof ArrayBufferTarget>;
  return { blob: new Blob([buffer], { type: "video/mp4" }), ext: "mp4", audioNote };
}
