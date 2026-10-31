"use client";
import { useEffect, useState } from "react";
import ForecastPanel from "./ForecastPanel";
import RiskPanel from "./RiskPanel";

type Tab = "forecast" | "risk";

export default function App() {
  const [tab, setTab] = useState<Tab>("forecast");
  useEffect(() => {
    try { const t = localStorage.getItem("er-tab"); if (t === "forecast" || t === "risk") setTab(t); } catch {}
  }, []);
  const choose = (t: Tab) => { setTab(t); try { localStorage.setItem("er-tab", t); } catch {} };
  return (
    <div className="wrap">
      <header className="top">
        <h1>ER Predict</h1>
        <p>Sundaram Medical Foundation · Emergency department</p>
      </header>
      <div className="tabs" role="tablist">
        <button role="tab" aria-selected={tab === "forecast"} onClick={() => choose("forecast")}>Bed demand forecast</button>
        <button role="tab" aria-selected={tab === "risk"} onClick={() => choose("risk")}>Discharge return risk</button>
      </div>
      {tab === "forecast" ? <ForecastPanel /> : <RiskPanel />}
      <footer>
        Decision support only — predictions are probabilities from models trained on 2019–2024 ER data and tested on 2025–26.
        They do not replace clinical judgement.
      </footer>
    </div>
  );
}
