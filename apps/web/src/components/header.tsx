"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import UserMenu from "./user-menu";

export default function Header() {
  const pathname = usePathname();

  const links = [
    { to: "/dashboard", label: "Dashboard" },
    { to: "/boxes", label: "Boxes" },
  ] as const;

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

          {/* Nav + User */}
          <div className="flex items-center gap-8">
            <nav className="hidden sm:flex items-center gap-6">
              {links.map(({ to, label }) => {
                const isActive =
                  pathname === to || pathname.startsWith(`${to}/`);
                return (
                  <Link
                    key={to}
                    href={to}
                    className={`text-sm font-medium transition-colors hover:text-primary ${
                      isActive ? "text-primary" : "text-muted-foreground"
                    }`}
                  >
                    {label}
                  </Link>
                );
              })}
            </nav>
            <UserMenu />
          </div>
        </div>
      </div>
    </header>
  );
}
