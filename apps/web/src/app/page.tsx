import Link from "next/link";

import { Button } from "@/components/ui/button";
import { getSession } from "@/lib/auth-client.server";

import BoxesList from "./boxes/boxes-list";

export default async function Home() {
  const session = await getSession();

  if (session?.user) {
    return (
      <div className="mx-auto max-w-6xl px-6 lg:px-8 py-12">
        <BoxesList />
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] gap-8">
      <div className="flex items-center gap-3">
        <div className="h-12 w-12 rounded-xl bg-primary flex items-center justify-center">
          <span className="text-primary-foreground font-bold text-xl">VC</span>
        </div>
        <span className="font-semibold text-3xl tracking-tight">
          vps-claude
        </span>
      </div>
      <Link href="/login">
        <Button size="lg">Sign in</Button>
      </Link>
    </div>
  );
}
