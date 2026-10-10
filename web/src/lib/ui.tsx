"use client";
import { useCallback, useEffect, useState } from "react";
import { Icon } from "@/components/Icon";
import { api, ApiError, StageError } from "./api";
import { useT } from "./i18n";

export const mk = (minor: number | null | undefined) => `MK ${((minor ?? 0) / 100).toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
export const dt = (d?: string | null) => (d ? new Date(d).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" }) : "—");
export const dtt = (d?: string | null) => (d ? new Date(d).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }) : "—");

// Turns any thrown error into a message in the user's language.
export function useErr() {
  const { t } = useT();
  return (e: unknown) => {
    const root = e instanceof StageError ? e.cause : e;
    const detail = e instanceof StageError ? ` (${e.stage}: ${e.message})` : ""; // say WHERE an upload failed
    if (root instanceof ApiError) {
      const key = root.status === 0 ? "err.network" : `err.${root.code}`;
      const s = t(key); return (s === key ? t("err.internal") : s) + detail;
    }
    return t("err.internal") + detail;
  };
}

export function useLoad<T>(path: string | null, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(!!path);
  const run = useCallback(async () => {
    if (!path) return;
    setLoading(true);
    try { setData(await api<T>(path)); setError(null); } catch (e) { setError(e); } finally { setLoading(false); }
  }, [path]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { run(); }, [run, ...deps]); // eslint-disable-line react-hooks/exhaustive-deps
  return { data, error, loading, reload: run, setData };
}

export function Page({ title, children, actions }: { title: string; children: React.ReactNode; actions?: React.ReactNode }) {
  return <section><div className="pagehead"><h1>{title}</h1><div>{actions}</div></div>{children}</section>;
}
export const Card = ({ title, children, className = "" }: { title?: string; children: React.ReactNode; className?: string }) =>
  <div className={`card ${className}`}>{title && <h2>{title}</h2>}{children}</div>;

export function Btn({ kind = "primary", busy, ...p }: React.ButtonHTMLAttributes<HTMLButtonElement> & { kind?: "primary" | "ghost" | "danger"; busy?: boolean }) {
  return <button {...p} className={`btn ${kind} ${p.className ?? ""}`} disabled={p.disabled || busy} />;
}

export function Field({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  return <label className="field"><span>{label}</span>{children}{hint && <small>{hint}</small>}</label>;
}

export function Msg({ kind, children }: { kind: "ok" | "err" | "warn" | "info"; children: React.ReactNode }) {
  const icon = { ok: "check", err: "alert", warn: "alert", info: "info" }[kind];
  return children ? <div className={`msg ${kind}`} role={kind === "err" ? "alert" : "status"}><Icon name={icon} size={18} /><div>{children}</div></div> : null;
}

export function Loading({ error, loading }: { error?: unknown; loading?: boolean }) {
  const { t } = useT(); const err = useErr();
  if (error) return <Msg kind="err">{err(error)}</Msg>;
  return loading ? <p className="muted">{t("common.loading")}</p> : null;
}

export function Empty() { const { t } = useT(); return <p className="muted">{t("common.none")}</p>; }

export function Badge({ ns, value }: { ns: string; value: string }) {
  const { t } = useT();
  const tone = /ACCEPTED|VERIFIED|CONFIRMED|ACTIVE|CONNECTED/.test(value) ? "good" : /REJECTED|SUSPENDED|FAILED|UNDERPAID/.test(value) ? "bad" : /PENDING|AWAITING|SUBMITTED|REVIEW|QR|STARTING/.test(value) ? "wait" : "neutral";
  // icon + text, never colour alone
  const icon = tone === "good" ? "check" : tone === "bad" ? "x" : tone === "wait" ? "clock" : "dot";
  return <span className={`badge ${tone}`}><Icon name={icon} size={14} />{t(`${ns}.${value}`)}</span>;
}

export const confirmBox = (message: string) => window.confirm(message);

export function useBusy() {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const err = useErr();
  const run = async (fn: () => Promise<unknown>, okText?: string) => {
    setBusy(true); setMsg(null);
    try { await fn(); if (okText) setMsg({ kind: "ok", text: okText }); return true; }
    catch (e) { setMsg({ kind: "err", text: err(e) }); return false; }
    finally { setBusy(false); }
  };
  return { busy, msg, run, setMsg };
}

// Open a signed (short-lived) file URL in a new tab. The tab must be opened synchronously inside the click
// handler (before any await) or Safari and some Android browsers treat it as a blocked popup.
export async function openSigned(getUrl: () => Promise<string>) {
  const w = window.open("", "_blank");
  if (w) w.opener = null; // the new tab must not be able to reach back to this page
  try { const url = await getUrl(); if (w) w.location.href = url; else window.location.href = url; }
  catch (e) { w?.close(); throw e; }
}
