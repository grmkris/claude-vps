import { redirect } from "next/navigation";

import { getSession } from "@/lib/auth-client.server";

import CredentialsList from "./credentials-list";

export default async function CredentialsPage() {
  const session = await getSession();

  if (!session?.user) {
    redirect("/login");
  }

  return (
    <div className="mx-auto max-w-4xl px-6 lg:px-8 py-12">
      <CredentialsList />
    </div>
  );
}
