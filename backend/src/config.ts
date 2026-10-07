import { z } from "zod";

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().default(4000),
  DATABASE_URL: z.string(),
  REDIS_URL: z.string().default("redis://localhost:6379"),
  JWT_ACCESS_SECRET: z.string().min(32),
  JWT_REFRESH_SECRET: z.string().min(32),
  // 32-byte hex key used to encrypt device HMAC keys at rest. Use a KMS-managed key in production.
  DATA_ENC_KEY: z.string().length(64).default("0".repeat(64)),
  CORS_ORIGINS: z.string().default("http://localhost:3000"),
  S3_BUCKET: z.string().default("admissions-private"),
  S3_REGION: z.string().default("af-south-1"),
  // "local" (default) keeps files on this server's disk — no cloud account needed. "s3" is an optional alternative.
  STORAGE_DRIVER: z.enum(["s3", "local"]).default("local"),
  LOCAL_STORAGE_DIR: z.string().default("./.data"),
  PUBLIC_API_URL: z.string().default("http://localhost:4000"),
  WEB_URL: z.string().default("http://localhost:3000"), // used in password-reset links
  // Outgoing email over plain SMTP (any provider, or a mail server on this machine). Without it, email is only logged.
  SMTP_HOST: z.string().optional(), SMTP_PORT: z.coerce.number().default(587), SMTP_SECURE: z.enum(["true", "false"]).default("false"),
  SMTP_USER: z.string().optional(), SMTP_PASS: z.string().optional(), SMTP_FROM: z.string().default("Enrolla <no-reply@localhost>"),
  RATE_LIMIT_PER_MIN: z.coerce.number().default(300),
  ACADEMIC_YEAR: z.string().default("2026/2027"),
  WA_DATA_DIR: z.string().default("./.wa-sessions"),
  WA_MAX_SESSIONS: z.coerce.number().default(40),
  // Optional: path to Chromium for whatsapp-web.js (e.g. /usr/bin/chromium).
  PUPPETEER_EXECUTABLE_PATH: z.string().optional(),
});

export const config = schema.parse(process.env);

if (config.NODE_ENV === "production") {
  const problems: string[] = [];
  if (config.DATA_ENC_KEY === "0".repeat(64)) problems.push("DATA_ENC_KEY must be set (64 hex characters)");
  if (!process.env.PUBLIC_API_URL) problems.push("PUBLIC_API_URL must be set to the address users reach this API on");
  if (!process.env.WEB_URL) problems.push("WEB_URL must be set to the address of the website (used in password-reset emails)");
  if (config.STORAGE_DRIVER === "local" && !config.LOCAL_STORAGE_DIR.startsWith("/")) problems.push("LOCAL_STORAGE_DIR must be an absolute path (e.g. /var/lib/enrolla/files)");
  if (problems.length) throw new Error("Production configuration problems:\n - " + problems.join("\n - "));
  if (!config.SMTP_HOST) console.warn("WARNING: SMTP_HOST is not set - emails (password resets, letters) will only be written to the log.");
}
