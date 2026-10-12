"use client";

import { useEffect, useRef, useState } from "react";
import { useEngine } from "@/lib/engine/store";
import { DEFAULT_SYSTEM_PROMPT } from "@/lib/engine/profile";
import { formatCompletedAt } from "@/lib/engine/util";
import type { EngineSchedule } from "@/lib/engine/db";
import { SearchIcon } from "./icons";

/**
 * System page (the top-nav "System" tab). Two jobs:
 *  - Store our Instagram handle (so a future Apify integration knows which
 *    account is ours, for pulling our own metrics later).
 *  - Edit the research system prompt, one editable box per section.
 * Everything autosaves to localStorage via the store. Nav + Create live in the
 * top bar now, so this page has no bottom dock.
 */
export function Profile() {
  const { profile, setInstagram, setPromptSection } = useEngine();
  const defaults = new Map(DEFAULT_SYSTEM_PROMPT.map((s) => [s.key, s.content]));

  return (
    <div className="gf-page-scroll">
      <div className="gf-profile">
        <header className="gf-profile-head">
          <h1 className="gf-profile-title">System</h1>
          <p className="gf-profile-sub">
            Your account and the brief that steers research. Saved automatically.
          </p>
        </header>

        <section className="gf-profile-section">
          <div className="gf-field-label">Instagram account</div>
          <p className="gf-field-help">
            The account these carousels publish to. Stored so Apify can pull our
            own post metrics later.
          </p>
          <div className="gf-ig-field">
            <span className="gf-ig-at">@</span>
            <input
              className="gf-ig-input"
              value={profile.instagram}
              onChange={(e) => setInstagram(e.target.value)}
              placeholder="engine"
              spellCheck={false}
              autoCapitalize="none"
              autoCorrect="off"
            />
          </div>
        </section>

        <SchedulerSection />

        <section className="gf-profile-section">
          <div className="gf-field-label">Research system prompt</div>
          <p className="gf-field-help">
            The standing instructions the automated story-finder follows. Edit any
            section.
          </p>

          <div className="gf-prompt-sections">
            {profile.systemPrompt.map((s) => {
              const changed = defaults.get(s.key) !== s.content;
              return (
                <div className="gf-prompt-section" key={s.key}>
                  <div className="gf-prompt-section-head">
                    <span className="gf-prompt-section-label">{s.label}</span>
                    {changed && (
                      <button
                        className="gf-prompt-reset"
                        onClick={() =>
                          setPromptSection(s.key, defaults.get(s.key) ?? "")
                        }
                      >
                        Reset
                      </button>
                    )}
                  </div>
                  <AutoTextarea
                    value={s.content}
                    onChange={(v) => setPromptSection(s.key, v)}
                  />
                </div>
              );
            })}
          </div>
        </section>
      </div>
    </div>
  );
}

const INTERVALS: Array<[number, string]> = [
  [60, "Every hour"],
  [360, "Every 6 hours"],
  [720, "Every 12 hours"],
  [1440, "Once a day"],
  [4320, "Every 3 days"],
  [10080, "Once a week"],
];

/**
 * The automatic-research scheduler. Reads/writes the server schedule
 * (Supabase) via /api/engine/schedule. The toggle is the kill switch;
 * the select is the interval; "Run now" forces an immediate run. Renders
 * nothing if the scheduler store isn't reachable.
 */
function SchedulerSection() {
  const [schedule, setSchedule] = useState<EngineSchedule | null>(null);
  const [saving, setSaving] = useState(false);
  const [running, setRunning] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/engine/schedule")
      .then((r) => (r.ok ? r.json() : null))
      .then((j: { schedule?: EngineSchedule } | null) => {
        if (!cancelled && j?.schedule) setSchedule(j.schedule);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  async function patch(p: { enabled?: boolean; intervalMinutes?: number }) {
    setSaving(true);
    setNote(null);
    try {
      const res = await fetch("/api/engine/schedule", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(p),
      });
      const j = (await res.json()) as { schedule?: EngineSchedule; error?: string };
      if (res.ok && j.schedule) setSchedule(j.schedule);
      else setNote(j.error ?? "Couldn’t save.");
    } catch {
      setNote("Couldn’t save.");
    } finally {
      setSaving(false);
    }
  }

  async function runNow() {
    setRunning(true);
    setNote(
      "Researching… a “Researching” card appears in your grid within a minute; it fills in once done (a few minutes). You can leave this page.",
    );
    try {
      const res = await fetch("/api/engine/cron?force=1");
      const j = (await res.json()) as {
        ok?: boolean;
        title?: string;
        error?: string;
        skipped?: string;
      };
      setNote(
        res.ok && j.ok
          ? `Done — generated “${j.title}.”`
          : j.error ?? `Skipped (${j.skipped ?? "unknown"}).`,
      );
    } catch {
      // Navigating away cancels this fetch, but the research keeps running on
      // the server and the card fills in — so this isn't a real failure.
      setNote("Running in the background — your card will fill in shortly.");
    } finally {
      setRunning(false);
    }
  }

  if (!schedule) return null;

  return (
    <section className="gf-profile-section">
      <div className="gf-field-label">Automatic research</div>
      <p className="gf-field-help">
        When on, the finder researches and queues a new story on its own — on
        the server, even with your computer closed. Off pauses it completely
        until you turn it back on.
      </p>
      <div className="gf-sched">
        <div className="gf-sched-row">
          <span className="gf-sched-name">
            {schedule.enabled ? "Running" : "Paused"}
          </span>
          <button
            className={`gf-switch${schedule.enabled ? " is-on" : ""}`}
            role="switch"
            aria-checked={schedule.enabled}
            aria-label="Automatic research on/off"
            disabled={saving}
            onClick={() => patch({ enabled: !schedule.enabled })}
          >
            <span className="gf-switch-knob" />
          </button>
        </div>
        <label className="gf-sched-row">
          <span className="gf-sched-name">Frequency</span>
          <select
            className="gf-sched-select"
            value={schedule.intervalMinutes}
            disabled={saving}
            onChange={(e) => patch({ intervalMinutes: Number(e.target.value) })}
          >
            {INTERVALS.map(([m, label]) => (
              <option key={m} value={m}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <div className="gf-sched-foot">
          <span className="gf-sched-status">
            {schedule.lastRunAt
              ? `Last run ${formatCompletedAt(schedule.lastRunAt)}`
              : "Hasn’t run yet"}
          </span>
          <button
            className="gf-btn gf-btn-icon"
            onClick={runNow}
            disabled={running}
          >
            <SearchIcon size={14} />
            {running ? "Researching…" : "Run now"}
          </button>
        </div>
        {note && <p className="gf-sched-note">{note}</p>}
      </div>
    </section>
  );
}

/** A textarea that grows to fit its content, so a whole prompt section is
 *  visible without an inner scrollbar. */
function AutoTextarea({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [value]);

  return (
    <textarea
      ref={ref}
      className="gf-prompt-textarea"
      value={value}
      spellCheck={false}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}
