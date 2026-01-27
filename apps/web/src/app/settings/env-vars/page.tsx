import { redirect } from "next/navigation";

import { getSession } from "@/lib/auth-client.server";

import EnvVarsList from "./env-vars-list";

export default async function EnvVarsPage() {
  const session = await getSession();

  if (!session?.user) {
    redirect("/login");
  }

  return (
    <div className="mx-auto max-w-4xl px-6 lg:px-8 py-12">
      <EnvVarsList />
    </div>
  );
}
