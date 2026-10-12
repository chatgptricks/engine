import type { Metadata } from "next";
import EngineClient from "./client";
import {resolveEngineAccess} from "@/lib/engine/member";
import {editorOwnerScope} from "@/lib/template-editor/persistence";

export const metadata: Metadata = {
  title: "Engine · Template Studio",
  description:
    "Create posts and carousels with defined templates, editable designs, and a reusable brand kit.",
  robots: { index: false, follow: false },
};

export default async function EnginePage() {
  const access = await resolveEngineAccess();
  return <EngineClient workspaceScope={access ? editorOwnerScope(access.ownerKey) : undefined} />;
}
