import type { ReactNode } from "react";
import Link from "next/link";
import { UserButton } from "@clerk/nextjs";

export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <div className="mx-auto max-w-3xl px-4">
      <header className="flex items-center justify-between py-4">
        <nav className="flex gap-4">
          <Link href="/" className="font-semibold">Library</Link>
          <Link href="/chat" className="text-neutral-600">Chat</Link>
        </nav>
        <UserButton />
      </header>
      <main className="py-4">{children}</main>
    </div>
  );
}
