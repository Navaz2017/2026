"use client";
import { useState } from "react";
import { Field } from "@/lib/ui";

// Tiny controlled-form helpers so each wizard step stays short.
export function useFields<T extends Record<string, any>>(init: T) {
  const [v, setV] = useState<T>(init);
  const set = (k: keyof T, val: any) => setV((p) => ({ ...p, [k]: val }));
  return { v, setV, set };
}

type P = { label: string; value: any; onChange: (v: string) => void; required?: boolean; type?: string; hint?: string; inputMode?: any; max?: number; min?: number; maxLength?: number; placeholder?: string; step?: string };
export const Txt = ({ label, value, onChange, required, type = "text", hint, inputMode, maxLength, placeholder, min, max, step }: P) =>
  <Field label={label} hint={hint}><input type={type} required={required} value={value ?? ""} onChange={(e) => onChange(e.target.value)} inputMode={inputMode} maxLength={maxLength} placeholder={placeholder} min={min} max={max} step={step} /></Field>;

export const Area = ({ label, value, onChange, required, maxLength = 1000 }: P) =>
  <Field label={label}><textarea style={{ minHeight: 90 }} required={required} value={value ?? ""} onChange={(e) => onChange(e.target.value)} maxLength={maxLength} /></Field>;

export const Sel = ({ label, value, onChange, options, required, blank }: Omit<P, "type"> & { options: [string, string][]; blank?: boolean }) =>
  <Field label={label}><select required={required} value={value ?? ""} onChange={(e) => onChange(e.target.value)}>{(blank || !required) && <option value="" />}{options.map(([k, t]) => <option key={k} value={k}>{t}</option>)}</select></Field>;

export const Check = ({ label, checked, onChange, required }: { label: string; checked: boolean; onChange: (v: boolean) => void; required?: boolean }) =>
  <label className="check"><input type="checkbox" required={required} checked={checked} onChange={(e) => onChange(e.target.checked)} /><span>{label}</span></label>;

export const clean = <T extends Record<string, any>>(o: T): T => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== "" && v !== undefined && v !== null)) as T;
