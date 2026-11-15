import { ANIMATION_DIRECTIONS, ANIMATION_KINDS, ANIMATION_MODES, ANIMATION_SPEED_RANGE, MAX_SLIDE_VIDEO_SECONDS, parseElementAnimation, type AnimationDirection, type AnimationKind, type CanvasElement, type DesignPage, type ElementAnimation } from "./model";

/**
 * Animate, after Canva's: each layer gets one motion that plays as it enters the
 * page, as it leaves, or both. The motion is a pose at each moment (opacity, a
 * move, a scale, a turn, a blur and a wipe), worked out here once; the editor's
 * preview plays those poses with the Web Animations API and the MP4 export draws
 * each frame's layers at them, so both move the same way. PNG and PDF show every
 * layer at rest.
 */

export const ANIMATION_LABELS: Record<AnimationKind, string> = { fade: "Fade", rise: "Rise", pan: "Pan", pop: "Pop", wipe: "Wipe", blur: "Blur", drift: "Drift", tumble: "Tumble", stomp: "Stomp", baseline: "Baseline" };
/** Kinds that move one way, and the way they move by default. */
export const ANIMATION_DEFAULT_DIRECTION: Partial<Record<AnimationKind, AnimationDirection>> = { rise: "up", pan: "left", wipe: "right", drift: "up", baseline: "up" };
/** Canva's speed buttons, as the seconds one entrance takes. */
export const ANIMATION_SPEEDS = { slow: 1.2, medium: 0.7, fast: 0.4 } as const;
const DEFAULT_SPEED: Partial<Record<AnimationKind, number>> = { drift: 1.2 };
/** How long a still page with animations plays: Canva's 5 seconds, longer when delays need it. */
export const STILL_PAGE_SECONDS = 5;

export type AnimationSettings = Required<ElementAnimation>;
export function animationSettings(animation: ElementAnimation): AnimationSettings {
  return { mode: "both", delay: 0, speed: DEFAULT_SPEED[animation.kind] ?? ANIMATION_SPEEDS.medium, direction: ANIMATION_DEFAULT_DIRECTION[animation.kind] ?? "up", ...animation };
}

/** A layer's pose: `x`, `y` and `blur` in scene units, `rotate` in degrees, `clip` as fractions of its box cut from each side. */
export type AnimationPose = { opacity: number; x: number; y: number; scale: number; rotate: number; blur: number; clip: { top: number; right: number; bottom: number; left: number } };
export const REST_POSE: AnimationPose = { opacity: 1, x: 0, y: 0, scale: 1, rotate: 0, blur: 0, clip: { top: 0, right: 0, bottom: 0, left: 0 } };

const clamp = (value: number, low = 0, high = 1) => Math.min(high, Math.max(low, value));
const easeOut = (p: number) => 1 - (1 - p) ** 3;
const easeOutBack = (p: number, overshoot = 1.6) => 1 + (overshoot + 1) * (p - 1) ** 3 + overshoot * (p - 1) ** 2;
const OPPOSITE: Record<AnimationDirection, AnimationDirection> = { up: "down", down: "up", left: "right", right: "left" };
/** The way a direction points, as a unit step on the page (y grows downwards). */
const STEP: Record<AnimationDirection, { x: number; y: number }> = { up: { x: 0, y: -1 }, down: { x: 0, y: 1 }, left: { x: -1, y: 0 }, right: { x: 1, y: 0 } };

/** The pose part way into an entrance: p 0 is before it starts, 1 is at rest. */
function enterPose(kind: AnimationKind, direction: AnimationDirection, p: number, box: { width: number; height: number }): AnimationPose {
  const e = easeOut(clamp(p)), step = STEP[direction], pose: AnimationPose = { ...REST_POSE, clip: { ...REST_POSE.clip } };
  const fadeIn = clamp(p * 1.8), along = (distance: number) => { pose.x = -step.x * distance * (1 - e); pose.y = -step.y * distance * (1 - e); };
  switch (kind) {
    case "fade": pose.opacity = e; break;
    case "rise": along(Math.max(12, (step.y ? box.height : box.width) * 0.4)); pose.opacity = fadeIn; break;
    case "pan": along(Math.max(24, (step.y ? box.height : box.width) * 0.6)); pose.opacity = fadeIn; break;
    case "drift": along(Math.max(6, (step.y ? box.height : box.width) * 0.12)); pose.opacity = e; break;
    case "pop": pose.scale = 0.3 + 0.7 * easeOutBack(clamp(p)); pose.opacity = clamp(p * 3); break;
    case "stomp": pose.scale = 1 + 0.6 * (1 - easeOutBack(clamp(p), 1.2)); pose.opacity = clamp(p * 4); break;
    case "tumble": pose.rotate = -90 * (1 - e); pose.scale = 0.6 + 0.4 * e; pose.opacity = fadeIn; break;
    case "blur": pose.blur = Math.max(4, Math.min(box.width, box.height) * 0.12) * (1 - e); pose.opacity = e; break;
    case "wipe": {
      // The layer shows from the side it moves away from: a wipe to the right uncovers it left to right.
      const hidden = 1 - e, side = direction === "right" ? "right" : direction === "left" ? "left" : direction === "down" ? "bottom" : "top";
      pose.clip[side] = hidden;
      break;
    }
    case "baseline": {
      // Rises out of its own box, as text comes up over a baseline: the part outside the box stays hidden.
      const distance = (step.y ? box.height : box.width) * (1 - e);
      pose.x = -step.x * distance; pose.y = -step.y * distance;
      if (direction === "up") pose.clip.bottom = 1 - e; else if (direction === "down") pose.clip.top = 1 - e; else if (direction === "left") pose.clip.right = 1 - e; else pose.clip.left = 1 - e;
      break;
    }
  }
  return pose;
}

/** When a layer's motion happens on a page `length` seconds long. */
export function animationWindows(animation: ElementAnimation, length: number) {
  const s = animationSettings(animation);
  const enter = s.mode === "exit" ? undefined : { start: Math.min(s.delay, Math.max(0, length - s.speed)), end: Math.min(s.delay, Math.max(0, length - s.speed)) + s.speed };
  const exit = s.mode === "enter" ? undefined : { start: Math.max(enter?.end ?? 0, length - s.speed), end: length };
  return { enter, exit };
}

/** The pose of a layer at second `t` of a page `length` seconds long. */
export function animationPose(animation: ElementAnimation | undefined, t: number, length: number, box: { width: number; height: number }): AnimationPose {
  if (!animation) return REST_POSE;
  const s = animationSettings(animation), { enter, exit } = animationWindows(animation, length);
  if (enter && t < enter.end) return enterPose(s.kind, s.direction, (t - enter.start) / (enter.end - enter.start), box);
  // An exit is the entrance played backwards the other way: a layer that rose in rises out.
  if (exit && t > exit.start) return enterPose(s.kind, OPPOSITE[s.direction], 1 - (t - exit.start) / Math.max(1e-6, exit.end - exit.start), box);
  return REST_POSE;
}

export const isRestPose = (pose: AnimationPose) => pose === REST_POSE || (pose.opacity === 1 && !pose.x && !pose.y && pose.scale === 1 && !pose.rotate && !pose.blur && !pose.clip.top && !pose.clip.right && !pose.clip.bottom && !pose.clip.left);

export function hasAnimations(elements: readonly CanvasElement[]): boolean {
  return elements.some(element => element.animation && !element.hidden);
}
/** A page whose layers move: it exports as an MP4 like a page with a video. */
export function pageMotion(page: DesignPage | undefined): boolean {
  return Boolean(page?.canvas && hasAnimations(page.canvas.elements));
}

/** How long a still page with animations plays: 5 seconds, or long enough for the last
 * entrance and a moment's hold before the exits. */
export function stillPageLength(elements: readonly CanvasElement[]): number {
  let length = STILL_PAGE_SECONDS;
  for (const element of elements) {
    if (!element.animation || element.hidden) continue;
    const s = animationSettings(element.animation);
    if (s.mode !== "exit") length = Math.max(length, s.delay + s.speed + 1 + (s.mode === "both" ? s.speed : 0));
  }
  return Math.min(MAX_SLIDE_VIDEO_SECONDS, Math.round(length * 10) / 10);
}

/** The layer with an animation, or without one (null). */
export function setElementAnimation<T extends CanvasElement>(element: T, animation: ElementAnimation | null): T {
  const next = { ...element };
  if (animation) next.animation = tidy(animation); else delete next.animation;
  return next;
}
/** Drops settings that are the defaults, and a direction on a kind that has none. */
function tidy(animation: ElementAnimation): ElementAnimation {
  const next: ElementAnimation = { kind: animation.kind };
  if (animation.mode && animation.mode !== "both") next.mode = animation.mode;
  if (animation.speed !== undefined && animation.speed !== (DEFAULT_SPEED[animation.kind] ?? ANIMATION_SPEEDS.medium)) next.speed = Math.round(clamp(animation.speed, ANIMATION_SPEED_RANGE.min, ANIMATION_SPEED_RANGE.max) * 100) / 100;
  if (animation.direction && ANIMATION_DEFAULT_DIRECTION[animation.kind] && animation.direction !== ANIMATION_DEFAULT_DIRECTION[animation.kind]) next.direction = animation.direction;
  if (animation.delay) next.delay = Math.round(animation.delay * 100) / 100;
  return next;
}

/** What agents may send: a kind alone, null or "none" (no animation), or the settings. A partial
 * object changes only what it names, so `{speed: 1}` keeps the kind. */
export function agentAnimation(value: unknown, current: ElementAnimation | undefined): ElementAnimation | null | undefined {
  if (value === null || value === "none") return null;
  if (typeof value === "string") return (ANIMATION_KINDS as readonly string[]).includes(value) ? { ...current, kind: value as AnimationKind, direction: undefined } : undefined;
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const raw = value as Record<string, unknown>;
  if (raw.kind === null || raw.kind === "none") return null;
  const merged: Record<string, unknown> = { ...current, ...raw };
  // A new kind starts from its own direction unless the agent names one.
  if (raw.kind !== undefined && raw.kind !== current?.kind && raw.direction === undefined) delete merged.direction;
  for (const key of Object.keys(merged)) if (merged[key] === undefined) delete merged[key];
  const parsed = parseElementAnimation(merged);
  return parsed ? tidy(parsed) : undefined;
}

export { ANIMATION_DIRECTIONS, ANIMATION_KINDS, ANIMATION_MODES };
