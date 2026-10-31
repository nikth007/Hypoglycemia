"""Feature engineering for the discharge-risk model (all information known when the patient is sent home)."""
import re

import numpy as np
import pandas as pd

_DURATION = re.compile(r"(\d+(?:\.\d+)?)\s*(hours?|hrs?|days?|weeks?|wks?|months?|years?|yrs?)\b", re.I)
_UNIT_DAYS = {"h": 1 / 24, "d": 1, "w": 7, "m": 30, "y": 365}

KEYWORDS = {
    "kw_diabetes": r"\bdm\b|t2dm|t1dm|diabet|sugar",
    "kw_hypertension": r"\bhtn\b|hypertens",
    "kw_kidney": r"\bckd\b|kidney|renal|dialysis",
    "kw_cardiac": r"\bcad\b|\bihd\b|\bmi\b|cardiac|heart|ptca|cabg",
    "kw_airway": r"\bba\b|asthma|copd|wheez",
    "kw_pregnancy": r"pregnan|\bweeks? amenorrh|\bg\d\s*p\d",
    "kw_alcohol": r"alcohol|ethanol|\bdrunk",
    "kw_trauma": r"\brta\b|fall|injur|trauma|assault|fracture",
    "kw_poison": r"poison|ingest|overdose|consum",
    "kw_vomiting": r"vomit|loose stool|diarrh",
    "kw_fever": r"fever|febrile",
    "kw_chest_pain": r"chest pain",
    "kw_breathless": r"breath|\bsob\b|dyspn",
    "kw_seizure": r"seiz|convuls|\bfits?\b",
    "kw_hypoglycemia": r"hypoglyc|low sugar",
}


def duration_days(text):
    m = _DURATION.search(text)
    if not m:
        return np.nan
    return float(m.group(1)) * _UNIT_DAYS[m.group(2)[0].lower()]


def tabular(c):
    f = pd.DataFrame(index=c.index)
    for col in ["age", "male", "hr", "rr", "bpsystolic", "temp", "spo2", "spo2_measured"]:
        f[col] = c[col]
    f["shock_index"] = c["hr"] / c["bpsystolic"]
    f["fever"] = (c["temp"] >= 100.4).astype(float).where(c["temp"].notna())
    f["dow"] = c["arrival_date"].dt.dayofweek
    f["month"] = c["arrival_date"].dt.month
    f["op_home"] = (c["disposition"] == "OP-Home").astype(int)
    f["left_at_request"] = (c["disposition"] == "Discharge at Request").astype(int)
    for col in ["er_prev_30d", "er_prev_365d", "er_prev_all", "er_days_since_last",
                "ip_prev_30d", "ip_prev_365d", "ip_prev_all", "ip_days_since_last"]:
        f[col] = c[col]
    f["symptom_days"] = c["chiefcomplaints"].map(duration_days)
    dx = c["finaldiagnosis"].str.lower()
    f["dx_uncertain"] = dx.str.contains(r"\?|for evaluation|evaluat|r/o|rule out").astype(int)
    f["dx_count"] = c["finaldiagnosis"].str.count("\n") + (c["finaldiagnosis"] != "").astype(int)
    f["complaint_len"] = c["chiefcomplaints"].str.len()
    f["has_other_complaints"] = (c["othercomplaints"] != "").astype(int)
    text = (c["chiefcomplaints"] + " " + c["finaldiagnosis"] + " " + c["othercomplaints"]).str.lower()
    for name, pat in KEYWORDS.items():
        f[name] = text.str.contains(pat, regex=True).astype(int)
    return f


def text_fields(c):
    return {
        "complaint": c["chiefcomplaints"].str.lower(),
        "diagnosis": c["finaldiagnosis"].str.lower(),
        "other": c["othercomplaints"].str.lower(),
    }
