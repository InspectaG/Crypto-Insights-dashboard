import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: "Coinbase Settings | Gatchek Signals",
  description: "Private Coinbase connection settings for Gatchek Signals.",
  robots: { index: false, follow: false },
};

export default function SettingsLayout({ children }: { children: ReactNode }) {
  return children;
}
