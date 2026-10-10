// Same lists as the website (web/src/lib/forms.ts).
export const MODES = ["FULL_TIME", "PART_TIME", "WEEKEND", "EVENING", "ODEL"];
export const QUALS = ["MSCE", "IGCSE", "A_LEVEL", "AS", "COSC", "MATRIC", "IB", "JCE", "PSLCE", "OTHER"];
export const OTHER_QUALS = ["CERTIFICATE", "DIPLOMA", "BACHELORS", "MASTERS"];
export const HEARD = ["NEWSPAPER", "RADIO", "TV", "FRIEND", "SOCIAL_MEDIA", "WEBSITE", "OPEN_DAY", "REPRESENTATIVE", "LETTER", "POSTER", "EX_STUDENT", "OTHER"];
export const clean = <T extends Record<string, any>>(o: T): T => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== "" && v !== undefined && v !== null)) as T;
export const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// Nationality is chosen from a list (Malawian first). "Other" for anything not listed.
export const NATIONALITIES = ["Malawian","Afghan","Albanian","Algerian","American","Angolan","Argentine","Australian","Austrian","Bangladeshi","Belgian","Beninese","Botswanan","Brazilian","British","Bulgarian","Burkinabe","Burundian","Cameroonian","Canadian","Chadian","Chinese","Congolese (DRC)","Congolese (Republic)","Croatian","Cuban","Czech","Danish","Dutch","Egyptian","Eritrean","Ethiopian","Finnish","French","Gabonese","Gambian","German","Ghanaian","Greek","Guinean","Hungarian","Indian","Indonesian","Iranian","Iraqi","Irish","Israeli","Italian","Ivorian","Jamaican","Japanese","Jordanian","Kenyan","Lebanese","Lesotho","Liberian","Libyan","Madagascan","Malaysian","Malian","Mauritian","Mexican","Moroccan","Mozambican","Namibian","Nepalese","New Zealander","Nigerian","Nigerien","Norwegian","Pakistani","Palestinian","Peruvian","Philippine","Polish","Portuguese","Romanian","Russian","Rwandan","Saudi","Senegalese","Sierra Leonean","Singaporean","Somali","South African","South Korean","South Sudanese","Spanish","Sri Lankan","Sudanese","Swazi","Swedish","Swiss","Syrian","Tanzanian","Thai","Togolese","Tunisian","Turkish","Ugandan","Ukrainian","Vietnamese","Yemeni","Zambian","Zimbabwean","Other"];
