# ER Predict — web app

One Next.js app with two tools for the ER:

- **Bed demand forecast**: next-day admissions from the ER per 8-hour shift, for all admissions, adult ward,
  adult ICU + IMCU and paediatric. Data comes from uploading the HIS export (`ER TO IP` sheet); the browser
  reads the file and sends only per-shift counts to the database.
- **Discharge return risk**: calibrated risk of returning within 72 h / 7 days, and of returning and being admitted
  within 7 days, for an adult being sent home. Free text is only scanned for keywords and never stored.

Models are trained in Python (`../er_model`) and exported to `models/*.json`; the app evaluates the trees in
TypeScript, so nothing but Node runs on Vercel. `tests/parity.test.ts` checks the port reproduces the Python
predictions exactly (needs the fixtures from `er_model/export.py`, which are kept out of the repo).

## Environment variables

| Variable | Required | Purpose |
|---|---|---|
| `DATABASE_URL` (or `POSTGRES_URL`) | yes | Neon Postgres connection string (pooled). Tables are created on first request. |
| `APP_PASSWORD` | recommended | If set, the whole site asks for this password (HTTP Basic auth, any username). |

## Deploy on Vercel + Neon (dashboard, no CLI)

1. Vercel → **Add New → Project** → import `nikth007/hypoglycemia`; set **Root Directory** to `web`.
2. In the project, **Storage → Create → Neon (Postgres)** and connect it; this sets `DATABASE_URL`.
3. **Settings → Environment Variables** → add `APP_PASSWORD`.
4. Deploy, open the site, and upload the ER export on the *Bed demand forecast* tab.

## Deploy with the CLIs

```bash
neonctl projects create --name er-predict --region-id aws-ap-southeast-1   # Singapore, closest to Chennai
neonctl connection-string --pooled            # -> DATABASE_URL
cd web
vercel link --yes
printf '%s' "$DATABASE_URL" | vercel env add DATABASE_URL production
printf '%s' "$APP_PASSWORD" | vercel env add APP_PASSWORD production
vercel deploy --prod
DATABASE_URL=... npm run seed -- /path/to/ER_Patient_Details.xlsx   # optional: load counts from the command line
```

## Develop

```bash
npm install
DATABASE_URL=postgresql://... npm run dev
npm test                                                     # unit tests
FIXTURE_DIR=... EXCEL_PATH=... npm test                      # + parity tests against the Python models
```
