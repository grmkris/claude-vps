import { redirect } from "next/navigation";

import { getSession } from "@/lib/auth-client.server";

import CreateBoxForm from "./create-box-form";

export default async function NewBoxPage() {
  const session = await getSession();

  if (!session?.user) {
    redirect("/login");
  }

  return (
    <div className="flex-1 flex items-start justify-center px-6 py-12">
      <CreateBoxForm />
    </div>
  );
}
