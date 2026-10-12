import {notFound} from "next/navigation";
import {getPublicReview} from "@/lib/template-editor/reviews";
import ReviewViewer from "@/components/template-editor/review-viewer";
import {ENGINE_FONT_VARS} from "@/app/admin/(tool)/engine/fonts";
import "@/app/admin/(tool)/engine/engine.css";
import "@/app/admin/(tool)/engine/licensed-fonts.css";
import "@/components/template-editor/studio.css";
export const dynamic = "force-dynamic";
export const metadata = {title: "Engine · Design review", robots: {index: false, follow: false}, referrer: "no-referrer"};
export default async function ReviewPage({params}: {params: Promise<{token: string}>}) {
  const {token} = await params, review = await getPublicReview(token); if (!review) notFound();
  return <div className={`gf-root te-root ${ENGINE_FONT_VARS}`}><ReviewViewer token={token} review={review} /></div>;
}
