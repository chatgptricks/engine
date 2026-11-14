/**
 * Sound at another speed with its pitch kept (WSOLA: overlap-add of short windows, each nudged
 * to where it lines up with the one before), so a slide at 2× or 0.5× keeps a voice sounding
 * like itself, as the editor's `preservesPitch` playback does. Pure: plain sample arrays.
 */

/** `channels` (equal lengths) played `speed` times as fast: about length / speed samples each. */
export function stretchAudio(channels: Float32Array[], speed: number, sampleRate: number): Float32Array[] {
  const length = channels[0]?.length ?? 0;
  if (!length || !(speed > 0) || Math.abs(speed - 1) < 1e-6) return channels.map(channel => channel.slice());
  const outLength = Math.max(1, Math.round(length / speed));
  const size = Math.max(64, 2 * Math.round(sampleRate * 0.025)); // ~50 ms windows
  const hop = size / 2; // output hop: half-overlapping Hann windows sum to one
  const tolerance = Math.round(sampleRate * 0.012); // how far a window may move to line up
  const window = Float32Array.from({length: size}, (_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / size));
  const mono = new Float32Array(length);
  for (const channel of channels) for (let i = 0; i < length; i++) mono[i] += channel[i] / channels.length;
  const at = (signal: Float32Array, i: number) => (i >= 0 && i < signal.length ? signal[i] : 0);
  const out = channels.map(() => new Float32Array(outLength + size));
  const weight = new Float32Array(outLength + size);
  const lastStart = Math.max(0, length - size);
  let previous = 0;
  for (let k = 0; k * hop < outLength; k++) {
    let start = Math.min(lastStart, Math.round(k * hop * speed));
    if (k > 0) {
      // The window that best continues the last one: compare its first half with what
      // followed the last window in the input.
      const follow = previous + hop;
      let best = start, score = -Infinity;
      const from = Math.max(0, start - tolerance), to = Math.min(lastStart, start + tolerance);
      for (let candidate = from; candidate <= to; candidate += 2) {
        let sum = 0;
        for (let i = 0; i < hop; i += 8) sum += at(mono, candidate + i) * at(mono, follow + i);
        if (sum > score) { score = sum; best = candidate; }
      }
      start = best;
    }
    const offset = k * hop;
    for (let i = 0; i < size; i++) {
      const w = window[i];
      weight[offset + i] += w;
      for (let c = 0; c < channels.length; c++) out[c][offset + i] += w * at(channels[c], start + i);
    }
    previous = start;
  }
  return out.map(channel => {
    const result = channel.subarray(0, outLength);
    for (let i = 0; i < outLength; i++) if (weight[i] > 1e-3) result[i] /= Math.max(weight[i], 0.5);
    return result.slice();
  });
}
