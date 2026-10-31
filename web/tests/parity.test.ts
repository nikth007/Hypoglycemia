// Checks the TypeScript port reproduces the Python models exactly.
// Needs FIXTURE_DIR (written by er_model/export.py, kept outside the repo); skipped otherwise.
import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { predict } from "@/lib/lgbm";
import { forecastFeatures } from "@/lib/forecast";
import { returnFeatures, scoreReturn, type RiskInput } from "@/lib/returnRisk";
import { aggregate, GROUPS } from "@/lib/admissions";

const DIR = process.env.FIXTURE_DIR ?? "";
const has = (f: string) => DIR !== "" && existsSync(path.join(DIR, f));
const load = (f: string) => JSON.parse(readFileSync(path.join(DIR, f), "utf8"));
const models = (f: string) => JSON.parse(readFileSync(path.join(__dirname, "..", "models", f), "utf8"));
const nanify = (v: unknown) => (v === null || v === undefined ? NaN : (v as number));

describe.skipIf(!has("forecast_fixture.json"))("forecast parity", () => {
  for (const g of GROUPS) {
    it(`${g}: matches Python predictions on every test shift`, () => {
      const fx = load("forecast_fixture.json");
      const fm = models("forecast.json");
      let maxErr = 0;
      for (const [day, shift, expected] of fx[g].test as [string, number, number][]) {
        const feats = forecastFeatures(fx[g].counts, day)!;
        const p = predict(fm.groups[g].model, feats[shift]);
        maxErr = Math.max(maxErr, Math.abs(p - expected));
      }
      expect(maxErr).toBeLessThan(1e-6);
    });
  }
});

describe.skipIf(!has("return_features_fixture.json"))("return model parity", () => {
  const rm: any = has("return_features_fixture.json") ? models("return_risk.json") : null;
  it("tree evaluation matches LightGBM on Python-built features", () => {
    const rows = load("return_features_fixture.json") as Record<string, unknown>[];
    let maxErr = 0;
    for (const r of rows) {
      const f = Object.fromEntries(rm.features.map((k: string) => [k, nanify(r[k])]));
      for (const t of Object.keys(rm.targets)) maxErr = Math.max(maxErr, Math.abs(predict(rm.targets[t].model, f) - (r[`raw_${t}`] as number)));
    }
    expect(maxErr).toBeLessThan(1e-9);
  });

  it("feature engineering from raw fields matches Python end to end", () => {
    const rows = load("return_fixture.json") as Record<string, any>[];
    const feats = load("return_features_fixture.json") as Record<string, unknown>[];
    let maxErr = 0, mismatches: string[] = [];
    rows.forEach((r, i) => {
      const input: RiskInput = {
        arrivalDate: r.arrival_date, age: r.age, sex: r.male === 1 ? "male" : r.male === 0 ? "female" : "unknown",
        hr: r.hr, rr: r.rr, bpSystolic: r.bpsystolic, tempF: r.temp, spo2: r.spo2, disposition: r.disposition,
        chiefComplaints: r.chiefcomplaints, finalDiagnosis: r.finaldiagnosis, otherComplaints: r.othercomplaints,
        erPrev30d: r.er_prev_30d, erPrev365d: r.er_prev_365d, erPrevAll: r.er_prev_all, erDaysSinceLast: r.er_days_since_last,
        ipPrev30d: r.ip_prev_30d, ipPrev365d: r.ip_prev_365d, ipPrevAll: r.ip_prev_all, ipDaysSinceLast: r.ip_days_since_last,
      };
      const f = returnFeatures(input);
      for (const k of rm.features) {
        const a = f[k], b = nanify(feats[i][k]);
        const same = (Number.isNaN(a) && Number.isNaN(b)) || Math.abs(a - b) < 1e-9;
        if (!same && mismatches.length < 10) mismatches.push(`row ${i} ${k}: ts=${a} py=${b}`);
      }
      const s = scoreReturn(rm, input);
      for (const t of s.targets) maxErr = Math.max(maxErr, Math.abs(t.risk - r[`cal_${t.key}`]));
    });
    expect(mismatches).toEqual([]);
    // steep isotonic segments amplify last-bit float differences; 1e-6 is far below anything clinically visible
    expect(maxErr).toBeLessThan(1e-6);
  });
});

describe.skipIf(!process.env.EXCEL_PATH || !has("forecast_fixture.json"))("Excel aggregation parity", () => {
  it("shift counts from the raw workbook match Python", async () => {
    const { readSheet } = await import("read-excel-file/node");
    const rows = (await readSheet(process.env.EXCEL_PATH!, "ER TO IP")) as unknown[][];
    const agg = aggregate(rows);
    const fx = load("forecast_fixture.json");
    for (const g of GROUPS) expect(agg.counts[g]).toEqual(fx[g].counts);
  });
});
