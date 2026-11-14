"use client";
import {useState} from "react";
import {CaptionFileError, MAX_CAPTION_CUES, MAX_CAPTION_TEXT, MIN_CAPTION_SECONDS, cueAt, formatSrt, parseCaptionFile, type CaptionCue} from "@/lib/template-editor/captions";
import {formatSeconds} from "@/lib/template-editor/client-video";
import type {VideoClip} from "@/lib/template-editor/model";

const round = (value: number) => Math.round(value * 100) / 100;
/** Each add, import, removal or edit of words is its own undo step; typing in one time field is one. */
let steps = 0;
const step = (kind: string) => `${kind}-${++steps}`;
const sorted = (cues: CaptionCue[]) => [...cues].sort((a, b) => a.start - b.start || a.end - b.end);

/** A caption's words, saved when the field loses focus or on Enter (one undo step each), so
 * spaces typed at the end stay while typing. Emptied, the caption goes. */
function CueText({label, text, onCommit}: {label: string; text: string; onCommit: (text: string) => void}) {
  const [draft, setDraft] = useState(text);
  const commit = () => { if (draft !== text) onCommit(draft); };
  return <input className="te-video-cue-text" aria-label={label} value={draft} maxLength={MAX_CAPTION_TEXT} onChange={event => setDraft(event.target.value)} onBlur={commit} onKeyDown={event => { if (event.key === "Enter") { event.preventDefault(); commit(); } else if (event.key === "Escape") setDraft(text); }}/>;
}

/** A clip's timed captions: add one at the playhead, edit words and times, import an .srt or
 * .vtt file, download them as .srt. Times are seconds of the clip, as the trim is. The first
 * caption also adds a caption layer to the slide (the editor does that), which sets their look. */
export function CaptionControls({clip, now, disabled, onChange, onSeek, captionLayerId, onSelectLayer}: {clip: VideoClip; now: number; disabled: boolean; onChange: (cues: CaptionCue[], step: string) => void; onSeek: (time: number) => void; captionLayerId?: string; onSelectLayer?: (id: string) => void}) {
  const cues = clip.captions ?? [];
  const [error, setError] = useState("");
  const playing = cueAt(cues, now);
  const set = (index: number, patch: Partial<CaptionCue>, kind: string) => {
    const next = cues.map((cue, at) => at === index ? {...cue, ...patch} : cue);
    const cue = next[index];
    if (cue.end - cue.start < MIN_CAPTION_SECONDS) { if (patch.start !== undefined) cue.end = round(cue.start + MIN_CAPTION_SECONDS); else cue.start = Math.max(0, round(cue.end - MIN_CAPTION_SECONDS)); }
    onChange(patch.text !== undefined ? next : sorted(next), kind);
  };
  const add = () => {
    const end = clip.end ?? clip.duration;
    const start = round(Math.min(now, end - MIN_CAPTION_SECONDS));
    // A new caption runs two seconds, or up to the next one.
    const following = cues.find(cue => cue.start > start + MIN_CAPTION_SECONDS);
    onChange(sorted([...cues, {start, end: round(Math.max(start + MIN_CAPTION_SECONDS, Math.min(start + 2, end, following?.start ?? Infinity))), text: "New caption"}]), step("add"));
  };
  async function load(file: File) {
    setError("");
    try {
      if (file.size > 1024 * 1024) throw new CaptionFileError("This file is over 1 MB; a clip holds 300 captions.");
      const next = parseCaptionFile(await file.text()).filter(cue => cue.start < clip.duration);
      if (!next.length) throw new CaptionFileError("Every caption in this file starts after the clip ends.");
      onChange(next, step("import"));
    } catch (reason) { setError(reason instanceof CaptionFileError ? reason.message : "Couldn't read this file. Use an .srt or .vtt file."); }
  }
  const download = () => {
    const url = URL.createObjectURL(new Blob([formatSrt(cues)], {type: "application/x-subrip"}));
    const link = Object.assign(document.createElement("a"), {href: url, download: "captions.srt"});
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  return <fieldset disabled={disabled} className="te-video-captions">
    <legend>Captions{cues.length ? ` (${cues.length})` : ""}</legend>
    {cues.length > 0 && <ol className="te-video-cues" aria-label="Captions">
      {cues.map((cue, index) => <li key={index} className={`te-video-cue${cue === playing ? " is-playing" : ""}`}>
        <button type="button" className="te-video-cue-go" onClick={() => onSeek(cue.start)} aria-label={`Go to ${formatSeconds(cue.start)}`} title="Go to this caption">{formatSeconds(cue.start)}</button>
        <CueText key={`${cue.start}-${cue.text}`} label={`Caption ${index + 1} words`} text={cue.text} onCommit={text => text.trim() ? set(index, {text: text.trim()}, step("words")) : onChange(cues.filter((_, at) => at !== index), step("remove"))}/>
        <label className="te-video-cue-time"><span>From</span><input type="number" aria-label={`Caption ${index + 1} starts at`} min={0} max={clip.duration} step={0.1} value={cue.start} onChange={event => { const value = Number(event.target.value); if (Number.isFinite(value)) set(index, {start: Math.max(0, Math.min(clip.duration - MIN_CAPTION_SECONDS, round(value)))}, `start-${index}`); }}/></label>
        <label className="te-video-cue-time"><span>to</span><input type="number" aria-label={`Caption ${index + 1} ends at`} min={0} max={clip.duration} step={0.1} value={cue.end} onChange={event => { const value = Number(event.target.value); if (Number.isFinite(value)) set(index, {end: Math.max(MIN_CAPTION_SECONDS, Math.min(clip.duration, round(value)))}, `end-${index}`); }}/></label>
        <button type="button" className="te-video-cue-remove" aria-label={`Remove caption ${index + 1}`} title="Remove" onClick={() => onChange(cues.filter((_, at) => at !== index), step("remove"))}>×</button>
      </li>)}
    </ol>}
    <div className="te-element-grid te-element-actions">
      <button type="button" disabled={cues.length >= MAX_CAPTION_CUES} onClick={add} title="A caption from the playhead; type its words, then set when it ends.">Add caption at {formatSeconds(now)}</button>
      <label className="te-property-action">Import .srt or .vtt<input type="file" hidden aria-label="Import captions" accept=".srt,.vtt,text/vtt,application/x-subrip" onChange={event => { const file = event.target.files?.[0]; event.target.value = ""; if (file) void load(file); }}/></label>
      {cues.length > 0 && <button type="button" onClick={download}>Download .srt</button>}
      {cues.length > 0 && <button type="button" onClick={() => onChange([], step("remove-all"))}>Remove all</button>}
    </div>
    {cues.length > 0 && <p className="te-element-hint">Shown in the slide&apos;s caption layer and burned into the MP4. {captionLayerId && onSelectLayer ? <button type="button" className="te-link-button" onClick={() => onSelectLayer(captionLayerId)}>Select the caption layer</button> : null}{captionLayerId ? " to change its font, size, colour or place." : ""}</p>}
    {error && <p className="te-element-hint" role="alert">{error}</p>}
  </fieldset>;
}
