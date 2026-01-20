import { redirect } from "next/navigation";

import { getSession } from "@/lib/auth-client.server";

import ApiKeysList from "./api-keys-list";

export default async function ApiKeysPage() {
  const session = await getSession();

  if (!session?.user) {
    redirect("/login");
  }

  return (
    <div className="mx-auto max-w-4xl px-6 lg:px-8 py-12">
      <ApiKeysList />
    </div>
  );
}
