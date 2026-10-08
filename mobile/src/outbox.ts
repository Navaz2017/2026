// Offline write queue - pure logic (no React Native imports) so it is unit-tested with node.
// Only idempotent "save this section" style writes are queued. Draft creation, submit, payment and file upload need the
// server to answer, so they are online-only and say so.
export interface OutboxItem { key: string; method: "PUT"; path: string; body: unknown; createdAt: number; attempts: number }
export interface Store { load(): Promise<OutboxItem[]>; save(items: OutboxItem[]): Promise<void> }
export type Send = (item: OutboxItem) => Promise<{ ok: boolean; status: number }>;

// Same endpoint written twice before it synced: only the latest body matters. Order of first write is kept.
export function enqueue(items: OutboxItem[], item: Omit<OutboxItem, "attempts" | "createdAt" | "key">, now = Date.now()): OutboxItem[] {
  const key = `${item.method} ${item.path}`;
  const i = items.findIndex((x) => x.key === key);
  const next: OutboxItem = { ...item, key, createdAt: i >= 0 ? items[i]!.createdAt : now, attempts: 0 };
  return i >= 0 ? items.map((x, j) => (j === i ? next : x)) : [...items, next];
}

export interface FlushResult { sent: number; kept: number; dropped: OutboxItem[]; offline: boolean }

// Sends in order. Network failure / 5xx / 429 -> stop and keep everything left (retry later).
// 4xx on a full save (e.g. validation because the form is half-filled) -> retry once as ?partial=1 so the typed data is not lost.
export async function flush(items: OutboxItem[], send: Send): Promise<{ left: OutboxItem[]; result: FlushResult }> {
  const left: OutboxItem[] = [], dropped: OutboxItem[] = [];
  let sent = 0, offline = false;
  for (let i = 0; i < items.length; i++) {
    const it = items[i]!;
    let r: { ok: boolean; status: number };
    try { r = await send(it); } catch { offline = true; left.push(...items.slice(i)); break; }
    if (!r.ok && r.status >= 400 && r.status < 500 && r.status !== 429 && r.status !== 401 && !it.path.includes("partial=1")) {
      try { r = await send({ ...it, path: it.path + (it.path.includes("?") ? "&" : "?") + "partial=1" }); } catch { offline = true; left.push(...items.slice(i)); break; }
    }
    if (r.ok) sent++;
    else if (r.status === 429 || r.status >= 500 || r.status === 401) { offline = true; left.push(...items.slice(i).map((x, j) => (j === 0 ? { ...x, attempts: x.attempts + 1 } : x))); break; }
    else dropped.push(it);
  }
  return { left, result: { sent, kept: left.length, dropped, offline } };
}
