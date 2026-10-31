"""Model 3: risk of returning after being sent home from the ER.

Compares logistic regression, logistic regression + text, LightGBM, LightGBM + text (stacked)
and a neural network (MLP), trained on 2019-2023, tuned and calibrated on 2024,
and tested on 2025-2026.

Usage: python -m er_model.train_return <cohort.pkl> <out_dir>
"""
import json
import pickle
import sys
from pathlib import Path

import lightgbm as lgb
import numpy as np
import pandas as pd
from scipy import sparse
from sklearn.decomposition import TruncatedSVD
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.impute import SimpleImputer
from sklearn.isotonic import IsotonicRegression
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import average_precision_score, brier_score_loss, roc_auc_score
from sklearn.model_selection import GroupKFold
from sklearn.neural_network import MLPClassifier
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import StandardScaler

from .features import tabular, text_fields

TARGETS = ["y_return_7d", "y_return_72h", "y_return_admit_7d"]
TRAIN_END, VALID_END = "2024-01-01", "2025-01-01"
ALERT_SHARE = 0.10  # flag the riskiest 10% of discharges
RNG = np.random.default_rng(0)


class TextVectorizer:
    def fit(self, c):
        self.vecs = {
            "complaint": TfidfVectorizer(ngram_range=(1, 2), min_df=3, max_features=30000, sublinear_tf=True),
            "diagnosis": TfidfVectorizer(ngram_range=(1, 2), min_df=3, max_features=20000, sublinear_tf=True),
            "diagnosis_char": TfidfVectorizer(analyzer="char_wb", ngram_range=(3, 5), min_df=5, max_features=30000, sublinear_tf=True),
            "other": TfidfVectorizer(ngram_range=(1, 2), min_df=3, max_features=10000, sublinear_tf=True),
        }
        t = text_fields(c)
        for k, v in self.vecs.items():
            v.fit(t[k.replace("_char", "")])
        return self

    def transform(self, c):
        t = text_fields(c)
        return sparse.hstack([v.transform(t[k.replace("_char", "")]) for k, v in self.vecs.items()]).tocsr()


def dense_tab(fit_on, *frames):
    """Impute (with missing indicators) and scale tabular features for the linear model and the MLP."""
    pipe = make_pipeline(SimpleImputer(strategy="median", add_indicator=True), StandardScaler())
    pipe.fit(fit_on)
    return [pipe.transform(f) for f in frames]


def evaluate(y, p, n_days, boot=0):
    y, p = np.asarray(y), np.asarray(p)
    k = int(np.ceil(ALERT_SHARE * len(p)))
    top = np.argsort(-p)[:k]
    r = {
        "AUROC": roc_auc_score(y, p),
        "AUPRC": average_precision_score(y, p),
        "base_rate": y.mean(),
        "Brier": brier_score_loss(y, p),
        f"recall_top{int(ALERT_SHARE*100)}pct": y[top].sum() / max(y.sum(), 1),
        f"PPV_top{int(ALERT_SHARE*100)}pct": y[top].mean(),
        "alerts_per_day": k / n_days,
        "events": int(y.sum()),
        "n": int(len(y)),
    }
    if boot:
        aucs, aps = [], []
        for _ in range(boot):
            i = RNG.integers(0, len(y), len(y))
            if y[i].min() == y[i].max():
                continue
            aucs.append(roc_auc_score(y[i], p[i])); aps.append(average_precision_score(y[i], p[i]))
        r["AUROC_95CI"] = [float(np.percentile(aucs, 2.5)), float(np.percentile(aucs, 97.5))]
        r["AUPRC_95CI"] = [float(np.percentile(aps, 2.5)), float(np.percentile(aps, 97.5))]
    return {k: (round(float(v), 4) if isinstance(v, (float, np.floating)) else v) for k, v in r.items()}


LGB_PARAMS = dict(objective="binary", learning_rate=0.02, num_leaves=15, min_child_samples=100,
                  feature_fraction=0.7, bagging_fraction=0.8, bagging_freq=1, lambda_l2=5.0,
                  verbose=-1, seed=0, num_threads=4)


def fit_lgb(Xtr, ytr, Xva, yva):
    return lgb.train(LGB_PARAMS, lgb.Dataset(Xtr, ytr), 3000, valid_sets=[lgb.Dataset(Xva, yva)],
                     callbacks=[lgb.early_stopping(200, verbose=False)])


def best_logreg(Xtr, ytr, Xva, yva):
    best = None
    for C in (0.01, 0.03, 0.1, 0.3, 1.0):
        m = LogisticRegression(C=C, max_iter=3000, solver="liblinear").fit(Xtr, ytr)
        s = average_precision_score(yva, m.predict_proba(Xva)[:, 1])
        if best is None or s > best[0]:
            best = (s, m)
    return best[1]


def oof_text_score(c_tr, y_tr, Xtxt_tr, C):
    """Out-of-fold text scores on the training years, grouped by patient, for stacking into LightGBM."""
    oof = np.zeros(len(c_tr))
    for a, b in GroupKFold(5).split(Xtxt_tr, y_tr, c_tr["patient_id"]):
        m = LogisticRegression(C=C, max_iter=3000, solver="liblinear").fit(Xtxt_tr[a], y_tr[a])
        oof[b] = m.predict_proba(Xtxt_tr[b])[:, 1]
    return oof


def run_target(target, c, splits, T, Xtxt, out):
    (tr, va, te) = splits
    y = {k: c.loc[idx, target].to_numpy() for k, idx in zip("tvs", splits)}
    days = c.loc[te, "arrival_date"].nunique()
    res, preds = {}, {}

    # 1. Logistic regression, tabular only
    Ttr, Tva, Tte = dense_tab(T.loc[tr], T.loc[tr], T.loc[va], T.loc[te])
    m = best_logreg(Ttr, y["t"], Tva, y["v"])
    preds["LogReg (tabular)"] = (m.predict_proba(Tva)[:, 1], m.predict_proba(Tte)[:, 1])

    # 2. Logistic regression, tabular + text
    Xtr, Xva, Xte = (sparse.hstack([sparse.csr_matrix(a), Xtxt[k]]).tocsr() for a, k in ((Ttr, "t"), (Tva, "v"), (Tte, "s")))
    m = best_logreg(Xtr, y["t"], Xva, y["v"])
    preds["LogReg (tabular + text)"] = (m.predict_proba(Xva)[:, 1], m.predict_proba(Xte)[:, 1])

    # 3. LightGBM, tabular only
    g = fit_lgb(T.loc[tr], y["t"], T.loc[va], y["v"])
    preds["LightGBM (tabular)"] = (g.predict(T.loc[va], num_iteration=g.best_iteration),
                                   g.predict(T.loc[te], num_iteration=g.best_iteration))

    # 4. LightGBM + stacked text score
    txt = best_logreg(Xtxt["t"], y["t"], Xtxt["v"], y["v"])
    C = txt.C
    T2 = {"t": T.loc[tr].assign(text_score=oof_text_score(c.loc[tr], y["t"], Xtxt["t"], C)),
          "v": T.loc[va].assign(text_score=txt.predict_proba(Xtxt["v"])[:, 1]),
          "s": T.loc[te].assign(text_score=txt.predict_proba(Xtxt["s"])[:, 1])}
    g2 = fit_lgb(T2["t"], y["t"], T2["v"], y["v"])
    preds["LightGBM (tabular + text)"] = (g2.predict(T2["v"], num_iteration=g2.best_iteration),
                                         g2.predict(T2["s"], num_iteration=g2.best_iteration))

    # 5. Neural network (MLP) on tabular + 100-dim text embedding (SVD of TF-IDF)
    svd = TruncatedSVD(100, random_state=0).fit(Xtxt["t"])
    sc = StandardScaler().fit(svd.transform(Xtxt["t"]))
    N = {k: np.hstack([a, sc.transform(svd.transform(Xtxt[k]))]) for a, k in ((Ttr, "t"), (Tva, "v"), (Tte, "s"))}
    pos = np.flatnonzero(y["t"] == 1); neg = np.flatnonzero(y["t"] == 0)
    bal = np.concatenate([neg, np.repeat(pos, 5)])  # oversample events 5x so the MLP sees them
    mlp = MLPClassifier((128, 64), alpha=1e-3, learning_rate_init=1e-3, batch_size=256, max_iter=200,
                        early_stopping=True, validation_fraction=0.1, n_iter_no_change=10, random_state=0)
    mlp.fit(N["t"][bal], y["t"][bal])
    preds["Neural net (MLP, tabular + text)"] = (mlp.predict_proba(N["v"])[:, 1], mlp.predict_proba(N["s"])[:, 1])

    for name, (pv, ps) in preds.items():
        res[name] = evaluate(y["s"], ps, days)
    best = max(preds, key=lambda k: average_precision_score(y["v"], preds[k][0]))  # chosen on 2024, not on test
    iso = IsotonicRegression(out_of_bounds="clip", y_min=0, y_max=1).fit(preds[best][0], y["v"])
    p_cal = iso.predict(preds[best][1])
    res["_selected_on_2024"] = best
    res["_selected_calibrated"] = evaluate(y["s"], p_cal, days, boot=500)

    # Robustness: patients never seen in 2019-2024, and subgroups
    seen = set(c.loc[tr.union(va), "patient_id"])
    new = ~c.loc[te, "patient_id"].isin(seen).to_numpy()
    sub = {"new_patients": new,
           "age_65_plus": c.loc[te, "age"].to_numpy() >= 65, "age_under_65": c.loc[te, "age"].to_numpy() < 65,
           "male": c.loc[te, "male"].to_numpy() == 1, "female": c.loc[te, "male"].to_numpy() == 0}
    res["_subgroups"] = {k: evaluate(y["s"][m_], p_cal[m_], days) for k, m_ in sub.items() if y["s"][m_].sum() >= 10}

    if best.startswith("LightGBM"):
        model = g2 if "text" in best else g
        imp = pd.Series(model.feature_importance("gain"), index=model.feature_name()).sort_values(ascending=False)
        res["_top_features"] = (imp / imp.sum()).round(3).head(12).to_dict()

    # calibration table, deciles of calibrated risk
    q = pd.qcut(pd.Series(p_cal).rank(method="first"), 10, labels=False)
    res["_calibration_deciles"] = pd.DataFrame({"pred": p_cal, "obs": y["s"]}).groupby(q.to_numpy()).mean().round(4).to_dict("list")
    pd.DataFrame({"arrival_date": c.loc[te, "arrival_date"].to_numpy(), "y": y["s"], "risk": p_cal}).to_csv(out / f"return_test_{target}.csv", index=False)
    return res


def learning_curve(c, T, target, out_years=(1, 2, 3, 4.6)):
    """Effect of more training history on the tabular+text LightGBM (test = 2025-26)."""
    te = c.index[c["arrival_date"] >= VALID_END]
    va = c.index[(c["arrival_date"] >= TRAIN_END) & (c["arrival_date"] < VALID_END)]
    res = {}
    for yrs in out_years:
        start = pd.Timestamp(TRAIN_END) - pd.Timedelta(days=int(365.25 * yrs))
        tr = c.index[(c["arrival_date"] >= start) & (c["arrival_date"] < TRAIN_END)]
        tv = TextVectorizer().fit(c.loc[tr])
        X = {k: tv.transform(c.loc[i]) for k, i in (("t", tr), ("v", va), ("s", te))}
        y = {k: c.loc[i, target].to_numpy() for k, i in (("t", tr), ("v", va), ("s", te))}
        txt = best_logreg(X["t"], y["t"], X["v"], y["v"])
        Tt = T.loc[tr].assign(text_score=oof_text_score(c.loc[tr], y["t"], X["t"], txt.C))
        Tv = T.loc[va].assign(text_score=txt.predict_proba(X["v"])[:, 1])
        Ts = T.loc[te].assign(text_score=txt.predict_proba(X["s"])[:, 1])
        g = fit_lgb(Tt, y["t"], Tv, y["v"])
        p = g.predict(Ts, num_iteration=g.best_iteration)
        res[f"{yrs} years ({len(tr)} visits, {int(y['t'].sum())} events)"] = {
            "AUROC": round(roc_auc_score(y["s"], p), 4), "AUPRC": round(average_precision_score(y["s"], p), 4)}
    return res


def main(cohort_path, out_dir):
    out = Path(out_dir); out.mkdir(parents=True, exist_ok=True)
    c = pickle.load(open(cohort_path, "rb")).reset_index(drop=True)
    T = tabular(c)
    tr = c.index[c["arrival_date"] < TRAIN_END]
    va = c.index[(c["arrival_date"] >= TRAIN_END) & (c["arrival_date"] < VALID_END)]
    te = c.index[c["arrival_date"] >= VALID_END]
    tv = TextVectorizer().fit(c.loc[tr])
    Xtxt = {k: tv.transform(c.loc[i]) for k, i in (("t", tr), ("v", va), ("s", te))}
    results = {"_split": {"train": f"{c.loc[tr,'arrival_date'].min():%Y-%m-%d} to 2023-12-31 ({len(tr)} visits)",
                          "valid": f"2024 ({len(va)} visits)",
                          "test": f"2025-01-01 to {c.loc[te,'arrival_date'].max():%Y-%m-%d} ({len(te)} visits)"}}
    for target in TARGETS:
        print("training", target, flush=True)
        results[target] = run_target(target, c, (tr, va, te), T, Xtxt, out)
        json.dump(results, open(out / "return_results.json", "w"), indent=2, default=str)
    print("learning curve", flush=True)
    results["_learning_curve_y_return_7d"] = learning_curve(c, T, "y_return_7d")
    json.dump(results, open(out / "return_results.json", "w"), indent=2, default=str)
    print(json.dumps(results, indent=2, default=str))


if __name__ == "__main__":
    main(*sys.argv[1:3])
