import { useEffect, useState, useSyncExternalStore } from "react";
import { ApiError, api, get } from "./api";
import { kv } from "./kv";
import { isOnline, onReconnect, useNetVersion } from "./net";
import { enqueue, flush, type OutboxItem } from "./outbox";

// ---------------------------------------------------------------- read cache (stale-while-revalidate)
const ck = (path: string) => `c:${path}`;
export const cacheGet = <T,>(path: string) => kv.get<T>(ck(path));
export const cacheSet = (path: string, data: unknown) => kv.set(ck(path), data);
export async function clearOfflineData() { for (const k of await kv.keys("c:")) await kv.del(k); await kv.del("outbox"); pending = []; emit(); }

// ---------------------------------------------------------------- outbox
let pending: OutboxItem[] = [];
let loaded: Promise<void> | null = null;
const subs = new Set<() => void>();
const emit = () => subs.forEach((f) => f());
const loadOutbox = () => (loaded ??= kv.get<OutboxItem[]>("outbox").then((x) => { pending = x ?? []; emit(); }));
const persist = async () => { await kv.set("outbox", pending); emit(); };
export const usePendingCount = () => { void loadOutbox(); return useSyncExternalStore((f) => { subs.add(f); return () => { subs.delete(f); }; }, () => pending.length, () => 0); };
export const pendingFor = (prefix: string) => pending.filter((p) => p.path.startsWith(prefix));

// Latest queued answers are laid over what the server sent, so a refresh never "forgets" something typed offline.
export function overlayApplication(app: any) {
  const base = `/me/applications/${app.id}`;
  let out = app;
  for (const p of pending) {
    const m = p.path.slice(base.length).match(/^\/section\/(\w+)/);
    if (p.path.startsWith(base + "/section/") && m) out = { ...out, form: { ...(out.form ?? {}), [m[1]!]: p.body } };
    else if (p.path === base + "/documents") out = { ...out, attachedCredentialIds: (p.body as any).credentialIds };
  }
  return out;
}

let flushing: Promise<void> | null = null;
export const lastFlush = { dropped: 0 };
export function flushOutbox() {
  flushing ??= (async () => {
    await loadOutbox();
    if (!pending.length) return;
    const { left, result } = await flush(pending, async (it) => {
      try { await api(it.path, { method: it.method, body: JSON.stringify(it.body) }, 15_000); return { ok: true, status: 200 }; }
      catch (e) { if (e instanceof ApiError && e.status > 0) return { ok: false, status: e.status }; throw e; }
    });
    pending = left; lastFlush.dropped += result.dropped.length; await persist();
  })().finally(() => { flushing = null; });
  return flushing;
}
onReconnect(() => { void flushOutbox().catch(() => {}); });

// Save an answer: straight to the server when possible (so validation errors show up right away);
// if there is no connection (or older answers are still waiting) it is kept on the phone and sent later, in order.
export async function writeOrQueue(path: string, body: unknown): Promise<{ queued: boolean }> {
  await loadOutbox();
  if (pending.length) await flushOutbox().catch(() => {});
  // Known offline -> straight to the queue (no waiting on a dead connection). Otherwise try for 8 s, then queue.
  if (!pending.length && isOnline()) {
    try { await api(path, { method: "PUT", body: JSON.stringify(body) }, 8000); return { queued: false }; }
    catch (e) { if (!(e instanceof ApiError) || e.status !== 0) throw e; }
  }
  pending = enqueue(pending, { method: "PUT", path, body });
  await persist();
  return { queued: true };
}

// ---------------------------------------------------------------- hook
export function useResource<T = any>(path: string | null, transform?: (d: T) => T) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [loading, setLoading] = useState(!!path);
  const [offline, setOffline] = useState(false);
  const [tick, setTick] = useState(0);
  const net = useNetVersion();

  useEffect(() => {
    if (!path) { setData(null); setLoading(false); return; }
    let live = true;
    const apply = (d: T) => (transform ? transform(d) : d);
    (async () => {
      await loadOutbox();
      const cached = await cacheGet<T>(path);
      if (live && cached) { setData(apply(cached)); setLoading(false); }
      try {
        const fresh = await get<T>(path);
        if (!live) return;
        await cacheSet(path, fresh);
        setData(apply(fresh)); setError(null); setOffline(false);
      } catch (e) {
        if (!live) return;
        if (e instanceof ApiError && e.status === 0) setOffline(true); else if (!cached) setError(e as ApiError);
      } finally { if (live) setLoading(false); }
    })();
    return () => { live = false; };
  }, [path, tick, net]); // eslint-disable-line react-hooks/exhaustive-deps

  return { data, error, loading, offline, reload: () => setTick((x) => x + 1), setData };
}
