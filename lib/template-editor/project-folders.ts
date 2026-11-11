import type {DesignDocument} from "./model";

/**
 * Projects are filed by page, then by month. Nothing here is stored as a folder:
 * a design's page is its `pageId` (a page profile id, such as chatgptricks), and
 * its month is the month it was created. Designs saved before pages existed are
 * filed by the page tag Recreate gives every post it makes; the rest are Unsorted.
 */

/** The folder for designs with no page. Stored as a design's pageId when someone moves it there, so a page tag can't file it again. */
export const UNSORTED_PAGE_ID = "unsorted";
export const UNSORTED_PAGE_NAME = "Unsorted";

/** What a folder needs to know about a page profile. */
export type ProjectPage = {id: string; name: string; handle?: string};
export type PageFolder = ProjectPage & {count: number; currentMonthCount: number; updatedAt?: string};
export type MonthFolder = {id: string; label: string; count: number; current: boolean};

/** The page a design is filed under: its own pageId, else a page tag Recreate added, else Unsorted. */
export function designPageId(design: Pick<DesignDocument, "pageId" | "tags">, pages: readonly Pick<ProjectPage, "id">[]): string {
  if (design.pageId) return design.pageId;
  const known = new Set(pages.map(page => page.id));
  return design.tags?.find(tag => tag !== UNSORTED_PAGE_ID && known.has(tag)) ?? UNSORTED_PAGE_ID;
}

/** "2026-11" in the viewer's own time zone, so a design made late on the 31st stays in that month. */
export function monthKey(date: Date | string): string {
  const value = typeof date === "string" ? new Date(date) : date;
  if (!Number.isFinite(value.getTime())) return "";
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}`;
}
export function designMonth(design: Pick<DesignDocument, "createdAt">): string {
  return monthKey(design.createdAt);
}
export function isMonthKey(value: string): boolean {
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(value);
}
/** "November 2026". */
export function monthLabel(key: string, locale?: string): string {
  if (!isMonthKey(key)) return "Undated";
  const [year, month] = key.split("-").map(Number);
  return new Date(year, month - 1, 1).toLocaleDateString(locale ?? "en-US", {month: "long", year: "numeric"});
}

/** A page's display name, falling back to its id for a page that was removed. */
export function pageName(pageId: string, pages: readonly ProjectPage[]): string {
  if (pageId === UNSORTED_PAGE_ID) return UNSORTED_PAGE_NAME;
  return pages.find(page => page.id === pageId)?.name ?? pageId;
}

/**
 * One folder per page profile, even when it has no designs yet, plus a folder for
 * any page a design names that isn't a profile any more, then Unsorted when it has designs.
 * Pages keep their profile order; Unsorted comes last.
 */
export function pageFolders(designs: readonly DesignDocument[], pages: readonly ProjectPage[], now: Date = new Date()): PageFolder[] {
  const current = monthKey(now), folders = new Map<string, PageFolder>();
  for (const page of pages) if (page.id !== UNSORTED_PAGE_ID) folders.set(page.id, {...page, count: 0, currentMonthCount: 0});
  for (const design of designs) {
    if (design.deletedAt) continue;
    const id = designPageId(design, pages);
    const folder = folders.get(id) ?? {id, name: pageName(id, pages), count: 0, currentMonthCount: 0};
    folder.count++;
    if (designMonth(design) === current) folder.currentMonthCount++;
    if (!folder.updatedAt || design.updatedAt > folder.updatedAt) folder.updatedAt = design.updatedAt;
    folders.set(id, folder);
  }
  const unsorted = folders.get(UNSORTED_PAGE_ID);
  folders.delete(UNSORTED_PAGE_ID);
  return [...folders.values(), ...(unsorted ? [unsorted] : [])];
}

/** A page's months: the current month first (even when empty, so a new month starts its own folder), then older months, newest first. */
export function monthFolders(designs: readonly DesignDocument[], pageId: string, pages: readonly ProjectPage[], now: Date = new Date(), locale?: string): MonthFolder[] {
  const current = monthKey(now), counts = new Map<string, number>([[current, 0]]);
  for (const design of designs) {
    if (design.deletedAt || designPageId(design, pages) !== pageId) continue;
    const month = designMonth(design);
    counts.set(month, (counts.get(month) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort(([a], [b]) => a === current ? -1 : b === current ? 1 : b.localeCompare(a))
    .map(([id, count]) => ({id, label: monthLabel(id, locale), count, current: id === current}));
}

/** Where someone is in Projects: every page, one page's months, or one month of one page. */
export type ProjectLocation = {page: string; month: string};
export function inProjectLocation(design: DesignDocument, location: ProjectLocation, pages: readonly ProjectPage[]): boolean {
  if (location.page && designPageId(design, pages) !== location.page) return false;
  if (location.month && designMonth(design) !== location.month) return false;
  return true;
}

/** The page a new design made here belongs to: the folder's page, or none outside a page and in Unsorted. */
export function pageForNewDesign(location: ProjectLocation): string | undefined {
  return location.page && location.page !== UNSORTED_PAGE_ID ? location.page : undefined;
}

/** Moves designs to another page (or Unsorted). Their month stays the month they were made. */
export function moveDesignsToPage<T extends Pick<DesignDocument, "id" | "pageId" | "updatedAt" | "deletedAt">>(designs: readonly T[], ids: readonly string[], pageId: string, now = new Date().toISOString()): T[] {
  const selected = new Set(ids);
  return designs.map(design => selected.has(design.id) && !design.deletedAt && design.pageId !== pageId ? {...design, pageId, updatedAt: now} : design);
}
