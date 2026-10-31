"""Load, clean and link the two sheets of the ER export.

Sheet 1 ("ER Patient Data"): one row per ER visit, mostly visits that were NOT admitted.
Sheet 2 ("ER TO IP"): one row per admission from the ER (adult ER and paediatric P-ER).
The sheets link on PATIENT_ID == OPMRNO (hospital MRN).
"""
import re

import numpy as np
import pandas as pd

# Plausible ranges; anything outside is treated as a charting error (missing).
VITAL_RANGES = {
    "HR": (20, 250),
    "RR": (4, 70),
    "BPSYSTOLIC": (40, 300),
    "TEMP": (90, 110),  # Fahrenheit
    "SPO2": (40, 100),
}

SENT_HOME = {"ED-Home", "OP-Home", "Discharge at Request", "Ref.To OPD"}


def _num(s):
    return pd.to_numeric(s.astype(str).str.replace("%", "").str.strip(), errors="coerce")


def parse_age_years(s):
    parts = s.astype(str).str.extract(r"(?:(\d+)\s*Y)?\s*(?:(\d+)\s*M)?\s*(?:(\d+)\s*D)?")
    parts = parts.astype(float)
    years = parts[0].fillna(0) + parts[1].fillna(0) / 12 + parts[2].fillna(0) / 365.25
    years[parts.isna().all(axis=1)] = np.nan
    return years


def clean_er(raw):
    df = pd.DataFrame()
    df["patient_id"] = raw["PATIENT_ID"].astype(str).str.strip()
    df["erno"] = raw["ERNO"].astype(str).str.strip()
    df["arrival_date"] = pd.to_datetime(raw["DATEOFARRIVAL"], format="%d-%m-%y", errors="coerce")
    df["age"] = parse_age_years(raw["AGE"])
    sex = raw["SEX"].astype(str).str.strip().str.lower()
    df["male"] = sex.map({"male": 1.0, "female": 0.0})
    for col, (lo, hi) in VITAL_RANGES.items():
        v = _num(raw[col])
        df[col.lower()] = v.where(v.between(lo, hi))
    df["spo2_measured"] = df["spo2"].notna().astype(int)
    for col in ["CHIEFCOMPLAINTS", "FINALDIAGNOSIS", "OTHERCOMPLAINTS"]:
        df[col.lower()] = raw[col].fillna("").astype(str).str.strip()
    df["disposition"] = raw["DISPOSITION"].astype(str).str.strip()
    # WEIGHT (99.9% empty), CONCIOUSNESS (100% empty), TIMEOFARRIVAL (holds month-year,
    # not a time) and TORETURN (written after the disposition decision) are not used.
    df = df.dropna(subset=["arrival_date"]).drop_duplicates("erno")
    return df.sort_values(["patient_id", "arrival_date", "erno"]).reset_index(drop=True)


def unit_level(room):
    """Group the 265 NEWROOM codes into levels of care."""
    r = str(room).upper().strip()
    if r in ("", "NAN"):
        return "UNKNOWN"
    if r.startswith("NICU"):
        return "NICU"
    if r.startswith("PIMCU"):
        return "PIMCU"
    if r.startswith("IMCU") or r.startswith("ISCU") or r.startswith("HMAU"):
        return "IMCU"
    if r.startswith("ICU"):
        return "ICU"
    if r.startswith("LR"):
        return "LABOUR"
    if re.match(r"^P?\s*-?\s*ER", r):
        return "ER_HOLD"
    return "WARD"


def clean_ip(raw):
    df = pd.DataFrame()
    df["ip_no"] = raw["IP NO"].astype(str).str.strip()
    df["patient_id"] = raw["OPMRNO"].astype(str).str.strip()
    df["from_room"] = raw["OLDROOMNO"].astype(str).str.strip()  # ER or P-ER
    df["new_room"] = raw["NEWROOM"].fillna("").astype(str).str.strip()
    df["unit"] = df["new_room"].map(unit_level)
    df["admit_ts"] = pd.to_datetime(
        raw["ADMISSIONDT"].astype(str).str.strip() + " " + raw["ADMISSIONTM"].astype(str).str.strip(),
        format="%d/%m/%Y %I:%M:%S %p",
        errors="coerce",
    )
    df["admit_date"] = df["admit_ts"].dt.normalize()
    df = df.dropna(subset=["admit_ts"]).drop_duplicates("ip_no")
    return df.sort_values("admit_ts").reset_index(drop=True)


def load(path):
    sheets = pd.read_excel(path, sheet_name=None, dtype=str)
    er_raw, ip_raw = list(sheets.values())[:2]
    return clean_er(er_raw), clean_ip(ip_raw)
