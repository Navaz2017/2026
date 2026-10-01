import { GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { randomUUID } from "node:crypto";
import { config } from "../config.js";

const s3 = new S3Client({ region: config.S3_REGION });

const ALLOWED: Record<string, number> = {
  "application/pdf": 10_000_000,
  "image/jpeg": 8_000_000,
  "image/png": 8_000_000,
  "video/mp4": 200_000_000,
};

// Clients upload straight to the private bucket (keeps 70k users' bytes off the API servers).
// Content-type and size are pinned in the signature. A malware-scan Lambda should gate `quarantine/` -> live key.
export async function presignUpload(prefix: string, mime: string, size: number) {
  const max = ALLOWED[mime];
  if (!max || size > max) throw new Error("File type or size not allowed");
  const key = `${prefix}/${randomUUID()}`;
  const url = await getSignedUrl(
    s3,
    new PutObjectCommand({ Bucket: config.S3_BUCKET, Key: key, ContentType: mime, ContentLength: size }),
    { expiresIn: 300 },
  );
  return { key, url, headers: { "Content-Type": mime } };
}

export const presignDownload = (key: string, seconds = 120) =>
  getSignedUrl(s3, new GetObjectCommand({ Bucket: config.S3_BUCKET, Key: key }), { expiresIn: seconds });
