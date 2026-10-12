"use client";

import type { ReactNode } from "react";
import {
  ChannelsIcon,
  ChevronLeftIcon,
  HomeIcon,
  PlusIcon,
  UserIcon,
} from "./icons";
import { ResearchMenu } from "./research-menu";

export type Page = "home" | "channels" | "profile";

/**
 * Fixed top navigation bar. Left: the logo, then either the Home/System tabs
 * (browsing) or a back button (inside a story). Right: the Research and Create
 * actions, available from every screen. The contextual controls still live in
 * the bottom dock per screen.
 */
export function TopNav({
  page,
  onNavigate,
  onResearchStarted,
  onCreate,
  onBack,
}: {
  page: Page;
  onNavigate: (page: Page) => void;
  /** Fired once a research run is kicked off — lets the shell show the grid. */
  onResearchStarted?: () => void;
  onCreate: () => void;
  /** Present only inside a story — returns to the grid. */
  onBack?: () => void;
}) {
  return (
    <div className="gf-topnav">
      <div className="gf-topnav-left">
        <a href="/admin/engine" className="gf-logo" aria-label="Back to Engine" title="Back to Engine">
          <span className="gf-logo-dot" />
        </a>
        {onBack ? (
          <button className="gf-back" onClick={onBack} aria-label="Back to grid">
            <ChevronLeftIcon size={17} />
          </button>
        ) : (
          <nav className="gf-navpill" aria-label="Primary">
            <button
              className={page === "home" ? "is-active" : ""}
              aria-current={page === "home" ? "page" : undefined}
              onClick={() => onNavigate("home")}
            >
              <HomeIcon size={15} />
              Home
            </button>
            <button
              className={page === "channels" ? "is-active" : ""}
              aria-current={page === "channels" ? "page" : undefined}
              onClick={() => onNavigate("channels")}
            >
              <ChannelsIcon size={15} />
              Channels
            </button>
            <button
              className={page === "profile" ? "is-active" : ""}
              aria-current={page === "profile" ? "page" : undefined}
              onClick={() => onNavigate("profile")}
            >
              <UserIcon size={15} />
              System
            </button>
          </nav>
        )}
      </div>
      <div className="gf-topnav-right">
        <ResearchMenu onStarted={onResearchStarted} />
        <button className="gf-topnav-btn is-primary" onClick={onCreate}>
          <PlusIcon size={15} />
          Create
        </button>
      </div>
    </div>
  );
}

/**
 * The contextual bottom dock. A single frosted pill that hovers at the bottom
 * center of the screen; each screen fills it with its own controls (filters +
 * search on the grid, view + tools inside a story). Nested pills are flattened
 * inside the dock — see the `.gf-dock` rules in the CSS.
 */
export function Dock({ children }: { children: ReactNode }) {
  return (
    <div className="gf-dock" role="toolbar" aria-label="Actions">
      {children}
    </div>
  );
}

export function DockDivider() {
  return <span className="gf-dock-divider" aria-hidden />;
}
