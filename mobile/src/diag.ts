import { Platform } from "react-native";
import { ApiError, post } from "./api";

// A failure with the step it happened in ("pick", "read", "send"...). The step and reason are shown on screen, written to the
// console (Metro / adb logcat) and reported to the server log, so "something went wrong" always says where.
export class StageError extends Error {
  constructor(public stage: string, public cause: unknown) { super(describe(cause)); }
}
export const describe = (e: unknown) => (e instanceof ApiError ? `${e.status || "network"} ${e.code}` : e instanceof Error ? `${e.name}: ${e.message}` : String(e)).slice(0, 200);

export async function stage<T>(name: string, fn: () => Promise<T>, extra: { mime?: string; size?: number } = {}): Promise<T> {
  try { return await fn(); }
  catch (e) {
    if (e instanceof StageError) throw e;
    const err = new StageError(name, e);
    console.warn(`[upload:${name}]`, err.message, extra, e);
    post("/me/diag", { stage: name, message: err.message, platform: `${Platform.OS} ${Platform.Version}`, ...extra }).catch(() => {}); // best effort
    throw err;
  }
}
