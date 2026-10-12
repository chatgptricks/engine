import type { Metadata, Viewport } from "next";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import localFont from "next/font/local";
import { ThemeProvider } from "./providers";
import "./globals.css";

// Self-hosted (app/fonts) so builds never depend on Google's CDN.
const libreBaskerville = localFont({
  src: [
    { path: "./fonts/libre-baskerville-latin-regular.woff2", weight: "400", style: "normal" },
    { path: "./fonts/libre-baskerville-latin-italic.woff2", weight: "400", style: "italic" },
    { path: "./fonts/libre-baskerville-latin-700.woff2", weight: "700", style: "normal" },
    { path: "./fonts/libre-baskerville-latin-700italic.woff2", weight: "700", style: "italic" },
  ],
  variable: "--font-libre-baskerville",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Engine · Template Studio",
  applicationName: "Engine",
  description:
    "Create posts and carousels with reusable templates.",
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  interactiveWidget: "resizes-content",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${GeistSans.variable} ${GeistMono.variable} ${libreBaskerville.variable} antialiased`}
    >
      <body className="min-h-svh bg-bg text-fg">
        <ThemeProvider>{children}</ThemeProvider>
      </body>
    </html>
  );
}
