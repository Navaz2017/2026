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
  // "local" stores files on disk (dev/tests); production must use "s3".
  STORAGE_DRIVER: z.enum(["s3", "local"]).default("local"),
  LOCAL_STORAGE_DIR: z.string().default("./.data"),
  PUBLIC_API_URL: z.string().default("http://localhost:4000"),
  RATE_LIMIT_PER_MIN: z.coerce.number().default(300),
  ACADEMIC_YEAR: z.string().default("2026/2027"),
  WA_DATA_DIR: z.string().default("./.wa-sessions"),
  WA_MAX_SESSIONS: z.coerce.number().default(40),
  // Optional: path to Chromium for whatsapp-web.js (e.g. /usr/bin/chromium).
  PUPPETEER_EXECUTABLE_PATH: z.string().optional(),
});

export const config = schema.parse(process.env);
if (config.NODE_ENV === "production" && config.STORAGE_DRIVER !== "s3") throw new Error("STORAGE_DRIVER must be s3 in production");
if (config.NODE_ENV === "production" && config.DATA_ENC_KEY === "0".repeat(64)) {
  throw new Error("DATA_ENC_KEY must be set in production");
}
