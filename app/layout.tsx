import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
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
  metadataBase: new URL("https://crypto.gatchek.com"),
  title: "Gatchek Signals | Crypto Intelligence Desk",
  description:
    "A private evidence-weighted crypto intelligence dashboard for market, news, social, and whale signals.",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
  openGraph: {
    title: "Gatchek Signals",
    description:
      "Private crypto intelligence, distilled into explainable signals.",
    type: "website",
    url: "https://crypto.gatchek.com",
    images: [
      {
        url: "/og.png",
        width: 1731,
        height: 909,
        alt: "Gatchek Signals — Crypto intelligence, distilled.",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "Gatchek Signals",
    description:
      "Private crypto intelligence, distilled into explainable signals.",
    images: ["/og.png"],
  },
  robots: {
    index: false,
    follow: false,
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        {children}
      </body>
    </html>
  );
}
