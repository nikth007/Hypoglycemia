// Postgres (Neon in production). Uses DATABASE_URL, or POSTGRES_URL as set by Vercel's Neon integration.
import { Pool } from "pg";
import { GROUPS, type Group } from "./admissions";
import type { DayCounts } from "./forecast";

declare global { var __erPool: Pool | undefined; var __erSchema: Promise<void> | undefined; }

export function connectionString(): string | undefined {
  return process.env.DATABASE_URL ?? process.env.POSTGRES_URL;
}

function pool(): Pool {
  const url = connectionString();
  if (!url) throw new Error("DATABASE_URL is not set");
  const local = /@(localhost|127\.0\.0\.1)[:/]/.test(url);
  globalThis.__erPool ??= new Pool({ connectionString: url, max: 3, ssl: local ? undefined : { rejectUnauthorized: true } });
  return globalThis.__erPool;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS shift_counts (
  grp   text     NOT NULL,
  day   date     NOT NULL,
  shift smallint NOT NULL CHECK (shift BETWEEN 0 AND 2),
  n     integer  NOT NULL CHECK (n >= 0),
  PRIMARY KEY (grp, day, shift)
);
CREATE TABLE IF NOT EXISTS uploads (
  id           serial PRIMARY KEY,
  uploaded_at  timestamptz NOT NULL DEFAULT now(),
  source       text,
  first_day    date NOT NULL,
  last_day     date NOT NULL,
  rows_used    integer NOT NULL,
  rows_skipped integer NOT NULL
);
CREATE TABLE IF NOT EXISTS risk_assessments (
  id         serial PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now(),
  features   jsonb NOT NULL,  -- derived model inputs only; no names, IDs or free text
  risks      jsonb NOT NULL
);`;

export async function db(): Promise<Pool> {
  const p = pool();
  globalThis.__erSchema ??= p.query(SCHEMA).then(() => undefined);
  await globalThis.__erSchema;
  return p;
}

export async function saveCounts(
  counts: Record<Group, DayCounts>,
  meta: { source: string; firstDay: string; lastDay: string; rowsUsed: number; rowsSkipped: number },
) {
  const g: string[] = [], d: string[] = [], s: number[] = [], n: number[] = [];
  for (const grp of GROUPS)
    for (const [day, c] of Object.entries(counts[grp] ?? {}))
      c.forEach((v, i) => { g.push(grp); d.push(day); s.push(i); n.push(v); });
  const client = await (await db()).connect();
  try {
    await client.query("BEGIN");
    // replace whole days covered by the upload, so re-uploading the same file is harmless
    await client.query(
      `INSERT INTO shift_counts (grp, day, shift, n)
       SELECT * FROM unnest($1::text[], $2::date[], $3::smallint[], $4::int[])
       ON CONFLICT (grp, day, shift) DO UPDATE SET n = EXCLUDED.n`,
      [g, d, s, n],
    );
    await client.query(
      "INSERT INTO uploads (source, first_day, last_day, rows_used, rows_skipped) VALUES ($1,$2,$3,$4,$5)",
      [meta.source, meta.firstDay, meta.lastDay, meta.rowsUsed, meta.rowsSkipped],
    );
    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
  return g.length;
}

/** Counts per group for days in [from, to]. */
export async function loadCounts(from: string, to: string): Promise<Record<Group, DayCounts>> {
  const { rows } = await (await db()).query(
    "SELECT grp, day::text AS day, shift, n FROM shift_counts WHERE day BETWEEN $1 AND $2",
    [from, to],
  );
  const out = Object.fromEntries(GROUPS.map((x) => [x, {}])) as Record<Group, DayCounts>;
  for (const r of rows) {
    const grp = r.grp as Group;
    if (!out[grp]) continue;
    (out[grp][r.day] ??= [0, 0, 0])[r.shift] = r.n;
  }
  return out;
}

export async function dataStatus() {
  const p = await db();
  const range = await p.query("SELECT min(day)::text AS first, max(day)::text AS last, count(DISTINCT day)::int AS days FROM shift_counts WHERE grp = 'total'");
  const up = await p.query("SELECT uploaded_at, source, first_day::text, last_day::text, rows_used FROM uploads ORDER BY id DESC LIMIT 1");
  return { firstDay: range.rows[0].first as string | null, lastDay: range.rows[0].last as string | null,
           days: range.rows[0].days as number, lastUpload: up.rows[0] ?? null };
}

export async function saveAssessment(features: Record<string, number>, risks: unknown) {
  const clean = Object.fromEntries(Object.entries(features).map(([k, v]) => [k, Number.isNaN(v) ? null : v]));
  await (await db()).query("INSERT INTO risk_assessments (features, risks) VALUES ($1, $2)", [clean, JSON.stringify(risks)]);
}
