import { animationPose, animationSettings, type AnimationPose } from "@/lib/template-editor/animations";
import type { CanvasElement, ElementAnimation } from "@/lib/template-editor/model";

/** Frames a second the preview samples poses at; the browser tweens between them. */
const SAMPLES_PER_SECOND = 30;
const playing = new Set<Animation>();

const usesClip = (animation: ElementAnimation) => animation.kind === "wipe" || animation.kind === "baseline";
const percent = (value: number) => `${Math.round(value * 10000) / 100}%`;

/** The Web Animations keyframes for a layer's timeline, from the same poses the MP4 draws. */
export function animationKeyframes(animation: ElementAnimation, length: number, box: { width: number; height: number }, base: { opacity: number; filter: string }): Keyframe[] {
  const steps = Math.max(2, Math.min(600, Math.ceil(length * SAMPLES_PER_SECOND))), clip = usesClip(animation), frames: Keyframe[] = [];
  for (let index = 0; index <= steps; index++) {
    const pose: AnimationPose = animationPose(animation, index / steps * length, length, box);
    const blur = pose.blur > 0 ? `blur(${Math.round(pose.blur * 100) / 100}px)` : "";
    const frame: Keyframe = { offset: index / steps, opacity: base.opacity * pose.opacity, translate: `${Math.round(pose.x * 100) / 100}px ${Math.round(pose.y * 100) / 100}px`, rotate: `${Math.round(pose.rotate * 100) / 100}deg`, scale: `${Math.round(pose.scale * 1000) / 1000}`, filter: [base.filter, blur].filter(Boolean).join(" ") || "none" };
    if (clip) frame.clipPath = `inset(${percent(pose.clip.top)} ${percent(pose.clip.right)} ${percent(pose.clip.bottom)} ${percent(pose.clip.left)})`;
    frames.push(frame);
  }
  return frames;
}

/** A short run for one layer just chosen: in, a beat at rest, then out when it leaves. */
export function sampleTimeline(animation: ElementAnimation): { animation: ElementAnimation; length: number } {
  const s = animationSettings(animation), hold = 0.6;
  const length = s.mode === "enter" ? s.speed + hold : s.mode === "exit" ? hold + s.speed : s.speed * 2 + hold;
  return { animation: { ...animation, delay: 0 }, length };
}

export function stopAnimationPreview() {
  for (const animation of playing) animation.cancel();
  playing.clear();
}

/** Plays layers' animations on the editor's canvas. With `sample`, each plays its short run
 * alone; otherwise the page's timeline, `length` seconds long. */
export function playAnimationPreview(elements: readonly CanvasElement[], length: number, options: { sample?: boolean; root?: ParentNode } = {}) {
  stopAnimationPreview();
  if (typeof document === "undefined" || typeof Element.prototype.animate !== "function") return;
  const scene = (options.root ?? document).querySelector(".te-canvas-editor-scene");
  if (!scene) return;
  for (const element of elements) {
    if (!element.animation || element.hidden) continue;
    const node = scene.querySelector<HTMLElement>(`.te-canvas-element[data-element-id="${CSS.escape(element.id)}"]`);
    if (!node) continue;
    const run = options.sample ? sampleTimeline(element.animation) : { animation: element.animation, length };
    const style = getComputedStyle(node), base = { opacity: Number.parseFloat(style.opacity) || 1, filter: style.filter && style.filter !== "none" ? style.filter : "" };
    const animation = node.animate(animationKeyframes(run.animation, run.length, element, base), { duration: run.length * 1000, easing: "linear" });
    playing.add(animation);
    animation.onfinish = animation.oncancel = () => playing.delete(animation);
  }
}
