import { NextResponse } from "next/server";
import { getDashboard } from "@/lib/insights";

export const dynamic = "force-dynamic";

/**
 * The dashboard payload as JSON. Handy for debugging the data layer without the UI:
 *   curl "http://localhost:3000/api/dashboard?league=sleeper:123"
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const league = url.searchParams.get("league") ?? undefined;
  const weekParam = url.searchParams.get("week");
  const week = weekParam ? Number(weekParam) : undefined;

  try {
    const data = await getDashboard(league, Number.isFinite(week) ? week : undefined);
    return NextResponse.json(data);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}
