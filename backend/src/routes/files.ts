import express, { Router } from "express";
import { localMime, localRead, localWrite, verifyLocalToken } from "../lib/storage.js";
import { h } from "../middleware/validate.js";

const MAGIC: Record<string, number[]> = { "application/pdf": [0x25, 0x50, 0x44, 0x46], "image/jpeg": [0xff, 0xd8, 0xff], "image/png": [0x89, 0x50, 0x4e, 0x47] };
const looksLike = (mime: string, b: Buffer) => !MAGIC[mime] || MAGIC[mime]!.every((x, i) => b[i] === x);

// Dev/test stand-in for S3 presigned URLs. Never mounted when STORAGE_DRIVER=s3.
export const files = Router();
files.put("/put/:token", express.raw({ type: "*/*", limit: "200mb" }), h(async (req, res) => {
  const t = verifyLocalToken(req.params.token!);
  if (!t || t.op !== "put" || !Buffer.isBuffer(req.body)) return res.status(403).json({ error: "forbidden" });
  if (!(req.header("content-type") ?? "").startsWith(t.mime!) || req.body.length !== t.size) return res.status(400).json({ error: "upload_failed" });
  if (!looksLike(t.mime!, req.body)) return res.status(400).json({ error: "file_type_not_allowed" }); // the bytes must really be what the label says
  await localWrite(t.key, req.body, t.mime);
  res.status(200).end();
}));
files.get("/get/:token", h(async (req, res) => {
  const t = verifyLocalToken(req.params.token!);
  if (!t || t.op !== "get") return res.status(403).json({ error: "forbidden" });
  const data = await localRead(t.key).catch(() => null);
  if (!data) return res.status(404).json({ error: "not_found" });
  res.type(await localMime(t.key)).set({ "Content-Disposition": "inline", "X-Content-Type-Options": "nosniff", "Cross-Origin-Resource-Policy": "cross-origin" /* helmet default (same-origin) would block <img>/<video> on the web app */ }).send(data);
}));
