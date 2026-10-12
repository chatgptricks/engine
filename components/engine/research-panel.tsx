"use client";

import { useEffect, useState } from "react";
import type { Rubric, Story } from "@/lib/engine/types";
import { verificationLabel } from "@/lib/engine/util";
import { CheckIcon, ChevronLeftIcon } from "./icons";

const RUBRIC_GATES: Array<{ key: keyof Rubric; label: string }> = [
  { key: "verification", label: "Verification" },
  { key: "specificity", label: "Specificity" },
  { key: "hiddenness", label: "Hiddenness" },
  { key: "synthesis", label: "Synthesis fit" },
  { key: "visual", label: "Visual evidence" },
  { key: "voice", label: "Voice survivability" },
];

/**
 * Screen 2 — research dossier (left). A visible frosted-glass pane,
 * collapsible (chevron) and resizable (drag the bar on its right edge).
 * The chosen width persists to localStorage so it survives refresh.
 */
const WIDTH_KEY = "gf-research-width";
const MIN = 280;
const MAX = 560;
const DEFAULT = 360;
const COLLAPSED = 64;

function loadWidth(): number | null {
  if (typeof window === "undefined") return null;
  try {
    const v = Number(window.localStorage.getItem(WIDTH_KEY));
    return Number.isFinite(v) && v >= MIN && v <= MAX ? v : null;
  } catch {
    return null;
  }
}

function saveWidth(w: number): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(WIDTH_KEY, String(Math.round(w)));
  } catch {
    /* noop */
  }
}

export function ResearchPanel({ story }: { story: Story }) {
  const [collapsed, setCollapsed] = useState(false);
  const [width, setWidth] = useState(DEFAULT);
  const [dragging, setDragging] = useState(false);
  const d = story.dossier;

  // Hydrate the saved width after mount (avoids SSR mismatch).
  useEffect(() => {
    const w = loadWidth();
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-shot hydration of a persisted UI width on mount
    if (w) setWidth(w);
  }, []);

  function onResizeDown(e: React.PointerEvent) {
    e.preventDefault();
    const startX = e.clientX;
    const startW = width;
    let lastW = startW;
    setDragging(true);
    document.body.style.userSelect = "none";

    function move(ev: PointerEvent) {
      lastW = Math.min(MAX, Math.max(MIN, startW + (ev.clientX - startX)));
      setWidth(lastW);
    }
    function up() {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      document.body.style.userSelect = "";
      setDragging(false);
      saveWidth(lastW);
    }
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }

  return (
    <div
      className={`gf-research-wrap${collapsed ? " is-collapsed" : ""}${
        dragging ? " is-dragging" : ""
      }`}
      style={{ width: collapsed ? COLLAPSED : width }}
    >
      <div className="gf-research">
        <button
          className="gf-research-toggle"
          onClick={() => setCollapsed((c) => !c)}
          aria-expanded={!collapsed}
          aria-label={collapsed ? "Expand research" : "Collapse research"}
        >
          <ChevronLeftIcon
            size={15}
            style={{ transform: collapsed ? "rotate(180deg)" : "none" }}
          />
          <span>Research</span>
        </button>

        {!collapsed && (
          <>
            <section className="gf-research-section">
              <div className="gf-research-label">Verified facts</div>
              {d.verifiedFacts.map((f, i) => (
                <div className="gf-fact" key={i}>
                  <span className="gf-fact-text">{f.fact}</span>
                  <div className="gf-fact-meta">
                    {f.sources.map((s, j) => (
                      <a
                        key={j}
                        className="gf-source-link"
                        href={s.url}
                        target="_blank"
                        rel="noreferrer"
                      >
                        {s.name}
                      </a>
                    ))}
                    {f.confirmedByTwo && (
                      <span className="gf-twomark">
                        <CheckIcon size={11} /> Two sources
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </section>

            {d.contestedPoints.length > 0 && (
              <section className="gf-research-section">
                <div className="gf-research-label">Contested or uncertain</div>
                {d.contestedPoints.map((c, i) => (
                  <div className="gf-contested" key={i}>
                    <div className="gf-contested-claim">{c.claim}</div>
                    <div className="gf-contested-handling">{c.handling}</div>
                  </div>
                ))}
              </section>
            )}

            {d.primarySources.length > 0 && (
              <section className="gf-research-section">
                <div className="gf-research-label">Primary sources reached</div>
                {d.primarySources.map((s, i) => (
                  <div className="gf-fact" key={i}>
                    <a
                      className="gf-source-link"
                      href={s.url}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {s.name}
                    </a>
                  </div>
                ))}
              </section>
            )}

            <section className="gf-research-section">
              <div className="gf-research-label">Verification checks</div>
              <span className="gf-pill" data-level={d.verificationStatus}>
                <i className="gf-pill-mark" aria-hidden />
                {verificationLabel(d.verificationStatus)}
              </span>
              {story.rubric && (
                <div className="gf-research-rubric">
                  {story.verdict && (
                    <div className="gf-research-sublabel">
                      Verdict · {story.verdict}
                    </div>
                  )}
                  {RUBRIC_GATES.map(({ key, label }) => {
                    const g = story.rubric![key];
                    if (!g) return null; // tolerate a partial rubric (missing gate)
                    return (
                      <div className="gf-gate" key={key}>
                        <span
                          className={`gf-gate-mark${g.pass ? " is-pass" : ""}`}
                          aria-hidden
                        >
                          {g.pass ? "✓" : "✕"}
                        </span>
                        <div className="gf-gate-body">
                          <span className="gf-gate-label">{label}</span>
                          {g.note && (
                            <span className="gf-gate-note">{g.note}</span>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </section>
          </>
        )}
      </div>

      {!collapsed && (
        <div
          className="gf-research-resize"
          onPointerDown={onResizeDown}
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize research panel"
        />
      )}
    </div>
  );
}
