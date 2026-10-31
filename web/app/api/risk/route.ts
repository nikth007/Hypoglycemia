import { NextResponse } from "next/server";
import { returnModels } from "@/lib/models";
import { scoreReturn, type RiskInput } from "@/lib/returnRisk";
import { saveAssessment } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DISPOSITIONS = ["ED-Home", "OP-Home", "Discharge at Request", "Ref.To OPD"];
const num = (v: unknown) => (v === null || v === undefined || v === "" ? null : Number.isFinite(Number(v)) ? Number(v) : null);
const count = (v: unknown) => Math.max(0, Math.floor(num(v) ?? 0));
const text = (v: unknown) => String(v ?? "").slice(0, 2000);

export async function POST(req: Request) {
  let b: any;
  try { b = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(b?.arrivalDate ?? "")) return NextResponse.json({ error: "Arrival date is required" }, { status: 400 });
  if (!DISPOSITIONS.includes(b.disposition)) return NextResponse.json({ error: "Disposition must be a sent-home disposition" }, { status: 400 });
  const input: RiskInput = {
    arrivalDate: b.arrivalDate,
    age: num(b.age),
    sex: b.sex === "male" || b.sex === "female" ? b.sex : "unknown",
    hr: num(b.hr), rr: num(b.rr), bpSystolic: num(b.bpSystolic), tempF: num(b.tempF), spo2: num(b.spo2),
    disposition: b.disposition,
    chiefComplaints: text(b.chiefComplaints), finalDiagnosis: text(b.finalDiagnosis), otherComplaints: text(b.otherComplaints),
    erPrev30d: count(b.erPrev30d), erPrev365d: count(b.erPrev365d), erPrevAll: count(b.erPrevAll), erDaysSinceLast: num(b.erDaysSinceLast),
    ipPrev30d: count(b.ipPrev30d), ipPrev365d: count(b.ipPrev365d), ipPrevAll: count(b.ipPrevAll), ipDaysSinceLast: num(b.ipDaysSinceLast),
  };
  const result = scoreReturn(returnModels(), input);
  const risks = result.targets.map(({ key, risk, flagged }) => ({ key, risk, flagged }));
  let saved = false, saveError: string | null = null;
  if (b.save === true) {
    try { await saveAssessment(result.features, risks); saved = true; } catch (e) { saveError = (e as Error).message; }
  }
  const features = Object.fromEntries(Object.entries(result.features).map(([k, v]) => [k, Number.isNaN(v) ? null : v]));
  return NextResponse.json({ targets: result.targets, features, saved, saveError, alertShare: returnModels().alert_share });
}
