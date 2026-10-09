import type { Metadata } from "next";

import { LocationProvider } from "@/components/location-provider";
import { RegionPrompt } from "@/components/region-prompt";
import { getSavedRegion, getSuggestedRegion } from "@/lib/location-server";
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
  description: "Official UK and US food recalls in one place, newest first, with a quick way to check a pack. A missing match does not tell you whether food is safe to eat.",
  applicationName: "Eat or Yeet",
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, statusBarStyle: "default", title: "Eat or Yeet" },
  formatDetection: { telephone: false },
};

export default async function RootLayout({ children }: LayoutProps<"/">) {
  const [savedRegion, suggestedRegion] = await Promise.all([getSavedRegion(), getSuggestedRegion()]);
  const region = savedRegion ?? "UK";
  return (
    <html lang="en" data-scroll-behavior="smooth" suppressHydrationWarning className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
      <body className="flex min-h-full flex-col">
        <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
          <a href="#main-content" className="sr-only z-50 rounded-full bg-background px-5 py-3 font-bold focus:not-sr-only focus:fixed focus:left-4 focus:top-4">Skip to main content</a>
          <LocationProvider initialRegion={region} hasSavedRegion={Boolean(savedRegion)} suggestedRegion={suggestedRegion}>
            <SiteHeader />
            <RegionPrompt />
            <main id="main-content" tabIndex={-1} className="flex flex-1 flex-col outline-none">{children}</main>
            <SiteFooter />
          </LocationProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
