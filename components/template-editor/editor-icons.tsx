import type { SVGProps } from "react";

export type EditorIconName = "select" | "hand" | "pen" | "nodes" | "text" | "fill" | "outline" | "photo" | "crop" | "position" | "effects" | "merge" | "group" | "unlock" | "more";

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
    more: "M5 12h.01M12 12h.01M19 12h.01",
  };
  return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.65" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}><path d={paths[name]} /></svg>;
}
