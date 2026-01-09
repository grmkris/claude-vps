import { redirect } from "next/navigation";

import { getSession } from "@/lib/auth-client.server";

import BoxesList from "./boxes-list";

export default async function BoxesPage() {
  const session = await getSession();

  if (!session?.user) {
    redirect("/login");
  }

  return (
    <div className="mx-auto max-w-6xl px-6 lg:px-8 py-12">
      <BoxesList />
    </div>
  );
}
