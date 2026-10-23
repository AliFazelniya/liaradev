import type { Metadata } from "next";
import localFont from "next/font/local";
import "./globals.css";
import Header from "@/components/Header";
import ChatDock from "@/components/ChatDock";

// Liara's own typeface (Yekan Bakh), self-hosted
const yekan = localFont({
  src: [
    { path: "../public/fonts/YekanBakh-Light.woff2", weight: "300" },
    { path: "../public/fonts/YekanBakh-Regular.woff2", weight: "400" },
    { path: "../public/fonts/YekanBakh-SemiBold.woff2", weight: "600" },
    { path: "../public/fonts/YekanBakh-Bold.woff2", weight: "700" },
    { path: "../public/fonts/YekanBakh-ExtraBold.woff2", weight: "800" },
  ],
  variable: "--font-yekan",
  display: "swap",
});

export const metadata: Metadata = {
  title: "لیارا‌پایلوت | دستیار هوشمند DevOps",
  description: "دستیار هوشمند برای راه‌اندازی، دیپلوی و پایش پروژه‌ها روی لیارا",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fa" dir="rtl" className={yekan.variable}>
      <body className="min-h-screen antialiased">
        <Header />
        <main className="mx-auto w-full max-w-[1180px] px-5 py-8 lg:px-8 lg:py-10">{children}</main>
        <ChatDock />
      </body>
    </html>
  );
}
