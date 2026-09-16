import { Playbook } from "@/components/Playbook";
import { Setup } from "@/components/Setup";
import { getDashboard } from "@/lib/insights";

// Every render pulls live league state; caching happens inside the provider layer.
export const dynamic = "force-dynamic";

export default async function Page(props: PageProps<"/">) {
  const params = await props.searchParams;
  const leagueId = typeof params.league === "string" ? params.league : undefined;
  const week = typeof params.week === "string" ? Number(params.week) : undefined;

  const result = await getDashboard(
    leagueId,
    week && Number.isFinite(week) ? week : undefined
  );

  if ("error" in result) {
    return <Setup message={result.error} />;
  }

  return <Playbook data={result} />;
}
