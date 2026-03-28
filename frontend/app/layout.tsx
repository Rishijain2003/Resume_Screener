import type { Metadata } from "next";
import { ToasterHost } from "@/components/ToasterHost";
import "./globals.css";

export const metadata: Metadata = {
  title: "Resume Screener",
  description: "AI-powered candidate ranking",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="font-sans text-[15px] leading-relaxed tracking-tight antialiased">
        {children}
        <ToasterHost />
      </body>
    </html>
  );
}
