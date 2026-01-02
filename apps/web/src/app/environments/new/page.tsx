import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { authClient } from "@/lib/auth-client";

import CreateEnvironmentForm from "./create-environment-form";

export default async function NewEnvironmentPage() {
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
    <div className="container mx-auto py-8 max-w-md">
      <CreateEnvironmentForm />
    </div>
  );
}
