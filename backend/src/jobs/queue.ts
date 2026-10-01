import { Queue } from "bullmq";
import { Redis } from "ioredis";
import { config } from "../config.js";

export const redis = new Redis(config.REDIS_URL, { maxRetriesPerRequest: null });
export const letterQueue = new Queue<{ applicationId: string }>("letters", { connection: redis });
