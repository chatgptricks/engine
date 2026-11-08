/**
 * Recreate runs take minutes, so the route answers at once and the work
 * continues after the response. Jobs live in this server process (kept on
 * globalThis so development reloads keep them) and expire after a day. The
 * finished post itself is saved in the workspace, so a lost job never loses
 * work; only its progress record.
 */
import { randomUUID } from "node:crypto";
import type { RecreateResult, RecreateStage } from "./recreate";

export type RecreateJob = {
  jobId: string; ownerKey: string; status: RecreateStage; message: string;
  startedAt: string; updatedAt: string; result?: RecreateResult; error?: string;
};
const TTL_MS = 24 * 60 * 60 * 1000, MAX_ACTIVE_PER_OWNER = 4;
const store = ((globalThis as { __engineRecreateJobs?: Map<string, RecreateJob> }).__engineRecreateJobs ??= new Map());

function prune() {
  const cutoff = Date.now() - TTL_MS;
  for (const [id, job] of store) if (Date.parse(job.updatedAt) < cutoff) store.delete(id);
}
export function activeJobs(ownerKey: string): number {
  return [...store.values()].filter(job => job.ownerKey === ownerKey && job.status !== "done" && job.status !== "error").length;
}
export function createJob(ownerKey: string): RecreateJob | null {
  prune();
  if (activeJobs(ownerKey) >= MAX_ACTIVE_PER_OWNER) return null;
  const now = new Date().toISOString();
  const job: RecreateJob = { jobId: randomUUID(), ownerKey, status: "queued", message: "Waiting to start", startedAt: now, updatedAt: now };
  store.set(job.jobId, job);
  return job;
}
export function updateJob(jobId: string, patch: Partial<Omit<RecreateJob, "jobId" | "ownerKey" | "startedAt">>) {
  const job = store.get(jobId);
  if (job) store.set(jobId, { ...job, ...patch, updatedAt: new Date().toISOString() });
}
export function getJob(ownerKey: string, jobId: string): RecreateJob | null {
  const job = store.get(jobId);
  return job && job.ownerKey === ownerKey ? job : null;
}
/** The public view: never the owner key. */
export function publicJob(job: RecreateJob) {
  const { ownerKey: _owner, ...rest } = job;
  void _owner;
  return rest;
}
