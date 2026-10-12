import { redirect } from "next/navigation";

/** The studio is the whole app. */
export default function Home() {
  redirect("/admin/engine");
}
