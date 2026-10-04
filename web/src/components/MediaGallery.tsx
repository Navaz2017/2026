"use client";
import { useEffect, useState } from "react";
import { Icon } from "./Icon";
import { useT } from "@/lib/i18n";

export interface MediaItem { id: string; kind: "IMAGE" | "VIDEO"; caption?: string | null; url: string; approved?: boolean }

// Thumbnails that open in a full-screen preview (keyboard: Esc closes, arrows move). Videos play in the preview.
export function MediaGallery({ items, showStatus }: { items: MediaItem[]; showStatus?: boolean }) {
  const { t } = useT();
  const [open, setOpen] = useState<number | null>(null);
  const [broken, setBroken] = useState<Set<string>>(new Set());
  useEffect(() => {
    if (open === null) return;
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(null);
      if (e.key === "ArrowRight") setOpen((i) => (i === null ? i : (i + 1) % items.length));
      if (e.key === "ArrowLeft") setOpen((i) => (i === null ? i : (i - 1 + items.length) % items.length));
    };
    window.addEventListener("keydown", key); return () => window.removeEventListener("keydown", key);
  }, [open, items.length]);
  const cur = open === null ? null : items[open];
  return (
    <>
      <div className="gallery">
        {items.map((m, i) => (
          <button key={m.id} type="button" className="thumb" onClick={() => setOpen(i)} aria-label={`${t("media.preview")}: ${m.caption ?? ""}`}>
            {m.kind === "VIDEO"
              ? <><video src={m.url} muted preload="metadata" /><span className="play" aria-hidden><Icon name="arrow" size={26} /></span></>
              : broken.has(m.id) ? <span className="muted">!</span> : <img src={m.url} alt={m.caption ?? ""} loading="lazy" onError={() => setBroken(new Set(broken).add(m.id))} />}
            {(m.caption || showStatus) && <span className="cap">{m.caption}{showStatus && <em> · {m.approved ? t("inst.mediaVisible") : t("inst.mediaHidden")}</em>}</span>}
          </button>
        ))}
      </div>
      {cur && (
        <div className="lightbox" role="dialog" aria-modal="true" aria-label={cur.caption ?? t("media.preview")} onClick={() => setOpen(null)}>
          <button className="lbclose" onClick={() => setOpen(null)} aria-label={t("media.close")}><Icon name="x" size={24} /></button>
          <div className="lbbody" onClick={(e) => e.stopPropagation()}>
            {cur.kind === "VIDEO" ? <video src={cur.url} controls autoPlay /> : <img src={cur.url} alt={cur.caption ?? ""} />}
            {cur.caption && <p>{cur.caption}</p>}
            {items.length > 1 && <div className="row" style={{ justifyContent: "center" }}>
              <button className="btn" onClick={() => setOpen((open! - 1 + items.length) % items.length)}>{t("media.prev")}</button>
              <button className="btn" onClick={() => setOpen((open! + 1) % items.length)}>{t("media.next")}</button>
            </div>}
          </div>
        </div>
      )}
    </>
  );
}
