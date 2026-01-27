import type { Metadata } from "next";

import { Outfit, JetBrains_Mono } from "next/font/google";

import "../index.css";
import Script from "next/script";

import Header from "@/components/header";
import Providers from "@/components/providers";

const outfit = Outfit({
  variable: "--font-outfit",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

const jetbrainsMono = JetBrains_Mono({
  variable: "--font-jetbrains",
  subsets: ["latin"],
  weight: ["400", "500"],
});

export const metadata: Metadata = {
  title: "vps-claude",
  description: "Deploy Claude Code environments in the cloud",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark" suppressHydrationWarning>
      <head>
        {process.env.NODE_ENV === "development" && (
          <Script
            crossOrigin="anonymous"
            src="//unpkg.com/react-grab/dist/index.global.js"
            strategy="beforeInteractive"
          />
        )}
      </head>
      <body className={`${outfit.variable} ${jetbrainsMono.variable}`}>
        <Providers>
          <div className="min-h-svh flex flex-col">
            <Header />
            <main className="flex-1">{children}</main>
          </div>
        </Providers>
      </body>
    </html>
  );
}
