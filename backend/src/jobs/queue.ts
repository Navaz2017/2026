// Decision letters used to go through Redis/BullMQ. They are now picked up from the database by jobs/worker.ts, so this is
// only a hook kept for callers: announcing a decision is enough, the worker finds it within a few seconds.
export async function enqueueLetter(_applicationId: string) {}
