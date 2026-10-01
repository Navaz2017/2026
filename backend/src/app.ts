import express, { type ErrorRequestHandler } from "express";
import helmet from "helmet";
import cors from "cors";
import rateLimit from "express-rate-limit";
import { config } from "./config.js";
import { auth } from "./routes/auth.js";
import { institutions } from "./routes/institutions.js";
import { family } from "./routes/family.js";
import { sms } from "./routes/sms.js";
import { sync } from "./routes/sync.js";
import { admin } from "./routes/admin.js";
import { publicCatalog } from "./routes/public.js";
import { files } from "./routes/files.js";

export const app = express();
app.set("trust proxy", 1); // behind the load balancer; req.ip is then the real client for rate limits and audit
app.disable("x-powered-by");
app.use(helmet());
app.use(cors({ origin: config.CORS_ORIGINS.split(","), credentials: true }));
// Keep the raw bytes: the SMS ingest endpoint verifies an HMAC over them.
app.use(express.json({ limit: "256kb", verify: (req, _res, buf) => { (req as any).rawBody = buf.toString("utf8"); } }));

const limiter = (windowMs: number, limit: number) => rateLimit({ windowMs, limit, standardHeaders: true, legacyHeaders: false });
// TODO(scale): swap the in-memory store for rate-limit-redis so limits hold across API instances.
app.use(limiter(60_000, 300));
app.use("/v1/auth", limiter(15 * 60_000, 30), auth);

app.get("/healthz", (_req, res) => res.json({ ok: true }));
app.use("/v1/public", publicCatalog);
app.use("/v1/sync", sync);
app.use("/v1/institution", institutions);
app.use("/v1/me", family);
app.use("/v1/sms", sms);
app.use("/v1/admin", admin);
if (config.STORAGE_DRIVER === "local") app.use("/v1/files", files);

const onError: ErrorRequestHandler = (err, _req, res, _next) => {
  console.error(err); // swap for pino + Sentry; never return stack traces to clients
  res.status(500).json({ error: "internal" });
};
app.use(onError);
