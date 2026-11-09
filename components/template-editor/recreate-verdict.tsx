"use client";
import {useEffect, useId, useRef, useState, type FormEvent, type ReactNode} from "react";
import {safeSourceUrl, type FabricationSign, type RecreateJob, type RecreateVerdict as Verdict, type SourceLink, type VerdictAnswer} from "./recreate-job";

/**
 * The check, when it needs a person or has stopped a post: the story couldn't be
 * traced, looks made up, is stale, or was already covered. While it asks, a person
 * goes ahead, doesn't make it, or adds the story's original so research starts
 * from it. A post it stopped can still be built anyway (its warnings go into the
 * brief) or researched again.
 */
const SIGN_LABELS: Record<FabricationSign, string> = {
  no_original: "No original found", lone_quote: "One quote with no source", shifting_numbers: "The numbers change between versions",
  satire_account: "From a satire account", debunked: "Already debunked", other: "Something else looks off",
};
type Busy = "" | "proceed" | "stop" | "link" | "rerun";

/** What research found that the check went by, one line each. */
function findings(verdict: Verdict): {text: string; link?: SourceLink}[] {
  const lines: {text: string; link?: SourceLink}[] = [];
  const origin = verdict.origin;
  if (origin?.found) lines.push({text: `Original: ${[origin.who || "found", origin.date].filter(Boolean).join(", ")}`, ...(origin.url ? {link: {title: "Open the original", url: origin.url}} : {})});
  else if (origin) lines.push({text: `No original found${origin.note ? `: ${origin.note}` : ""}`});
  for (const sign of verdict.fabrication) lines.push({text: `${SIGN_LABELS[sign.sign]}${sign.detail ? `: ${sign.detail}` : ""}`});
  if (verdict.covered?.already) lines.push({text: `Already covered${verdict.covered.by.length ? ` by ${verdict.covered.by.map(page => page.title).join(", ")}` : ""}${verdict.covered.note ? `. ${verdict.covered.note}` : ""}`});
  if (verdict.fresh?.stale) lines.push({text: `Old news: first seen ${verdict.fresh.firstSeen ?? "a while ago"}${verdict.fresh.ageDays !== null ? `, ${verdict.fresh.ageDays} days ago` : ""}`});
  if (verdict.saturation?.saturated) lines.push({text: `Everyone has posted it${verdict.saturation.note ? `: ${verdict.saturation.note}` : ""}`});
  if (verdict.traction?.performing) lines.push({text: `The original is performing${verdict.traction.ratio ? `, ${verdict.traction.ratio.toFixed(1)}× its page's usual` : ""}`});
  if (verdict.originUrl) lines.push({text: "You added the story's original", link: {title: "Open it", url: verdict.originUrl}});
  return lines;
}

function Link({link}: {link: SourceLink}) {
  const href = safeSourceUrl(link.url);
  return href ? <a href={href} target="_blank" rel="noopener noreferrer">{link.title}</a> : <>{link.title}</>;
}

export function RecreateVerdict({summary, job, verdict, onAnswer, onRerun, onClose}: {
  /** The run's source and page, as the other steps show it. */
  summary: ReactNode;
  job: RecreateJob;
  verdict: Verdict;
  onAnswer: (answer: VerdictAnswer) => Promise<unknown>;
  /** Research the story again, from the start. */
  onRerun: () => Promise<unknown>;
  onClose: () => void;
}) {
  const id = useId();
  const stopped = job.status === "stopped", yourCall = verdict.answer?.choice === "stop";
  const [adding, setAdding] = useState(false), [link, setLink] = useState(""), [note, setNote] = useState("");
  const [busy, setBusy] = useState<Busy>(""), [error, setError] = useState(""), [linkError, setLinkError] = useState("");
  const primary = useRef<HTMLButtonElement>(null), linkField = useRef<HTMLInputElement>(null);
  // The native dialog opens after child effects run, so focus once it is showing.
  useEffect(() => {
    const timer = setTimeout(() => (adding ? linkField : primary).current?.focus(), 0);
    return () => clearTimeout(timer);
  }, [adding]);
  const lines = findings(verdict);

  async function run(kind: Busy, act: () => Promise<unknown>) {
    setBusy(kind);
    setError("");
    try { await act(); }
    catch (cause) { setError(cause instanceof Error && cause.message ? cause.message : "That didn't go through. Try again."); setBusy(""); }
  }
  const said = () => note.trim() ? {note: note.trim()} : {};
  function addLink(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const href = safeSourceUrl(link.trim());
    if (!href) { setLinkError("Paste a link to the story's original: a web address that starts with https://."); linkField.current?.focus(); return; }
    setLinkError("");
    void run("link", () => onAnswer({choice: "link", link: href, ...said()}));
  }

  return <form noValidate onSubmit={addLink}>
    <fieldset disabled={Boolean(busy)} className="te-pro-panel te-tool-dialog te-recreate te-recreate-wide">
      {summary}
      <div className={`te-recreate-brief te-recreate-check is-${stopped ? "stop" : "ask"}`}>
        <strong>{stopped ? yourCall ? "You chose not to make this post" : "The check stopped this post" : "The check needs you before this post is made"}</strong>
        {verdict.reason && <p>{verdict.reason}</p>}
      </div>
      {lines.length > 0 && <div className="te-recreate-section" role="group" aria-labelledby={`${id}-found`}>
        <div className="te-recreate-section-head"><h3 id={`${id}-found`}>What research found</h3></div>
        <ul className="te-recreate-notes">{lines.map((line, index) => <li key={index}>{line.text}{line.link && <> · <Link link={line.link}/></>}</li>)}</ul>
      </div>}
      {verdict.evidence.length > 0 && <div className="te-recreate-section" role="group" aria-labelledby={`${id}-evidence`}>
        <div className="te-recreate-section-head"><h3 id={`${id}-evidence`}>Evidence</h3></div>
        <ul className="te-recreate-sources">{verdict.evidence.map((source, index) => <li key={index}><Link link={source}/></li>)}</ul>
      </div>}
      {adding && <div className="te-recreate-field">
        <label htmlFor={`${id}-link`}>The story&apos;s original</label>
        <input ref={linkField} id={`${id}-link`} type="url" inputMode="url" autoComplete="off" spellCheck={false} maxLength={2000} placeholder="https://…" value={link} aria-invalid={Boolean(linkError)} aria-describedby={`${id}-link-help${linkError ? ` ${id}-link-error` : ""}`} onChange={event => { setLink(event.target.value); setLinkError(""); }}/>
        {linkError && <small id={`${id}-link-error`} className="te-recreate-invalid" role="alert">{linkError}</small>}
        <small id={`${id}-link-help`}>The first post or article. Research starts again from it.</small>
      </div>}
      <label className="te-recreate-field">
        <span id={`${id}-note-label`}>Your note <small className="te-recreate-optional">Optional</small></span>
        <textarea aria-labelledby={`${id}-note-label`} rows={2} maxLength={2000} placeholder={stopped ? "Why build it anyway" : "Anything the team should know"} value={note} onChange={event => setNote(event.target.value)}/>
      </label>
    </fieldset>
    {error && <div className="te-dialog-error te-recreate-alert" role="alert"><strong>Not done yet</strong><span>{error}</span></div>}
    <div className="te-dialog-footer">
      <button type="button" className="te-button" onClick={onClose}>{stopped ? "Close" : "Later"}</button>
      {stopped ? <>
        <button type="button" className="te-button" onClick={() => void run("rerun", onRerun)}>{busy === "rerun" ? "Starting…" : "Research again"}</button>
        <button ref={primary} type="button" className="te-button te-primary" onClick={() => void run("proceed", () => onAnswer({choice: "proceed", ...said()}))}>{busy === "proceed" ? "Starting…" : "Build it anyway"}</button>
      </> : adding ? <>
        <button type="button" className="te-button" onClick={() => { setAdding(false); setLinkError(""); }}>Back</button>
        <button className="te-button te-primary">{busy === "link" ? "Adding…" : "Research from this link"}</button>
      </> : <>
        <button type="button" className="te-button" onClick={() => void run("stop", () => onAnswer({choice: "stop", ...said()}))}>{busy === "stop" ? "Stopping…" : "Don't make it"}</button>
        <button type="button" className="te-button" onClick={() => setAdding(true)}>Add the original</button>
        <button ref={primary} type="button" className="te-button te-primary" onClick={() => void run("proceed", () => onAnswer({choice: "proceed", ...said()}))}>{busy === "proceed" ? "Starting…" : "Go ahead"}</button>
      </>}
    </div>
  </form>;
}
