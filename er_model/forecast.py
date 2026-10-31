"""Model 2: bed-demand forecast for ER-to-IP admissions.

Forecasts the number of admissions per 8-hour shift for the next day, per unit group,
using only information available at the end of the previous day. Compares a LightGBM
Poisson model against two seasonal baselines on a time-based hold-out.

Usage: python -m er_model.forecast <clean.pkl> <out_dir>
"""
import json
import pickle
import sys
from pathlib import Path

import lightgbm as lgb
import numpy as np
import pandas as pd
from scipy.stats import poisson

SHIFTS = {0: "00-08", 1: "08-16", 2: "16-24"}
TRAIN_END = "2024-01-01"  # train: before this
VALID_END = "2025-01-01"  # valid: 2024; test: 2025 onwards


def unit_groups(ip):
    critical = ip["unit"].isin(["ICU", "IMCU"]) & (ip["from_room"] == "ER")
    return {
        "total": pd.Series(True, index=ip.index),
        "adult_ward": (ip["unit"] == "WARD") & (ip["from_room"] == "ER"),
        "adult_icu_imcu": critical,
        "paediatric": ip["from_room"] == "P-ER",
    }


def shift_counts(ip, mask, last_day):
    t = ip.loc[mask, "admit_ts"]
    slot = t.dt.normalize() + pd.to_timedelta((t.dt.hour // 8) * 8, unit="h")
    idx = pd.date_range(ip["admit_ts"].min().normalize(), last_day + pd.Timedelta(hours=16), freq="8h")
    return slot.value_counts().reindex(idx, fill_value=0).sort_index()


def make_features(y):
    """Features for slot t use only counts from days strictly before t's day."""
    df = pd.DataFrame({"y": y})
    df["day"] = df.index.normalize()
    df["shift"] = df.index.hour // 8
    df["dow"] = df.index.dayofweek
    df["month"] = df.index.month
    df["doy_sin"] = np.sin(2 * np.pi * df.index.dayofyear / 365.25)
    df["doy_cos"] = np.cos(2 * np.pi * df.index.dayofyear / 365.25)
    daily = y.groupby(y.index.normalize()).sum()
    prev = daily.shift(1)  # yesterday is the most recent complete day
    for w in (1, 7, 28, 91):
        df[f"daily_mean_{w}d"] = df["day"].map(prev.rolling(w, min_periods=1).mean())
    for k in (1, 2, 3, 4):  # same shift, same weekday, k weeks ago
        df[f"same_slot_w{k}"] = y.shift(21 * k)
    df["same_slot_4wk_mean"] = df[[f"same_slot_w{k}" for k in (1, 2, 3, 4)]].mean(axis=1)
    by_shift = y.groupby(y.index.hour)
    df["shift_mean_28d"] = by_shift.transform(lambda s: s.shift(3).rolling(28, min_periods=7).mean())
    return df.dropna()


FEATURES = ["shift", "dow", "month", "doy_sin", "doy_cos", "daily_mean_1d", "daily_mean_7d",
            "daily_mean_28d", "daily_mean_91d", "same_slot_w1", "same_slot_w2", "same_slot_w3",
            "same_slot_w4", "same_slot_4wk_mean", "shift_mean_28d"]


def metrics(y, mu):
    y, mu = np.asarray(y, float), np.clip(np.asarray(mu, float), 1e-6, None)
    upper = poisson.ppf(0.9, mu)
    return {
        "MAE": float(np.mean(np.abs(y - mu))),
        "RMSE": float(np.sqrt(np.mean((y - mu) ** 2))),
        "Poisson_deviance": float(np.mean(2 * (np.where(y > 0, y * np.log(np.where(y > 0, y, 1) / mu), 0) - (y - mu)))),
        "P90_coverage": float(np.mean(y <= upper)),
    }


def fit_group(name, y, out):
    df = make_features(y)
    tr, va, te = df[df.index < TRAIN_END], df[(df.index >= TRAIN_END) & (df.index < VALID_END)], df[df.index >= VALID_END]
    params = dict(objective="poisson", learning_rate=0.03, num_leaves=15, min_child_samples=50,
                  feature_fraction=0.8, bagging_fraction=0.8, bagging_freq=1, lambda_l2=1.0, verbose=-1, seed=0)
    m = lgb.train(params, lgb.Dataset(tr[FEATURES], tr["y"]), 2000,
                  valid_sets=[lgb.Dataset(va[FEATURES], va["y"])],
                  callbacks=[lgb.early_stopping(100, verbose=False)])
    # refit on train+valid with the chosen number of rounds, then score the untouched test years
    trva = pd.concat([tr, va])
    m = lgb.train(params, lgb.Dataset(trva[FEATURES], trva["y"]), m.best_iteration)
    preds = {
        "seasonal_naive (same shift last week)": te["same_slot_w1"],
        "4-week same-shift mean": te["same_slot_4wk_mean"],
        "LightGBM Poisson": pd.Series(m.predict(te[FEATURES]), index=te.index),
    }
    res = {k: metrics(te["y"], v) for k, v in preds.items()}
    daily_true = te["y"].groupby(te["day"]).sum()
    daily_pred = preds["LightGBM Poisson"].groupby(te["day"]).sum()
    res["LightGBM Poisson"]["daily_MAE"] = float(np.mean(np.abs(daily_true - daily_pred)))
    res["LightGBM Poisson"]["daily_P90_coverage"] = float(np.mean(daily_true <= poisson.ppf(0.9, daily_pred)))
    res["_mean_per_shift_test"] = float(te["y"].mean())
    res["_n_test_shifts"] = int(len(te))
    imp = pd.Series(m.feature_importance("gain"), index=FEATURES).sort_values(ascending=False)
    res["_top_features"] = (imp / imp.sum()).round(3).head(6).to_dict()
    pd.DataFrame({"actual": te["y"], "predicted": preds["LightGBM Poisson"],
                  "p90_upper": poisson.ppf(0.9, preds["LightGBM Poisson"])}).to_csv(out / f"forecast_test_{name}.csv")
    m.save_model(str(out / f"forecast_{name}.txt"))
    return res


def main(clean_path, out_dir):
    out = Path(out_dir); out.mkdir(parents=True, exist_ok=True)
    _, ip = pickle.load(open(clean_path, "rb"))
    last_day = ip["admit_ts"].max().normalize() - pd.Timedelta(days=1)  # last day is partial
    ip = ip[ip["admit_ts"] < last_day + pd.Timedelta(days=1)]
    results = {}
    for name, mask in unit_groups(ip).items():
        results[name] = fit_group(name, shift_counts(ip, mask, last_day), out)
    json.dump(results, open(out / "forecast_results.json", "w"), indent=2)
    print(json.dumps(results, indent=2))


if __name__ == "__main__":
    main(*sys.argv[1:3])
