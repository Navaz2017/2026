import * as DocumentPicker from "expo-document-picker";
import * as ImagePicker from "expo-image-picker";
import type { Picked } from "./api";
import { stage } from "./diag";

export const DOC_KINDS = ["ID", "MSCE", "IGCSE", "A_LEVEL", "JCE", "PSLCE", "TRANSCRIPT", "SCHOOL_REPORT", "BIRTH_CERT", "PHOTO", "SPONSOR_LETTER", "OTHER_CERT"];
export const ACADEMIC_KINDS = ["MSCE", "JCE", "PSLCE", "IGCSE", "A_LEVEL", "TRANSCRIPT", "SCHOOL_REPORT", "OTHER_CERT"];

// Pick a PDF or photo from the phone. Uploading needs a connection (large files are never queued silently).
export async function pickFile(): Promise<Picked | null> {
  const r = await stage("pick-file", () => DocumentPicker.getDocumentAsync({ type: ["application/pdf", "image/jpeg", "image/png"], copyToCacheDirectory: true }));
  if (r.canceled || !r.assets[0]) return null;
  const a = r.assets[0];
  return { uri: a.uri, name: a.name, mime: a.mimeType ?? "application/pdf", size: a.size };
}

// A photo from the gallery (re-encoded as JPEG at 70% quality, so a 10 MB camera photo becomes well under the limit).
export async function pickPhoto(): Promise<Picked | null> {
  const r = await stage("pick-photo", () => ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], quality: 0.7, allowsEditing: false }));
  if (r.canceled || !r.assets[0]) return null;
  const a = r.assets[0];
  return { uri: a.uri, name: a.fileName ?? "photo.jpg", mime: a.mimeType?.startsWith("image/") ? a.mimeType : "image/jpeg", size: a.fileSize };
}
