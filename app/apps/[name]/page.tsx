import { redirect } from "next/navigation";

export default async function AppIndex({ params }: { params: Promise<{ name: string }> }) {
  redirect(`/apps/${(await params).name}/overview`);
}
