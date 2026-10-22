/** Serialize JSON with bounded temporary strings. Large embedded images must
 * not force one workspace-sized string and UTF-8 buffer to coexist. */
export function* jsonTextChunks(input: unknown, chunkSize = 64 * 1024): Generator<string> {
  if (!Number.isSafeInteger(chunkSize) || chunkSize < 2) throw new RangeError("JSON chunks must contain at least two characters.");
  const ancestors = new Set<object>();
  const omitted = (value: unknown) => value === undefined || typeof value === "function" || typeof value === "symbol";
  function normalize(value: unknown, key: string): unknown {
    if (value !== null && (typeof value === "object" || typeof value === "bigint")) {
      const toJSON = (value as {toJSON?: unknown}).toJSON;
      if (typeof toJSON === "function") value = toJSON.call(value, key);
      if (value instanceof Number || value instanceof String || value instanceof Boolean ||
        (value !== null && typeof value === "object" && Object.getPrototypeOf(value) === BigInt.prototype)) {
        value = (value as {valueOf(): unknown}).valueOf();
      }
    }
    return value;
  }
  function boundary(value: string, end: number): number {
    const last = value.charCodeAt(end - 1), next = value.charCodeAt(end);
    return last >= 0xd800 && last <= 0xdbff && next >= 0xdc00 && next <= 0xdfff ? end - 1 : end;
  }
  function* quoted(value: string): Generator<string> {
    yield '"';
    for (let start = 0; start < value.length;) {
      const end = boundary(value, Math.min(value.length, start + chunkSize));
      yield JSON.stringify(value.slice(start, end)).slice(1, -1);
      start = end;
    }
    yield '"';
  }
  function* tokens(value: unknown): Generator<string> {
    if (typeof value === "string") { yield* quoted(value); return; }
    if (value === null || typeof value !== "object") {
      const encoded = JSON.stringify(value);
      if (encoded !== undefined) yield encoded;
      return;
    }
    if (ancestors.has(value)) throw new TypeError("Converting circular structure to JSON");
    ancestors.add(value);
    try {
      if (Array.isArray(value)) {
        yield "[";
        const length = value.length;
        for (let index = 0; index < length; index++) {
          if (index) yield ",";
          const child = normalize(value[index], String(index));
          if (omitted(child)) yield "null";
          else yield* tokens(child);
        }
        yield "]";
      } else {
        yield "{";
        let first = true;
        for (const key of Object.keys(value)) {
          const child = normalize((value as Record<string, unknown>)[key], key);
          if (omitted(child)) continue;
          if (!first) yield ",";
          first = false;
          yield* quoted(key);
          yield ":";
          yield* tokens(child);
        }
        yield "}";
      }
    } finally { ancestors.delete(value); }
  }
  let buffered = "";
  for (const token of tokens(normalize(input, ""))) {
    let start = 0;
    while (start < token.length) {
      const end = boundary(token, Math.min(token.length, start + chunkSize - buffered.length));
      if (end === start) { yield buffered; buffered = ""; continue; }
      buffered += token.slice(start, end);
      start = end;
      if (buffered.length === chunkSize) { yield buffered; buffered = ""; }
    }
  }
  if (buffered) yield buffered;
}

/** Backpressure keeps at most one bounded encoded chunk queued. Cancellation
 * closes the generator so it releases its reference to the workspace. */
export function jsonByteStream(input: unknown, chunkBytes = 64 * 1024): ReadableStream<Uint8Array> {
  if (!Number.isSafeInteger(chunkBytes) || chunkBytes < 6) throw new RangeError("JSON byte chunks must contain at least six bytes.");
  // A UTF-16 code unit produces at most three UTF-8 bytes; surrogate pairs are
  // kept together by jsonTextChunks and produce four bytes for two code units.
  const chunks = jsonTextChunks(input, Math.floor(chunkBytes / 3));
  const encoder = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      try {
        const next = chunks.next();
        if (next.done) controller.close();
        else controller.enqueue(encoder.encode(next.value));
      } catch (error) { controller.error(error); }
    },
    cancel() { chunks.return(undefined); },
  });
}
