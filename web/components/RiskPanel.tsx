"use client";
import { useState } from "react";
import { WarnIcon, CheckIcon } from "./Icons";

type Form = Record<string, string>;
interface Target {
  key: string; label: string; risk: number; baseRate: number; relative: number; flagged: boolean;
  test: { AUROC: number; ppv_at_alert: number; recall_at_alert: number };
}
interface Result { targets: Target[]; features: Record<string, number | null>; saved: boolean; saveError: string | null; alertShare: number }

const today = () => new Date().toISOString().slice(0, 10);
const EMPTY: Form = {
  arrivalDate: today(), disposition: "ED-Home", age: "", sex: "unknown", hr: "", rr: "", bpSystolic: "", tempF: "", spo2: "",
  chiefComplaints: "", finalDiagnosis: "", otherComplaints: "",
  erPrev30d: "0", erPrev365d: "0", erPrevAll: "0", erDaysSinceLast: "", ipPrev30d: "0", ipPrev365d: "0", ipPrevAll: "0", ipDaysSinceLast: "",
};
const ORDER = ["y_return_72h", "y_return_7d", "y_return_admit_7d"];
const KW: Record<string, string> = {
  kw_fever: "fever", kw_trauma: "trauma", kw_vomiting: "vomiting / diarrhoea", kw_breathless: "breathlessness", kw_chest_pain: "chest pain",
  kw_diabetes: "diabetes", kw_hypertension: "hypertension", kw_kidney: "kidney disease", kw_cardiac: "cardiac", kw_airway: "asthma / COPD",
  kw_pregnancy: "pregnancy", kw_alcohol: "alcohol", kw_poison: "poisoning / ingestion", kw_seizure: "seizure", kw_hypoglycemia: "hypoglycaemia",
};

function Field({ label, name, values, set, type = "number", ...rest }: { label: string; name: string; values: Form; set: (k: string, v: string) => void; type?: string } & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <label className="f">{label}
      <input type={type} value={values[name]} onChange={(e) => set(name, e.target.value)} inputMode={type === "number" ? "decimal" : undefined} {...rest} />
    </label>
  );
}

export default function RiskPanel() {
  const [form, setForm] = useState<Form>(EMPTY);
  const [save, setSave] = useState(false);
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<Result | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const set = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setErr(null);
    try {
      const r = await fetch("/api/risk", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...form, save }) });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? r.statusText);
      setRes(j);
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  }

  const n = (k: string) => (form[k] === "" ? null : Number(form[k]));
  const historyIssues = [
    n("erDaysSinceLast") !== null && n("erDaysSinceLast")! <= 30 && (n("erPrev30d") ?? 0) < 1 && "a last ER visit within 30 days means “ER visits, last 30 days” should be at least 1",
    n("erDaysSinceLast") !== null && n("erDaysSinceLast")! <= 365 && (n("erPrev365d") ?? 0) < Math.max(1, n("erPrev30d") ?? 0) && "“ER visits, last year” should include the last-30-day visits",
    (n("erPrevAll") ?? 0) < (n("erPrev365d") ?? 0) && "“ER visits, since 2019” should be at least the last-year count",
    n("ipDaysSinceLast") !== null && n("ipDaysSinceLast")! <= 30 && (n("ipPrev30d") ?? 0) < 1 && "a last admission within 30 days means “Admissions, last 30 days” should be at least 1",
    (n("ipPrevAll") ?? 0) < (n("ipPrev365d") ?? 0) && "“Admissions, since 2019” should be at least the last-year count",
  ].filter(Boolean) as string[];
  const f = res?.features;
  const kws = f ? Object.entries(KW).filter(([k]) => f[k] === 1).map(([, v]) => v) : [];
  const anyFlag = res?.targets.some((t) => t.flagged);

  return (
    <div className="grid2">
      <form className="card" onSubmit={submit}>
        <h2>Patient being sent home</h2>
        <p className="small muted" style={{ marginTop: 0 }}>Use at the point of discharge from the ER. Leave unknown values blank.</p>
        <fieldset>
          <legend>Visit</legend>
          <div className="fields">
            <Field label="Arrival date" name="arrivalDate" type="date" values={form} set={set} required />
            <label className="f">Disposition
              <select value={form.disposition} onChange={(e) => set("disposition", e.target.value)}>
                <option value="ED-Home">ED – Home</option>
                <option value="OP-Home">OP – Home</option>
                <option value="Discharge at Request">Discharge at request</option>
                <option value="Ref.To OPD">Referred to OPD</option>
              </select>
            </label>
            <Field label="Age (years)" name="age" values={form} set={set} min={18} max={110} step="any" />
            <label className="f">Sex
              <select value={form.sex} onChange={(e) => set("sex", e.target.value)}>
                <option value="unknown">Not recorded</option><option value="female">Female</option><option value="male">Male</option>
              </select>
            </label>
          </div>
        </fieldset>
        <fieldset>
          <legend>Vitals</legend>
          <div className="fields">
            <Field label="Heart rate (/min)" name="hr" values={form} set={set} step="any" />
            <Field label="Resp. rate (/min)" name="rr" values={form} set={set} step="any" />
            <Field label="Systolic BP (mmHg)" name="bpSystolic" values={form} set={set} step="any" />
            <Field label="Temperature (°F)" name="tempF" values={form} set={set} step="any" />
            <Field label="SpO₂ (%)" name="spo2" values={form} set={set} step="any" />
          </div>
        </fieldset>
        <fieldset>
          <legend>Clinical notes</legend>
          <div className="fields" style={{ gridTemplateColumns: "1fr" }}>
            <label className="f">Chief complaints<textarea value={form.chiefComplaints} onChange={(e) => set("chiefComplaints", e.target.value)} placeholder="e.g. Fever 3 days with vomiting" /></label>
            <label className="f">Final diagnosis<textarea value={form.finalDiagnosis} onChange={(e) => set("finalDiagnosis", e.target.value)} placeholder="One per line, e.g. Acute febrile illness - day 3" /></label>
            <label className="f">Other complaints / known conditions<textarea value={form.otherComplaints} onChange={(e) => set("otherComplaints", e.target.value)} placeholder="e.g. K/C/O T2DM, HTN" /></label>
          </div>
          <p className="tiny" style={{ marginBottom: 0 }}>Notes are only scanned for keywords and symptom duration; the text is never stored.</p>
        </fieldset>
        <fieldset>
          <legend>History at this hospital</legend>
          <div className="fields">
            <Field label="ER visits, last 30 days" name="erPrev30d" values={form} set={set} min={0} />
            <Field label="ER visits, last year" name="erPrev365d" values={form} set={set} min={0} />
            <Field label="ER visits, since 2019" name="erPrevAll" values={form} set={set} min={0} />
            <Field label="Days since last ER visit" name="erDaysSinceLast" values={form} set={set} min={1} placeholder="never" />
            <Field label="Admissions, last 30 days" name="ipPrev30d" values={form} set={set} min={0} />
            <Field label="Admissions, last year" name="ipPrev365d" values={form} set={set} min={0} />
            <Field label="Admissions, since 2019" name="ipPrevAll" values={form} set={set} min={0} />
            <Field label="Days since last admission" name="ipDaysSinceLast" values={form} set={set} min={1} placeholder="never" />
          </div>
          {historyIssues.length > 0 && (
            <div className="notice" style={{ marginTop: 10 }}><WarnIcon /><span>Check history: {historyIssues.join("; ")}.</span></div>
          )}
        </fieldset>
        <div className="row">
          <button className="btn" type="submit" disabled={busy}>{busy ? "Assessing…" : "Assess return risk"}</button>
          <button className="btn secondary" type="button" onClick={() => { setForm({ ...EMPTY, arrivalDate: today() }); setRes(null); }}>Clear</button>
          <label className="check"><input type="checkbox" checked={save} onChange={(e) => setSave(e.target.checked)} />Save anonymised inputs to the audit log</label>
        </div>
        {err && <p className="error small">{err}</p>}
      </form>

      <div className="card" aria-live="polite">
        <h2>Return risk</h2>
        {!res ? (
          <p className="muted small">Fill in the form and select “Assess return risk”. Risks are calibrated probabilities for adults sent home from this ER.</p>
        ) : (
          <>
            {anyFlag ? (
              <div className="notice"><WarnIcon /><span>Among the riskiest {Math.round(res.alertShare * 100)}% of discharges. Consider a recheck before discharge, clear return advice, or a follow-up call.</span></div>
            ) : (
              <div className="notice" style={{ background: "var(--surface-2)", color: "var(--text-2)" }}><CheckIcon /><span>Not in the highest-risk {Math.round(res.alertShare * 100)}% on any outcome.</span></div>
            )}
            {ORDER.map((k) => res.targets.find((t) => t.key === k)!).map((t) => (
              <div className="risk" key={t.key}>
                <div className="head">
                  <span>{t.label}</span>
                  <span className="pct">{(t.risk * 100).toFixed(1)}%</span>
                </div>
                <div className="bar" aria-hidden="true">
                  <div className="fill" style={{ width: `${Math.min(100, (t.risk / 0.2) * 100)}%` }} />
                  <div className="base" style={{ left: `${Math.min(100, (t.baseRate / 0.2) * 100)}%` }} />
                </div>
                <div className="row small muted" style={{ justifyContent: "space-between" }}>
                  <span>{t.relative.toFixed(1)}× the average of {(t.baseRate * 100).toFixed(1)}% <span className="tiny">(bar scale 0–20%, tick = average)</span></span>
                  {t.flagged ? <span className="badge warn"><WarnIcon />Top {Math.round(res.alertShare * 100)}%</span> : <span className="badge neutral">Below alert level</span>}
                </div>
              </div>
            ))}
            {f && (
              <div style={{ marginTop: 12 }}>
                <h3>What the model read from this patient</h3>
                <div className="chips">
                  {f.symptom_days !== null && <span className="chip">symptoms {f.symptom_days! < 1 ? `${Math.round(f.symptom_days! * 24)} h` : `${+f.symptom_days!.toFixed(1)} days`}</span>}
                  {f.shock_index !== null && <span className="chip">shock index {f.shock_index!.toFixed(2)}</span>}
                  {f.fever === 1 && <span className="chip">temp ≥ 100.4 °F</span>}
                  {f.dx_uncertain === 1 && <span className="chip">uncertain diagnosis</span>}
                  {kws.map((k) => <span className="chip" key={k}>{k}</span>)}
                  {f.symptom_days === null && f.shock_index === null && !kws.length && f.fever !== 1 && <span className="tiny">No vitals or keywords recognised.</span>}
                </div>
              </div>
            )}
            {res.saved && <p className="small ok" style={{ display: "flex", gap: 6, alignItems: "center" }}><CheckIcon />Saved to the audit log (no names, IDs or free text).</p>}
            {res.saveError && <p className="small error">Could not save to the audit log: {res.saveError}</p>}
            <details style={{ marginTop: 12 }}>
              <summary className="small">How reliable is this?</summary>
              <table className="data" style={{ marginTop: 8 }}>
                <thead><tr><th>Outcome</th><th>AUROC</th><th>Flagged who return</th><th>Returns caught</th></tr></thead>
                <tbody>
                  {ORDER.map((k) => res.targets.find((t) => t.key === k)!).map((t) => (
                    <tr key={t.key}><td>{t.label}</td><td>{t.test.AUROC.toFixed(2)}</td><td>{Math.round(t.test.ppv_at_alert * 100)}%</td><td>{Math.round(t.test.recall_at_alert * 100)}%</td></tr>
                  ))}
                </tbody>
              </table>
              <p className="tiny">Tested on 9,863 discharges in 2025–26. The model ranks risk only moderately well (AUROC 0.65–0.76): use it as a prompt for safety-netting, never as a reason to keep or send someone home.</p>
            </details>
          </>
        )}
      </div>
    </div>
  );
}
