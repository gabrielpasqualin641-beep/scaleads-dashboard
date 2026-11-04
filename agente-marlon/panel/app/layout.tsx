import "./globals.css";
import type { ReactNode } from "react";
import { Nav } from "./nav";

export const metadata = { title: "Painel do agente · Equipe Marlon Mattedi" };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="pt-BR">
      <body>
        <Nav />
        {children}
      </body>
    </html>
  );
}
