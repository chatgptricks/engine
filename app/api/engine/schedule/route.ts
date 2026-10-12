import { getCurrentAdminUser } from "@/lib/supabase/auth-server";
import { getSchedule, saveSchedule } from "@/lib/engine/db";

export const runtime = "nodejs";

async function gate(): Promise<boolean> {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) return process.env.NODE_ENV !== "production";
  return Boolean(await getCurrentAdminUser());
}

export async function GET() {
  if (!(await gate())) return Response.json({ error: "Unauthorized" }, { status: 401 });
  return Response.json({ schedule: await getSchedule() });
}

export async function PUT(request: Request) {
  if (!(await gate())) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const body = (await request.json().catch(() => ({}))) as {
    enabled?: boolean;
    intervalMinutes?: number;
  };
  const updated = await saveSchedule({
    enabled: typeof body.enabled === "boolean" ? body.enabled : undefined,
    intervalMinutes:
      typeof body.intervalMinutes === "number" ? body.intervalMinutes : undefined,
  });
  if (!updated) {
    return Response.json(
      { error: "Scheduler store not configured (run migration 0014 + set SUPABASE_SERVICE_ROLE_KEY)." },
      { status: 503 },
    );
  }
  return Response.json({ schedule: updated });
}
