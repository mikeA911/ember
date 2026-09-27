import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { getBrandingUrls } from "@/lib/branding";
import { createClient } from "@/lib/supabase/server";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

// Async so the favicon/apple-touch-icon reflect whatever an admin has
// configured (src/lib/branding.ts), not just the shipped default.
export async function generateMetadata(): Promise<Metadata> {
  const supabase = await createClient();
  const urls = await getBrandingUrls(supabase);
  return {
    title: "Ember",
    description: "Knowledge curation workbench",
    icons: { icon: urls.icon192, apple: urls.appleTouchIcon },
  };
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col bg-zinc-50 text-zinc-900">{children}</body>
    </html>
  );
}
