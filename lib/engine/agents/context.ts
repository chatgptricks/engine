/** What every Recreate stage is given, and what it hands back to the orchestrator. */
import type { BrandGuide } from "../../template-editor/brand-guide";
import type { DesignTemplate } from "../../template-editor/model";
import type { PageProfile } from "../page-profiles";
import type { PostFile, PostSource, PostStage } from "../post-files";
import type { ChartData } from "../recreate-data";
import { RecreateError, type SourceImage, type UsageMeter } from "./claude";

/** Held in memory for one run: the original's slides and every downloaded series. */
export type RunCache = { images?: SourceImage[]; chartData: ChartData; uploads?: { name: string; dataUrl: string }[] };

export type StageContext = {
  ownerKey: string;
  /** The post file as it was when the stage started. */
  file: PostFile;
  profile: PageProfile;
  template: DesignTemplate;
  templates: DesignTemplate[];
  /** The page's brand guide (Brand → Guides), when it follows one. Its brief is already in `profile.voice`. */
  guide?: BrandGuide | null;
  signal: AbortSignal;
  usage: UsageMeter;
  cache: RunCache;
  /** Fix round: 0 on the first pass. */
  round: number;
  /** Direction for a rerun, from a person, an agent or a critic. */
  instructions?: string;
  /** This stage's earlier output, when it is being rerun. */
  previous?: unknown;
};

export type StageResult = {
  output: unknown;
  status?: "done" | "skipped";
  /** Changes to the post's source record (the brief stage fills it in after the import). */
  source?: Partial<PostSource>;
};
export type StageRunner = (context: StageContext) => Promise<StageResult>;

/** A finished stage's output, or undefined when it was skipped or hasn't run. */
export function outputOf<T>(file: PostFile, stage: PostStage): T | undefined {
  const record = file.stages[stage];
  return record?.status === "done" ? record.output as T : undefined;
}
export function need<T>(file: PostFile, stage: PostStage): T {
  const value = outputOf<T>(file, stage);
  if (value === undefined) throw new RecreateError(`The ${stage} stage hasn't finished yet.`, 409);
  return value;
}

export const languageName = (profile: PageProfile) => profile.language === "es" ? "Spanish" : "English";
export const today = () => new Date().toISOString().slice(0, 10);
/** Direction for a rerun with instructions: the earlier result and what to fix. A plain rerun starts fresh. */
export function rerunNote(context: StageContext): string {
  if (!context.instructions) return "";
  return [
    context.previous !== undefined ? `YOUR PREVIOUS RESULT\n${JSON.stringify(context.previous)}` : "",
    `FIX THIS (keep everything else as it was)\n${context.instructions}`,
  ].filter(Boolean).join("\n\n");
}
