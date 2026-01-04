import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { authClient } from "@/lib/auth-client";

import CreateBoxForm from "./create-box-form";

export default async function NewBoxPage() {
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
    <div className="flex-1 flex items-start justify-center px-6 py-12">
      <CreateBoxForm />
    </div>
  );
}
