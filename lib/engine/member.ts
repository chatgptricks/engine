import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { getCurrentAdminUser } from "@/lib/supabase/auth-server";

/**
 * Engine membership — the app's subscription identity.
 *
 * Same philosophy as the site's skill unlocks: Stripe is the source of truth,
 * and the cookie is a signed proof that "this device's owner has an active
 * subscription". No user table, no passwords. The payload tag (`gfm`) is
 * distinct from the skills subscriber tag (`sub`), so the two products'
 * tokens are never interchangeable.
 *
 *   payload = `<email>:gfm:<expires_at_unix_seconds>`
 *   cookie  = gf_member=<base64url(email)>.<expires_at>.<hex(hmac)>
 *
 * 30-day rolling: each checkout/recovery visit re-issues it. If the buyer
 * cancels, no new token is minted and access lapses naturally.
 */

const SECRET = process.env.UNLOCK_SECRET ?? "dev-only-do-not-ship-this";

export const MEMBER_COOKIE = "gf_member";
export const MEMBER_TTL_DAYS = 30;
const MEMBER_TTL_SECONDS = MEMBER_TTL_DAYS * 24 * 60 * 60;

function sign(payload: string): string {
  return createHmac("sha256", SECRET).update(payload).digest("hex");
}

function safeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

export function memberExpiry(now = Date.now()): number {
  return Math.floor(now / 1000) + MEMBER_TTL_SECONDS;
}

export function makeMemberToken(
  email: string,
  expiresAt: number = memberExpiry(),
): string {
  const normalized = email.trim().toLowerCase();
  const hmac = sign(`${normalized}:gfm:${expiresAt}`);
  const encoded = Buffer.from(normalized, "utf8").toString("base64url");
  return `${encoded}.${expiresAt}.${hmac}`;
}

export interface MemberClaim {
  email: string;
  expiresAt: number;
}

export function verifyMemberToken(token: string): MemberClaim | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [encoded, expiresAtStr, hmac] = parts;
  const expiresAt = Number(expiresAtStr);
  if (!Number.isFinite(expiresAt)) return null;
  if (expiresAt < Math.floor(Date.now() / 1000)) return null;
  let email: string;
  try {
    email = Buffer.from(encoded, "base64url").toString("utf8");
  } catch {
    return null;
  }
  return safeEqualHex(sign(`${email}:gfm:${expiresAt}`), hmac)
    ? { email, expiresAt }
    : null;
}

/** Stable per-member key used to partition the server story store. */
export function memberOwnerKey(email: string): string {
  return createHash("sha256")
    .update(email.trim().toLowerCase())
    .digest("hex")
    .slice(0, 16);
}

export type EngineAccess =
  | { kind: "owner"; ownerKey: "owner" }
  | { kind: "member"; email: string; ownerKey: string };

export function membersEnabled(): boolean {
  return process.env.GF_ENABLE_MEMBERS === "true" &&
    Boolean(process.env.UNLOCK_SECRET) &&
    Boolean(process.env.STRIPE_SECRET_KEY);
}

/**
 * Who is using the tool right now?
 * - The site owner (Supabase admin session) → full access, the `owner` store.
 * - A paying member (valid gf_member cookie) → their own partition.
 * - Local/worktree dev with no Supabase configured → treated as the owner so
 *   the tool stays openable, matching the layout gate's behavior.
 */
export async function resolveEngineAccess(): Promise<EngineAccess | null> {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) {
    return process.env.NODE_ENV === "production"
      ? null
      : { kind: "owner", ownerKey: "owner" };
  }
  const admin = await getCurrentAdminUser();
  if (admin) return { kind: "owner", ownerKey: "owner" };
  if (!membersEnabled()) return null;
  try {
    const jar = await cookies();
    const token = jar.get(MEMBER_COOKIE)?.value;
    if (token) {
      const claim = verifyMemberToken(token);
      if (claim)
        return {
          kind: "member",
          email: claim.email,
          ownerKey: memberOwnerKey(claim.email),
        };
    }
  } catch {
    /* no cookie store in this context */
  }
  return null;
}
