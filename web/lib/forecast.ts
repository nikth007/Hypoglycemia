// Next-day forecast per 8-hour shift. Feature definitions mirror er_model/forecast.py make_features().
import { addDays, dayOfWeek, dayOfYear, month } from "./dates";
import { predict, type LgbModel } from "./lgbm";

export type DayCounts = Record<string, [number, number, number]>;

const mean = (a: number[]) => a.reduce((s, x) => s + x, 0) / a.length;

/** Features for each shift of `day`, using only days strictly before it. Returns null if history is too short. */
export function forecastFeatures(counts: DayCounts, day: string): Record<string, number>[] | null {
  const get = (d: string) => counts[d];
  const total = (d: string) => { const c = get(d); return c ? c[0] + c[1] + c[2] : undefined; };
  for (let k = 1; k <= 28; k++) if (!get(addDays(day, -k))) return null;

  const dailyMean = (w: number) => {
    const v: number[] = [];
    for (let k = 1; k <= w; k++) { const t = total(addDays(day, -k)); if (t !== undefined) v.push(t); }
    return v.length ? mean(v) : NaN;
  };
  const doy = dayOfYear(day);
  const common = {
    dow: dayOfWeek(day),
    month: month(day),
    doy_sin: Math.sin((2 * Math.PI * doy) / 365.25),
    doy_cos: Math.cos((2 * Math.PI * doy) / 365.25),
    daily_mean_1d: dailyMean(1),
    daily_mean_7d: dailyMean(7),
    daily_mean_28d: dailyMean(28),
    daily_mean_91d: dailyMean(91),
  };
  return [0, 1, 2].map((s) => {
    const lags = [1, 2, 3, 4].map((k) => get(addDays(day, -7 * k))![s]);
    const recent: number[] = [];
    for (let k = 3; k <= 30; k++) { const c = get(addDays(day, -k)); if (c) recent.push(c[s]); }
    return {
      shift: s,
      ...common,
      same_slot_w1: lags[0], same_slot_w2: lags[1], same_slot_w3: lags[2], same_slot_w4: lags[3],
      same_slot_4wk_mean: mean(lags),
      shift_mean_28d: recent.length >= 7 ? mean(recent) : NaN,
    };
  });
}

/** Smallest k with P(X <= k) >= q for X ~ Poisson(mu) (scipy.stats.poisson.ppf). */
export function poissonPpf(q: number, mu: number): number {
  let k = 0, p = Math.exp(-mu), cdf = p;
  while (cdf < q - 1e-12 && k < 1000) { k++; p *= mu / k; cdf += p; }
  return k;
}

export function forecastDay(model: LgbModel, counts: DayCounts, day: string) {
  const feats = forecastFeatures(counts, day);
  if (!feats) return null;
  const shifts = feats.map((f) => predict(model, f));
  const expected = shifts.reduce((a, b) => a + b, 0);
  return {
    day,
    shifts: shifts.map((mu) => ({ expected: mu, upper90: poissonPpf(0.9, mu) })),
    expected,
    upper90: poissonPpf(0.9, expected),
    pAtLeast: (k: number) => 1 - Array.from({ length: k }, (_, i) => i).reduce((s, i) => s + poissonPmf(i, expected), 0),
  };
}

function poissonPmf(k: number, mu: number) {
  let p = Math.exp(-mu);
  for (let i = 1; i <= k; i++) p *= mu / i;
  return p;
}
