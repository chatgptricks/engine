"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useEngine } from "@/lib/engine/store";
import { formatCompletedAt, leadImageOf, proxied } from "@/lib/engine/util";
import type { Story, StoryStatus } from "@/lib/engine/types";
import { Dock, DockDivider } from "./dock";
import { CheckIcon, FilterIcon, RetryIcon, SearchIcon, StarIcon, TrashIcon } from "./icons";

type Tab = "for_you" | "researching" | "queue" | "published" | "starred" | "shelved";
type Sort = "newest" | "az";

/** The active view's title, shown under the "Home" eyebrow. */
const VIEW_LABELS: Record<Tab, string> = {
  for_you: "All Stories",
  researching: "Researching",
  queue: "Queue",
  published: "Published",
  starred: "Starred",
  shelved: "Set aside",
};

/**
 * Screen 1 — the story grid. A stable, top-aligned grid of frosted cards on the
 * off-black field. The contextual dock at the bottom holds everything: the
 * Home/Profile nav, the status filters, sort, search, and Create.
 */
export function Grid({ onOpen }: { onOpen: (storyId: string) => void }) {
  const { stories, isPublished, channels, getCuration } = useEngine();
  const [tab, setTab] = useState<Tab>("for_you");
  const [sort, setSort] = useState<Sort>("newest");
  const [channel, setChannel] = useState<string>("all");
  const [query, setQuery] = useState("");

  // A removed channel shouldn't leave the grid silently filtered to nothing.
  const channelFilter = channels.some((c) => c.id === channel) ? channel : "all";

  const byChannel = useMemo(
    () =>
      channelFilter === "all"
        ? stories
        : stories.filter((s) => s.channelId === channelFilter),
    [stories, channelFilter],
  );

  const counts = useMemo(() => {
    const shelved = (s: Story) => Boolean(getCuration(s.id).shelved);
    const active = byChannel.filter((s) => !shelved(s));
    return {
      for_you: active.length,
      researching: active.filter((s) => s.status === "researching").length,
      queue: active.filter((s) => s.status === "queue").length,
      published: active.filter((s) => isPublished(s)).length,
      starred: byChannel.filter((s) => getCuration(s.id).starred).length,
      shelved: byChannel.filter(shelved).length,
    };
  }, [byChannel, isPublished, getCuration]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = byChannel.filter((s) => {
      const cur = getCuration(s.id);
      if (tab === "starred") return Boolean(cur.starred);
      if (tab === "shelved") return Boolean(cur.shelved);
      // Set-aside stories stay out of every working view (that's the point —
      // parked, not deleted). They live under the Set aside filter only.
      if (cur.shelved) return false;
      if (tab === "researching") return s.status === "researching";
      if (tab === "queue") return s.status === "queue";
      if (tab === "published") return isPublished(s);
      return true; // "for you" = all surfaced stories
    });
    const matched = q
      ? list.filter((s) =>
          `${s.title} ${s.description} ${s.caption.draft}`.toLowerCase().includes(q),
        )
      : list;
    return [...matched].sort((a, b) =>
      sort === "az"
        ? a.title.localeCompare(b.title)
        : +new Date(b.researchCompletedAt) - +new Date(a.researchCompletedAt),
    );
  }, [byChannel, query, tab, sort, isPublished, getCuration]);

  return (
    <div className="gf-grid-screen">
      <div className="gf-scroll">
        <header className="gf-grid-header">
          <span className="gf-grid-eyebrow">Home</span>
          <h1 className="gf-grid-title">{VIEW_LABELS[tab]}</h1>
        </header>
        <div className="gf-cardgrid">
          {visible.map((story) => (
            <StoryCard key={story.id} story={story} onOpen={onOpen} />
          ))}
        </div>
        {visible.length === 0 && (
          <p className="gf-grid-empty">
            {query
              ? `No stories match “${query}.”`
              : "No stories in this view yet — hit Research up top to start one."}
          </p>
        )}
      </div>

      <Dock>
        <FilterMenu
          tab={tab}
          setTab={setTab}
          sort={sort}
          setSort={setSort}
          counts={counts}
          channel={channelFilter}
          setChannel={setChannel}
        />
        <DockDivider />
        <label className="gf-dock-search">
          <SearchIcon />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search…"
            aria-label="Search stories"
          />
        </label>
      </Dock>
    </div>
  );
}

const FILTERS: Array<[Tab, string]> = [
  ["for_you", "For you"],
  ["researching", "Researching"],
  ["queue", "Queue"],
  ["published", "Published"],
  ["starred", "Starred"],
  ["shelved", "Set aside"],
];

/**
 * The filter/sort control: a single icon button in the dock that opens a
 * frosted "liquid glass" popover above it. The selected option is full-opacity
 * text with a check — no pill. Default is For you + Most recent (all stories,
 * newest first).
 */
function FilterMenu({
  tab,
  setTab,
  sort,
  setSort,
  counts,
  channel,
  setChannel,
}: {
  tab: Tab;
  setTab: (t: Tab) => void;
  sort: Sort;
  setSort: (s: Sort) => void;
  counts: Record<Tab, number>;
  channel: string;
  setChannel: (id: string) => void;
}) {
  const { channels } = useEngine();
  const [open, setOpen] = useState(false);
  const dirty = tab !== "for_you" || sort !== "newest" || channel !== "all";
  return (
    <div className="gf-filter">
      <button
        className={`gf-filter-btn${open ? " is-open" : ""}${dirty ? " is-dirty" : ""}`}
        onClick={() => setOpen((o) => !o)}
        aria-label="Filter and sort"
        aria-expanded={open}
      >
        <FilterIcon size={16} />
      </button>
      {open && (
        <>
          <button
            className="gf-filter-backdrop"
            aria-label="Close filter"
            onClick={() => setOpen(false)}
          />
          <div className="gf-filter-menu" role="menu">
            {channels.length > 0 && (
              <>
                <div className="gf-filter-grouplabel">Channel</div>
                {[
                  { id: "all", label: "All channels" },
                  ...channels.map((c) => ({
                    id: c.id,
                    label: c.name || `@${c.handle}`,
                  })),
                ].map((c) => (
                  <button
                    key={c.id}
                    role="menuitemradio"
                    aria-checked={channel === c.id}
                    className={`gf-filter-opt${channel === c.id ? " is-active" : ""}`}
                    onClick={() => {
                      setChannel(c.id);
                      setOpen(false);
                    }}
                  >
                    <span className="gf-filter-check">
                      {channel === c.id && <CheckIcon size={12} />}
                    </span>
                    <span className="gf-filter-opt-label">{c.label}</span>
                  </button>
                ))}
                <div className="gf-filter-sep" />
              </>
            )}
            <div className="gf-filter-grouplabel">Show</div>
            {FILTERS.map(([key, label]) => (
              <button
                key={key}
                role="menuitemradio"
                aria-checked={tab === key}
                className={`gf-filter-opt${tab === key ? " is-active" : ""}`}
                onClick={() => {
                  setTab(key);
                  setOpen(false);
                }}
              >
                <span className="gf-filter-check">
                  {tab === key && <CheckIcon size={12} />}
                </span>
                <span className="gf-filter-opt-label">{label}</span>
                <span className="gf-filter-count">{counts[key]}</span>
              </button>
            ))}
            <div className="gf-filter-sep" />
            <div className="gf-filter-grouplabel">Sort</div>
            {(
              [
                ["newest", "Most recent"],
                ["az", "A–Z"],
              ] as Array<[Sort, string]>
            ).map(([key, label]) => (
              <button
                key={key}
                role="menuitemradio"
                aria-checked={sort === key}
                className={`gf-filter-opt${sort === key ? " is-active" : ""}`}
                onClick={() => {
                  setSort(key);
                  setOpen(false);
                }}
              >
                <span className="gf-filter-check">
                  {sort === key && <CheckIcon size={12} />}
                </span>
                <span className="gf-filter-opt-label">{label}</span>
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function statusMeta(
  story: Story,
  published: boolean,
): { label: string; status: StoryStatus | "published" } {
  if (published) return { label: "Published", status: "published" };
  if (story.status === "researching")
    return { label: "Researching", status: "researching" };
  if (story.status === "failed") return { label: "Didn’t finish", status: "failed" };
  if (story.status === "queue") return { label: "Queue", status: "queue" };
  return { label: "For you", status: "for_you" };
}

function StoryCard({
  story,
  onOpen,
}: {
  story: Story;
  onOpen: (storyId: string) => void;
}) {
  const { isPublished, deleteStory, retryResearch, toggleStar, getCuration } = useEngine();
  const [confirmDel, setConfirmDel] = useState(false);
  const confirmTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lead = leadImageOf(story);
  const starred = Boolean(getCuration(story.id).starred);
  const published = isPublished(story);
  const meta = statusMeta(story, published);
  const researching = meta.status === "researching";
  const failed = meta.status === "failed";

  // Clear the pending confirm timer on unmount.
  useEffect(
    () => () => {
      if (confirmTimer.current) clearTimeout(confirmTimer.current);
    },
    [],
  );

  return (
    <article
      className="gf-card"
      role="button"
      tabIndex={0}
      onClick={() => onOpen(story.id)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpen(story.id);
        }
      }}
    >
      <div className="gf-card-media">
        {lead ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={proxied(lead.url)}
            alt={story.title}
            width={lead.width || undefined}
            height={lead.height || undefined}
            loading="lazy"
            referrerPolicy="no-referrer"
          />
        ) : (
          <div className="gf-card-placeholder">
            <span className={failed ? "gf-card-failnote" : "gf-pulse"}>
              {failed ? "didn’t finish" : "researching…"}
            </span>
          </div>
        )}
        <span
          className={`gf-card-status${researching ? " is-researching" : ""}${
            failed ? " is-failed" : ""
          }`}
          title={failed ? story.error || undefined : undefined}
        >
          <i className="gf-dot" aria-hidden />
          {meta.label}
        </span>
        <button
          type="button"
          className={`gf-card-fav${starred ? " is-on" : ""}`}
          aria-label={starred ? "Unstar story" : "Star story"}
          aria-pressed={starred}
          title={starred ? "Unstar" : "Star"}
          onClick={(e) => {
            e.stopPropagation();
            toggleStar(story.id);
          }}
        >
          <StarIcon size={14} filled={starred} />
        </button>
        <button
          type="button"
          className={`gf-card-delete${confirmDel ? " is-confirming" : ""}`}
          aria-label={confirmDel ? "Confirm delete" : "Delete story"}
          title={confirmDel ? "Click again to delete" : "Delete story"}
          onClick={(e) => {
            e.stopPropagation();
            if (!confirmDel) {
              setConfirmDel(true);
              if (confirmTimer.current) clearTimeout(confirmTimer.current);
              confirmTimer.current = setTimeout(() => setConfirmDel(false), 3000);
              return;
            }
            if (confirmTimer.current) clearTimeout(confirmTimer.current);
            deleteStory(story.id);
          }}
        >
          {confirmDel ? "Delete?" : <TrashIcon size={14} />}
        </button>
        <div className="gf-card-scrim">
          <h3 className="gf-card-title">{story.title}</h3>
          {failed ? (
            <button
              type="button"
              className="gf-card-retry"
              onClick={(e) => {
                e.stopPropagation();
                retryResearch(story.id);
              }}
            >
              <RetryIcon size={13} />
              Retry research
            </button>
          ) : (
            <p className="gf-card-sub">
              {formatCompletedAt(story.researchCompletedAt)}
            </p>
          )}
        </div>
      </div>
    </article>
  );
}
