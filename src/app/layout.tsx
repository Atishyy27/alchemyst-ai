import type { Metadata } from "next";
import localFont from "next/font/local";
import "./globals.css";

const geistSans = localFont({
  src: "./fonts/GeistVF.woff",
  variable: "--font-geist-sans",
  weight: "100 900",
});
const geistMono = localFont({
  src: "./fonts/GeistMonoVF.woff",
  variable: "--font-geist-mono",
  weight: "100 900",
});

export const metadata: Metadata = {
  title: "Agent Console",
  description: "Alchemyst AI Systems Engineering Console",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="h-full w-full overflow-hidden">
      <body 
        className={`${geistSans.variable} ${geistMono.variable} antialiased h-full w-full min-h-full min-w-full m-0 p-0 overflow-hidden bg-slate-50 text-slate-900`}
      >
        {children}
      </body>
    </html>
  );
}