"use client";

import {useEffect, useState} from "react";
import {DesignFrame, FRAME_WIDTH} from "@/components/template-editor/preview";
import {formatDimensions, type DesignDocument} from "@/lib/template-editor/model";
import {prepareSmartTextExport} from "@/lib/template-editor/smart-text";
import {prepareExportDimensions} from "@/lib/template-editor/export-dimensions";
import {assertDesignExportBudget} from "@/lib/template-editor/export-renditions";

/**
 * The editor's PNG export for one page (design-editor.tsx `startExport`):
 * smart text is fitted after fonts load and baked into fixed lines, image
 * dimensions are confirmed, the memory budget is checked, and only then is the
 * export frame mounted. When Export would refuse the page (text that does not
 * fit legibly, say), the frame shows the live canvas instead and carries the
 * reason in `data-export-error` for the renderer to report.
 *
 * One deliberate difference: a font file that fails to load (the licensed
 * faces are missing from a checkout without the font bundle) does not stop the
 * render. Text is fitted and baked with the fallback font the page actually
 * draws, and `data-missing-fonts` tells the renderer.
 */
let missingFonts = false;
/** Installed once for the page (React may run effects twice in development). */
function tolerateMissingFonts() {
  const fonts = document.fonts as FontFaceSet & {engineRenderTolerant?: true};
  if (fonts.engineRenderTolerant) return;
  fonts.engineRenderTolerant = true;
  const load = fonts.load.bind(fonts);
  fonts.load = (font, text) => load(font, text).catch(error => {
    if (error instanceof DOMException && error.name === "NetworkError") { missingFonts = true; return []; }
    throw error;
  });
}

export function ExportFrame({design, pageId}: {design: DesignDocument; pageId: string}) {
  const [prepared, setPrepared] = useState<{design: DesignDocument; error?: string; missingFonts?: boolean} | null>(null);
  useEffect(() => {
    const controller = new AbortController(), options = {format: "png"};
    tolerateMissingFonts();
    (async () => {
      try {
        const baked = await prepareExportDimensions(await prepareSmartTextExport(structuredClone(design), controller.signal, [pageId]), [pageId], options, controller.signal);
        controller.signal.throwIfAborted();
        assertDesignExportBudget(baked, options, [pageId]);
        setPrepared({design: baked, missingFonts});
      } catch (error) {
        if (!controller.signal.aborted) setPrepared({design, missingFonts, error: error instanceof Error ? error.message : "Export could not start."});
      }
    })();
    return () => controller.abort();
  }, [design, pageId]);
  const page = prepared?.design.pages.find(candidate => candidate.id === pageId);
  if (!prepared || !page) return null;
  return (
    <div data-engine-render={pageId} data-export-error={prepared.error} data-missing-fonts={prepared.missingFonts ? "" : undefined}>
      <DesignFrame design={prepared.design} page={page} outputScale={formatDimensions(prepared.design).width / FRAME_WIDTH} />
    </div>
  );
}
