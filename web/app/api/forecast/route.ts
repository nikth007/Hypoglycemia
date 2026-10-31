import { NextResponse } from "next/server";
import { GROUPS, GROUP_LABELS } from "@/lib/admissions";
import { addDays } from "@/lib/dates";
import { dataStatus, loadCounts } from "@/lib/db";
import { forecastDay } from "@/lib/forecast";
import { forecastModels } from "@/lib/models";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const HISTORY_DAYS = 56;

export async function GET() {
  try {
    const status = await dataStatus();
    if (!status.lastDay) return NextResponse.json({ status, groups: null });
    const target = addDays(status.lastDay, 1);
    // features need up to 91 days before each day; history chart backtests the last 56 days
    const counts = await loadCounts(addDays(status.lastDay, -(HISTORY_DAYS + 91)), status.lastDay);
    const fm = forecastModels();
    const groups = GROUPS.map((g) => {
      const model = fm.groups[g].model;
      const next = forecastDay(model, counts[g], target);
      const history = [];
      for (let k = HISTORY_DAYS - 1; k >= 0; k--) {
        const day = addDays(status.lastDay!, -k);
        const c = counts[g][day];
        const back = forecastDay(model, counts[g], day);
        history.push({ day, actual: c ? c[0] + c[1] + c[2] : null, forecast: back?.expected ?? null });
      }
      return {
        key: g,
        label: GROUP_LABELS[g],
        test: fm.groups[g].test,
        next: next && {
          day: next.day,
          expected: next.expected,
          upper90: next.upper90,
          shifts: next.shifts,
          pAtLeast2: next.pAtLeast(2),
        },
        history,
      };
    });
    return NextResponse.json({ status, target, groups });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
