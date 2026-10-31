// Turns rows of the "ER TO IP" sheet into admission counts per unit group, day and 8-hour shift.
// Runs in the browser (upload) and in Node (seed script); only counts ever leave this module.

export const GROUPS = ["total", "adult_ward", "adult_icu_imcu", "paediatric"] as const;
export type Group = (typeof GROUPS)[number];

export const GROUP_LABELS: Record<Group, string> = {
  total: "All admissions",
  adult_ward: "Adult ward",
  adult_icu_imcu: "Adult ICU + IMCU",
  paediatric: "Paediatric (P-ER)",
};

export const SHIFT_LABELS = ["00:00–08:00", "08:00–16:00", "16:00–24:00"];

/** Same grouping as er_model/data.py unit_level(). */
export function unitLevel(room: unknown): string {
  const r = String(room ?? "").toUpperCase().trim();
  if (r === "" || r === "NAN") return "UNKNOWN";
  if (r.startsWith("NICU")) return "NICU";
  if (r.startsWith("PIMCU")) return "PIMCU";
  if (r.startsWith("IMCU") || r.startsWith("ISCU") || r.startsWith("HMAU")) return "IMCU";
  if (r.startsWith("ICU")) return "ICU";
  if (r.startsWith("LR")) return "LABOUR";
  if (/^P?\s*-?\s*ER/.test(r)) return "ER_HOLD";
  return "WARD";
}

export function groupsFor(fromRoom: string, unit: string): Group[] {
  const g: Group[] = ["total"];
  if (unit === "WARD" && fromRoom === "ER") g.push("adult_ward");
  if ((unit === "ICU" || unit === "IMCU") && fromRoom === "ER") g.push("adult_icu_imcu");
  if (fromRoom === "P-ER") g.push("paediatric");
  return g;
}

const pad = (n: number) => String(n).padStart(2, "0");

/** Accepts "18/03/2023" text or a Date cell. Returns "YYYY-MM-DD" or null. */
export function parseAdmitDate(v: unknown): string | null {
  if (v instanceof Date && !Number.isNaN(v.getTime()))
    return `${v.getUTCFullYear()}-${pad(v.getUTCMonth() + 1)}-${pad(v.getUTCDate())}`;
  const m = String(v ?? "").trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (!m) return null;
  return `${m[3]}-${pad(+m[2])}-${pad(+m[1])}`;
}

/** Accepts "05:26:47 pm" text, a Date cell, or an Excel day fraction. Returns the hour 0-23 or null. */
export function parseAdmitHour(v: unknown): number | null {
  if (v instanceof Date && !Number.isNaN(v.getTime())) return v.getUTCHours();
  if (typeof v === "number" && v >= 0 && v < 1) return Math.floor(v * 24 + 1e-9);
  const m = String(v ?? "").trim().toLowerCase().match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(am|pm)?$/);
  if (!m) return null;
  let h = +m[1];
  if (m[4] === "pm" && h !== 12) h += 12;
  if (m[4] === "am" && h === 12) h = 0;
  return h >= 0 && h < 24 ? h : null;
}

export interface ShiftCounts {
  /** group -> day -> [shift0, shift1, shift2] */
  counts: Record<Group, Record<string, [number, number, number]>>;
  firstDay: string;
  lastDay: string; // last complete day (the final day in the file is treated as partial)
  rowsUsed: number;
  rowsSkipped: number;
}

const REQUIRED = ["IP NO", "OLDROOMNO", "NEWROOM", "ADMISSIONDT", "ADMISSIONTM"];

/** rows[0] is the header row. */
export function aggregate(rows: unknown[][]): ShiftCounts {
  const header = rows[0].map((h) => String(h ?? "").trim().toUpperCase());
  const col = Object.fromEntries(REQUIRED.map((c) => [c, header.indexOf(c)]));
  const missing = REQUIRED.filter((c) => col[c] < 0);
  if (missing.length) throw new Error(`Sheet is missing column(s): ${missing.join(", ")}`);

  const seen = new Set<string>();
  const events: { day: string; shift: number; groups: Group[] }[] = [];
  let skipped = 0;
  for (const r of rows.slice(1)) {
    const ipNo = String(r[col["IP NO"]] ?? "").trim();
    const day = parseAdmitDate(r[col["ADMISSIONDT"]]);
    const hour = parseAdmitHour(r[col["ADMISSIONTM"]]);
    if (!ipNo || !day || hour === null || seen.has(ipNo)) { skipped++; continue; }
    seen.add(ipNo);
    const from = String(r[col["OLDROOMNO"]] ?? "").trim();
    events.push({ day, shift: Math.floor(hour / 8), groups: groupsFor(from, unitLevel(r[col["NEWROOM"]])) });
  }
  if (!events.length) throw new Error("No usable admission rows found");
  const days = events.map((e) => e.day).sort();
  const firstDay = days[0];
  const fileLast = days[days.length - 1];
  const lastDay = new Date(Date.parse(`${fileLast}T00:00:00Z`) - 86400000).toISOString().slice(0, 10);

  const counts = Object.fromEntries(GROUPS.map((g) => [g, {}])) as ShiftCounts["counts"];
  for (let d = firstDay; d <= lastDay; d = new Date(Date.parse(`${d}T00:00:00Z`) + 86400000).toISOString().slice(0, 10))
    for (const g of GROUPS) counts[g][d] = [0, 0, 0];
  for (const e of events) {
    if (e.day > lastDay) continue;
    for (const g of e.groups) counts[g][e.day][e.shift]++;
  }
  return { counts, firstDay, lastDay, rowsUsed: events.length, rowsSkipped: skipped };
}
