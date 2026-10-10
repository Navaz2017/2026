// Constants shared by the application wizard, school pages and the institution screens.
export const PRIMARY_LEVELS = ["STD1", "STD2", "STD3", "STD4", "STD5", "STD6", "STD7", "STD8"];
export const SECONDARY_LEVELS = ["F1", "F2", "F3", "F4", "F5", "F6"];
export const levelLabel = (l: string) => (l.startsWith("STD") ? `Standard ${l.slice(3)}` : `Form ${l.slice(1)}`);
export const isSchool = (type: string) => type === "PRIMARY_SCHOOL" || type === "SECONDARY_SCHOOL";
export const levelsFor = (type: string) => (type === "PRIMARY_SCHOOL" ? PRIMARY_LEVELS : type === "SECONDARY_SCHOOL" ? SECONDARY_LEVELS : []);
export const allowedLevels = (type: string, highest?: string | null) => { const all = levelsFor(type); const i = highest ? all.indexOf(highest) : -1; return i < 0 ? [] : all.slice(0, i + 1); };
export const syllabiForLevel = (l: string) => (l === "F5" || l === "F6" ? ["CAMBRIDGE"] : l.startsWith("F") ? ["MSCE", "CAMBRIDGE"] : []);

export const MODES = ["FULL_TIME", "PART_TIME", "WEEKEND", "EVENING", "ODEL"];
export const PERIODS = ["SEMESTER", "YEAR", "TERM", "PROGRAMME"];
export const QUALS = ["MSCE", "IGCSE", "A_LEVEL", "AS", "COSC", "MATRIC", "IB", "JCE", "PSLCE", "OTHER"];
export const OTHER_QUALS = ["CERTIFICATE", "DIPLOMA", "BACHELORS", "MASTERS"];
export const HEARD = ["NEWSPAPER", "RADIO", "TV", "FRIEND", "SOCIAL_MEDIA", "WEBSITE", "OPEN_DAY", "REPRESENTATIVE", "LETTER", "POSTER", "EX_STUDENT", "OTHER"];
export const DOC_KINDS = ["ID", "MSCE", "IGCSE", "A_LEVEL", "JCE", "PSLCE", "TRANSCRIPT", "SCHOOL_REPORT", "BIRTH_CERT", "PHOTO", "SPONSOR_LETTER", "OTHER_CERT"];
export const ACADEMIC_KINDS = ["MSCE", "JCE", "PSLCE", "IGCSE", "A_LEVEL", "TRANSCRIPT", "SCHOOL_REPORT", "OTHER_CERT"];

// Nationality is chosen from a list (Malawian first). "Other" for anything not listed.
export const NATIONALITIES = ["Malawian","Afghan","Albanian","Algerian","American","Angolan","Argentine","Australian","Austrian","Bangladeshi","Belgian","Beninese","Botswanan","Brazilian","British","Bulgarian","Burkinabe","Burundian","Cameroonian","Canadian","Chadian","Chinese","Congolese (DRC)","Congolese (Republic)","Croatian","Cuban","Czech","Danish","Dutch","Egyptian","Eritrean","Ethiopian","Finnish","French","Gabonese","Gambian","German","Ghanaian","Greek","Guinean","Hungarian","Indian","Indonesian","Iranian","Iraqi","Irish","Israeli","Italian","Ivorian","Jamaican","Japanese","Jordanian","Kenyan","Lebanese","Lesotho","Liberian","Libyan","Madagascan","Malaysian","Malian","Mauritian","Mexican","Moroccan","Mozambican","Namibian","Nepalese","New Zealander","Nigerian","Nigerien","Norwegian","Pakistani","Palestinian","Peruvian","Philippine","Polish","Portuguese","Romanian","Russian","Rwandan","Saudi","Senegalese","Sierra Leonean","Singaporean","Somali","South African","South Korean","South Sudanese","Spanish","Sri Lankan","Sudanese","Swazi","Swedish","Swiss","Syrian","Tanzanian","Thai","Togolese","Tunisian","Turkish","Ugandan","Ukrainian","Vietnamese","Yemeni","Zambian","Zimbabwean","Other"];
