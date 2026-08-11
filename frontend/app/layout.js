const Geist = () => ({ variable: "" });
const Geist_Mono = () => ({ variable: "" });

import AgentChatWidget from "@/components/ai/Agentchatwidget";
import SessionTimeout from "@/components/SessionTimeout";
import ToastProvider from "@/components/ToastProvider";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata = {
  title: "TalentAI | AI-Powered Employee Journey",
  description:
    "TalentAI streamlines recruitment, onboarding, learning, performance, and employee development in one intelligent platform.",
  icons: {
    icon: "/favicon.ico",
  },
};

export default function RootLayout({ children }) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable}`}
    >
      <head>
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