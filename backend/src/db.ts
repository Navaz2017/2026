import { PrismaClient } from "@prisma/client";

// Prisma's default pool is small (2 x CPU cores + 1, e.g. 5 on a laptop) with a 10 s wait. The API, workers and live
// notifications all share one process each, so give every process a roomier pool and a longer wait, unless the
// DATABASE_URL already sets them (?connection_limit=..&pool_timeout=..).
function withPool(raw: string | undefined) {
  if (!raw) return undefined;
  try {
    const u = new URL(raw);
    if (!u.searchParams.has("connection_limit")) u.searchParams.set("connection_limit", process.env.DB_POOL_SIZE ?? "15");
    if (!u.searchParams.has("pool_timeout")) u.searchParams.set("pool_timeout", "30");
    return u.toString();
  } catch { return raw; }
}
const url = withPool(process.env.DATABASE_URL);
export const prisma = new PrismaClient(url ? { datasources: { db: { url } } } : undefined);
