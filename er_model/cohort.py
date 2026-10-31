"""Model 3 cohort: patients sent home from the ER, labelled with a return within 72 h / 7 days.

Dates only (arrival time is corrupted in the export), so windows are counted in calendar days.
An admission on the same or next day as an "ED-Home" visit is far more common than on later days
(about 4,100 and 1,350 vs about 250 on day 2), which means those visits were most likely really
admitted with a wrong disposition. They are excluded from the cohort rather than counted as returns.
"""
import numpy as np
import pandas as pd

from .data import SENT_HOME

FOLLOW_UP_DAYS = 7


def _days_to_events(index, events, lo, hi):
    """For each index visit, count events of the same patient within [lo, hi] days after it."""
    m = index[["row", "patient_id", "arrival_date"]].merge(events, on="patient_id")
    gap = (m["event_date"] - m["arrival_date"]).dt.days
    hit = m[(gap >= lo) & (gap <= hi)]
    return index["row"].map(hit.groupby("row").size()).fillna(0).astype(int)


def _history(index, events, prefix):
    """Counts of earlier events strictly before the index date, plus days since the last one."""
    m = index[["row", "patient_id", "arrival_date"]].merge(events, on="patient_id")
    gap = (m["arrival_date"] - m["event_date"]).dt.days
    m = m[gap > 0].assign(gap=gap[gap > 0])
    g = m.groupby("row")
    out = pd.DataFrame(index=index["row"])
    out[f"{prefix}_prev_30d"] = (m[m.gap <= 30].groupby("row").size())
    out[f"{prefix}_prev_365d"] = (m[m.gap <= 365].groupby("row").size())
    out[f"{prefix}_prev_all"] = g.size()
    out = out.fillna(0)
    out[f"{prefix}_days_since_last"] = g["gap"].min()  # NaN = never
    return out.reset_index(drop=True)


def build(er, ip):
    er = er.reset_index(drop=True).assign(row=lambda d: np.arange(len(d)))
    er_events = er[["patient_id", "arrival_date"]].rename(columns={"arrival_date": "event_date"})
    ip_events = ip[["patient_id", "admit_date"]].rename(columns={"admit_date": "event_date"})

    er["admit_d0_d1"] = _days_to_events(er, ip_events, 0, 1)
    er["er_return_d1_3"] = _days_to_events(er, er_events, 1, 3)
    er["er_return_d1_7"] = _days_to_events(er, er_events, 1, 7)
    er["admit_d2_3"] = _days_to_events(er, ip_events, 2, 3)
    er["admit_d2_7"] = _days_to_events(er, ip_events, 2, FOLLOW_UP_DAYS)
    hist = pd.concat([_history(er, er_events, "er"), _history(er, ip_events, "ip")], axis=1)
    er = pd.concat([er, hist], axis=1)

    last_complete = min(er["arrival_date"].max(), ip["admit_date"].max()) - pd.Timedelta(days=FOLLOW_UP_DAYS)
    cohort = er[
        er["disposition"].isin(SENT_HOME)
        & (er["admit_d0_d1"] == 0)
        & (er["arrival_date"] <= last_complete)
        & (er["age"] >= 18)
    ].copy()
    cohort["y_return_72h"] = ((cohort["er_return_d1_3"] + cohort["admit_d2_3"]) > 0).astype(int)
    cohort["y_return_7d"] = ((cohort["er_return_d1_7"] + cohort["admit_d2_7"]) > 0).astype(int)
    cohort["y_return_admit_7d"] = (cohort["admit_d2_7"] > 0).astype(int)
    return cohort.drop(columns=["row"]).reset_index(drop=True)
