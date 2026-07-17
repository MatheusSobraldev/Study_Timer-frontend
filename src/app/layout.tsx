import type { Metadata } from "next";

import "./globals.css";

export const metadata: Metadata = {
  title: "Timer Estudo",
  description: "Timer e registros para ajudar estudantes a manter o foco."
};

export default function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="pt-BR">
      <body>{children}</body>
    </html>
  );
}
