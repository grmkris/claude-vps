import Link from "next/link";

import UserMenu from "./user-menu";

export default function Header() {
  return (
    <header className="border-b border-border/50">
      <div className="mx-auto max-w-6xl px-6 lg:px-8">
        <div className="flex h-16 items-center justify-between">
          {/* Logo */}
          <Link href="/" className="flex items-center gap-2">
            <div className="h-8 w-8 rounded-lg bg-primary flex items-center justify-center">
              <span className="text-primary-foreground font-bold text-sm">
                VC
              </span>
            </div>
            <span className="font-semibold text-lg tracking-tight">
              vps-claude
            </span>
          </Link>

          <UserMenu />
        </div>
      </div>
    </header>
  );
}
