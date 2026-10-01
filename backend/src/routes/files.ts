import express, { Router } from "express";
import { localMime, localRead, localWrite, verifyLocalToken } from "../lib/storage.js";
import { h } from "../middleware/validate.js";

// Dev/test stand-in for S3 presigned URLs. Never mounted when STORAGE_DRIVER=s3.
export const files = Router();
files.put("/put/:token", express.raw({ type: "*/*", limit: "200mb" }), h(async (req, res) => {
  const t = verifyLocalToken(req.params.token!);
  if (!t || t.op !== "put" || req.header("content-type") !== t.mime || !Buffer.isBuffer(req.body) || req.body.length !== t.size) return res.status(403).json({ error: "forbidden" });
  await localWrite(t.key, req.body, t.mime);
  res.status(200).end();
}));
files.get("/get/:token", h(async (req, res) => {
  const t = verifyLocalToken(req.params.token!);
  if (!t || t.op !== "get") return res.status(403).json({ error: "forbidden" });
  const data = await localRead(t.key).catch(() => null);
  if (!data) return res.status(404).json({ error: "not_found" });
  res.type(await localMime(t.key)).set({ "Content-Disposition": "inline", "X-Content-Type-Options": "nosniff"}).send(data);
}));
