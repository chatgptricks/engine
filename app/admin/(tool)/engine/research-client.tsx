"use client";

import { useEffect, useState } from "react";
import { EngineProvider, useEngine } from "@/lib/engine/store";
import { TopNav, type Page } from "@/components/engine/dock";
import { Grid } from "@/components/engine/grid";
import { Detail } from "@/components/engine/detail";
import { Profile } from "@/components/engine/profile";
import { Channels } from "@/components/engine/channels";
import { CreateModal } from "@/components/engine/create-modal";
import { ENGINE_FONT_VARS } from "./fonts";

/**
 * Top-level surface. A fixed top nav (logo + Home/System tabs on the left,
 * Research + Create on the right) sits over every screen; each screen owns a
 * contextual bottom dock with its remaining controls (filters + search on the
 * grid, view + tools inside a story).
 */
function App() {
  const { ready, getStory, updateChannel } = useEngine();
  const [page, setPage] = useState<Page>("home");
  const [activeId, setActiveId] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);

  // Returning from the Instagram OAuth flow: mark the channel connected and
  // land on the Channels screen (the callback redirects with these params).
  // Deferred a tick so the state updates don't cascade inside the effect.
  useEffect(() => {
    if (!ready) return;
    const params = new URLSearchParams(window.location.search);
    const connected = params.get("ig_connected");
    if (!connected) return;
    const igUsername = params.get("ig_handle") ?? undefined;
    const igUserId = params.get("ig_id") ?? undefined;
    window.history.replaceState(null, "", window.location.pathname);
    queueMicrotask(() => {
      updateChannel(connected, { connected: true, igUsername, igUserId });
      setPage("channels");
    });
  }, [ready, updateChannel]);

  function navigate(p: Page) {
    setPage(p);
    setActiveId(null);
  }

  function handleCreated() {
    setCreateOpen(false);
    setActiveId(null);
    setPage("home");
  }

  // After research kicks off from the top-right menu, return to the grid so the
  // new "Researching" card is visible.
  function showGrid() {
    setActiveId(null);
    setPage("home");
  }

  if (!ready) {
    return (
      <div className="gf-center">
        <span className="gf-muted-note gf-pulse">Gathering stories…</span>
      </div>
    );
  }

  const activeStory = activeId ? getStory(activeId) : undefined;
  const openCreate = () => setCreateOpen(true);

  return (
    <>
      <TopNav
        page={page}
        onNavigate={navigate}
        onResearchStarted={showGrid}
        onCreate={openCreate}
        onBack={activeStory ? () => setActiveId(null) : undefined}
      />
      {activeStory ? (
        <Detail story={activeStory} />
      ) : page === "home" ? (
        <Grid onOpen={setActiveId} />
      ) : page === "channels" ? (
        <Channels />
      ) : (
        <Profile />
      )}
      {createOpen && (
        <CreateModal
          onClose={() => setCreateOpen(false)}
          onCreated={handleCreated}
        />
      )}
    </>
  );
}

export default function EngineClient() {
  return (
    <div className={`gf-root ${ENGINE_FONT_VARS}`}>
      <EngineProvider>
        <App />
      </EngineProvider>
    </div>
  );
}
