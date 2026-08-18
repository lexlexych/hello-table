import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
  title: "Basilik — Ristorante in Berlin",
  description: "Zeitgenössische italienische Küche, ehrliche Zutaten und entspannte Abende in Berlin.",
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="de">
      <body>{children}</body>
    </html>
  );
}
