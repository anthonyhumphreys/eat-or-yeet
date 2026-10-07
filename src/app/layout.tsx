import type { Metadata } from "next";
import { Suspense } from "react";

import { LocationProvider } from "@/components/location-provider";
import { SiteNews } from "@/components/news/site-news";
import { getPreferredRegion } from "@/lib/location-server";
import { Geist, Geist_Mono } from "next/font/google";

import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { ThemeProvider } from "@/components/theme-provider";

import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000"),
  title: {
    default: "Eat or Yeet?",
    template: "%s | Eat or Yeet",
  },
  description: "Check packaged food against published official UK and US food-safety warnings. A missing match does not tell you whether food is safe to eat.",
  applicationName: "Eat or Yeet",
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, statusBarStyle: "default", title: "Eat or Yeet" },
  formatDetection: { telephone: false },
};

export default async function RootLayout({ children }: LayoutProps<"/">) {
  const region = await getPreferredRegion();
  return (
    <html lang="en" suppressHydrationWarning className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
      <body className="flex min-h-full flex-col">
        <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
          <a href="#main-content" className="sr-only z-50 rounded-full bg-background px-5 py-3 font-bold focus:not-sr-only focus:fixed focus:left-4 focus:top-4">Skip to main content</a>
          <LocationProvider initialRegion={region}>
            <SiteHeader />
            <Suspense fallback={<div className="min-h-12 border-b bg-muted" aria-label="Loading food safety news" />}><SiteNews /></Suspense>
            <main id="main-content" tabIndex={-1} className="flex flex-1 flex-col outline-none">{children}</main>
            <SiteFooter />
          </LocationProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
