"use client";
import { useCallback, useEffect, useState } from "react";
import ForecastChart, { type Point } from "./ForecastChart";
import UploadCard from "./UploadCard";
import { WarnIcon } from "./Icons";
import { SHIFT_LABELS } from "@/lib/admissions";

interface GroupResult {
  key: string; label: string;
  test: { shift_MAE: number; daily_MAE: number; daily_P90_coverage: number; baseline_shift_MAE: number };
  next: { day: string; expected: number; upper90: number; shifts: { expected: number; upper90: number }[]; pAtLeast2: number } | null;
  history: Point[];
}
interface Data {
  status: { firstDay: string | null; lastDay: string | null; days: number; lastUpload: { uploaded_at: string; source: string } | null };
  target?: string; groups: GroupResult[] | null; error?: string;
}

const longDay = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

export default function ForecastPanel() {
  const [data, setData] = useState<Data | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [group, setGroup] = useState("total");

  const load = useCallback(async () => {
    setErr(null);
    try {
      const r = await fetch("/api/forecast", { cache: "no-store" });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? r.statusText);
      setData(j);
    } catch (e) { setErr((e as Error).message); }
  }, []);
  useEffect(() => { load(); }, [load]);

  if (err) return <div className="stack"><div className="card error">Could not load the forecast: {err}</div><UploadCard onSaved={load} /></div>;
  if (!data) return <div className="card muted">Loading forecast…</div>;
  if (!data.groups) return (
    <div className="stack">
      <div className="card"><h2>No admissions data yet</h2><p className="muted">Upload the ER export below to create the first forecast.</p></div>
      <UploadCard onSaved={load} />
    </div>
  );

  const g = data.groups.find((x) => x.key === group) ?? data.groups[0];
  const today = new Date().toISOString().slice(0, 10);
  const staleDays = data.status.lastDay ? Math.round((Date.parse(today) - Date.parse(data.status.lastDay)) / 86400000) - 1 : 0;

  return (
    <div className="stack">
      <div className="card">
        <div className="row" style={{ justifyContent: "space-between" }}>
          <div>
            <h2>Admissions from the ER — forecast for {data.target ? longDay(data.target) : "—"}</h2>
            <div className="small muted">Data through {data.status.lastDay ? longDay(data.status.lastDay) : "—"} · {data.status.days.toLocaleString()} days of history</div>
          </div>
          <div className="seg" role="group" aria-label="Unit group">
            {data.groups.map((x) => (
              <button key={x.key} aria-pressed={x.key === g.key} onClick={() => setGroup(x.key)}>{x.label}</button>
            ))}
          </div>
        </div>
        {staleDays > 0 && (
          <div className="notice" style={{ marginTop: 12 }}>
            <WarnIcon />
            <span>The latest data is {staleDays} day{staleDays === 1 ? "" : "s"} older than yesterday, so this forecast is for {data.target}, not tomorrow. Upload the latest ER TO IP export to forecast tomorrow.</span>
          </div>
        )}
        {g.next ? (
          <div className="tiles">
            <div className="tile"><div className="label">Expected admissions</div><div className="value">{g.next.expected.toFixed(1)}</div><div className="sub">{g.label}, whole day</div></div>
            <div className="tile"><div className="label">Plan beds for up to</div><div className="value">{g.next.upper90}</div><div className="sub">enough on 9 of 10 days</div></div>
            {g.next.shifts.map((s, i) => (
              <div className="tile" key={i}><div className="label">Shift {SHIFT_LABELS[i]}</div><div className="value">{s.expected.toFixed(1)}</div><div className="sub">up to {s.upper90}</div></div>
            ))}
            {g.key === "adult_icu_imcu" && (
              <div className="tile"><div className="label">Chance of 2 or more</div><div className="value">{Math.round(g.next.pAtLeast2 * 100)}%</div><div className="sub">critical-care admissions</div></div>
            )}
          </div>
        ) : <p className="muted">Need at least 28 days of history to forecast.</p>}
        <ForecastChart history={g.history} next={g.next && { day: g.next.day, expected: g.next.expected, upper90: g.next.upper90 }} />
        <p className="tiny" style={{ marginBottom: 0 }}>
          Accuracy on 2025–26 (unseen): typical daily error ±{g.test.daily_MAE.toFixed(1)} admissions; the “plan for” figure covered the actual count on {Math.round(g.test.daily_P90_coverage * 100)}% of days.
          This is close to the limit set by day-to-day chance — adding live ER census data is what would improve it.
        </p>
      </div>
      <UploadCard onSaved={load} />
    </div>
  );
}
