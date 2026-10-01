"use client";
import { useState } from "react";
import { useT } from "@/lib/i18n";

export interface Bar { label: string; value: number; display?: string }

// One series -> one hue (palette slot 1). Thin bars with rounded tops anchored to a quiet baseline,
// selective direct labels, hover/focus tooltip, and a table view for screen readers and low-vision users.
export function BarChart({ title, bars, height = 180 }: { title: string; bars: Bar[]; height?: number }) {
  const { t } = useT();
  const [table, setTable] = useState(false);
  const [hot, setHot] = useState<number | null>(null);
  const max = Math.max(1, ...bars.map((b) => b.value));
  const W = Math.max(320, bars.length * 44), top = 22, bottom = 34, ch = height - top - bottom, bw = Math.min(26, (W / Math.max(1, bars.length)) * 0.55);
  const x = (i: number) => (W / bars.length) * (i + 0.5);
  const show = (b: Bar) => b.display ?? b.value.toLocaleString("en-US");
  return (
    <figure className="chart">
      <figcaption><strong>{title}</strong>
        <button className="linkbtn" onClick={() => setTable(!table)}>{t("owner.showTable")}</button></figcaption>
      {table ? (
        <table className="tbl"><tbody>{bars.map((b) => <tr key={b.label}><th>{b.label}</th><td>{show(b)}</td></tr>)}</tbody></table>
      ) : (
        <div className="chartscroll">
          <svg role="img" aria-label={`${title}: ${bars.map((b) => `${b.label} ${show(b)}`).join(", ")}`} viewBox={`0 0 ${W} ${height}`} width={W} height={height}>
            <line x1="0" x2={W} y1={top + ch} y2={top + ch} stroke="var(--grid)" strokeWidth="1" />
            {bars.map((b, i) => {
              const h = Math.max(b.value > 0 ? 3 : 0, (b.value / max) * ch), y = top + ch - h;
              return (
                <g key={b.label} tabIndex={0} onMouseEnter={() => setHot(i)} onMouseLeave={() => setHot(null)} onFocus={() => setHot(i)} onBlur={() => setHot(null)}>
                  <rect x={x(i) - 22} y={0} width={44} height={height} fill="transparent" />
                  <rect x={x(i) - bw / 2} y={y} width={bw} height={h} rx={4} fill="var(--series-1)" opacity={hot === null || hot === i ? 1 : 0.55} />
                  {(bars.length <= 8 || hot === i) && b.value > 0 && <text x={x(i)} y={y - 5} textAnchor="middle" className="chartval">{show(b)}</text>}
                  <text x={x(i)} y={height - 12} textAnchor="middle" className="chartlbl">{b.label}</text>
                  <title>{`${b.label}: ${show(b)}`}</title>
                </g>
              );
            })}
          </svg>
        </div>
      )}
    </figure>
  );
}
