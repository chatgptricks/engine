"use client";

import { useRef } from "react";
import { ANIMATION_DIRECTIONS, ANIMATION_KINDS, ANIMATION_SPEED_RANGE, type AnimationDirection, type AnimationKind, type AnimationMode, type CanvasElement, type ElementAnimation } from "@/lib/template-editor/model";
import { ANIMATION_DEFAULT_DIRECTION, ANIMATION_LABELS, ANIMATION_SPEEDS, animationSettings, setElementAnimation } from "@/lib/template-editor/animations";
import { animationKeyframes, playAnimationPreview, sampleTimeline } from "./animation-preview";
import { RangeRow } from "./text-format-bar";

type Update = (group: string, transform: (element: CanvasElement) => CanvasElement) => void;

const MODES: { mode: AnimationMode; label: string }[] = [{ mode: "both", label: "Both" }, { mode: "enter", label: "On enter" }, { mode: "exit", label: "On exit" }];
const DIRECTION_LABELS: Record<AnimationDirection, string> = { up: "Up", down: "Down", left: "Left", right: "Right" };
const SAMPLE = { width: 28, height: 20 };

/** A tile: a small block that plays the motion when pointed at, as Canva's tiles do. */
function Tile({ kind, label, pressed, onClick }: { kind?: AnimationKind; label: string; pressed: boolean; onClick: () => void }) {
  const sample = useRef<HTMLSpanElement>(null);
  const play = () => {
    if (!kind || !sample.current || typeof sample.current.animate !== "function") return;
    const run = sampleTimeline({ kind, mode: "enter" });
    sample.current.animate(animationKeyframes(run.animation, run.length, SAMPLE, { opacity: 1, filter: "" }), { duration: run.length * 1000, easing: "linear" });
  };
  return <button type="button" aria-label={kind ? `${label} animation` : "No animation"} aria-pressed={pressed} onClick={onClick} onMouseEnter={play} onFocus={play}>
    <span className="te-animate-tile"><span ref={sample} className="te-animate-sample" aria-hidden="true" /></span>
    {label}
  </button>;
}

const same = <T,>(values: T[]) => values.length > 0 && values.every(value => value === values[0]) ? values[0] : undefined;

/** Canva's Animate: one motion per layer, in, out or both, at a speed, after a delay. Each
 * change is one undo step and plays on the canvas; agents set the same `animation`. */
export function AnimatePanel({ elements, disabled, update, onApplyToPage, pageLength }: { elements: CanvasElement[]; disabled: boolean; update: Update; onApplyToPage?: (animation: ElementAnimation) => void; pageLength: () => { elements: CanvasElement[]; length: number } }) {
  const kind = same(elements.map(element => element.animation?.kind ?? "none"));
  const first = elements[0]?.animation, current = kind && kind !== "none" && first ? animationSettings(first) : undefined;
  // The change lands on the canvas on the next render; play it then.
  const preview = (ids: string[]) => typeof requestAnimationFrame === "function" && requestAnimationFrame(() => requestAnimationFrame(() => { const page = pageLength(); playAnimationPreview(page.elements.filter(element => ids.includes(element.id)), page.length, { sample: true }); }));
  const set = (group: string, next: (animation: ElementAnimation | undefined) => ElementAnimation | null) => {
    update(group, element => setElementAnimation(element, next(element.animation)));
    preview(elements.map(element => element.id));
  };
  const patch = (group: string, change: Partial<ElementAnimation>) => set(group, animation => animation ? { ...animation, ...change } : null);
  return <fieldset className="te-animate" disabled={disabled}>
    <div className="te-animate-presets" role="group" aria-label="Animations">
      <Tile label="None" pressed={kind === "none"} onClick={() => set("animation", () => null)} />
      {ANIMATION_KINDS.map(choice => <Tile key={choice} kind={choice} label={ANIMATION_LABELS[choice]} pressed={kind === choice} onClick={() => set("animation", animation => animation?.kind === choice ? animation : { ...(animation && { mode: animation.mode, speed: animation.speed, delay: animation.delay }), kind: choice })} />)}
    </div>
    {current && <div className="te-animate-controls">
      <div className="te-animate-segment" role="group" aria-label="Animate when">
        {MODES.map(({ mode, label }) => <button key={mode} type="button" aria-pressed={same(elements.map(element => element.animation?.mode ?? "both")) === mode} onClick={() => patch("animation-mode", { mode })}>{label}</button>)}
      </div>
      <div className="te-animate-segment" role="group" aria-label="Speed">
        {(Object.keys(ANIMATION_SPEEDS) as (keyof typeof ANIMATION_SPEEDS)[]).map(name => <button key={name} type="button" aria-pressed={current.speed === ANIMATION_SPEEDS[name]} onClick={() => patch("animation-speed", { speed: ANIMATION_SPEEDS[name] })}>{name[0].toUpperCase() + name.slice(1)}</button>)}
      </div>
      <RangeRow label="Seconds" min={ANIMATION_SPEED_RANGE.min} max={ANIMATION_SPEED_RANGE.max} step={0.1} value={same(elements.map(element => element.animation ? animationSettings(element.animation).speed : undefined))} onChange={value => patch("animation-speed", { speed: Math.round(value * 10) / 10 })} />
      {ANIMATION_DEFAULT_DIRECTION[current.kind] && <div className="te-animate-segment" role="group" aria-label="Direction">
        {ANIMATION_DIRECTIONS.map(direction => <button key={direction} type="button" aria-pressed={current.direction === direction} onClick={() => patch("animation-direction", { direction })}>{DIRECTION_LABELS[direction]}</button>)}
      </div>}
      {current.mode !== "exit" && <RangeRow label="Delay" min={0} max={10} step={0.1} value={same(elements.map(element => element.animation?.delay ?? 0))} onChange={value => patch("animation-delay", { delay: Math.round(value * 10) / 10 })} />}
    </div>}
    <div className="te-animate-actions">
      <button type="button" className="te-look-reset" onClick={() => { const page = pageLength(); playAnimationPreview(page.elements, page.length); }}>Play page</button>
      {onApplyToPage && current && first && <button type="button" className="te-look-reset" title="Every layer on the page, one after another" onClick={() => onApplyToPage(first)}>Animate whole page</button>}
    </div>
  </fieldset>;
}
