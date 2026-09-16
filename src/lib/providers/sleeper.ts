// Sleeper's API is entirely public — no auth needed. Two hosts are in play:
// api.sleeper.app for league data, and api.sleeper.com for the (undocumented but
// stable) projections and stats feeds.

import { cachedResilient, HOUR, MINUTE } from "../cache";
import { fetchJson } from "../http";
import { normalizeTeam } from "../nfl";
import type { InjuryStatus, Pos, SlotId } from "../types";

const APP = "https://api.sleeper.app/v1";
const API = "https://api.sleeper.com";

export interface SleeperUser {
  user_id: string;
  username: string;
  display_name: string;
}

export interface SleeperLeague {
  league_id: string;
  name: string;
  season: string;
  total_rosters: number;
  roster_positions: string[];
  scoring_settings: Record<string, number>;
  settings: Record<string, number>;
  status: string;
}

export interface SleeperRoster {
  roster_id: number;
  owner_id: string | null;
  players: string[] | null;
  starters: string[] | null;
  reserve: string[] | null;
  settings: {
    wins: number;
    losses: number;
    ties: number;
    fpts: number;
    fpts_decimal?: number;
    fpts_against?: number;
    fpts_against_decimal?: number;
    waiver_budget_used?: number;
  };
}

export interface SleeperLeagueUser {
  user_id: string;
  display_name: string;
  metadata?: { team_name?: string };
}

export interface SleeperMatchup {
  roster_id: number;
  matchup_id: number | null;
  points: number;
  starters: string[] | null;
  players: string[] | null;
  starters_points?: number[];
}

export interface SleeperPlayer {
  player_id: string;
  full_name?: string;
  first_name?: string;
  last_name?: string;
  position?: string | null;
  fantasy_positions?: string[] | null;
  team?: string | null;
  injury_status?: string | null;
  status?: string | null;
  active?: boolean;
  search_rank?: number | null;
}

/** Sleeper's roster_positions strings mapped onto our canonical slots. */
const SLOT_MAP: Record<string, SlotId> = {
  QB: "QB",
  RB: "RB",
  WR: "WR",
  TE: "TE",
  FLEX: "FLEX",
  WRRB_FLEX: "FLEX",
  REC_FLEX: "REC_FLEX",
  SUPER_FLEX: "SUPER_FLEX",
  K: "K",
  DEF: "DST",
  BN: "BN",
  IR: "IR",
  TAXI: "IR",
};

export function mapSlot(raw: string): SlotId | null {
  return SLOT_MAP[raw] ?? null;
}

export function mapPosition(raw: string | null | undefined): Pos | null {
  if (!raw) return null;
  if (raw === "DEF" || raw === "DST" || raw === "D/ST") return "DST";
  if (raw === "QB" || raw === "RB" || raw === "WR" || raw === "TE" || raw === "K") return raw;
  return null;
}

/**
 * The fantasy position for a Sleeper player.
 *
 * `position` is the player's real NFL position, which is not always a fantasy one:
 * two-way players like Travis Hunter come through as `position: "DB"` with
 * `fantasy_positions: ["DB", "WR"]`. So the whole eligibility list is scanned for the
 * first position a fantasy roster can actually use, and only then do we give up.
 */
export function resolvePosition(player: SleeperPlayer): Pos | null {
  const direct = mapPosition(player.position);
  if (direct) return direct;
  for (const candidate of player.fantasy_positions ?? []) {
    const mapped = mapPosition(candidate);
    if (mapped) return mapped;
  }
  return null;
}

export function mapInjury(raw: string | null | undefined): InjuryStatus {
  switch ((raw ?? "").toUpperCase()) {
    case "QUESTIONABLE":
      return "Q";
    case "DOUBTFUL":
      return "D";
    case "OUT":
      return "O";
    case "IR":
    case "INJURED RESERVE":
      return "IR";
    case "SUS":
    case "SUSPENDED":
      return "SUS";
    case "NA":
    case "PUP":
      return "NA";
    default:
      return "ACTIVE";
  }
}

export async function getUser(username: string): Promise<SleeperUser> {
  return cachedResilient(`sleeper:user:${username}`, 6 * HOUR, () =>
    fetchJson<SleeperUser>(`${APP}/user/${encodeURIComponent(username)}`)
  );
}

export async function getUserLeagues(userId: string, season: number): Promise<SleeperLeague[]> {
  return cachedResilient(`sleeper:leagues:${userId}:${season}`, 30 * MINUTE, () =>
    fetchJson<SleeperLeague[]>(`${APP}/user/${userId}/leagues/nfl/${season}`)
  );
}

export async function getLeague(leagueId: string): Promise<SleeperLeague> {
  return cachedResilient(`sleeper:league:${leagueId}`, 30 * MINUTE, () =>
    fetchJson<SleeperLeague>(`${APP}/league/${leagueId}`)
  );
}

export async function getRosters(leagueId: string): Promise<SleeperRoster[]> {
  return cachedResilient(`sleeper:rosters:${leagueId}`, 3 * MINUTE, () =>
    fetchJson<SleeperRoster[]>(`${APP}/league/${leagueId}/rosters`)
  );
}

export async function getLeagueUsers(leagueId: string): Promise<SleeperLeagueUser[]> {
  return cachedResilient(`sleeper:users:${leagueId}`, 30 * MINUTE, () =>
    fetchJson<SleeperLeagueUser[]>(`${APP}/league/${leagueId}/users`)
  );
}

export async function getMatchups(leagueId: string, week: number): Promise<SleeperMatchup[]> {
  return cachedResilient(`sleeper:matchups:${leagueId}:${week}`, 2 * MINUTE, () =>
    fetchJson<SleeperMatchup[]>(`${APP}/league/${leagueId}/matchups/${week}`)
  );
}

/**
 * The full NFL player dictionary — roughly 5MB, and Sleeper explicitly asks that it
 * be fetched at most once a day. Cached hard.
 */
export async function getPlayerDictionary(): Promise<Record<string, SleeperPlayer>> {
  return cachedResilient("sleeper:players", 12 * HOUR, () =>
    fetchJson<Record<string, SleeperPlayer>>(`${APP}/players/nfl`, { timeoutMs: 60_000 })
  );
}

const PROJECTION_POSITIONS = ["QB", "RB", "WR", "TE", "K", "DEF"];

interface SleeperStatLine {
  player_id: string;
  stats: Record<string, number> | null;
}

function positionQuery(): string {
  return PROJECTION_POSITIONS.map((p) => `position[]=${p}`).join("&");
}

/** Weekly projections keyed by Sleeper player id, holding the raw stat line. */
export async function getWeekProjections(
  season: number,
  week: number
): Promise<Map<string, Record<string, number>>> {
  const rows = await cachedResilient(`sleeper:proj:${season}:${week}`, 30 * MINUTE, () =>
    fetchJson<SleeperStatLine[]>(
      `${API}/projections/nfl/${season}/${week}?season_type=regular&${positionQuery()}&order_by=ppr`,
      { timeoutMs: 30_000 }
    )
  );
  const map = new Map<string, Record<string, number>>();
  for (const row of rows) if (row.stats) map.set(row.player_id, row.stats);
  return map;
}

/** Actual scoring for a week, used for in-progress matchups and season averages. */
export async function getWeekStats(
  season: number,
  week: number
): Promise<Map<string, Record<string, number>>> {
  const rows = await cachedResilient(`sleeper:stats:${season}:${week}`, 3 * MINUTE, () =>
    fetchJson<SleeperStatLine[]>(
      `${API}/stats/nfl/${season}/${week}?season_type=regular&${positionQuery()}`,
      { timeoutMs: 30_000 }
    )
  );
  const map = new Map<string, Record<string, number>>();
  for (const row of rows) if (row.stats) map.set(row.player_id, row.stats);
  return map;
}

/** Season-to-date totals, keyed by Sleeper player id. */
export async function getSeasonStats(season: number): Promise<Map<string, Record<string, number>>> {
  const rows = await cachedResilient(`sleeper:season-stats:${season}`, HOUR, () =>
    fetchJson<SleeperStatLine[]>(
      `${API}/stats/nfl/${season}?season_type=regular&${positionQuery()}`,
      { timeoutMs: 45_000 }
    )
  );
  const map = new Map<string, Record<string, number>>();
  for (const row of rows) if (row.stats) map.set(row.player_id, row.stats);
  return map;
}

/** Net adds over the last 24h across all of Sleeper — a good "who's hot" signal. */
export async function getTrendingAdds(): Promise<Map<string, number>> {
  const rows = await cachedResilient("sleeper:trending", 30 * MINUTE, () =>
    fetchJson<Array<{ player_id: string; count: number }>>(
      `${APP}/players/nfl/trending/add?lookback_hours=24&limit=200`
    )
  );
  return new Map(rows.map((r) => [r.player_id, r.count]));
}

/**
 * Sleeper reports projections as raw stat categories plus a few pre-scored totals.
 * We prefer the pre-scored total matching the league's PPR setting, and fall back to
 * applying the league's own scoring settings to the raw categories.
 */
export function scoreStatLine(
  stats: Record<string, number> | undefined,
  scoring: Record<string, number>
): number {
  if (!stats) return 0;

  const rec = scoring.rec ?? 0;
  if (Math.abs(rec - 1) < 0.01 && stats.pts_ppr != null) return stats.pts_ppr;
  if (Math.abs(rec - 0.5) < 0.01 && stats.pts_half_ppr != null) return stats.pts_half_ppr;
  if (Math.abs(rec) < 0.01 && stats.pts_std != null) return stats.pts_std;

  // Custom scoring: apply the league's settings category by category. Sleeper uses the
  // same keys in scoring_settings as in stat lines, so this is a dot product over the
  // categories both sides know about.
  let total = 0;
  for (const [key, weight] of Object.entries(scoring)) {
    const value = stats[key];
    if (typeof value === "number" && Number.isFinite(value)) total += value * weight;
  }
  return total;
}

export function playerName(player: SleeperPlayer): string {
  if (player.full_name) return player.full_name;
  const parts = [player.first_name, player.last_name].filter(Boolean);
  return parts.length ? parts.join(" ") : player.player_id;
}

export function playerTeam(player: SleeperPlayer): string | null {
  return normalizeTeam(player.team);
}
