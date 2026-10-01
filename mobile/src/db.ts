import * as SQLite from "expo-sqlite";

// Local-first store: the UI reads ONLY from here. Network is a background concern.
export const db = SQLite.openDatabaseSync("app.db");

db.execSync(`
  PRAGMA journal_mode = WAL;
  CREATE TABLE IF NOT EXISTS docs (coll TEXT NOT NULL, id TEXT NOT NULL, json TEXT NOT NULL, updatedAt TEXT NOT NULL, PRIMARY KEY (coll, id));
  CREATE TABLE IF NOT EXISTS cursors (coll TEXT PRIMARY KEY, since TEXT NOT NULL);
  -- Writes made offline. clientId doubles as the server-side idempotency key.
  CREATE TABLE IF NOT EXISTS outbox (clientId TEXT PRIMARY KEY, method TEXT NOT NULL, path TEXT NOT NULL, body TEXT NOT NULL, attempts INTEGER NOT NULL DEFAULT 0, createdAt TEXT NOT NULL);
`);
