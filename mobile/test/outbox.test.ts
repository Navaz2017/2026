import test from "node:test";
import assert from "node:assert/strict";
import { enqueue, flush, type OutboxItem } from "../src/outbox.js";

const put = (path: string, body: unknown = {}) => ({ method: "PUT" as const, path, body });

test("writing the same section twice keeps one entry with the latest data, in original order", () => {
  let q: OutboxItem[] = [];
  q = enqueue(q, put("/a/section/personal", { v: 1 }), 1);
  q = enqueue(q, put("/a/section/guardian", { v: 1 }), 2);
  q = enqueue(q, put("/a/section/personal", { v: 2 }), 3);
  assert.deepEqual(q.map((x) => [x.path, (x.body as any).v, x.createdAt]), [["/a/section/personal", 2, 1], ["/a/section/guardian", 1, 2]]);
});

test("flush sends in order and empties the queue", async () => {
  const seen: string[] = [];
  let q = enqueue(enqueue([], put("/1")), put("/2"));
  const { left, result } = await flush(q, async (i) => { seen.push(i.path); return { ok: true, status: 200 }; });
  assert.deepEqual(seen, ["/1", "/2"]); assert.equal(left.length, 0); assert.equal(result.sent, 2); assert.equal(result.offline, false);
});

test("no connection: nothing is lost, order kept, flagged offline", async () => {
  const q = enqueue(enqueue([], put("/1")), put("/2"));
  const { left, result } = await flush(q, async () => { throw new Error("network"); });
  assert.deepEqual(left.map((x) => x.path), ["/1", "/2"]); assert.equal(result.offline, true); assert.equal(result.sent, 0);
});

test("server error or rate limit stops the run and retries later (attempt counted once)", async () => {
  const q = enqueue(enqueue([], put("/1")), put("/2"));
  for (const status of [500, 503, 429, 401]) {
    const calls: string[] = [];
    const { left, result } = await flush(q, async (i) => { calls.push(i.path); return { ok: false, status }; });
    assert.deepEqual(calls, ["/1"], `status ${status}`); assert.equal(left.length, 2); assert.equal(left[0]!.attempts, 1); assert.equal(result.offline, true);
  }
});

test("validation rejection: retried once as partial so typed data is kept; if still rejected it is dropped and reported", async () => {
  const q = enqueue(enqueue([], put("/a/section/x", { a: 1 })), put("/b/section/y"));
  const calls: string[] = [];
  const { left, result } = await flush(q, async (i) => { calls.push(i.path); return i.path.startsWith("/a") && !i.path.includes("partial") ? { ok: false, status: 400 } : { ok: true, status: 200 }; });
  assert.deepEqual(calls, ["/a/section/x", "/a/section/x?partial=1", "/b/section/y"]);
  assert.equal(left.length, 0); assert.equal(result.sent, 2); assert.equal(result.dropped.length, 0);
  const r2 = await flush(q, async () => ({ ok: false, status: 404 }));
  assert.equal(r2.result.dropped.length, 2); assert.equal(r2.left.length, 0);
});

test("a rejected item does not block the ones behind it", async () => {
  const q = enqueue(enqueue([], put("/gone")), put("/ok"));
  const { result } = await flush(q, async (i) => (i.path === "/ok" ? { ok: true, status: 200 } : { ok: false, status: 404 }));
  assert.equal(result.sent, 1); assert.deepEqual(result.dropped.map((x) => x.path), ["/gone"]);
});
