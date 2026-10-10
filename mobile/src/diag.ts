import { Platform } from "react-native";

// A failure with the step it happened in ("pick-file", "read-file", "send-file"...). The step and reason are shown on screen, written to
// the console (Metro / adb logcat) and reported to the server log, so "something went wrong" always says where.
// (No import of ./api here: api.ts registers the reporter, which avoids a require cycle.)
export class StageError extends Error {
  constructor(public stage: string, public cause: unknown) { super(describe(cause)); }
}
export const describe = (e: unknown) => {
  const x = e as { status?: number; code?: string } | null;
  return (x && typeof x === "object" && typeof x.code === "string" && "status" in x ? `${x.status || "network"} ${x.code}` : e instanceof Error ? `${e.name}: ${e.message}` : String(e)).slice(0, 200);
};

let report: (body: Record<string, unknown>) => Promise<unknown> = async () => {};
export const setDiagReporter = (f: typeof report) => { report = f; };

export async function stage<T>(name: string, fn: () => Promise<T>, extra: { mime?: string; size?: number } = {}): Promise<T> {
  try { return await fn(); }
  catch (e) {
    if (e instanceof StageError) throw e;
    const err = new StageError(name, e);
    console.warn(`[upload:${name}]`, err.message, extra, e);
    report({ stage: name, message: err.message, platform: `${Platform.OS} ${Platform.Version}`, ...extra }).catch(() => {}); // best effort
    throw err;
  }
}
