"use client";
import { LanguageProvider } from "@/lib/i18n";
import { SessionProvider } from "@/lib/session";

export function Providers({ children }: { children: React.ReactNode }) {
  return <LanguageProvider><SessionProvider>{children}</SessionProvider></LanguageProvider>;
}
