import type { Metadata } from "next";
import "./globals.css";
import { AppLayout } from "@/components/layout";
import { AuthProvider } from "@/components/providers/auth-provider";

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
    <html lang="en">
      <body className="font-sans antialiased">
        <AuthProvider>
          <AppLayout>{children}</AppLayout>
        </AuthProvider>
      </body>
    </html>
  );
}
