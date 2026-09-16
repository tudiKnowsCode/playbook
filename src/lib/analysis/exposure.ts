// Cross-league player exposure: who you're rooting for, who you're rooting against,
// and who you're doing both with at once.
//
// Starters only, on both sides. A bench player has no bearing on any result this week,
// so counting them would inflate every number with players who cannot score.

import type { League, Player, Pos } from "../types";
import { isStartingSlot } from "../types";

const POSITION_ORDER: Pos[] = ["QB", "RB", "WR", "TE", "DST", "K"];

export interface ExposureEntry {
  name: string;
  pos: Pos;
  nflTeam: string | null;
  /** Number of leagues the player appears in on this side. */
  count: number;
  /** League names, in load order. */
  leagues: string[];
  proj: number;
  /** True when the same player is on the other side in some other league. */
  conflicted: boolean;
  /** Leagues where the player is on the opposing side. */
  conflictLeagues: string[];
}

export interface ExposureGroup {
  pos: Pos;
  label: string;
  players: ExposureEntry[];
}

export interface Conflict {
  name: string;
  pos: Pos;
  /** Leagues where this player is in your starting lineup. */
  startedIn: number;
  facedIn: number;
  /** Net rooting interest: positive means you want a big game. */
  netProj: number;
}

export interface ExposureReport {
  leagueCount: number;
  /** Unique players you're starting, and the total starting spots they fill. */
  myPlayerCount: number;
  myStartingSpots: number;
  oppPlayerCount: number;
  oppStartingSpots: number;
  mine: ExposureGroup[];
  opponents: ExposureGroup[];
  conflicts: Conflict[];
  /** Source breakdown, e.g. "2 Sleeper · 1 ESPN". */
  sourceLabel: string;
}

/** Exposure keys on name + position so the same human matches across providers. */
function key(player: Player): string {
  return `${player.pos}|${player.name.toLowerCase().replace(/[^a-z ]/g, "").trim()}`;
}

function label(pos: Pos): string {
  return pos === "DST" ? "D/ST" : pos;
}

interface Accumulator {
  name: string;
  pos: Pos;
  nflTeam: string | null;
  leagues: string[];
  proj: number;
}

function collect(
  leagues: League[],
  side: "mine" | "opponent"
): Map<string, Accumulator> {
  const map = new Map<string, Accumulator>();

  for (const league of leagues) {
    const myTeam = league.teams.find((t) => t.isMine);
    if (!myTeam) continue;

    let team = myTeam;
    if (side === "opponent") {
      const matchup = league.matchups.find(
        (m) => m.homeTeamId === myTeam.id || m.awayTeamId === myTeam.id
      );
      if (!matchup) continue;
      const oppId = matchup.homeTeamId === myTeam.id ? matchup.awayTeamId : matchup.homeTeamId;
      const opponent = league.teams.find((t) => t.id === oppId);
      if (!opponent) continue;
      team = opponent;
    }

    for (const entry of team.roster) {
      if (!isStartingSlot(entry.slot)) continue;
      const k = key(entry.player);
      const existing = map.get(k) ?? {
        name: entry.player.name,
        pos: entry.player.pos,
        nflTeam: entry.player.nflTeam,
        leagues: [],
        proj: entry.player.proj,
      };
      existing.leagues.push(league.name);
      existing.proj = Math.max(existing.proj, entry.player.proj);
      map.set(k, existing);
    }
  }

  return map;
}

function toGroups(
  map: Map<string, Accumulator>,
  otherSide: Map<string, Accumulator>
): ExposureGroup[] {
  const groups: ExposureGroup[] = [];

  for (const pos of POSITION_ORDER) {
    const players = [...map.entries()]
      .filter(([, entry]) => entry.pos === pos)
      .map(([k, entry]) => {
        const conflict = otherSide.get(k);
        return {
          name: entry.name,
          pos: entry.pos,
          nflTeam: entry.nflTeam,
          count: entry.leagues.length,
          leagues: entry.leagues,
          proj: entry.proj,
          conflicted: Boolean(conflict),
          conflictLeagues: conflict?.leagues ?? [],
        };
      })
      .sort((a, b) => b.count - a.count || b.proj - a.proj || a.name.localeCompare(b.name));

    if (players.length > 0) groups.push({ pos, label: label(pos), players });
  }

  return groups;
}

export function buildExposure(leagues: League[]): ExposureReport {
  const withMyTeam = leagues.filter((l) => l.teams.some((t) => t.isMine));
  const mineMap = collect(withMyTeam, "mine");
  const oppMap = collect(withMyTeam, "opponent");

  const conflicts: Conflict[] = [];
  for (const [k, entry] of mineMap) {
    const faced = oppMap.get(k);
    if (!faced) continue;
    conflicts.push({
      name: entry.name,
      pos: entry.pos,
      startedIn: entry.leagues.length,
      facedIn: faced.leagues.length,
      netProj:
        Math.round(entry.proj * (entry.leagues.length - faced.leagues.length) * 10) / 10,
    });
  }
  conflicts.sort((a, b) => b.startedIn + b.facedIn - (a.startedIn + a.facedIn));

  const sourceCounts = new Map<string, number>();
  for (const league of withMyTeam) {
    const name = league.source === "espn" ? "ESPN" : "Sleeper";
    sourceCounts.set(name, (sourceCounts.get(name) ?? 0) + 1);
  }

  const spots = (map: Map<string, Accumulator>) =>
    [...map.values()].reduce((sum, e) => sum + e.leagues.length, 0);

  return {
    leagueCount: withMyTeam.length,
    myPlayerCount: mineMap.size,
    myStartingSpots: spots(mineMap),
    oppPlayerCount: oppMap.size,
    oppStartingSpots: spots(oppMap),
    mine: toGroups(mineMap, oppMap),
    opponents: toGroups(oppMap, mineMap),
    conflicts,
    sourceLabel:
      [...sourceCounts.entries()].map(([name, count]) => `${count} ${name}`).join(" · ") ||
      "no leagues",
  };
}
