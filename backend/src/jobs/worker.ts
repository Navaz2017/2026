// Run as a separate process (`npm run worker`; `npm run dev:all` / `start:all` start it for you). No Redis needed:
// it simply looks in the database for decisions that have been announced but have no letter yet, so nothing can be lost.
import { prisma } from "../db.js";
import { generateLetter } from "../lib/letterJob.js";

const retryAt = new Map<string, number>(); // application id -> earliest next try after a failure
const tries = new Map<string, number>();

export async function sweepLetters() {
  const todo = await prisma.application.findMany({
    where: { status: { in: ["ACCEPTED", "REJECTED"] }, decisionPublishedAt: { not: null }, letter: null },
    select: { id: true }, orderBy: { decisionPublishedAt: "asc" }, take: 20,
  });
  let done = 0;
  for (const a of todo) {
    if ((retryAt.get(a.id) ?? 0) > Date.now()) continue;
    try { await generateLetter(a.id); done++; retryAt.delete(a.id); tries.delete(a.id); }
    catch (e) {
      const n = (tries.get(a.id) ?? 0) + 1; tries.set(a.id, n);
      retryAt.set(a.id, Date.now() + Math.min(n * 30_000, 600_000)); // back off, but keep trying
      console.error(`letter for ${a.id} failed (try ${n}):`, (e as Error).message);
    }
  }
  return done;
}

if (process.env.NODE_ENV !== "test") {
  console.log("letter worker running");
  setInterval(() => { sweepLetters().catch((e) => console.error("letter sweep failed:", e.message)); }, 3000);
}
