// Malawi school structure. Primary: Standard 1-8. Secondary: Form 1-4 (MSCE syllabus); the Cambridge syllabus goes up to Form 6.
// A school states the HIGHEST class it offers; it can only create class-level "programmes" up to that.
export const PRIMARY_LEVELS = ["STD1", "STD2", "STD3", "STD4", "STD5", "STD6", "STD7", "STD8"] as const;
export const SECONDARY_LEVELS = ["F1", "F2", "F3", "F4", "F5", "F6"] as const;
export const ALL_LEVELS: readonly string[] = [...PRIMARY_LEVELS, ...SECONDARY_LEVELS];

export const isSchool = (type: string) => type === "PRIMARY_SCHOOL" || type === "SECONDARY_SCHOOL";
export const levelsFor = (type: string): readonly string[] => (type === "PRIMARY_SCHOOL" ? PRIMARY_LEVELS : type === "SECONDARY_SCHOOL" ? SECONDARY_LEVELS : []);
export const levelLabel = (l: string) => (l.startsWith("STD") ? `Standard ${l.slice(3)}` : `Form ${l.slice(1)}`);

export function allowedLevels(inst: { type: string; highestLevel: string | null }) {
  const all = levelsFor(inst.type);
  if (!inst.highestLevel) return [];
  const i = all.indexOf(inst.highestLevel);
  return i < 0 ? [] : all.slice(0, i + 1);
}

// F1-F4 can be taught under MSCE or Cambridge; F5-F6 only exist under Cambridge.
export const syllabiForLevel = (l: string) => (l === "F5" || l === "F6" ? ["CAMBRIDGE"] : l.startsWith("F") ? ["MSCE", "CAMBRIDGE"] : []);

export const MODES = ["FULL_TIME", "PART_TIME", "WEEKEND", "EVENING", "ODEL"] as const;
export const TUITION_PERIODS = ["SEMESTER", "YEAR", "TERM", "PROGRAMME"] as const;
export const MAX_CHOICES_TERTIARY = 3;
