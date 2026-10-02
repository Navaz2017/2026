// Line icons (24x24, 1.6 stroke) — one consistent set instead of emoji, which look informal and render differently per device.
const P: Record<string, string> = {
  dashboard: "M3 3h7v7H3z M14 3h7v7h-7z M14 14h7v7h-7z M3 14h7v7H3z",
  verified: "M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6l8-3z M9 12l2 2 4-4",
  payments: "M2 6h20v12H2z M2 10h20 M6 15h4",
  phone: "M7 2h10v20H7z M11 18h2",
  bank: "M3 10l9-6 9 6 M5 10v8 M9 10v8 M15 10v8 M19 10v8 M3 21h18",
  scale: "M12 3v18 M5 7h14 M5 7l-3 7a3 3 0 006 0L5 7z M19 7l-3 7a3 3 0 006 0l-3-7z",
  users: "M16 20v-1a4 4 0 00-4-4H7a4 4 0 00-4 4v1 M9.5 11a3.5 3.5 0 100-7 3.5 3.5 0 000 7z M21 20v-1a4 4 0 00-3-3.9 M16 4.1a3.5 3.5 0 010 6.8",
  log: "M6 3h9l4 4v14H6z M15 3v4h4 M9 12h6 M9 16h6",
  lock: "M5 11h14v10H5z M8 11V7a4 4 0 018 0v4",
  inbox: "M3 13l3-8h12l3 8v6H3z M3 13h5l1 3h6l1-3h5",
  cap: "M2 9l10-5 10 5-10 5-10-5z M6 11.5V16c0 1.5 3 3 6 3s6-1.5 6-3v-4.5 M22 9v6",
  image: "M3 4h18v16H3z M8.5 10a1.5 1.5 0 100-3 1.5 1.5 0 000 3z M21 16l-5-5L5 20",
  mail: "M3 5h18v14H3z M3 7l9 6 9-6",
  note: "M6 3h12v18H6z M9 8h6 M9 12h6 M9 16h3",
  chat: "M21 12a8 8 0 01-11.6 7.1L4 20l1-4.6A8 8 0 1121 12z",
  wallet: "M3 7h16a2 2 0 012 2v10H3z M3 7l12-3v3 M16 14h2",
  folder: "M3 6h6l2 2h10v12H3z",
  search: "M11 18a7 7 0 100-14 7 7 0 000 14z M21 21l-5-5",
  bell: "M6 16v-5a6 6 0 1112 0v5l2 2H4z M10 21h4",
  doc: "M6 3h9l4 4v14H6z M15 3v4h4",
  family: "M9 8a3 3 0 100-6 3 3 0 000 6z M3 21v-2a5 5 0 015-5h2a5 5 0 015 5v2 M17 9a2.5 2.5 0 100-5 2.5 2.5 0 000 5z M17 14a4 4 0 014 4v3",
  check: "M5 12l4 4 10-10",
  x: "M6 6l12 12 M18 6L6 18",
  clock: "M12 21a9 9 0 100-18 9 9 0 000 18z M12 7v5l3 2",
  alert: "M12 3l10 18H2z M12 10v5 M12 18h.01",
  info: "M12 21a9 9 0 100-18 9 9 0 000 18z M12 11v6 M12 7.5h.01",
  arrow: "M5 12h14 M13 6l6 6-6 6",
  globe: "M12 21a9 9 0 100-18 9 9 0 000 18z M3 12h18 M12 3a14 14 0 010 18 M12 3a14 14 0 000 18",
  dot: "M12 12h.01",
};

export function Icon({ name, size = 20, className }: { name: keyof typeof P | string; size?: number; className?: string }) {
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      <path d={P[name] ?? P.dot} />
    </svg>
  );
}

// Brand mark: an open book under an arch (learning + institution).
export function Logo({ size = 34 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 40 40" aria-hidden="true" focusable="false">
      <rect width="40" height="40" rx="6" fill="#C9A227" />
      <path d="M8 31V17L20 8l12 9v14" fill="none" stroke="#0B2545" strokeWidth="2.4" strokeLinejoin="round" />
      <path d="M20 15v16M12 21c3-1.6 5-1.6 8 0 3-1.6 5-1.6 8 0v8c-3-1.6-5-1.6-8 0-3-1.6-5-1.6-8 0z" fill="none" stroke="#0B2545" strokeWidth="2" strokeLinejoin="round" />
    </svg>
  );
}
