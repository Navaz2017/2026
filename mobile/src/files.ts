import * as DocumentPicker from "expo-document-picker";
import type { Picked } from "./api";

export const DOC_KINDS = ["ID", "MSCE", "IGCSE", "A_LEVEL", "JCE", "PSLCE", "TRANSCRIPT", "SCHOOL_REPORT", "BIRTH_CERT", "PHOTO", "SPONSOR_LETTER", "OTHER_CERT"];
export const ACADEMIC_KINDS = ["MSCE", "JCE", "PSLCE", "IGCSE", "A_LEVEL", "TRANSCRIPT", "SCHOOL_REPORT", "OTHER_CERT"];

// Pick a PDF or photo from the phone. Uploading needs a connection (large files are never queued silently).
export async function pickFile(): Promise<Picked | null> {
  const r = await DocumentPicker.getDocumentAsync({ type: ["application/pdf", "image/jpeg", "image/png"], copyToCacheDirectory: true });
  if (r.canceled || !r.assets[0]) return null;
  const a = r.assets[0];
  return { uri: a.uri, name: a.name, mime: a.mimeType ?? "application/pdf", size: a.size };
}
