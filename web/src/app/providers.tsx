"use client";
import { LanguageProvider } from "@/lib/i18n";
import { SessionProvider } from "@/lib/session";
import { RealtimeProvider } from "@/lib/realtime";

export function Providers({ children }: { children: React.ReactNode }) {
  return <LanguageProvider><SessionProvider><RealtimeProvider>{children}</RealtimeProvider></SessionProvider></LanguageProvider>;
}
