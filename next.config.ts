import type { NextConfig } from "next";

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
    // Wildcard subdomain so this doesn't need updating if the project ref
    // ever changes.
    remotePatterns: [
      {
        protocol: "https",
        hostname: "**.supabase.co",
        pathname: "/storage/v1/object/public/**",
      },
    ],
  },
};

export default nextConfig;
