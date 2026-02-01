import { redirect } from "next/navigation";

export default async function BoxPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  redirect(`/boxes/${id}/inbox`);
}
