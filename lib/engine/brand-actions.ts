import {randomUUID} from "node:crypto";
import {BrandGuideError, GUIDE_CHECKS, enabledChecks, runGuideChecks, type BrandGuide, type GuideIssue} from "@/lib/template-editor/brand-guide";
import {designTemplateFromGuide, guideTemplateId, templateBrand, type GuideLanguage} from "@/lib/template-editor/guide-template";
import {parseLibrary, type DesignDocument, type DesignTemplate} from "@/lib/template-editor/model";
import {checkLibrarySaveBudget} from "@/lib/template-editor/library-budget";
import {getEditorLibrary, LibraryConflictError, saveEditorLibrary} from "@/lib/template-editor/persistence";
import {libraryTemplates} from "@/lib/template-editor/template-catalog";
import {CHATGPTRICKS_TEMPLATE_ID} from "@/lib/template-editor/chatgptricks-template";
import {getBrandGuide} from "./brand-guides";
import {listPageProfiles} from "./page-profiles";

/**
 * What agents and the editor do with a guide beyond reading it: check a deck
 * or template against it, and draft a template from it.
 */

export type GuideCheckResult = {
  brand: {id: string; name: string; version: number};
  target: {kind: "deck" | "template"; id: string; name: string};
  checks: {kind: string; label: string}[];
  issues: GuideIssue[];
  summary: string;
};

function summary(issues: GuideIssue[], guide: BrandGuide, kind: "deck" | "template"): string {
  const must = issues.filter(issue => issue.severity === "must_fix").length, should = issues.filter(issue => issue.severity === "should_fix").length;
  if (!issues.length) return `This ${kind} passes every ${guide.name} guide check code can make. Look at the slides too: a critic checks what code can't.`;
  return `${issues.length} issue${issues.length === 1 ? "" : "s"} against the ${guide.name} guide (${must} must fix, ${should} should fix).`;
}

/** Which guide a template or deck follows: the one asked for, else its template's brand tag, else a page that uses its template. */
async function guideFor(ownerKey: string, brandId: string | undefined, template: DesignTemplate | undefined): Promise<BrandGuide> {
  let id = brandId || (template ? templateBrand(template) : undefined);
  if (!id && template) id = (await listPageProfiles(ownerKey)).find(profile => profile.templateId === template.id && profile.brandId)?.brandId;
  if (!id) throw new BrandGuideError("Name the brand to check against (brandId): this deck's template doesn't name one.", 400);
  const guide = await getBrandGuide(ownerKey, id);
  if (!guide) throw new BrandGuideError(`There's no brand guide called ${id}.`, 404);
  return guide;
}

export async function checkAgainstGuide(ownerKey: string, input: {brandId?: string; deckId?: string; templateId?: string}): Promise<GuideCheckResult> {
  if (!input.deckId === !input.templateId) throw new BrandGuideError("Pass either deckId or templateId.", 400);
  const {library} = await getEditorLibrary(ownerKey);
  const templates = libraryTemplates(library);
  let target: DesignDocument | DesignTemplate, kind: "deck" | "template", template: DesignTemplate | undefined;
  if (input.deckId) {
    const deck = library.designs.find(item => item.id === input.deckId && !item.deletedAt);
    if (!deck) throw new BrandGuideError("Deck not found.", 404);
    target = deck; kind = "deck"; template = templates.find(item => item.id === deck.templateId);
  } else {
    template = templates.find(item => item.id === input.templateId);
    if (!template) throw new BrandGuideError("Template not found.", 404);
    target = template; kind = "template";
  }
  const guide = await guideFor(ownerKey, input.brandId, template);
  const issues = runGuideChecks(target, guide, {scope: kind, language: template?.tags?.includes("language:es") ? "es" : "en"});
  return {
    brand: {id: guide.id, name: guide.name, version: guide.version},
    target: {kind, id: target.id, name: target.name},
    checks: [...enabledChecks(guide)].filter(check => kind === "deck" ? GUIDE_CHECKS[check].scope !== "template" : GUIDE_CHECKS[check].scope !== "copy").map(check => ({kind: check, label: GUIDE_CHECKS[check].label})),
    issues,
    summary: summary(issues, guide, kind),
  };
}

export type DraftedTemplate = {
  template: {id: string; name: string; description: string; tags: string[]; pages: string[]};
  replaced: boolean;
  issues: GuideIssue[];
  pagesUsingIt: string[];
};

/**
 * Drafts a template from a guide (English or Spanish) and saves it in the
 * workspace's templates, replacing an earlier draft of the same brand and
 * language. No page switches to it until someone picks it for the page.
 */
export async function draftTemplateFromGuide(ownerKey: string, input: {brandId: string; language: GuideLanguage; baseTemplateId?: string}): Promise<DraftedTemplate> {
  const guide = await getBrandGuide(ownerKey, input.brandId);
  if (!guide) throw new BrandGuideError(`There's no brand guide called ${input.brandId}.`, 404);
  const id = guideTemplateId(guide.id, input.language);
  for (let attempt = 0; attempt < 4; attempt++) {
    const stored = await getEditorLibrary(ownerKey);
    const base = libraryTemplates(stored.library).find(item => item.id === (input.baseTemplateId ?? CHATGPTRICKS_TEMPLATE_ID));
    if (!base) throw new BrandGuideError("The base template wasn't found.", 404);
    // A draft already carries a guide's padding, remark and logo spots; drafting from it again would double them.
    if (base.id === id || base.tags?.some(tag => tag.startsWith("brand-guide:"))) throw new BrandGuideError("Draft from the original template, not from an earlier draft.", 400);
    const drafted = designTemplateFromGuide(guide, base, {language: input.language});
    const existing = stored.library.templates.find(item => item.id === id);
    if (!existing && stored.library.templates.length >= 80) throw new BrandGuideError("This workspace has 80 custom templates, the most it can hold. Delete one first.", 413);
    const templates = [{...drafted, ...(existing?.folderId ? {folderId: existing.folderId} : {}), ...(existing?.favorite ? {favorite: existing.favorite} : {})}, ...stored.library.templates.filter(item => item.id !== id)];
    const next = parseLibrary({...stored.library, templates});
    if (!next) throw new BrandGuideError("The drafted template doesn't fit Engine's template limits.", 422);
    const budget = checkLibrarySaveBudget(next);
    if (!budget.ok) throw new BrandGuideError(budget.error, 413);
    try {
      const saved = await saveEditorLibrary(ownerKey, next, stored.revision, randomUUID());
      const template = saved.library.templates.find(item => item.id === id) ?? drafted;
      const pagesUsingIt = (await listPageProfiles(ownerKey)).filter(profile => profile.templateId === id).map(profile => profile.id);
      return {
        template: {id, name: template.name, description: template.description, tags: template.tags ?? [], pages: template.pages.map((page, index) => page.label ?? `Page ${index + 1}`)},
        replaced: Boolean(existing),
        issues: runGuideChecks(template, guide, {scope: "template", language: input.language}),
        pagesUsingIt,
      };
    } catch (error) {
      if (!(error instanceof LibraryConflictError) || attempt === 3) throw error;
    }
  }
  throw new BrandGuideError("The workspace is busy. Retry in a moment.", 409);
}
