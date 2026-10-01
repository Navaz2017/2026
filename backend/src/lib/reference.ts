// Airtel TIDs look like "CI260915.1803.125840" and appear in SMS with a trailing full stop
// ("BW260929.1403.PL4887."). Applicants type them with/without dots, spaces, any case.
export const normaliseReference = (raw: string) => raw.replace(/\s+/g, "").replace(/\.+$/, "").toUpperCase();
export const REFERENCE_RE = /^[A-Za-z0-9]+(?:\.[A-Za-z0-9]+)*\.?$/;
