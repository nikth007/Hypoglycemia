import { NextResponse } from "next/server";
import { GROUPS, type Group } from "@/lib/admissions";
import { dataStatus, saveCounts } from "@/lib/db";
import type { DayCounts } from "@/lib/forecast";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DAY = /^\d{4}-\d{2}-\d{2}$/;

export async function GET() {
  try {
    return NextResponse.json(await dataStatus());
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}

/** Body: { source, firstDay, lastDay, rowsUsed, rowsSkipped, counts: { group: { day: [n0, n1, n2] } } } */
export async function POST(req: Request) {
  let body: any;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  const { counts, firstDay, lastDay } = body ?? {};
  if (!DAY.test(firstDay) || !DAY.test(lastDay) || firstDay > lastDay)
    return NextResponse.json({ error: "Invalid date range" }, { status: 400 });
  for (const g of GROUPS) {
    const c = counts?.[g];
    if (!c || typeof c !== "object") return NextResponse.json({ error: `Missing counts for ${g}` }, { status: 400 });
    for (const [day, v] of Object.entries(c)) {
      const ok = DAY.test(day) && day >= firstDay && day <= lastDay && Array.isArray(v) && v.length === 3 &&
        v.every((n) => Number.isInteger(n) && n >= 0 && n < 1000);
      if (!ok) return NextResponse.json({ error: `Invalid count for ${g} on ${day}` }, { status: 400 });
    }
  }
  try {
    const n = await saveCounts(counts as Record<Group, DayCounts>, {
      source: String(body.source ?? "upload").slice(0, 200), firstDay, lastDay,
      rowsUsed: Number(body.rowsUsed) || 0, rowsSkipped: Number(body.rowsSkipped) || 0,
    });
    return NextResponse.json({ saved: n, status: await dataStatus() });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
