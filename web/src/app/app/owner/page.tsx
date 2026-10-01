"use client";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";

const mk = (minor: number) => `MK ${(minor / 100).toLocaleString()}`;

export default function OwnerDashboard() {
  const [d, setD] = useState<any>(null);
  useEffect(() => { api("/admin/dashboard").then(setD).catch(() => setD(null)); }, []);
  if (!d) return <p>Loading…</p>;
  return (
    <>
      <h1>Dashboard</h1>
      <ul>
        <li>Total users: {d.users}</li>
        <li>Unmatched SMS: {d.unmatchedSms} · Payments awaiting match: {d.pendingPayments}</li>
        <li>Owner revenue: {mk(d.revenue.ownerTotalMinor)} (commission {mk(d.revenue.commissionMinor)} + student service fees {mk(d.revenue.studentServiceFeesMinor)})</li>
        <li>Owed to institutions: {mk(d.revenue.institutionsOwedMinor)}</li>
      </ul>
    </>
  );
}
