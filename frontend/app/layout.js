import { Geist, Geist_Mono } from "next/font/google";

import SessionTimeout from "@/components/SessionTimeout";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata = {
  title: "Talent | Recruiter Access",
  description: "Recruiter access for the Talent platform.",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable}`}>
      <body>
        <SessionTimeout />
        {children}
      </body>
    </html>
  );
}
