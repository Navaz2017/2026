"use client";
import { useState } from "react";
import { api } from "@/lib/api";

export default function RevenueConfig() {
  const [com, setCom] = useState(30), [svc, setSvc] = useState(30), [msg, setMsg] = useState("");
  const fee = 10_000, total = fee * (1 + svc / 100);
  return (
    <>
      <h1>Revenue sharing</h1>
      <label>Commission from institution fee (%) <input type="number" min={0} max={100} value={com} onChange={(e) => setCom(+e.target.value)} /></label><br />
      <label>Student service fee on top (%) <input type="number" min={0} max={100} value={svc} onChange={(e) => setSvc(+e.target.value)} /></label>
      <p>Example on a MK{fee.toLocaleString()} fee: student pays MK{total.toLocaleString()}; institution receives MK{(fee * (1 - com / 100)).toLocaleString()}; you earn MK{(fee * (com + svc) / 100).toLocaleString()}.</p>
      <button onClick={async () => {
        await api("/admin/revenue-config", { method: "PUT", body: JSON.stringify({ institutionCommissionBps: Math.round(com * 100), studentServiceFeeBps: Math.round(svc * 100) }) });
        setMsg("Saved. Applies to new applications only.");
      }}>Save</button> {msg}
    </>
  );
}
