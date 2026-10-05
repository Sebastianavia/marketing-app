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
  title: "Lulo Studio Desktop",
  description: "Suite Autónoma de Creación Audiovisual para Video Marketing",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html
      lang="es"
      className={`${geistSans.variable} ${geistMono.variable} h-screen w-screen overflow-hidden bg-black antialiased`}
    >
      <body className="h-screen w-screen overflow-hidden bg-black text-zinc-100 flex flex-col font-sans select-none">
        {children}
      </body>
    </html>
  );
}
