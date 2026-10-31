// Server-only model loading (JSON exported by er_model/export.py).
import { readFileSync } from "node:fs";
import path from "node:path";
import type { LgbModel } from "./lgbm";
import type { ReturnModels } from "./returnRisk";
import type { Group } from "./admissions";

export interface ForecastModels {
  features: string[];
  groups: Record<Group, { model: LgbModel; test: { shift_MAE: number; daily_MAE: number; daily_P90_coverage: number; baseline_shift_MAE: number } }>;
}

let forecastCache: ForecastModels | null = null;
let returnCache: ReturnModels | null = null;
const load = (f: string) => JSON.parse(readFileSync(path.join(process.cwd(), "models", f), "utf8"));

export const forecastModels = (): ForecastModels => (forecastCache ??= load("forecast.json"));
export const returnModels = (): ReturnModels => (returnCache ??= load("return_risk.json"));
