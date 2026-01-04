import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { authClient } from "@/lib/auth-client";

import BoxesList from "./boxes-list";

export default async function BoxesPage() {
  const session = await authClient.getSession({
    fetchOptions: {
      headers: await headers(),
      throw: true,
    },
  });

  if (!session?.user) {
    redirect("/login");
  }

  return (
    <div className="mx-auto max-w-6xl px-6 lg:px-8 py-12">
      <BoxesList />
    </div>
  );
}
