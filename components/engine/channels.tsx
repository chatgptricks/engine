"use client";

import { useEffect, useState } from "react";
import { useEngine } from "@/lib/engine/store";
import { channelInitial, type Channel } from "@/lib/engine/channels";
import { CheckIcon, InstagramIcon, PlusIcon, TrashIcon } from "./icons";

/**
 * The Channels screen — every Instagram account this curator manages. New
 * research is tagged with the ACTIVE channel; the grid's filter can scope to
 * any channel.
 *
 * "Connect Instagram" is a real Instagram login (Meta OAuth): the user signs
 * in to Instagram itself and grants access — no keys or codes on their side.
 * Connections live SERVER-side, so on load we reconcile each channel's
 * connected state against /api/instagram/status (cross-device truth), and
 * Disconnect revokes it there too.
 */
export function Channels() {
  const {
    channels,
    activeChannelId,
    addChannel,
    updateChannel,
    removeChannel,
    setActiveChannel,
  } = useEngine();
  const [name, setName] = useState("");
  const [handle, setHandle] = useState("");
  const [note, setNote] = useState<string | null>(null);

  // Reconcile connection state with the server (a connect made on another
  // device — or a disconnect — shows up here).
  useEffect(() => {
    let cancelled = false;
    fetch("/api/instagram/status")
      .then((r) => (r.ok ? r.json() : { connections: [] }))
      .then(
        (j: {
          connections?: Array<{
            channelId: string;
            username: string;
            igUserId: string;
          }>;
        }) => {
          if (cancelled) return;
          const live = new Map(
            (j.connections ?? []).map((c) => [c.channelId, c]),
          );
          queueMicrotask(() => {
            for (const c of channels) {
              const conn = live.get(c.id);
              if (conn && !c.connected) {
                updateChannel(c.id, {
                  connected: true,
                  igUsername: conn.username || undefined,
                  igUserId: conn.igUserId || undefined,
                });
              } else if (!conn && c.connected) {
                updateChannel(c.id, { connected: false });
              }
            }
          });
        },
      )
      .catch(() => {});
    return () => {
      cancelled = true;
    };
    // Run once on mount — `channels` here is the snapshot we reconcile.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const made = addChannel(name, handle);
    if (!made) {
      setNote("Give the channel a name or a handle.");
      setTimeout(() => setNote(null), 3000);
      return;
    }
    setName("");
    setHandle("");
  }

  return (
    <div className="gf-channels-screen">
      <div className="gf-scroll">
        <header className="gf-grid-header">
          <span className="gf-grid-eyebrow">Channels</span>
          <h1 className="gf-grid-title">Your accounts</h1>
          <p className="gf-channels-sub">
            New research is filed under the active channel. Filter the Home
            grid by channel from the toolbar.
          </p>
        </header>

        <div className="gf-channels-list">
          {channels.map((c) => (
            <ChannelCard
              key={c.id}
              channel={c}
              active={c.id === activeChannelId}
              onActivate={() => setActiveChannel(c.id)}
              onRemove={() => removeChannel(c.id)}
              onDisconnected={() => updateChannel(c.id, { connected: false })}
            />
          ))}

          <form className="gf-channel-add" onSubmit={submit}>
            <span className="gf-channel-avatar is-new" aria-hidden>
              <PlusIcon size={15} />
            </span>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Channel name"
              aria-label="Channel name"
            />
            <input
              value={handle}
              onChange={(e) => setHandle(e.target.value)}
              placeholder="@handle"
              aria-label="Instagram handle"
            />
            <button type="submit" className="gf-btn">
              Add channel
            </button>
            {note && <span className="gf-channel-note">{note}</span>}
          </form>
        </div>
      </div>
    </div>
  );
}

function ChannelCard({
  channel,
  active,
  onActivate,
  onRemove,
  onDisconnected,
}: {
  channel: Channel;
  active: boolean;
  onActivate: () => void;
  onRemove: () => void;
  onDisconnected: () => void;
}) {
  const [confirm, setConfirm] = useState(false);
  const [igNote, setIgNote] = useState<string | null>(null);

  async function connect() {
    // Probe first so an unconfigured app explains itself instead of bouncing
    // through a redirect that can't succeed. When configured, this navigates
    // straight into Instagram's own login + permission screen.
    try {
      const res = await fetch(
        `/api/instagram/connect?channel=${encodeURIComponent(channel.id)}&probe=1`,
      );
      const j = (await res.json()) as { url?: string; error?: string };
      if (j.url) {
        window.location.href = j.url;
        return;
      }
      setIgNote(j.error ?? "Instagram login isn’t configured yet.");
    } catch {
      setIgNote("Couldn’t reach the Instagram connect route.");
    }
    setTimeout(() => setIgNote(null), 5000);
  }

  async function disconnect() {
    try {
      await fetch(`/api/instagram/status?channel=${encodeURIComponent(channel.id)}`, {
        method: "DELETE",
      });
      onDisconnected();
    } catch {
      /* leave as-is; the next status reconcile will settle it */
    }
  }

  return (
    <div className={`gf-channel-card${active ? " is-active" : ""}`}>
      <span
        className="gf-channel-avatar"
        style={{ background: channel.color }}
        aria-hidden
      >
        {channelInitial(channel)}
      </span>
      <div className="gf-channel-meta">
        <span className="gf-channel-name">{channel.name}</span>
        <span className="gf-channel-handle">
          {channel.handle ? `@${channel.igUsername || channel.handle}` : "no handle"}
          {channel.connected && (
            <em className="gf-channel-linked">
              <CheckIcon size={10} /> Instagram linked
            </em>
          )}
        </span>
      </div>
      <div className="gf-channel-actions">
        {igNote ? (
          <span className="gf-channel-note">{igNote}</span>
        ) : channel.connected ? (
          <button
            className="gf-btn gf-btn-icon"
            onClick={disconnect}
            title="Unlink this channel's Instagram login"
          >
            <InstagramIcon size={14} />
            Disconnect
          </button>
        ) : (
          <button
            className="gf-btn gf-btn-icon"
            onClick={connect}
            title="Log in with Instagram to link this channel"
          >
            <InstagramIcon size={14} />
            Connect Instagram
          </button>
        )}
        <button
          className={`gf-btn${active ? " is-on" : ""}`}
          onClick={onActivate}
          aria-pressed={active}
          title="New research is filed under the active channel"
        >
          {active ? "Active" : "Make active"}
        </button>
        <button
          className={`gf-channel-remove${confirm ? " is-confirming" : ""}`}
          onClick={() => {
            if (!confirm) {
              setConfirm(true);
              setTimeout(() => setConfirm(false), 3000);
              return;
            }
            onRemove();
          }}
          aria-label={confirm ? "Confirm remove channel" : "Remove channel"}
        >
          {confirm ? "Remove?" : <TrashIcon size={14} />}
        </button>
      </div>
    </div>
  );
}
