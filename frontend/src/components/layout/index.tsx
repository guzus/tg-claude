"use client";

import { ChatLayout } from "@/components/chat";

interface AppLayoutProps {
  children: React.ReactNode;
}

export function AppLayout({ children }: AppLayoutProps) {
  return <ChatLayout>{children}</ChatLayout>;
}

export { Header, NewTaskButton } from "./header";
