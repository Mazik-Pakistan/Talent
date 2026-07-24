import { Geist, Geist_Mono } from "next/font/google";

import AgentChatWidget from "@/components/ai/Agentchatwidget";
import SessionTimeout from "@/components/SessionTimeout";
import ToastProvider from "@/components/ToastProvider";
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
      <head>
        {/* Used by the employee dashboard (app/dashboard/employee) — Sora/Inter match the approved mockup. */}
        {/* eslint-disable-next-line @next/next/no-page-custom-font -- this rule targets pages/_document.js; app-router root layouts are the correct place for shared font links. */}
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Sora:wght@500;600;700;800&family=Inter:wght@400;500;600;700&display=swap"
        />
      </head>
      <body>
        <SessionTimeout />
        <ToastProvider />
        {children}
        <AgentChatWidget />
      </body>
    </html>
  );
}
