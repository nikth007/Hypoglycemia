// Discharge return-risk features and scoring. Mirrors er_model/features.py tabular() and data.py cleaning.
import { dayOfWeek, month } from "./dates";
import { interp, predict, type LgbModel } from "./lgbm";

export interface RiskInput {
  arrivalDate: string; // YYYY-MM-DD
  age: number | null;
  sex: "male" | "female" | "unknown";
  hr: number | null;
  rr: number | null;
  bpSystolic: number | null;
  tempF: number | null;
  spo2: number | null;
  disposition: "ED-Home" | "OP-Home" | "Discharge at Request" | "Ref.To OPD";
  chiefComplaints: string;
  finalDiagnosis: string;
  otherComplaints: string;
  erPrev30d: number;
  erPrev365d: number;
  erPrevAll: number;
  erDaysSinceLast: number | null; // null = no earlier ER visit
  ipPrev30d: number;
  ipPrev365d: number;
  ipPrevAll: number;
  ipDaysSinceLast: number | null; // null = never admitted
}

export const VITAL_RANGES = {
  hr: [20, 250], rr: [4, 70], bpSystolic: [40, 300], tempF: [90, 110], spo2: [40, 100],
} as const;

const KEYWORDS: Record<string, RegExp> = {
  kw_diabetes: /\bdm\b|t2dm|t1dm|diabet|sugar/,
  kw_hypertension: /\bhtn\b|hypertens/,
  kw_kidney: /\bckd\b|kidney|renal|dialysis/,
  kw_cardiac: /\bcad\b|\bihd\b|\bmi\b|cardiac|heart|ptca|cabg/,
  kw_airway: /\bba\b|asthma|copd|wheez/,
  kw_pregnancy: /pregnan|\bweeks? amenorrh|\bg\d\s*p\d/,
  kw_alcohol: /alcohol|ethanol|\bdrunk/,
  kw_trauma: /\brta\b|fall|injur|trauma|assault|fracture/,
  kw_poison: /poison|ingest|overdose|consum/,
  kw_vomiting: /vomit|loose stool|diarrh/,
  kw_fever: /fever|febrile/,
  kw_chest_pain: /chest pain/,
  kw_breathless: /breath|\bsob\b|dyspn/,
  kw_seizure: /seiz|convuls|\bfits?\b/,
  kw_hypoglycemia: /hypoglyc|low sugar/,
};

const DURATION = /(\d+(?:\.\d+)?)\s*(hours?|hrs?|days?|weeks?|wks?|months?|years?|yrs?)\b/i;
const UNIT_DAYS: Record<string, number> = { h: 1 / 24, d: 1, w: 7, m: 30, y: 365 };

export function durationDays(text: string): number {
  const m = text.match(DURATION);
  return m ? parseFloat(m[1]) * UNIT_DAYS[m[2][0].toLowerCase()] : NaN;
}

const inRange = (v: number | null, [lo, hi]: readonly [number, number]) =>
  v === null || Number.isNaN(v) || v < lo || v > hi ? NaN : v;
const nz = (v: number | null) => (v === null || Number.isNaN(v) ? NaN : v);

export function returnFeatures(i: RiskInput): Record<string, number> {
  const hr = inRange(i.hr, VITAL_RANGES.hr);
  const bp = inRange(i.bpSystolic, VITAL_RANGES.bpSystolic);
  const temp = inRange(i.tempF, VITAL_RANGES.tempF);
  const spo2 = inRange(i.spo2, VITAL_RANGES.spo2);
  const cc = i.chiefComplaints.trim(), dx = i.finalDiagnosis.trim(), oc = i.otherComplaints.trim();
  const text = `${cc} ${dx} ${oc}`.toLowerCase();
  const f: Record<string, number> = {
    age: nz(i.age),
    male: i.sex === "male" ? 1 : i.sex === "female" ? 0 : NaN,
    hr,
    rr: inRange(i.rr, VITAL_RANGES.rr),
    bpsystolic: bp,
    temp,
    spo2,
    spo2_measured: Number.isNaN(spo2) ? 0 : 1,
    shock_index: hr / bp,
    fever: Number.isNaN(temp) ? NaN : temp >= 100.4 ? 1 : 0,
    dow: dayOfWeek(i.arrivalDate),
    month: month(i.arrivalDate),
    op_home: i.disposition === "OP-Home" ? 1 : 0,
    left_at_request: i.disposition === "Discharge at Request" ? 1 : 0,
    er_prev_30d: i.erPrev30d,
    er_prev_365d: i.erPrev365d,
    er_prev_all: i.erPrevAll,
    er_days_since_last: nz(i.erDaysSinceLast),
    ip_prev_30d: i.ipPrev30d,
    ip_prev_365d: i.ipPrev365d,
    ip_prev_all: i.ipPrevAll,
    ip_days_since_last: nz(i.ipDaysSinceLast),
    symptom_days: durationDays(cc),
    dx_uncertain: /\?|for evaluation|evaluat|r\/o|rule out/.test(dx.toLowerCase()) ? 1 : 0,
    dx_count: (dx.match(/\n/g)?.length ?? 0) + (dx !== "" ? 1 : 0),
    complaint_len: [...cc].length,
    has_other_complaints: oc !== "" ? 1 : 0,
  };
  for (const [k, re] of Object.entries(KEYWORDS)) f[k] = re.test(text) ? 1 : 0;
  return f;
}

export interface TargetModel {
  label: string;
  model: LgbModel;
  calibration: { x: number[]; y: number[] };
  alert_threshold_raw: number;
  base_rate: number;
  test: { AUROC: number; AUPRC: number; base_rate: number; share_flagged: number; recall_at_alert: number; ppv_at_alert: number };
}

export interface ReturnModels {
  features: string[];
  alert_share: number;
  targets: Record<string, TargetModel>;
}

export function scoreReturn(models: ReturnModels, input: RiskInput) {
  const features = returnFeatures(input);
  const targets = Object.entries(models.targets).map(([key, t]) => {
    const raw = predict(t.model, features);
    const risk = interp(raw, t.calibration.x, t.calibration.y);
    return { key, label: t.label, raw, risk, baseRate: t.base_rate, relative: risk / t.base_rate,
             flagged: raw >= t.alert_threshold_raw, test: t.test };
  });
  return { features, targets };
}
