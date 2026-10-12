"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useEngine } from "@/lib/engine/store";
import { assembleSystemPrompt } from "@/lib/engine/profile";
import type { Story, StoryImage } from "@/lib/engine/types";
import { CloseIcon, CommentIcon } from "./icons";

/**
 * The story chat — a frosted composer bar that sits in the bottom stack
 * just below the caption bar (same glass treatment as the caption and the
 * Create composer; opening it pushes the caption up). Ask questions about
 * the dossier, have it rewrite the caption (lands in the caption editor),
 * pull in more images, or kick off research for a new story. Tool effects
 * stream back as `action` events and are applied here through the store;
 * the conversation persists per story.
 */

interface ChatMsg {
  role: "user" | "assistant";
  content: string;
  /** Short confirmations of applied tool effects ("Caption updated"…). */
  chips?: string[];
}

const chatKey = (storyId: string) => `gf-chat-${storyId}`;

function loadMsgs(storyId: string): ChatMsg[] {
  try {
    const raw = window.localStorage.getItem(chatKey(storyId));
    const parsed = raw ? JSON.parse(raw) : null;
    return Array.isArray(parsed) ? (parsed as ChatMsg[]) : [];
  } catch {
    return [];
  }
}

function saveMsgs(storyId: string, msgs: ChatMsg[]) {
  try {
    window.localStorage.setItem(
      chatKey(storyId),
      JSON.stringify(msgs.slice(-60)),
    );
  } catch {
    /* quota — fine, the chat just won't persist */
  }
}

export function StoryChat({
  story,
  onClose,
}: {
  story: Story;
  onClose: () => void;
}) {
  const { setCaption, addImages, applyImageEdits, getCuration, profile, channels } =
    useEngine();
  const [messages, setMessages] = useState<ChatMsg[]>(() =>
    loadMsgs(story.id),
  );
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    saveMsgs(story.id, messages);
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, story.id]);

  // Grow the input with content up to a cap, like the caption textarea.
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 120)}px`;
  }, [input]);

  // Trimmed story context for the system prompt — no data-URL uploads, no
  // full image records, capped lists.
  const buildContext = useCallback(() => {
    const cur = getCuration(story.id);
    return {
      id: story.id,
      title: story.title,
      description: story.description,
      postType: story.postType,
      alignment: story.alignment,
      alignmentNote: story.alignmentNote,
      techOvert: story.techOvert,
      channelName: channels.find((c) => c.id === story.channelId)?.name,
      captionDraft: story.caption.draft,
      captionEdited: cur.captionEdited,
      dossier: {
        verificationStatus: story.dossier.verificationStatus,
        verifiedFacts: story.dossier.verifiedFacts.map((f) => ({
          fact: f.fact,
          sources: f.sources.slice(0, 2),
        })),
        contestedPoints: story.dossier.contestedPoints,
        primarySources: story.dossier.primarySources.slice(0, 12),
      },
      images: story.images.slice(0, 80).map((im) => ({
        id: im.id,
        source: im.source,
        description: (im.description ?? "").slice(0, 90),
        directive: (im.directive ?? "").slice(0, 60),
        // Web URLs only (curate_images fetches them server-side to LOOK at
        // them); data-URL uploads stay local and are never judged.
        url: /^https?:\/\//.test(im.url) ? im.url : undefined,
      })),
      selectedImageIds: cur.selectedImageIds,
    };
  }, [story, getCuration, channels]);

  async function send() {
    const text = input.trim();
    if (!text || busy) return;
    const history: ChatMsg[] = [...messages, { role: "user", content: text }];
    setMessages([...history, { role: "assistant", content: "" }]);
    setInput("");
    setBusy(true);

    let aiText = "";
    const chips: string[] = [];
    const update = () =>
      setMessages((prev) => {
        const next = [...prev];
        next[next.length - 1] = {
          role: "assistant",
          content: aiText,
          chips: [...chips],
        };
        return next;
      });

    try {
      const res = await fetch("/api/engine/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          story: buildContext(),
          messages: history.map((m) => ({ role: m.role, content: m.content })),
          researchSystemPrompt: assembleSystemPrompt(profile.systemPrompt),
        }),
      });
      if (!res.ok || !res.body) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(j.error ?? `Chat error (${res.status})`);
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const frames = buffer.split("\n\n");
        buffer = frames.pop() ?? "";
        for (const frame of frames) {
          const line = frame.trim();
          if (!line.startsWith("data: ")) continue;
          let ev: {
            type: string;
            delta?: string;
            query?: string;
            action?: string;
            caption?: string;
            images?: StoryImage[];
            removals?: string[];
            descriptions?: Record<string, string>;
            error?: string;
          };
          try {
            ev = JSON.parse(line.slice(6));
          } catch {
            continue;
          }
          if (ev.type === "text" && typeof ev.delta === "string") {
            aiText += ev.delta;
            update();
          } else if (ev.type === "search") {
            chips.push(`Searched the web: ${ev.query || "…"}`);
            update();
          } else if (ev.type === "action") {
            if (ev.action === "set_caption" && typeof ev.caption === "string") {
              setCaption(story.id, ev.caption);
              chips.push("Caption updated");
            } else if (ev.action === "add_images" && Array.isArray(ev.images)) {
              addImages(story.id, ev.images);
              chips.push(`Added ${ev.images.length} images to the gallery`);
            } else if (ev.action === "image_reviews") {
              const removals = Array.isArray(ev.removals) ? ev.removals : [];
              const descriptions = ev.descriptions ?? {};
              applyImageEdits(story.id, removals, descriptions);
              const parts = [
                removals.length ? `removed ${removals.length}` : "",
                Object.keys(descriptions).length
                  ? `described ${Object.keys(descriptions).length}`
                  : "",
              ].filter(Boolean);
              chips.push(`Images curated (${parts.join(", ")})`);
            } else if (ev.action === "research_started") {
              chips.push("New research started — see Home");
            }
            update();
          } else if (ev.type === "error" && ev.error) {
            aiText += (aiText ? "\n\n" : "") + `(${ev.error})`;
            update();
          }
        }
      }
      if (!aiText && chips.length === 0) {
        aiText = "(no reply — try again)";
        update();
      }
    } catch (err) {
      aiText +=
        (aiText ? "\n\n" : "") +
        `(${err instanceof Error ? err.message : "Couldn’t reach the chat."})`;
      update();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="gf-chat" aria-label="Story chat">
      {messages.length > 0 && (
        <div className="gf-chat-scroll" ref={scrollRef}>
          {messages.map((m, i) => (
            <div
              key={i}
              className={`gf-chat-msg ${m.role === "user" ? "is-user" : "is-ai"}`}
            >
              {m.chips?.map((c, j) => (
                <span key={j} className="gf-chat-chip">
                  {c}
                </span>
              ))}
              {m.content && <p>{m.content}</p>}
              {m.role === "assistant" &&
                !m.content &&
                (!m.chips || m.chips.length === 0) && (
                  <p className="gf-chat-thinking gf-pulse">thinking…</p>
                )}
            </div>
          ))}
        </div>
      )}

      <textarea
        ref={inputRef}
        className="gf-chat-input"
        value={input}
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            void send();
          }
        }}
        placeholder={
          busy
            ? "Working…"
            : "Ask about this story, rewrite the caption, find images, start research…"
        }
        rows={1}
        disabled={busy}
        aria-label="Message the story chat"
      />

      <div className="gf-chat-foot">
        <span className="gf-chat-meta">
          <CommentIcon size={12} />
          Chat · acts on this story
        </span>
        <div className="gf-caption-actions">
          {messages.length > 0 && (
            <button
              className="gf-btn"
              onClick={() => setMessages([])}
              disabled={busy}
            >
              Clear
            </button>
          )}
          <button
            className="gf-btn"
            onClick={() => void send()}
            disabled={busy || !input.trim()}
          >
            {busy ? "Working…" : "Send"}
          </button>
          <button
            className="gf-btn gf-btn-icon"
            onClick={onClose}
            aria-label="Collapse chat"
            title="Collapse chat"
          >
            <CloseIcon size={14} />
            Collapse
          </button>
        </div>
      </div>
    </div>
  );
}
