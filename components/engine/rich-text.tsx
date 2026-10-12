"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { ENGINE_FONTS } from "@/app/admin/(tool)/engine/fonts";
import type { SlideStyle } from "@/lib/engine/types";

/**
 * Per-word rich text for slide text boxes. Double-click a heading/body on the
 * canvas to edit it in place; selecting words pops a floating toolbar with
 * font, weight, bold/italic/underline/strikethrough that style ONLY the
 * selection. The result is stored as a sanitized inline-HTML sidecar
 * (`headingHtml`/`bodyHtml`) next to the plain-text mirror, so everything
 * downstream (exports, thumbnails, defaults) keeps working.
 *
 * Styling mechanics: bold/italic/underline/strike use the browser's native
 * contentEditable commands (correct toggle semantics, e.g. unbolding an
 * inherited-bold heading). Font + weight wrap the selection manually via
 * Range.extractContents into clean spans (`.gf-font-<id>` / inline
 * font-weight) — execCommand("fontName") proved unreliable.
 */

export const RICH_WEIGHTS = [
  { value: 300, label: "Light" },
  { value: 400, label: "Regular" },
  { value: 500, label: "Medium" },
  { value: 600, label: "Semibold" },
  { value: 700, label: "Bold" },
  { value: 800, label: "Heavy" },
];

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/** Plain text of an HTML fragment (the mirror written next to the rich html). */
export function plainOfHtml(html: string): string {
  const div = document.createElement("div");
  div.innerHTML = html;
  return (div.textContent ?? "").replace(/\s+/g, " ").trim();
}

const KEEP_TAGS = new Set(["B", "STRONG", "I", "EM", "U", "S", "STRIKE", "BR"]);
const FONT_IDS = new Set(ENGINE_FONTS.map((f) => f.id));

/** Reduce arbitrary contentEditable output to our safe inline vocabulary:
 * b/strong/i/em/u/s/br plus spans carrying a palette font class or a
 * font-weight. Everything else is unwrapped (text preserved, wrapper gone). */
export function sanitizeRich(html: string): string {
  const root = document.createElement("div");
  root.innerHTML = html;

  const visit = (el: Element) => {
    for (const child of Array.from(el.children)) visit(child);
    const tag = el.tagName;
    if (KEEP_TAGS.has(tag)) {
      for (const a of Array.from(el.attributes)) el.removeAttribute(a.name);
      return;
    }
    if (tag === "FONT") {
      const face = el.getAttribute("face") ?? "";
      const span = document.createElement("span");
      if (face.startsWith("gff:") && FONT_IDS.has(face.slice(4))) {
        span.className = `gf-font-${face.slice(4)}`;
      } else if (face.startsWith("gfw:")) {
        const w = Number(face.slice(4));
        if (w >= 100 && w <= 900) span.style.fontWeight = String(w);
      }
      if (span.className || span.style.fontWeight) {
        while (el.firstChild) span.appendChild(el.firstChild);
        el.replaceWith(span);
      } else {
        unwrap(el);
      }
      return;
    }
    if (tag === "SPAN") {
      const cls = Array.from(el.classList).filter(
        (c) => c.startsWith("gf-font-") && FONT_IDS.has(c.slice(8)),
      );
      const weight = (el as HTMLElement).style.fontWeight;
      // Browsers express "unbold an inherited-bold heading" as font-weight:
      // normal — keep keywords as numbers.
      const w =
        weight === "normal" ? 400 : weight === "bold" ? 700 : Number(weight);
      const keepWeight = Boolean(weight) && w >= 100 && w <= 900;
      const ital = (el as HTMLElement).style.fontStyle;
      const deco = (el as HTMLElement).style.textDecorationLine ||
        (el as HTMLElement).style.textDecoration;
      if (cls.length === 0 && !keepWeight && !ital && !deco) {
        unwrap(el);
        return;
      }
      for (const a of Array.from(el.attributes)) el.removeAttribute(a.name);
      if (cls.length) el.className = cls[0];
      if (keepWeight) (el as HTMLElement).style.fontWeight = String(w);
      if (ital === "italic" || ital === "normal")
        (el as HTMLElement).style.fontStyle = ital;
      if (deco && /underline|line-through|none/.test(deco))
        (el as HTMLElement).style.textDecorationLine = deco;
      return;
    }
    unwrap(el);
  };
  for (const child of Array.from(root.children)) visit(child);
  return root.innerHTML;
}

function unwrap(el: Element) {
  const parent = el.parentNode;
  if (!parent) return;
  while (el.firstChild) parent.insertBefore(el.firstChild, el);
  parent.removeChild(el);
}

/* ────────────────────────── floating toolbar ────────────────────────── */

/** Wrap the current selection in a span carrying a palette font class or a
 * font-weight. Manual Range surgery (extractContents splits partially-selected
 * nodes correctly) — execCommand("fontName") proved unreliable. The same
 * property is stripped from descendants so the new value always wins. */
function applySpan(kind: "font" | "weight", value: string) {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return;
  const range = sel.getRangeAt(0);
  const span = document.createElement("span");
  if (kind === "font") span.className = `gf-font-${value}`;
  else span.style.fontWeight = value;

  const frag = range.extractContents();
  for (const inner of Array.from(frag.querySelectorAll("span"))) {
    if (kind === "font") {
      for (const c of Array.from(inner.classList))
        if (c.startsWith("gf-font-")) inner.classList.remove(c);
      if (!inner.className) inner.removeAttribute("class");
    } else {
      inner.style.fontWeight = "";
    }
  }
  span.appendChild(frag);
  range.insertNode(span);
  // Keep the words selected so the curator can stack more styling.
  sel.removeAllRanges();
  const nr = document.createRange();
  nr.selectNodeContents(span);
  sel.addRange(nr);
}

function RichToolbar({
  editEl,
  onApplied,
}: {
  editEl: HTMLElement;
  onApplied: () => void;
}) {
  const [rect, setRect] = useState<{ x: number; y: number } | null>(null);
  const barRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const update = () => {
      const sel = window.getSelection();
      if (
        !sel ||
        sel.rangeCount === 0 ||
        sel.isCollapsed ||
        !editEl.contains(sel.anchorNode) ||
        !editEl.contains(sel.focusNode)
      ) {
        setRect(null);
        return;
      }
      const r = sel.getRangeAt(0).getBoundingClientRect();
      if (r.width === 0 && r.height === 0) {
        setRect(null);
        return;
      }
      setRect({ x: r.left + r.width / 2, y: r.top });
    };
    document.addEventListener("selectionchange", update);
    window.addEventListener("scroll", update, true);
    window.addEventListener("resize", update);
    update();
    return () => {
      document.removeEventListener("selectionchange", update);
      window.removeEventListener("scroll", update, true);
      window.removeEventListener("resize", update);
    };
  }, [editEl]);

  // The selection collapses when a native <select> takes focus (Safari
  // especially) — snapshot it on pointerdown, restore before applying.
  const savedRange = useRef<Range | null>(null);
  const saveSel = () => {
    const sel = window.getSelection();
    if (sel && sel.rangeCount > 0 && !sel.isCollapsed)
      savedRange.current = sel.getRangeAt(0).cloneRange();
  };

  if (!rect || typeof document === "undefined") return null;

  const run = (fn: () => void) => {
    editEl.focus();
    const sel = window.getSelection();
    if (savedRange.current && (!sel || sel.isCollapsed)) {
      sel?.removeAllRanges();
      sel?.addRange(savedRange.current);
    }
    document.execCommand("styleWithCSS", false, "false");
    fn();
    onApplied();
  };
  const cmd = (name: string) => run(() => document.execCommand(name));

  const pos: CSSProperties = {
    left: rect.x,
    top: Math.max(8, rect.y - 44),
  };
  const btn = (label: ReactNode, name: string, title: string, cls = "") => (
    <button
      type="button"
      className={`gf-richbtn ${cls}`}
      title={title}
      onPointerDown={(e) => {
        e.preventDefault(); /* keep the selection */
        saveSel();
      }}
      onClick={() => cmd(name)}
    >
      {label}
    </button>
  );

  return createPortal(
    <div
      className="gf-richbar"
      style={pos}
      ref={barRef}
      onPointerDown={(e) => e.stopPropagation()}
    >
      {btn(<b>B</b>, "bold", "Bold (⌘B)")}
      {btn(<i>I</i>, "italic", "Italic (⌘I)")}
      {btn(<u>U</u>, "underline", "Underline (⌘U)")}
      {btn(<s>S</s>, "strikeThrough", "Strikethrough")}
      <span className="gf-richsep" aria-hidden />
      <select
        className="gf-richsel"
        aria-label="Selection font"
        title="Font for the selected words"
        defaultValue=""
        onPointerDown={(e) => {
          e.stopPropagation();
          saveSel();
        }}
        onChange={(e) => {
          const id = e.target.value;
          if (id) run(() => applySpan("font", id));
          e.target.value = "";
        }}
      >
        <option value="" disabled>
          Font
        </option>
        {ENGINE_FONTS.map((f) => (
          <option key={f.id} value={f.id}>
            {f.label}
          </option>
        ))}
      </select>
      <select
        className="gf-richsel"
        aria-label="Selection weight"
        title="Weight for the selected words"
        defaultValue=""
        onPointerDown={(e) => {
          e.stopPropagation();
          saveSel();
        }}
        onChange={(e) => {
          const w = e.target.value;
          if (w) run(() => applySpan("weight", w));
          e.target.value = "";
        }}
      >
        <option value="" disabled>
          Weight
        </option>
        {RICH_WEIGHTS.map((w) => (
          <option key={w.value} value={w.value}>
            {w.label}
          </option>
        ))}
      </select>
    </div>,
    document.body,
  );
}

/* ────────────────────────── the editable element ────────────────────────── */

export function RichTextEl({
  tag = "h2",
  className,
  text,
  html,
  field,
  onSet,
}: {
  tag?: "h2" | "p" | "blockquote" | "cite";
  className: string;
  /** Plain-text value (the mirror / fallback). */
  text: string;
  /** Rich HTML sidecar — wins over `text` when present. */
  html?: string;
  /** Which SlideStyle pair this element writes ("heading" or "body"). */
  field: "heading" | "body";
  onSet?: (patch: Partial<SlideStyle>) => void;
}) {
  const [editing, setEditing] = useState(false);
  // The node also lives in state so render can hand it to the toolbar
  // (reading a ref during render is off-limits).
  const [editNode, setEditNode] = useState<HTMLElement | null>(null);
  const elRef = useRef<HTMLElement | null>(null);
  // Frozen at edit-entry so re-renders never clobber the live DOM/caret.
  const frozenRef = useRef<string>("");
  const debounceRef = useRef<number>(0);

  const display = html ?? escapeHtml(text);

  const commit = useCallback(() => {
    const el = elRef.current;
    if (!el || !onSet) return;
    const clean = sanitizeRich(el.innerHTML);
    const plain = plainOfHtml(clean);
    // A fragment with no styling collapses back to plain text storage.
    const isPlain = clean === escapeHtml(plain);
    onSet(
      field === "heading"
        ? { heading: plain, headingHtml: isPlain ? undefined : clean }
        : { body: plain, bodyHtml: isPlain ? undefined : clean },
    );
  }, [onSet, field]);

  // Sync DOM from props whenever we're NOT editing.
  useEffect(() => {
    const el = elRef.current;
    if (el && !editing && el.innerHTML !== display) el.innerHTML = display;
  }, [display, editing]);

  // Click-outside ends the edit (more reliable than blur alone — the floating
  // toolbar and its native selects shuffle focus around).
  useEffect(() => {
    if (!editing) return;
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (elRef.current?.contains(t)) return;
      if ((t as Element).closest?.(".gf-richbar")) return;
      window.clearTimeout(debounceRef.current);
      commit();
      setEditing(false);
    };
    document.addEventListener("pointerdown", onDown, true);
    return () => document.removeEventListener("pointerdown", onDown, true);
  }, [editing, commit]);

  const enter = (e: React.MouseEvent) => {
    if (!onSet || editing) return;
    e.stopPropagation();
    frozenRef.current = display;
    setEditing(true);
    requestAnimationFrame(() => {
      const el = elRef.current;
      if (!el) return;
      el.focus();
      // Put the caret where the user double-clicked.
      const doc = document as Document & {
        caretRangeFromPoint?: (x: number, y: number) => Range | null;
      };
      const r = doc.caretRangeFromPoint?.(e.clientX, e.clientY);
      if (r) {
        const sel = window.getSelection();
        sel?.removeAllRanges();
        sel?.addRange(r);
      }
    });
  };

  const exit = () => {
    window.clearTimeout(debounceRef.current);
    commit();
    setEditing(false);
  };

  const Tag = tag;
  return (
    <>
      <Tag
        ref={(node: HTMLElement | null) => {
          elRef.current = node;
          setEditNode(node);
          if (node && node.innerHTML === "" && display)
            node.innerHTML = display;
        }}
        className={`${className}${editing ? " gf-richedit" : ""}`}
        contentEditable={editing}
        suppressContentEditableWarning
        spellCheck={false}
        onDoubleClick={enter}
        onPointerDown={editing ? (e) => e.stopPropagation() : undefined}
        onKeyDown={
          editing
            ? (e) => {
                e.stopPropagation();
                if (e.key === "Escape") {
                  e.preventDefault();
                  (e.currentTarget as HTMLElement).blur();
                }
              }
            : undefined
        }
        onInput={
          editing
            ? () => {
                window.clearTimeout(debounceRef.current);
                debounceRef.current = window.setTimeout(commit, 500);
              }
            : undefined
        }
        onBlur={
          editing
            ? (e) => {
                // Focus moving into the toolbar isn't an exit.
                const to = e.relatedTarget as Element | null;
                if (to && to.closest?.(".gf-richbar")) return;
                exit();
              }
            : undefined
        }
        title={onSet && !editing ? "Double-click to edit text" : undefined}
      />
      {editing && editNode && (
        <RichToolbar editEl={editNode} onApplied={commit} />
      )}
    </>
  );
}
