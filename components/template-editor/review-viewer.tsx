"use client";
import {useState} from "react";
import type {PublicReview} from "@/lib/template-editor/reviews";
import {DesignPreview} from "./preview";
export default function ReviewViewer({token, review: initial}: {token: string; review: PublicReview}) {
  const [review, setReview] = useState(initial), [name, setName] = useState(""), [text, setText] = useState(""), [pageId, setPageId] = useState(""), [message, setMessage] = useState(""), [busy, setBusy] = useState(false);
  return <main className="te-review-viewer"><header><span className="te-eyebrow">DESIGN REVIEW</span><h1>{review.document.name}</h1><p>Read-only snapshot · expires {new Date(review.expiresAt).toLocaleDateString()}</p></header>
    <section className="te-review-pages">{review.document.pages.map((page, index) => <figure key={page.id}><DesignPreview design={review.document} page={page}/><figcaption>Page {index + 1}</figcaption></figure>)}</section>
    {review.document.caption && <section><h2>Caption</h2><p className="te-review-caption">{review.document.caption}</p></section>}
    <section><h2>Feedback</h2>{review.comments.map(comment => <article key={comment.id} className="te-review-comment"><strong>{comment.name}</strong><time>{new Date(comment.createdAt).toLocaleString()}</time>{comment.pageId && <span>Page {review.document.pages.findIndex(page => page.id === comment.pageId) + 1}</span>}<p>{comment.text}</p></article>)}
      <form onSubmit={async event => { event.preventDefault(); setBusy(true); setMessage(""); try { const response = await fetch("/api/template-editor/reviews", {method: "POST", headers: {"Content-Type": "application/json"}, body: JSON.stringify({token, name, text, ...(pageId ? {pageId} : {})})}); const data = await response.json(); if (!response.ok) throw new Error(data.error); setReview({...review, comments: [...review.comments, data.comment]}); setText(""); setMessage("Feedback added."); } catch (cause) {setMessage(cause instanceof Error ? cause.message : "Feedback could not be added.");} finally {setBusy(false);} }}>
        <label className="te-field">Your name<input required maxLength={80} value={name} onChange={event => setName(event.target.value)}/></label><label className="te-field">Page<select value={pageId} onChange={event => setPageId(event.target.value)}><option value="">Whole design</option>{review.document.pages.map((page, index) => <option key={page.id} value={page.id}>Page {index + 1}</option>)}</select></label><label className="te-field">Comment<textarea required maxLength={2000} value={text} onChange={event => setText(event.target.value)}/></label><button className="te-button te-primary" disabled={busy}>{busy ? "Adding…" : "Add feedback"}</button><p role="status">{message}</p>
      </form>
    </section></main>;
}
