import type {Metadata} from "next";
import {notFound} from "next/navigation";
import {readRenderToken} from "@/lib/engine/render-tokens";
import {ENGINE_FONT_VARS} from "@/app/admin/(tool)/engine/fonts";
import {ExportFrame} from "./export-frame";
import "@/app/admin/(tool)/engine/engine.css";
import "@/app/admin/(tool)/engine/licensed-fonts.css";
import "@/components/template-editor/studio.css";

/**
 * Private slide render: one page of a design held under a short-lived token
 * (lib/engine/render-tokens.ts), prepared and drawn exactly as the editor's PNG
 * export does (./export-frame.tsx) and nothing else, for headless screenshots
 * (lib/engine/slide-render.ts). It reads no workspace data; private images and
 * their dimensions are served to the renderer by slide-render.ts, never here.
 */
export const dynamic = "force-dynamic";
export const metadata: Metadata = {title: "Engine · Slide render", robots: {index: false, follow: false}, referrer: "no-referrer"};

export default async function RenderPage({params}: {params: Promise<{token: string}>}) {
  const {token} = await params, entry = readRenderToken(token);
  if (!entry?.document.pages.some(page => page.id === entry.pageId)) notFound();
  // Smart text is measured inside .gf-root, whose classes carry the font variables.
  return (
    <div className={`gf-root te-root ${ENGINE_FONT_VARS}`} style={{position: "fixed", left: 0, top: 0, margin: 0, padding: 0}}>
      <ExportFrame design={entry.document} pageId={entry.pageId} />
    </div>
  );
}
