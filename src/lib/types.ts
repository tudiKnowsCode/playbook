// Normalized domain model. Both ESPN and Sleeper are mapped into these shapes so
// every downstream analysis module is provider-agnostic.

export type Pos = "QB" | "RB" | "WR" | "TE" | "K" | "DST";

/** Lineup slots, using Sleeper's vocabulary as the canonical set. */
export type SlotId =
  | "QB"
  | "RB"
  | "WR"
  | "TE"
  | "FLEX"
  | "REC_FLEX"
  | "SUPER_FLEX"
  | "K"
  | "DST"
  | "BN"
  | "IR";

export type InjuryStatus = "ACTIVE" | "Q" | "D" | "O" | "IR" | "SUS" | "NA";

export type Source = "espn" | "sleeper";

export interface Player {
  /** `${source}:${providerId}` — unique across the whole app. */
  id: string;
  source: Source;
  providerId: string;
  /** Sleeper's player id when we could resolve one; the cross-provider join key. */
  sleeperId: string | null;
  name: string;
  pos: Pos;
  nflTeam: string | null;
  status: InjuryStatus;
  byeWeek: number | null;
  /** Percent of leagues rostering this player, 0-100. */
  rosteredPct: number | null;
  /** This week's opponent, pre-formatted e.g. "vs NYG" / "@ NO". */
  opponent: string | null;
  /** Kickoff, formatted for display e.g. "1:00". */
  kickoff: string | null;
  kickoffMs: number | null;
  /** Projected points this week under the league's scoring settings. */
  proj: number;
  floor: number;
  ceil: number;
  /** Points already scored this week. */
  actual: number | null;
  /** Per-game average so far this season. */
  seasonAvg: number;
  /** Projected points per game for the rest of the season. */
  rosProj: number;
  /** Net adds across Sleeper in the last 24h — the "trending" signal. */
  trendingAdds: number | null;
}

export interface RosterEntry {
  player: Player;
  slot: SlotId;
}

export interface TeamRecord {
  wins: number;
  losses: number;
  ties: number;
}

export interface Team {
  id: string;
  name: string;
  owner: string | null;
  record: TeamRecord;
  /** Points for / against on the season. */
  pf: number;
  pa: number;
  roster: RosterEntry[];
  isMine: boolean;
  /** Remaining FAAB budget, when the league uses FAAB. */
  faabLeft: number | null;
}

export interface Matchup {
  week: number;
  homeTeamId: string;
  awayTeamId: string;
  homeScore: number;
  awayScore: number;
  complete: boolean;
}

export interface ScoringSettings {
  /** Points per reception — the single setting that most changes rankings. */
  ppr: number;
  /** True when TEs get a different PPR than other positions. */
  tePremium: number;
  passTd: number;
}

export interface League {
  id: string;
  source: Source;
  /** The id the provider itself uses, without the source prefix. */
  providerId: string;
  name: string;
  season: number;
  currentWeek: number;
  /** Starting slots in display order, bench and IR excluded. */
  startingSlots: SlotId[];
  benchSlots: number;
  irSlots: number;
  teamCount: number;
  scoring: ScoringSettings;
  faabBudget: number | null;
  playoffTeams: number;
  regularSeasonWeeks: number;
  myTeamId: string | null;
  teams: Team[];
  matchups: Matchup[];
  /** Every scheduled matchup for the regular season, used for playoff simulation. */
  allMatchups: Matchup[];
  /** Rostered player ids across every team — the complement is the free-agent pool. */
  freeAgents: Player[];
  /** Populated when a provider call partially failed; surfaced in the UI. */
  warnings: string[];
}

/** Which positions may fill each slot. */
export const SLOT_ELIGIBILITY: Record<SlotId, Pos[]> = {
  QB: ["QB"],
  RB: ["RB"],
  WR: ["WR"],
  TE: ["TE"],
  FLEX: ["RB", "WR", "TE"],
  REC_FLEX: ["WR", "TE"],
  SUPER_FLEX: ["QB", "RB", "WR", "TE"],
  K: ["K"],
  DST: ["DST"],
  BN: ["QB", "RB", "WR", "TE", "K", "DST"],
  IR: ["QB", "RB", "WR", "TE", "K", "DST"],
};

export const STARTING_SLOTS: SlotId[] = [
  "QB",
  "RB",
  "WR",
  "TE",
  "FLEX",
  "REC_FLEX",
  "SUPER_FLEX",
  "K",
  "DST",
];

/**
 * The positions a league can actually start. Leagues that drop kickers or team
 * defenses are common, and a position with no slot is not merely low-value — it is
 * unrosterable, so it must be excluded from the free-agent pool entirely. Left in, it
 * poisons replacement level (nobody rosters kickers in a no-kicker league, so the
 * replacement kicker looks like a superstar).
 */
export function startablePositions(startingSlots: SlotId[]): Set<Pos> {
  const positions = new Set<Pos>();
  for (const slot of startingSlots) {
    for (const pos of SLOT_ELIGIBILITY[slot]) positions.add(pos);
  }
  return positions;
}

export function isStartingSlot(slot: SlotId): boolean {
  return slot !== "BN" && slot !== "IR";
}

/** Short label used in the compact slot columns of the UI. */
export function slotLabel(slot: SlotId): string {
  if (slot === "SUPER_FLEX") return "SFLX";
  if (slot === "REC_FLEX") return "WR/TE";
  if (slot === "DST") return "DST";
  return slot;
}
