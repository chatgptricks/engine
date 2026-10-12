import { redirect } from "next/navigation";

/** /engine → the onboarding flow (landing page comes later). */
export default function EngineIndex() {
  redirect("/engine/start");
}
