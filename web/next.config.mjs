const api = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";
const csp = [
  "default-src 'self'", "img-src 'self' data: https:", "media-src 'self' https:",
  "style-src 'self' 'unsafe-inline'", "script-src 'self'" + (process.env.NODE_ENV === "production" ? "" : " 'unsafe-eval' 'unsafe-inline'"),
  `connect-src 'self' ${api}`, "frame-ancestors 'none'", "base-uri 'self'", "form-action 'self'",
].join("; ");

export default {
  poweredByHeader: false,
  async headers() {
    return [{ source: "/:path*", headers: [
      { key: "Content-Security-Policy", value: csp },
      { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
      { key: "X-Content-Type-Options", value: "nosniff" },
      { key: "Referrer-Policy", value: "no-referrer" },
      { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
    ] }];
  },
};
