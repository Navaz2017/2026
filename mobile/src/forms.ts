// Same lists as the website (web/src/lib/forms.ts).
export const MODES = ["FULL_TIME", "PART_TIME", "WEEKEND", "EVENING", "ODEL"];
export const QUALS = ["MSCE", "IGCSE", "A_LEVEL", "AS", "COSC", "MATRIC", "IB", "JCE", "PSLCE", "OTHER"];
export const OTHER_QUALS = ["CERTIFICATE", "DIPLOMA", "BACHELORS", "MASTERS"];
export const HEARD = ["NEWSPAPER", "RADIO", "TV", "FRIEND", "SOCIAL_MEDIA", "WEBSITE", "OPEN_DAY", "REPRESENTATIVE", "LETTER", "POSTER", "EX_STUDENT", "OTHER"];
export const clean = <T extends Record<string, any>>(o: T): T => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== "" && v !== undefined && v !== null)) as T;
export const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
