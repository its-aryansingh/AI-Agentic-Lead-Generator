import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import { CallsDashboardClient } from "@/app/app/leads/calls/calls-dashboard-client";

export default async function CallsPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  return <CallsDashboardClient />;
}
