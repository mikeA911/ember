import type { NextConfig } from "next";

// Supabase Storage's public-object path on whichever Supabase this build
// points at -- Supabase cloud (<ref>.supabase.co) or a self-hosted stack on
// its own API domain (docs/guides/ember-on-self-hosted-supabase.md).
// NEXT_PUBLIC_SUPABASE_URL is required at runtime anyway; when it's absent
// (e.g. a bare `next build` in CI) only the cloud pattern is registered.
type RemotePattern = NonNullable<NonNullable<NextConfig["images"]>["remotePatterns"]>[number];

function supabaseStoragePatterns(): RemotePattern[] {
  const patterns: RemotePattern[] = [
    { protocol: "https", hostname: "**.supabase.co", pathname: "/storage/v1/object/public/**" },
  ];
  const raw = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!raw) return patterns;
  const url = new URL(raw);
  if (url.hostname.endsWith(".supabase.co")) return patterns;
  patterns.push({
    protocol: url.protocol === "http:" ? "http" : "https",
    hostname: url.hostname,
    port: url.port,
    pathname: "/storage/v1/object/public/**",
  });
  return patterns;
}

const nextConfig: NextConfig = {
  // The in-app browser reaches this development server through the machine's
  // LAN address rather than localhost. Keep the exception narrow: this only
  // affects Next's development-only asset and endpoint origin checks.
  allowedDevOrigins: ["192.168.8.102"],
  experimental: {
    // Default 1MB is well under the 5MB icon cap validateIconFile enforces
    // (src/lib/branding.ts) -- without raising this, a valid upload under
    // that cap can still get rejected by Next itself before the action body
    // is even parsed.
    serverActions: {
      bodySizeLimit: "6mb",
    },
  },
  async headers() {
    return [
      {
        // The OAuth consent page for AI apps (src/app/(auth)/oauth/consent)
        // must never render inside another site's frame -- a framed "Allow"
        // button is a clickjacking target.
        source: "/oauth/consent",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
        ],
      },
    ];
  },
  images: {
    // Admin-uploaded branding icons live in Supabase Storage (a public
    // bucket) rather than public/ once configured -- see src/lib/branding.ts.
    remotePatterns: supabaseStoragePatterns(),
  },
};

export default nextConfig;
