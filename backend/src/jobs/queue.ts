import { Queue } from "bullmq";
import { Redis } from "ioredis";
import { config } from "../config.js";

// Workers need a blocking connection; producers (the API) must fail fast instead of hanging when Redis is down.
export const workerRedis = () => new Redis(config.REDIS_URL, { maxRetriesPerRequest: null });
// Connects eagerly in the background; while Redis is down, commands reject immediately (no offline queue).
const producerRedis = new Redis(config.REDIS_URL, {
  enableOfflineQueue: false, maxRetriesPerRequest: 1,
  retryStrategy: (n) => (config.NODE_ENV === "test" ? null : Math.min(n * 500, 5000)), // tests have no Redis: give up so the process can exit
});
producerRedis.on("error", () => {});

export const letterQueue = new Queue<{ applicationId: string }>("letters", { connection: producerRedis });

// Never throws and never blocks for long: the decision is already committed, and BullMQ's add() would otherwise
// wait indefinitely for Redis. If the job cannot be queued the sweeper in worker.ts re-queues it within a minute.
export async function enqueueLetter(applicationId: string) {
  const add = letterQueue.add("letter", { applicationId }, { jobId: `letter-${applicationId}`, attempts: 5, backoff: { type: "exponential", delay: 5000 } });
  add.catch(() => {}); // late rejection after the timeout below must not become an unhandled rejection
  const timeout = new Promise<never>((_, reject) => setTimeout(() => reject(new Error("queue unavailable")), 1500));
  await Promise.race([add, timeout]).catch((e) => console.warn("letter enqueue deferred:", (e as Error).message));
}
