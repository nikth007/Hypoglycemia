"use client";
import { useState } from "react";
import { aggregate, type ShiftCounts } from "@/lib/admissions";
import { CheckIcon } from "./Icons";

export default function UploadCard({ onSaved }: { onSaved: () => void }) {
  const [parsed, setParsed] = useState<{ name: string; agg: ShiftCounts } | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [drag, setDrag] = useState(false);

  async function read(file: File) {
    setMsg(null); setParsed(null); setBusy(true);
    try {
      const { readAdmissionsSheet } = await import("@/lib/excel");
      const rows = await readAdmissionsSheet(file);
      setParsed({ name: file.name, agg: aggregate(rows) });
    } catch (e) {
      setMsg({ ok: false, text: `Could not read the file: ${(e as Error).message}` });
    } finally { setBusy(false); }
  }

  async function save() {
    if (!parsed) return;
    setBusy(true); setMsg(null);
    const { agg, name } = parsed;
    try {
      const r = await fetch("/api/admissions", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ source: name, firstDay: agg.firstDay, lastDay: agg.lastDay, rowsUsed: agg.rowsUsed, rowsSkipped: agg.rowsSkipped, counts: agg.counts }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? r.statusText);
      setMsg({ ok: true, text: `Saved. Data now runs to ${j.status.lastDay}.` });
      setParsed(null); onSaved();
    } catch (e) {
      setMsg({ ok: false, text: `Upload failed: ${(e as Error).message}` });
    } finally { setBusy(false); }
  }

  return (
    <div className="card">
      <h3>Update admissions data</h3>
      <p className="small muted" style={{ marginTop: 0 }}>
        Upload the HIS export (.xlsx) with the <b>ER TO IP</b> sheet (columns IP NO, OLDROOMNO, NEWROOM, ADMISSIONDT, ADMISSIONTM).
        The file is read in your browser; only per-shift admission counts are sent to the server — no patient rows.
        The last day in the file is treated as incomplete and skipped.
      </p>
      <label className={`drop${drag ? " active" : ""}`} style={{ display: "block", cursor: "pointer" }}
        onDragOver={(e) => { e.preventDefault(); setDrag(true); }} onDragLeave={() => setDrag(false)}
        onDrop={(e) => { e.preventDefault(); setDrag(false); const f = e.dataTransfer.files[0]; if (f) read(f); }}>
        <input type="file" accept=".xlsx" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) read(f); e.target.value = ""; }} />
        {busy && !parsed ? "Reading…" : "Drop an .xlsx file here, or click to choose"}
      </label>
      {parsed && (
        <div className="row" style={{ marginTop: 12 }}>
          <span className="small">
            <b>{parsed.name}</b>: {parsed.agg.rowsUsed.toLocaleString()} admissions, {parsed.agg.firstDay} to {parsed.agg.lastDay}
            {parsed.agg.rowsSkipped ? ` (${parsed.agg.rowsSkipped} rows skipped)` : ""}
          </span>
          <button className="btn" disabled={busy} onClick={save}>{busy ? "Saving…" : "Save counts"}</button>
          <button className="btn secondary" disabled={busy} onClick={() => setParsed(null)}>Cancel</button>
        </div>
      )}
      {msg && <p className={`small ${msg.ok ? "ok" : "error"}`} style={{ display: "flex", gap: 6, alignItems: "center" }}>{msg.ok && <CheckIcon />}{msg.text}</p>}
    </div>
  );
}
