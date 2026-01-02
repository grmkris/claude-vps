import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { authClient } from "@/lib/auth-client";

import EnvironmentsList from "./environments-list";

export default async function EnvironmentsPage() {
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
    <div className="container mx-auto py-8">
      <EnvironmentsList />
    </div>
  );
}
