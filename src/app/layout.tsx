import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { DashboardProviders } from "@/components/hermes-dashboard";
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
  title: "Hermes Dashboard",
  description: "Hermes Agent GUI dashboard for sessions, skills, and memory management.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
      <body className="min-h-full bg-background font-sans text-foreground"><DashboardProviders>{children}</DashboardProviders></body>
    </html>
  );
}
