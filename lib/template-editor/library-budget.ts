// The API accepts a 12 MiB request, including the library/revision envelope.
// Reserve space for document hashes and operation metadata in patch requests.
export const MAX_SAVE_LIBRARY_BYTES = 12 * 1024 * 1024 - 64 * 1024;

export type LibraryBudgetResult =
  | { ok: true; bytes: number }
  | { ok: false; bytes: number | null; error: string };

/** Measure JSON as UTF-8 bytes, not JavaScript UTF-16 characters. */
export function checkLibrarySaveBudget(library: unknown): LibraryBudgetResult {
  try {
    const json = JSON.stringify(library);
    if (json === undefined) throw new Error("Missing library");
    if (json.length > 30 * 1024 * 1024) return {ok: false, bytes: new TextEncoder().encode(json).byteLength, error: "This workspace exceeds the 30 MB in-memory document limit and was not applied. Remove old items or large images."};
    const assets = new Map<string, string>();
    const packed = JSON.stringify(library, (key, value) => {
      if ((key === "src" || key === "url") && typeof value === "string" && value.startsWith("data:image/")) {
        if (!assets.has(value)) assets.set(value, String(assets.size).padStart(64, "0"));
        return `engine-asset:${assets.get(value)}`;
      }
      return value;
    });
    const wire = assets.size ? JSON.stringify({library: JSON.parse(packed), assets: Object.fromEntries([...assets].map(([asset, id]) => [id, asset]))}) : json;
    const bytes = new TextEncoder().encode(wire).byteLength;
    if (bytes > MAX_SAVE_LIBRARY_BYTES) {
      return {
        ok: false,
        bytes,
        error: "This change exceeds the 12 MB library limit and was not applied. Remove unused assets or designs, or use smaller images.",
      };
    }
    return { ok: true, bytes };
  } catch {
    return {
      ok: false,
      bytes: null,
      error: "This change could not be saved and was not applied. Try again or export a backup before reloading.",
    };
  }
}
