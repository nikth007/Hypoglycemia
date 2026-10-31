"""Export trained models to compact JSON for the web app (web/models/).

The web app runs the LightGBM trees itself, so no Python runs on Vercel.
Return-risk models use LightGBM on tabular features (text is reduced to keyword flags in the
browser), calibrated with isotonic regression on 2024. A parity fixture with real test rows is
written to <fixture_dir> only, never to the repo.

Usage: python -m er_model.export <clean.pkl> <cohort.pkl> <forecast_out_dir> <web_models_dir> <fixture_dir>
"""
import json
import pickle
import sys
from pathlib import Path

import lightgbm as lgb
import numpy as np
import pandas as pd
from sklearn.isotonic import IsotonicRegression
from sklearn.metrics import average_precision_score, roc_auc_score

from .features import tabular
from .forecast import FEATURES as FORECAST_FEATURES
from .train_return import ALERT_SHARE, TRAIN_END, VALID_END, fit_lgb

TARGETS = {
    "y_return_72h": "Return to ER (or admitted) within 72 hours",
    "y_return_7d": "Return to ER (or admitted) within 7 days",
    "y_return_admit_7d": "Return and admitted within 7 days",
}
FORECAST_GROUPS = ["total", "adult_ward", "adult_icu_imcu", "paediatric"]


def compact_tree(node):
    if "leaf_value" in node:
        return {"v": round(node["leaf_value"], 10)}
    return {
        "f": node["split_feature"],
        "t": node["threshold"],
        "dl": bool(node["default_left"]),
        "m": node["missing_type"],
        "l": compact_tree(node["left_child"]),
        "r": compact_tree(node["right_child"]),
    }


def compact_model(booster, num_iteration=None):
    d = booster.dump_model(num_iteration=num_iteration)
    for t in d["tree_info"]:
        for n in _walk(t["tree_structure"]):
            assert n.get("decision_type", "<=") == "<=", "only numerical splits supported"
    return {"features": d["feature_names"], "objective": d["objective"].split()[0],
            "trees": [compact_tree(t["tree_structure"]) for t in d["tree_info"]]}


def _walk(n):
    yield n
    if "left_child" in n:
        yield from _walk(n["left_child"])
        yield from _walk(n["right_child"])


def main(clean_path, cohort_path, forecast_dir, web_dir, fixture_dir):
    web, fix = Path(web_dir), Path(fixture_dir)
    web.mkdir(parents=True, exist_ok=True); fix.mkdir(parents=True, exist_ok=True)

    # ---- Model 2: forecast boosters were saved by forecast.py
    fres = json.load(open(Path(forecast_dir) / "forecast_results.json"))
    forecast = {"features": FORECAST_FEATURES, "groups": {}}
    for g in FORECAST_GROUPS:
        b = lgb.Booster(model_file=str(Path(forecast_dir) / f"forecast_{g}.txt"))
        assert b.feature_name() == FORECAST_FEATURES
        m = fres[g]["LightGBM Poisson"]
        forecast["groups"][g] = {"model": compact_model(b), "test": {
            "shift_MAE": round(m["MAE"], 3), "daily_MAE": round(m["daily_MAE"], 3),
            "daily_P90_coverage": round(m["daily_P90_coverage"], 3),
            "baseline_shift_MAE": round(fres[g]["4-week same-shift mean"]["MAE"], 3)}}
    json.dump(forecast, open(web / "forecast.json", "w"), separators=(",", ":"))

    # ---- Model 3: return risk, LightGBM tabular + isotonic calibration
    c = pickle.load(open(cohort_path, "rb")).reset_index(drop=True)
    T = tabular(c)
    tr = c.index[c["arrival_date"] < TRAIN_END]
    va = c.index[(c["arrival_date"] >= TRAIN_END) & (c["arrival_date"] < VALID_END)]
    te = c.index[c["arrival_date"] >= VALID_END]
    out = {"features": list(T.columns), "alert_share": ALERT_SHARE, "targets": {}}
    fixture = c.loc[te, ["arrival_date", "age", "male", "hr", "rr", "bpsystolic", "temp", "spo2", "disposition",
                         "chiefcomplaints", "finaldiagnosis", "othercomplaints",
                         "er_prev_30d", "er_prev_365d", "er_prev_all", "er_days_since_last",
                         "ip_prev_30d", "ip_prev_365d", "ip_prev_all", "ip_days_since_last"]].copy()
    fixture["arrival_date"] = fixture["arrival_date"].dt.strftime("%Y-%m-%d")
    for target, label in TARGETS.items():
        y = c[target].to_numpy()
        g = fit_lgb(T.loc[tr], y[tr], T.loc[va], y[va])
        pv = g.predict(T.loc[va], num_iteration=g.best_iteration)
        ps = g.predict(T.loc[te], num_iteration=g.best_iteration)
        iso = IsotonicRegression(out_of_bounds="clip", y_min=0, y_max=1).fit(pv, y[va])
        cal_v, cal_s = iso.predict(pv), iso.predict(ps)
        thr = float(np.quantile(pv, 1 - ALERT_SHARE))
        flag = ps >= thr
        out["targets"][target] = {
            "label": label,
            "model": compact_model(g, g.best_iteration),
            "calibration": {"x": iso.X_thresholds_.tolist(), "y": iso.y_thresholds_.tolist()},
            # alert on the raw score (calibration is a step function and would create ties); set on 2024, not on test
            "alert_threshold_raw": thr,
            "base_rate": float(y[tr.union(va)].mean()),
            "test": {"AUROC": round(roc_auc_score(y[te], ps), 3), "AUPRC": round(average_precision_score(y[te], ps), 3),
                     "base_rate": round(float(y[te].mean()), 4),
                     "share_flagged": round(float(flag.mean()), 3),
                     "recall_at_alert": round(float(y[te][flag].sum() / y[te].sum()), 3),
                     "ppv_at_alert": round(float(y[te][flag].mean()), 3)},
        }
        fixture[f"raw_{target}"] = ps
        fixture[f"cal_{target}"] = cal_s
        print(target, out["targets"][target]["test"], "trees", g.best_iteration)
    json.dump(out, open(web / "return_risk.json", "w"), separators=(",", ":"))
    fixture.to_json(fix / "return_fixture.json", orient="records", double_precision=15)
    T.loc[te].assign(**{f"raw_{t}": fixture[f"raw_{t}"] for t in TARGETS}).to_json(fix / "return_features_fixture.json", orient="records", double_precision=15)
    for f in ("forecast.json", "return_risk.json"):
        print(f, round((web / f).stat().st_size / 1e6, 2), "MB")


if __name__ == "__main__":
    main(*sys.argv[1:6])
