"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { templateSceneHeight, type CanvasElement, type CanvasScene, type DesignFormat, type TextElement } from "@/lib/template-editor/model";
import { TEXT_AI_ACTIONS, TEXT_AI_LANGUAGES, TEXT_AI_TONES, accentRanges, applyTextAiOption, type TextAiAction, type TextAiOption } from "@/lib/template-editor/text-ai";

/** The deck a text box is in, for the AI: its size, and its template (the brand guide and language). */
export type TextAiDeck = { format: DesignFormat; customSize?: { width: number; height: number }; templateId?: string };

type Ask = { action: TextAiAction; tone?: string; language?: string; instruction?: string };
type State =
  | { step: "menu" }
  | { step: "pick"; action: "tone" | "translate" }
  | { step: "loading"; ask: Ask }
  | { step: "results"; ask: Ask; options: TextAiOption[]; model: string; brand?: string }
  | { step: "error"; ask: Ask; message: string };

/** Layout and template keys a copy shouldn't carry: it's a free layer of its own. */
const TEMPLATE_KEYS = ["slot", "smartFlow", "smartCenter", "leadsGroup", "componentId", "templateRole", "protected", "frameRole", "layoutRole", "master"] as const;

/** A copy of the box with the option's text, just under it, as a free layer. */
export function textAiLayer(element: TextElement, option: Pick<TextAiOption, "text" | "accents">, sceneHeight: number, id: string): TextElement {
  const copy: TextElement = { ...applyTextAiOption(element, option), id, name: `${element.name} (AI)`, locked: false };
  for (const key of TEMPLATE_KEYS) delete (copy as Partial<TextElement>)[key];
  copy.y = Math.max(0, Math.min(sceneHeight - copy.height, element.y + element.height + 8));
  return copy;
}

function Highlighted({ option }: { option: TextAiOption }) {
  const parts: ReactNode[] = [];
  let at = 0;
  for (const range of accentRanges(option.text, option.accents)) {
    if (range.start > at) parts.push(option.text.slice(at, range.start));
    parts.push(<mark key={range.start}>{option.text.slice(range.start, range.end)}</mark>);
    at = range.end;
  }
  parts.push(option.text.slice(at));
  return <span className="te-ai-option-text">{parts}</span>;
}

/** The AI menu on one text box: an instruction of your own or an action, then
 * options to place (one undo step), try again, or add as a new layer. */
export function TextAiMenu({ scene, element, deck, close, update, onChange }: {
  scene: CanvasScene;
  element: TextElement;
  deck: TextAiDeck;
  close: () => void;
  update: (transform: (element: CanvasElement) => CanvasElement, property?: "style" | "content" | "position", group?: string) => void;
  onChange: (scene: CanvasScene, group?: string) => void;
}) {
  const [state, setState] = useState<State>({ step: "menu" });
  const [instruction, setInstruction] = useState("");
  const request = useRef<AbortController | null>(null);
  useEffect(() => () => request.current?.abort(), []);

  async function run(ask: Ask) {
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setState({ step: "loading", ask });
    try {
      const response = await fetch("/api/template-editor/text-ai", {
        method: "POST", headers: { "content-type": "application/json" }, signal: controller.signal,
        body: JSON.stringify({ scene, elementId: element.id, ...deck, ...ask }),
      });
      const value = await response.json().catch(() => ({}));
      if (controller.signal.aborted) return;
      if (!response.ok) { setState({ step: "error", ask, message: typeof value.error === "string" ? value.error : "Engine's AI couldn't answer. Try again." }); return; }
      setState({ step: "results", ask, options: value.options, model: value.model, brand: value.brand?.name });
    } catch (error) {
      if (!controller.signal.aborted) setState({ step: "error", ask, message: error instanceof Error ? error.message : "Engine's AI couldn't answer. Try again." });
    }
  }
  const choose = (action: TextAiAction) => action === "tone" || action === "translate" ? setState({ step: "pick", action }) : run({ action, ...(action === "custom" ? { instruction } : {}) });
  const replace = (option: TextAiOption) => {
    update(item => item.id === element.id && item.type === "text" ? applyTextAiOption(item, option) : item, "content", `text-ai-${Date.now()}`);
    close();
  };
  const addLayer = (option: TextAiOption) => {
    const layer = textAiLayer(element, option, templateSceneHeight(deck), crypto.randomUUID());
    const index = scene.elements.findIndex(item => item.id === element.id);
    onChange({ ...scene, elements: [...scene.elements.slice(0, index + 1), layer, ...scene.elements.slice(index + 1)] }, `text-ai-layer-${Date.now()}`);
    close();
  };

  if (state.step === "pick") return <div className="te-ai-menu">
    <button type="button" className="te-ai-back" onClick={() => setState({ step: "menu" })}>‹ {state.action === "tone" ? "Change tone" : "Translate"}</button>
    <div className="te-format-choices" role="group" aria-label={state.action === "tone" ? "Tone" : "Language"}>
      {(state.action === "tone" ? TEXT_AI_TONES : TEXT_AI_LANGUAGES).map(choice => <button key={choice} type="button" onClick={() => run(state.action === "tone" ? { action: "tone", tone: choice } : { action: "translate", language: choice })}>{choice[0].toUpperCase() + choice.slice(1)}</button>)}
    </div>
  </div>;
  if (state.step === "loading") return <div className="te-ai-menu" aria-busy="true">
    <p className="te-ai-status" role="status"><span className="te-ai-spinner" aria-hidden="true" />{state.ask.action === "alternatives" && element.smartText?.role === "cover" ? "Writing headlines…" : "Writing…"}</p>
    <button type="button" className="te-ai-link" onClick={() => { request.current?.abort(); setState({ step: "menu" }); }}>Cancel</button>
  </div>;
  if (state.step === "error") return <div className="te-ai-menu">
    <p className="te-ai-error" role="alert">{state.message}</p>
    <div className="te-ai-footer"><button type="button" className="te-ai-link" onClick={() => setState({ step: "menu" })}>Back</button><button type="button" onClick={() => run(state.ask)}>Try again</button></div>
  </div>;
  if (state.step === "results") return <div className="te-ai-menu">
    <ul className="te-ai-options" aria-label="AI options">
      {state.options.map((option, index) => <li key={index} className="te-ai-option">
        <Highlighted option={option} />
        {option.brandIssues.length > 0 && <ul className="te-ai-issues" aria-label="Brand guide">{option.brandIssues.map(issue => <li key={issue}>{issue}</li>)}</ul>}
        <div className="te-ai-option-actions">
          <button type="button" className="te-ai-primary" onClick={() => replace(option)}>Replace</button>
          <button type="button" onClick={() => addLayer(option)}>Add as new layer</button>
        </div>
      </li>)}
    </ul>
    <div className="te-ai-footer">
      <button type="button" className="te-ai-link" onClick={() => setState({ step: "menu" })}>‹ Back</button>
      <span className="te-ai-meta">{state.model === "headline" ? "Headline model" : "Engine AI"}{state.brand ? ` · ${state.brand} guide` : ""}</span>
      <button type="button" onClick={() => run(state.ask)}>Try again</button>
    </div>
  </div>;
  return <div className="te-ai-menu">
    <form className="te-ai-ask" onSubmit={event => { event.preventDefault(); if (instruction.trim()) choose("custom"); }}>
      <input aria-label="Tell the AI what to do" placeholder="Tell the AI what to do…" maxLength={500} value={instruction} onChange={event => setInstruction(event.target.value)} autoFocus />
      <button type="submit" disabled={!instruction.trim()}>Go</button>
    </form>
    <div className="te-ai-actions" role="menu" aria-label="AI actions">
      {TEXT_AI_ACTIONS.filter(action => action.id !== "custom").map(action => <button key={action.id} type="button" role="menuitem" onClick={() => choose(action.id)}>
        <span>{action.label}</span>{action.hint && <small>{action.hint}</small>}{(action.id === "tone" || action.id === "translate") && <small aria-hidden="true">›</small>}
      </button>)}
    </div>
    <p className="te-ai-note">Never adds facts: what it can&apos;t know comes back in [brackets].</p>
  </div>;
}
