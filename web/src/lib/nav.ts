import type { Role } from "./api";

// "Architect it like Gmail": one shell, one URL, different mailbox per role. The backend enforces the
// same boundaries — this map only decides what to *show*.
export const NAV: Record<Role, { href: string; label: string }[]> = {
  SYSTEM_OWNER: [
    { href: "/app/owner", label: "Dashboard" }, { href: "/app/owner/institutions", label: "Verification queue" },
    { href: "/app/owner/revenue", label: "Revenue sharing" }, { href: "/app/owner/settlements", label: "Month-end payouts" },
    { href: "/app/owner/payments", label: "Payments & SMS" }, { href: "/app/owner/users", label: "Users" }, { href: "/app/owner/audit", label: "Audit log" },
  ],
  INSTITUTION_ADMIN: [
    { href: "/app/institution", label: "Applications" }, { href: "/app/institution/programs", label: "Programs" },
    { href: "/app/institution/media", label: "Campus gallery" }, { href: "/app/institution/letters", label: "Letter templates" },
    { href: "/app/institution/grades", label: "Grade requests" }, { href: "/app/institution/verification", label: "Verification" },
  ],
  PARENT: [{ href: "/app/family", label: "My children" }, { href: "/app/family/applications", label: "Applications" }, { href: "/app/browse", label: "Browse schools" }],
  STUDENT: [{ href: "/app/family", label: "My profile" }, { href: "/app/family/applications", label: "Applications" }, { href: "/app/browse", label: "Browse schools" }],
};
