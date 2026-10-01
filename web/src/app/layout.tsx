import "./globals.css";
import { headers } from "next/headers";
import { Providers } from "./providers";

export const metadata = { title: "Enrolla", description: "Apply to schools, colleges and universities" };
export const viewport = { width: "device-width", initialScale: 1 };

export default async function Root({ children }: { children: React.ReactNode }) {
  await headers(); // opts the tree into per-request rendering so Next stamps the CSP nonce on its scripts
  return <html lang="en"><body><Providers>{children}</Providers></body></html>;
}
