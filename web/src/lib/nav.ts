import type { Role } from "./api";

// One shell for everyone (like a mailbox app): the role decides which entries exist. The API enforces the
// same boundaries — hiding a link is only convenience. Icons let people who can't read well find their way.
export interface NavItem { href: string; key: string; icon: string }
export const NAV: Record<Role, NavItem[]> = {
  SYSTEM_OWNER: [
    { href: "/app/owner", key: "nav.dashboard", icon: "📊" }, { href: "/app/owner/institutions", key: "nav.verification", icon: "✅" },
    { href: "/app/owner/payments", key: "nav.payments", icon: "💳" }, { href: "/app/owner/devices", key: "nav.devices", icon: "📱" },
    { href: "/app/owner/settlements", key: "nav.settlements", icon: "🏦" }, { href: "/app/owner/revenue", key: "nav.revenue", icon: "⚖️" },
    { href: "/app/owner/users", key: "nav.users", icon: "👥" }, { href: "/app/owner/audit", key: "nav.audit", icon: "📜" },
    { href: "/app/security", key: "nav.security", icon: "🔒" },
  ],
  INSTITUTION_ADMIN: [
    { href: "/app/institution", key: "nav.dashboard", icon: "📊" }, { href: "/app/institution/applications", key: "nav.applications", icon: "📥" },
    { href: "/app/institution/programs", key: "nav.programs", icon: "🎓" }, { href: "/app/institution/media", key: "nav.gallery", icon: "🖼️" },
    { href: "/app/institution/letters", key: "nav.letters", icon: "✉️" }, { href: "/app/institution/grades", key: "nav.grades", icon: "📝" },
    { href: "/app/institution/whatsapp", key: "nav.whatsapp", icon: "💬" }, { href: "/app/institution/earnings", key: "nav.earnings", icon: "💰" },
    { href: "/app/institution/documents", key: "nav.documents", icon: "📁" }, { href: "/app/security", key: "nav.security", icon: "🔒" },
  ],
  PARENT: [
    { href: "/app/family", key: "nav.children", icon: "👨‍👩‍👧" }, { href: "/app/browse", key: "nav.browse", icon: "🔎" },
    { href: "/app/family/applications", key: "nav.myApps", icon: "📥" }, { href: "/app/family/documents", key: "nav.myDocs", icon: "📁" },
  ],
  STUDENT: [
    { href: "/app/browse", key: "nav.browse", icon: "🔎" }, { href: "/app/family/applications", key: "nav.myApps", icon: "📥" },
    { href: "/app/family/documents", key: "nav.myDocs", icon: "📁" },
  ],
};
