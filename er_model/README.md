# ER prediction models (Sundaram Medical Foundation)

Backend models built from the 2-sheet ER export (`ER Patient Data`, `ER TO IP`).
**No patient data lives in this repo** — pass the export's path on the command line.

| Module | Purpose |
|---|---|
| `data.py` | Load both sheets, clean vitals/age/sex, parse dates, group `NEWROOM` into ICU / IMCU / PIMCU / ward |
| `forecast.py` | Model 2 – next-day admissions per 8-hour shift, per unit group (LightGBM Poisson vs seasonal baselines) |
| `cohort.py` | Model 3 cohort – adults sent home, labelled with 72 h / 7-day return and 7-day return-with-admission |
| `features.py` | Disposition-time features: vitals, shock index, history of ER visits and admissions, complaint text flags |
| `train_return.py` | Model 3 – logistic regression, LightGBM and MLP, with and without text; temporal split, calibration, subgroups, learning curve |

## Run

```bash
pip install -r requirements.txt
python -c "import pickle; from er_model.data import load; pickle.dump(load('ER_Patient_Details.xlsx'), open('outputs/clean.pkl','wb'))"
python -c "import pickle; from er_model.cohort import build; pickle.dump(build(*pickle.load(open('outputs/clean.pkl','rb'))), open('outputs/cohort.pkl','wb'))"
python -m er_model.forecast outputs/clean.pkl outputs
python -m er_model.train_return outputs/cohort.pkl outputs
```

Split: train 2019–2023, tune/select/calibrate on 2024, test on 2025–Apr 2026.

## Known data limitations
- Sheet 1 has almost no admitted visits, so an admission / level-of-care model at triage is not possible yet.
- `TIMEOFARRIVAL` contains month-year values, not times; `CONCIOUSNESS` is empty; `SPO2` is 94% empty.
- About 4,100 "ED-Home" visits have an admission the same day; these are treated as mis-recorded admissions and excluded from the return cohort.
