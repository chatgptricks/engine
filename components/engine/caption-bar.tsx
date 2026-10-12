"use client";

import { useEffect, useRef, useState } from "react";
import { useEngine } from "@/lib/engine/store";
import { wordCount } from "@/lib/engine/util";
import type { Story } from "@/lib/engine/types";
import { CloseIcon, CopyIcon } from "./icons";

/**
 * Screen 2 — the caption bar. Fixed near the bottom, hovering over the
 * canvas, always reachable while the gallery scrolls behind it. The
 * textarea grows with content up to a max, then scrolls internally.
 * Edits persist to localStorage via the store; "reset to original"
 * restores the finder's draft.
 */
export function CaptionBar({
  story,
  onCollapse,
}: {
  story: Story;
  onCollapse?: () => void;
}) {
  const { effectiveCaption, setCaption, resetCaption, getCuration } = useEngine();
  const value = effectiveCaption(story);
  const edited = getCuration(story.id).captionEdited !== null;
  const ref = useRef<HTMLTextAreaElement>(null);
  const [copied, setCopied] = useState(false);

  // Grow to fit content up to the CSS max-height (220px), then scroll.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 220)}px`;
  }, [value]);

  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard blocked — no-op */
    }
  }

  return (
    <div className="gf-captionbar">
      <textarea
        ref={ref}
        className="gf-caption-textarea"
        value={value}
        spellCheck
        onChange={(e) => setCaption(story.id, e.target.value)}
        placeholder="Draft a caption…"
        aria-label="Caption"
      />
      <div className="gf-caption-foot">
        <span className="gf-caption-meta">
          {wordCount(value)} words · {value.length} chars
          {edited ? " · edited" : ""}
        </span>
        <div className="gf-caption-actions">
          {edited && (
            <button className="gf-btn" onClick={() => resetCaption(story.id)}>
              Reset to original
            </button>
          )}
          <button className="gf-btn gf-btn-icon" onClick={copy}>
            <CopyIcon />
            {copied ? "Copied" : "Copy"}
          </button>
          {onCollapse && (
            <button
              className="gf-btn gf-btn-icon"
              onClick={onCollapse}
              aria-label="Collapse caption"
              title="Collapse caption"
            >
              <CloseIcon size={14} />
              Collapse
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
