// Evaluates LightGBM models exported by er_model/export.py (numerical splits only).

export type Node =
  | { v: number }
  | { f: number; t: number; dl: boolean; m: "None" | "Zero" | "NaN"; l: Node; r: Node };

export interface LgbModel {
  features: string[];
  objective: string; // "binary" | "poisson"
  trees: Node[];
}

const ZERO = 1e-35;

function leaf(node: Node, x: number[]): number {
  let n = node;
  while (!("v" in n)) {
    let val = x[n.f];
    let left: boolean;
    if (n.m === "NaN" && Number.isNaN(val)) left = n.dl;
    else if (n.m === "Zero" && (Number.isNaN(val) || Math.abs(val) <= ZERO)) left = n.dl;
    else {
      if (Number.isNaN(val)) val = 0; // LightGBM treats NaN as 0 when the split has no missing handling
      left = val <= n.t;
    }
    n = left ? n.l : n.r;
  }
  return n.v;
}

export function rawScore(model: LgbModel, features: Record<string, number>): number {
  const x = model.features.map((f) => {
    const v = features[f];
    if (v === undefined) throw new Error(`missing feature ${f}`);
    return v === null ? NaN : v;
  });
  return model.trees.reduce((s, t) => s + leaf(t, x), 0);
}

export function predict(model: LgbModel, features: Record<string, number>): number {
  const raw = rawScore(model, features);
  if (model.objective === "binary") return 1 / (1 + Math.exp(-raw));
  if (model.objective === "poisson") return Math.exp(raw);
  throw new Error(`unsupported objective ${model.objective}`);
}

/** np.interp with clipping, as used by sklearn's IsotonicRegression.predict. */
export function interp(x: number, xs: number[], ys: number[]): number {
  if (x <= xs[0]) return ys[0];
  if (x >= xs[xs.length - 1]) return ys[ys.length - 1];
  let lo = 0, hi = xs.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (xs[mid] <= x) lo = mid; else hi = mid;
  }
  if (xs[hi] === xs[lo]) return ys[hi];
  const slope = (ys[hi] - ys[lo]) / (xs[hi] - xs[lo]); // same form as scipy interp1d
  return slope * (x - xs[lo]) + ys[lo];
}
