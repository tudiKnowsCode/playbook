// ESPN's fantasy API is undocumented and cookie-authenticated. Private leagues need
// the SWID and espn_s2 cookies from a logged-in browser session, which is why every
// call here has to run server-side — the browser can't reach these hosts directly.

import { cachedResilient, MINUTE } from "../cache";
import { fetchJson } from "../http";
import { ESPN_PRO_TEAMS } from "../nfl";
import type { InjuryStatus, Pos, SlotId } from "../types";

const HOST = "https://lm-api-reads.fantasy.espn.com";

export interface EspnCredentials {
  swid: string;
  espnS2: string;
}

/** ESPN's numeric lineup slots. Only the ones a football league can use are mapped. */
const LINEUP_SLOTS: Record<number, SlotId> = {
  0: "QB",
  2: "RB",
  3: "FLEX", // RB/WR
  4: "WR",
  5: "REC_FLEX", // WR/TE
  6: "TE",
  7: "SUPER_FLEX", // OP — any offensive player
  16: "DST",
  17: "K",
  20: "BN",
  21: "IR",
  23: "FLEX",
};

const POSITIONS: Record<number, Pos> = {
  1: "QB",
  2: "RB",
  3: "WR",
  4: "TE",
  5: "K",
  16: "DST",
};

/** ESPN injury strings differ from Sleeper's. */
const INJURY: Record<string, InjuryStatus> = {
  ACTIVE: "ACTIVE",
  NORMAL: "ACTIVE",
  QUESTIONABLE: "Q",
  DOUBTFUL: "D",
  OUT: "O",
  INJURY_RESERVE: "IR",
  SUSPENSION: "SUS",
  DAY_TO_DAY: "Q",
};

export function mapLineupSlot(id: number): SlotId | null {
  return LINEUP_SLOTS[id] ?? null;
}

export function mapPosition(id: number): Pos | null {
  return POSITIONS[id] ?? null;
}

export function mapInjury(raw: string | null | undefined): InjuryStatus {
  return INJURY[(raw ?? "").toUpperCase()] ?? "ACTIVE";
}

export function proTeam(id: number | null | undefined): string | null {
  if (id == null) return null;
  const abbr = ESPN_PRO_TEAMS[id];
  return abbr && abbr !== "FA" ? abbr : null;
}

export interface EspnStat {
  scoringPeriodId: number;
  seasonId: number;
  /** 0 = actual, 1 = projected. */
  statSourceId: number;
  /** 0 = season total, 1 = single week. */
  statSplitTypeId: number;
  appliedTotal?: number;
  appliedAverage?: number;
}

export interface EspnPlayer {
  id: number;
  fullName: string;
  defaultPositionId: number;
  proTeamId: number;
  injuryStatus?: string;
  eligibleSlots?: number[];
  ownership?: { percentOwned?: number; percentChange?: number };
  stats?: EspnStat[];
}

export interface EspnRosterEntry {
  playerId: number;
  lineupSlotId: number;
  playerPoolEntry?: { player: EspnPlayer };
}

export interface EspnTeam {
  id: number;
  name?: string;
  location?: string;
  nickname?: string;
  abbrev?: string;
  primaryOwner?: string;
  owners?: string[];
  record?: {
    overall?: {
      wins: number;
      losses: number;
      ties: number;
      pointsFor: number;
      pointsAgainst: number;
    };
  };
  roster?: { entries: EspnRosterEntry[] };
  transactionCounter?: { acquisitionBudgetSpent?: number };
}

export interface EspnMatchupSide {
  teamId: number;
  totalPoints?: number;
}

export interface EspnScheduleItem {
  matchupPeriodId: number;
  winner?: string;
  home?: EspnMatchupSide;
  away?: EspnMatchupSide;
}

export interface EspnMember {
  id: string;
  displayName?: string;
  firstName?: string;
  lastName?: string;
}

export interface EspnLeague {
  id: number;
  seasonId: number;
  scoringPeriodId: number;
  settings?: {
    name?: string;
    size?: number;
    rosterSettings?: { lineupSlotCounts?: Record<string, number> };
    scoringSettings?: {
      scoringItems?: Array<{ statId: number; points?: number; pointsOverrides?: Record<string, number> }>;
    };
    scheduleSettings?: { matchupPeriodCount?: number; playoffTeamCount?: number };
    acquisitionSettings?: { acquisitionBudget?: number; isUsingAcquisitionBudget?: boolean };
  };
  teams?: EspnTeam[];
  schedule?: EspnScheduleItem[];
  members?: EspnMember[];
}

function cookieHeader(creds: EspnCredentials): Record<string, string> {
  // ESPN is strict about the SWID braces; add them back if the user pasted it bare.
  const swid = creds.swid.startsWith("{") ? creds.swid : `{${creds.swid}}`;
  return { cookie: `SWID=${swid}; espn_s2=${creds.espnS2}` };
}

/** League core: teams, rosters, schedule and settings in one request. */
export async function getLeague(
  leagueId: string,
  season: number,
  week: number,
  creds: EspnCredentials | null
): Promise<EspnLeague> {
  const views = ["mTeam", "mRoster", "mMatchup", "mSettings", "mStandings"]
    .map((v) => `view=${v}`)
    .join("&");
  const url = `${HOST}/apis/v3/games/ffl/seasons/${season}/segments/0/leagues/${leagueId}?scoringPeriodId=${week}&${views}`;

  return cachedResilient(`espn:league:${leagueId}:${season}:${week}`, 3 * MINUTE, () =>
    fetchJson<EspnLeague>(url, { headers: creds ? cookieHeader(creds) : {}, timeoutMs: 30_000 })
  );
}

/**
 * The free-agent pool. ESPN drives this off an `x-fantasy-filter` header rather than
 * query parameters, and will happily return the entire player universe if the filter
 * is omitted — so the limit matters.
 */
export async function getFreeAgents(
  leagueId: string,
  season: number,
  week: number,
  creds: EspnCredentials | null,
  limit = 250
): Promise<EspnPlayer[]> {
  const filter = {
    players: {
      filterStatus: { value: ["FREEAGENT", "WAIVERS"] },
      filterSlotIds: { value: [0, 2, 3, 4, 5, 6, 16, 17, 23] },
      limit,
      offset: 0,
      sortPercOwned: { sortAsc: false, sortPriority: 1 },
      sortDraftRanks: { sortPriority: 100, sortAsc: true, value: "STANDARD" },
    },
  };

  const url = `${HOST}/apis/v3/games/ffl/seasons/${season}/segments/0/leagues/${leagueId}?scoringPeriodId=${week}&view=kona_player_info`;

  const data = await cachedResilient(
    `espn:fa:${leagueId}:${season}:${week}:${limit}`,
    5 * MINUTE,
    () =>
      fetchJson<{ players?: Array<{ player: EspnPlayer }> }>(url, {
        headers: {
          ...(creds ? cookieHeader(creds) : {}),
          "x-fantasy-filter": JSON.stringify(filter),
        },
        timeoutMs: 30_000,
      })
  );

  return (data.players ?? []).map((p) => p.player);
}

/** The projected total ESPN itself publishes for a player in a given week. */
export function weeklyProjection(player: EspnPlayer, season: number, week: number): number | null {
  const stat = player.stats?.find(
    (s) =>
      s.statSourceId === 1 &&
      s.statSplitTypeId === 1 &&
      s.scoringPeriodId === week &&
      s.seasonId === season
  );
  return stat?.appliedTotal ?? null;
}

/** Points actually scored in a week. */
export function weeklyActual(player: EspnPlayer, season: number, week: number): number | null {
  const stat = player.stats?.find(
    (s) =>
      s.statSourceId === 0 &&
      s.statSplitTypeId === 1 &&
      s.scoringPeriodId === week &&
      s.seasonId === season
  );
  return stat?.appliedTotal ?? null;
}

/** Season-to-date average, straight from ESPN's own season split. */
export function seasonAverage(player: EspnPlayer, season: number): number | null {
  const stat = player.stats?.find(
    (s) => s.statSourceId === 0 && s.statSplitTypeId === 0 && s.seasonId === season
  );
  return stat?.appliedAverage ?? null;
}

export function teamName(team: EspnTeam): string {
  if (team.name) return team.name;
  const parts = [team.location, team.nickname].filter(Boolean);
  return parts.length ? parts.join(" ") : `Team ${team.id}`;
}

/** Points per reception, read out of the league's own scoring items (stat 53). */
export function pointsPerReception(league: EspnLeague): number {
  const item = league.settings?.scoringSettings?.scoringItems?.find((s) => s.statId === 53);
  return item?.points ?? 0;
}

/** Reads the starting lineup shape out of ESPN's slot-count map. */
export function startingSlots(league: EspnLeague): { starters: SlotId[]; bench: number; ir: number } {
  const counts = league.settings?.rosterSettings?.lineupSlotCounts ?? {};
  const starters: SlotId[] = [];
  let bench = 0;
  let ir = 0;

  // Display order matches how fantasy sites lay out a lineup card.
  const order = [0, 2, 4, 6, 3, 23, 5, 7, 17, 16];
  for (const slotId of order) {
    const count = counts[String(slotId)] ?? 0;
    const slot = mapLineupSlot(slotId);
    if (!slot || slot === "BN" || slot === "IR") continue;
    for (let i = 0; i < count; i++) starters.push(slot);
  }
  bench = counts["20"] ?? 0;
  ir = counts["21"] ?? 0;

  return { starters, bench, ir };
}

export function isAuthError(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "status" in err &&
    ((err as { status: number }).status === 401 || (err as { status: number }).status === 403)
  );
}
