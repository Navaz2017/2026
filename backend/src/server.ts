import fs from "node:fs";
import path from "node:path";
import { app } from "./app.js";
import { config } from "./config.js";
import { prisma } from "./db.js";

// A database that is behind the code ("column ... does not exist") shows up as a bare 500 in the browser.
// Say so clearly at startup instead.
async function checkMigrations() {
  try {
    const dir = path.resolve("prisma/migrations");
    const local = fs.readdirSync(dir).filter((d) => /^\d/.test(d));
    const done = (await prisma.$queryRaw<{ migration_name: string }[]>`SELECT migration_name FROM _prisma_migrations WHERE finished_at IS NOT NULL`).map((r) => r.migration_name);
    const missing = local.filter((m) => !done.includes(m));
    if (missing.length) console.error(`\n!!  DATABASE IS OUT OF DATE - some requests will fail with 500 errors.\n!!  Run:  npx prisma migrate deploy\n!!  Missing migrations: ${missing.join(", ")}\n`);
  } catch (e) {
    console.error(`\n!!  Could not check the database (is Postgres running, and is DATABASE_URL in backend/.env correct, and has 'npx prisma migrate deploy' been run?)\n!!  ${(e as Error).message.split("\n").pop()}\n`);
  }
}

app.listen(config.PORT, () => { console.log(`api listening on :${config.PORT}`); void checkMigrations(); });
