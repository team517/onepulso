import "./globals.css";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "onepulso platform",
  description: "Plataforma de generación de campañas con memoria",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es">
      <body>{children}</body>
    </html>
  );
}
