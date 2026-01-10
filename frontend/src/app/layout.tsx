import type { Metadata } from "next";
import "./globals.css";
import { AppLayout } from "@/components/layout";

export const metadata: Metadata = {
  title: "Claude Hub - AI-Powered Development",
  description: "Intelligent task execution, context management, and documentation hub",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="dark">
      <body className="font-sans antialiased">
        <AppLayout>{children}</AppLayout>
      </body>
    </html>
  );
}
