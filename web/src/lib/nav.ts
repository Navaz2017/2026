import type { Role } from "./api";

// One shell for everyone (like a mailbox app): the role decides which entries exist. The API enforces the
// same boundaries — hiding a link is only convenience. Icons let people who can't read well find their way.
export interface NavItem { href: string; key: string; icon: string }
export const NAV: Record<Role, NavItem[]> = {
  SYSTEM_OWNER: [
    { href: "/app/owner", key: "nav.dashboard", icon: "dashboard" }, { href: "/app/owner/institutions", key: "nav.verification", icon: "verified" },
    { href: "/app/owner/payments", key: "nav.payments", icon: "payments" }, { href: "/app/owner/devices", key: "nav.devices", icon: "phone" },
    { href: "/app/owner/settlements", key: "nav.settlements", icon: "bank" }, { href: "/app/owner/revenue", key: "nav.revenue", icon: "scale" },
    { href: "/app/owner/users", key: "nav.users", icon: "users" }, { href: "/app/owner/audit", key: "nav.audit", icon: "log" },
    { href: "/app/security", key: "nav.security", icon: "lock" },
  ],
  INSTITUTION_ADMIN: [
    { href: "/app/institution", key: "nav.dashboard", icon: "dashboard" }, { href: "/app/institution/applications", key: "nav.applications", icon: "inbox" },
    { href: "/app/institution/programs", key: "nav.programs", icon: "cap" }, { href: "/app/institution/media", key: "nav.gallery", icon: "image" },
    { href: "/app/institution/letters", key: "nav.letters", icon: "mail" }, { href: "/app/institution/grades", key: "nav.grades", icon: "note" },
    { href: "/app/institution/whatsapp", key: "nav.whatsapp", icon: "chat" }, { href: "/app/institution/earnings", key: "nav.earnings", icon: "wallet" },
    { href: "/app/institution/documents", key: "nav.documents", icon: "folder" }, { href: "/app/security", key: "nav.security", icon: "lock" },
  ],
  PARENT: [
    { href: "/app/family", key: "nav.children", icon: "family" }, { href: "/app/browse", key: "nav.browse", icon: "search" },
    { href: "/app/family/applications", key: "nav.myApps", icon: "inbox" }, { href: "/app/family/documents", key: "nav.myDocs", icon: "folder" },
  ],
  STUDENT: [
    { href: "/app/browse", key: "nav.browse", icon: "search" }, { href: "/app/family/applications", key: "nav.myApps", icon: "inbox" },
    { href: "/app/family/documents", key: "nav.myDocs", icon: "folder" },
  ],
};
