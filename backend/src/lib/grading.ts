// Default Malawi secondary scale (MANEB JCE/MSCE, grades 1-9). Raw scores are stored; the grade is computed on read,
// so a school's own scale can replace this later. Primary schools: percentage only for now.
const MANEB: [number, number][] = [[80, 1], [75, 2], [70, 3], [65, 4], [60, 5], [55, 6], [50, 7], [40, 8], [0, 9]];
export const isSecondaryLevel = (level?: string | null) => !!level && /^F[1-6]$/.test(level);
export function gradeFor(percent: number, level?: string | null): number | null {
  if (!isSecondaryLevel(level)) return null;
  return MANEB.find(([min]) => percent >= min)![1];
}
export const percentOf = (score: number, max: number) => (max > 0 ? Math.round((score / max) * 1000) / 10 : 0);
