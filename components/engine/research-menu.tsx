"use client";

import { useEffect, useMemo, useState } from "react";
import { useEngine } from "@/lib/engine/store";
import { POST_TYPES, recommendNextType } from "@/lib/engine/post-types";
import { SearchIcon } from "./icons";

/**
 * The top-right Research action. Reuses the dock filter menu's frosted popover
 * (the same `.gf-filter-menu` glass + `.gf-filter-opt` rows), just dropped down
 * from the button: a Recommended row that picks the next under-served Territory
 * vein, then every vein. Each choice runs the client research flow and returns
 * to the grid via onStarted.
 */
export function ResearchMenu({ onStarted }: { onStarted?: () => void }) {
  const { stories, startTypeResearch } = useEngine();
  const [open, setOpen] = useState(false);

  const recommended = useMemo(
    () => recommendNextType(stories.map((s) => s.postType)),
    [stories],
  );

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  function start(typeId: string) {
    setOpen(false);
    startTypeResearch(typeId);
    onStarted?.();
  }

  return (
    <div className="gf-research-trigger">
      <button
        className={`gf-topnav-btn${open ? " is-open" : ""}`}
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <SearchIcon size={15} />
        Research
      </button>
      {open && (
        <>
          <button
            className="gf-filter-backdrop"
            aria-label="Close research menu"
            onClick={() => setOpen(false)}
          />
          <div className="gf-filter-menu gf-menu-topright" role="menu">
            <div className="gf-filter-grouplabel">Research a new story</div>
            <button
              className="gf-filter-opt"
              role="menuitem"
              onClick={() => start(recommended.id)}
              title={`Recommended next: ${recommended.label}. ${recommended.blurb}`}
            >
              <span className="gf-filter-opt-label">Recommended</span>
              <span className="gf-filter-count">{recommended.label}</span>
            </button>
            <div className="gf-filter-sep" />
            {POST_TYPES.map((t) => (
              <button
                key={t.id}
                className="gf-filter-opt"
                role="menuitem"
                onClick={() => start(t.id)}
                title={t.blurb}
              >
                <span className="gf-filter-opt-label">{t.label}</span>
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
