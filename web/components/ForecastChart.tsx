"use client";
import { useEffect, useMemo, useRef, useState } from "react";

export interface Point { day: string; actual: number | null; forecast: number | null }
interface Props { history: Point[]; next: { day: string; expected: number; upper90: number } | null }

const H = 260, M = { t: 16, r: 56, b: 28, l: 34 };
const fmtDay = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });

function niceMax(v: number) {
  const step = v <= 4 ? 1 : v <= 10 ? 2 : v <= 25 ? 5 : 10;
  return { max: Math.max(step, Math.ceil(v / step) * step), step };
}

export default function ForecastChart({ history, next }: Props) {
  const [hover, setHover] = useState<number | null>(null);
  const [showTable, setShowTable] = useState(false);
  const ref = useRef<SVGSVGElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const [W, setW] = useState(760);
  useEffect(() => {
    // draw at the real pixel width so text stays 11px on phones
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setW(Math.max(280, Math.round(e.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const pts = useMemo(() => [...history, ...(next ? [{ day: next.day, actual: null, forecast: next.expected }] : [])], [history, next]);
  const n = pts.length;
  const vmax = Math.max(1, ...pts.map((p) => Math.max(p.actual ?? 0, p.forecast ?? 0)), next?.upper90 ?? 0);
  const { max, step } = niceMax(vmax);
  const x = (i: number) => M.l + (i * (W - M.l - M.r)) / Math.max(1, n - 1);
  const y = (v: number) => H - M.b - (v * (H - M.t - M.b)) / max;
  const line = (key: "actual" | "forecast", upto: number) =>
    pts.slice(0, upto).map((p, i) => (p[key] === null ? null : `${x(i)},${y(p[key]!)}`)).filter(Boolean).join(" ");
  const ticks = Array.from({ length: Math.floor(max / step) + 1 }, (_, i) => i * step);
  const every = W < 520 ? 14 : 7;
  const xTicks = pts.map((p, i) => ({ p, i })).filter(({ i }) => (n - 1 - i) % every === 0);

  const onMove = (e: React.PointerEvent) => {
    const r = ref.current!.getBoundingClientRect();
    const px = ((e.clientX - r.left) / r.width) * W;
    const i = Math.round(((px - M.l) / (W - M.l - M.r)) * (n - 1));
    setHover(i >= 0 && i < n ? i : null);
  };
  const hp = hover !== null ? pts[hover] : null;
  const isNext = hover === n - 1 && !!next;

  return (
    <div>
      <div className="legend" aria-hidden="true">
        <span><span className="key" style={{ background: "var(--series-1)" }} />Actual admissions per day</span>
        <span><span className="key" style={{ background: "var(--series-2)" }} />Model forecast (made the day before)</span>
      </div>
      <div className="chart" ref={box}>
        <svg ref={ref} viewBox={`0 0 ${W} ${H}`} width={W} height={H} role="img" aria-label="Daily admissions, actual versus next-day forecast"
             onPointerMove={onMove} onPointerLeave={() => setHover(null)}>
          {ticks.map((t) => (
            <g key={t}>
              <line x1={M.l} x2={W - M.r} y1={y(t)} y2={y(t)} stroke="var(--grid)" strokeWidth="1" />
              <text x={M.l - 8} y={y(t)} dy="0.32em" textAnchor="end" fontSize="11" fill="var(--text-3)">{t}</text>
            </g>
          ))}
          {xTicks.map(({ p, i }) => (
            <text key={p.day} x={x(i)} y={H - 8} textAnchor="middle" fontSize="11" fill="var(--text-3)">{fmtDay(p.day)}</text>
          ))}
          <polyline points={line("forecast", n - (next ? 1 : 0))} fill="none" stroke="var(--series-2)" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
          <polyline points={line("actual", n)} fill="none" stroke="var(--series-1)" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
          {next && (
            <g>
              <line x1={x(n - 1)} x2={x(n - 1)} y1={y(next.expected)} y2={y(next.upper90)} stroke="var(--series-2)" strokeWidth="2" strokeLinecap="round" />
              <line x1={x(n - 1) - 5} x2={x(n - 1) + 5} y1={y(next.upper90)} y2={y(next.upper90)} stroke="var(--series-2)" strokeWidth="2" strokeLinecap="round" />
              <circle cx={x(n - 1)} cy={y(next.expected)} r="5" fill="var(--series-2)" stroke="var(--surface)" strokeWidth="2" />
              <text x={x(n - 1) + 9} y={y(next.expected)} dy="0.32em" fontSize="11" fill="var(--text)" fontWeight="600">{next.expected.toFixed(1)}</text>
              <text x={x(n - 1) + 9} y={y(next.upper90)} dy="0.32em" fontSize="11" fill="var(--text-2)">≤{next.upper90}</text>
            </g>
          )}
          {hp && hover !== null && (
            <g pointerEvents="none">
              <line x1={x(hover)} x2={x(hover)} y1={M.t} y2={H - M.b} stroke="var(--text-3)" strokeWidth="1" />
              {hp.actual !== null && <circle cx={x(hover)} cy={y(hp.actual)} r="4.5" fill="var(--series-1)" stroke="var(--surface)" strokeWidth="2" />}
              {hp.forecast !== null && <circle cx={x(hover)} cy={y(hp.forecast)} r="4.5" fill="var(--series-2)" stroke="var(--surface)" strokeWidth="2" />}
            </g>
          )}
        </svg>
        {hp && hover !== null && (
          <div className="tip" style={{ left: `${(x(hover) / W) * 100}%`, top: `${(M.t / H) * 100}%` }}>
            <div style={{ fontWeight: 600 }}>{fmtDay(hp.day)}{isNext ? " · forecast" : ""}</div>
            {hp.actual !== null && <div><span className="dot" style={{ background: "var(--series-1)", display: "inline-block", width: 8, height: 8, borderRadius: 4, marginRight: 6 }} />Actual {hp.actual}</div>}
            {hp.forecast !== null && <div><span style={{ background: "var(--series-2)", display: "inline-block", width: 8, height: 8, borderRadius: 4, marginRight: 6 }} />Forecast {hp.forecast.toFixed(1)}{isNext && next ? ` (90%: ≤${next.upper90})` : ""}</div>}
          </div>
        )}
      </div>
      <button className="linkbtn" onClick={() => setShowTable((s) => !s)}>{showTable ? "Hide table" : "Show as table"}</button>
      {showTable && (
        <div className="tablewrap">
          <table className="data">
            <thead><tr><th>Day</th><th>Actual</th><th>Forecast</th></tr></thead>
            <tbody>
              {[...pts].reverse().map((p) => (
                <tr key={p.day}><td>{fmtDay(p.day)}</td><td>{p.actual ?? "—"}</td><td>{p.forecast === null ? "—" : p.forecast.toFixed(1)}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
