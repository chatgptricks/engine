/** A photo or video look (media-looks.ts) as an SVG filter: one colour matrix, in sRGB like CSS filters.
 * The canvas puts it beside the picture; PNG and the PDF snapshot copy it with the DOM, and the MP4
 * export draws each video frame through it. */
export function LookFilter({ id, matrix }: { id: string; matrix: number[] }) {
  return <svg width="0" height="0" className="te-canvas-effect-defs" aria-hidden="true"><defs><filter id={id} x="0" y="0" width="100%" height="100%" colorInterpolationFilters="sRGB"><feColorMatrix type="matrix" values={matrix.join(" ")} /></filter></defs></svg>;
}
