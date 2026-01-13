"use client";

import { Suspense } from "react";
import { ChatLayout } from "@/components/chat";

interface AppLayoutProps {
  children: React.ReactNode;
}

function LayoutFallback() {
  return (
    <div className="flex h-screen bg-background items-center justify-center">
      <div className="animate-pulse text-muted-foreground">Loading...</div>
    </div>
  );
}

export function AppLayout({ children }: AppLayoutProps) {
  return (
    <Suspense fallback={<LayoutFallback />}>
      <ChatLayout>{children}</ChatLayout>
    </Suspense>
  );
}

export { Header, NewTaskButton } from "./header";
