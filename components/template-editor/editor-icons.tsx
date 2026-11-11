import type { SVGProps } from "react";

export type EditorIconName = "select" | "hand" | "pen" | "nodes" | "text" | "fill" | "outline" | "photo" | "crop" | "position" | "effects" | "merge" | "group" | "unlock" | "span" | "more" | "lock" | "align-left" | "align-center" | "align-right" | "list" | "list-number" | "spacing" | "transparency";

/** One visual language for tools, property shortcuts, and their selected states. */
export function EditorIcon({ name, ...props }: SVGProps<SVGSVGElement> & { name: EditorIconName }) {
  const paths: Record<EditorIconName, string> = {
    select: "m5 3 14 9-7 1-3 7Z",
    hand: "M8 13V6a2 2 0 0 1 4 0v6-8a2 2 0 0 1 4 0v8-5a2 2 0 0 1 4 0v9c0 4-3 6-7 6h-1c-2 0-3-1-4-3l-4-6a2 2 0 0 1 3-2l1 2",
    pen: "m4 20 3-12 9-5 5 5-5 9-12 3Zm0 0 8-8m-2-8 10 10",
    nodes: "M5 5h14v14H5Zm-2-2h4v4H3Zm14 0h4v4h-4Zm0 14h4v4h-4ZM3 17h4v4H3Z",
    text: "M4 6V4h16v2M12 4v16m-4 0h8",
    fill: "m4 11 7-7 9 9-7 7-9-9Zm3-9 7 7M4 12h15m1 6 2 3h-4Z",
    outline: "M4 4h16v16H4Zm4 4h8v8H8Z",
    photo: "M3 4h18v16H3Zm0 12 5-5 5 5 3-3 5 5M16 8h.01",
    crop: "M6 2v16h16M2 6h16v16",
    position: "M4 3v18M8 6h12v5H8Zm0 9h8v4H8Z",
    effects: "m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5Z",
    merge: "M3 3h11v6h7v12H9v-7H3Z",
    group: "M3 8V3h5m8 0h5v5m0 8v5h-5m-8 0H3v-5M7 7h6v6H7Zm4 4h6v6h-6",
    unlock: "M8 10V7a4 4 0 0 1 8 0M5 10h14v11H5Zm7 4v3",
    span: "M2 4h9v16H2Zm11 0h9v16h-9ZM5 9h14v6H5Z",
    more: "M5 12h.01M12 12h.01M19 12h.01",
    lock: "M8 10V7a4 4 0 0 1 8 0v3M5 10h14v11H5Zm7 4v3",
    "align-left": "M4 6h16M4 10h10M4 14h16M4 18h10",
    "align-center": "M4 6h16M7 10h10M4 14h16M7 18h10",
    "align-right": "M4 6h16M10 10h10M4 14h16M10 18h10",
    list: "M9 6h11M9 12h11M9 18h11M4.5 6h.01M4.5 12h.01M4.5 18h.01",
    "list-number": "M10 6h10M10 12h10M10 18h10M4 4h1v4M4 14h2l-2 3h2",
    spacing: "M4 3v18M20 3v18M8 9l-2 3 2 3M16 9l2 3-2 3M9 12h6",
    transparency: "M4 4h16v16H4ZM4 4h4v4H4Zm8 0h4v4h-4ZM8 8h4v4H8Zm8 0h4v4h-4ZM4 12h4v4H4Zm8 0h4v4h-4Zm-4 4h4v4H8Zm8 0h4v4h-4Z",
  };
  return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.65" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}><path d={paths[name]} /></svg>;
}
