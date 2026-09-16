import { cachedResilient, HOUR, MINUTE } from "./cache";
import { fetchJson } from "./http";

/** ESPN numbers pro teams; Sleeper and everyone else use abbreviations. */
export const ESPN_PRO_TEAMS: Record<number, string> = {
  0: "FA",
  1: "ATL",
  2: "BUF",
  3: "CHI",
  4: "CIN",
  5: "CLE",
  6: "DAL",
  7: "DEN",
  8: "DET",
  9: "GB",
  10: "TEN",
  11: "IND",
  12: "KC",
  13: "LV",
  14: "LAR",
  15: "MIA",
  16: "MIN",
  17: "NE",
  18: "NO",
  19: "NYG",
  20: "NYJ",
  21: "PHI",
  22: "ARI",
  23: "PIT",
  24: "LAC",
  25: "SF",
  26: "SEA",
  27: "TB",
  28: "WSH",
  29: "CAR",
  30: "JAX",
  33: "BAL",
  34: "HOU",
};

/** Abbreviations that differ between providers, normalized to the ESPN spelling. */
const TEAM_ALIASES: Record<string, string> = {
  WAS: "WSH",
  JAC: "JAX",
  LA: "LAR",
  SD: "LAC",
  OAK: "LV",
  STL: "LAR",
};

export function normalizeTeam(abbr: string | null | undefined): string | null {
  if (!abbr) return null;
  const upper = abbr.toUpperCase();
  return TEAM_ALIASES[upper] ?? upper;
}

export interface NflGame {
  home: string;
  away: string;
  kickoffMs: number;
  /** e.g. "1:00" in US Eastern, which is how fantasy sites label kickoffs. */
  kickoffLabel: string;
  completed: boolean;
  homeScore: number | null;
  awayScore: number | null;
}

interface EspnScoreboard {
  events?: Array<{
    date: string;
    status?: { type?: { completed?: boolean } };
    competitions?: Array<{
      competitors?: Array<{
        homeAway: "home" | "away";
        score?: string;
        team?: { abbreviation?: string };
      }>;
    }>;
  }>;
}

function easternKickoffLabel(iso: string): string {
  const date = new Date(iso);
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).formatToParts(date);
  const hour = parts.find((p) => p.type === "hour")?.value ?? "";
  const minute = parts.find((p) => p.type === "minute")?.value ?? "00";
  return `${hour}:${minute}`;
}

/** Every game in one week, keyed by both participating team abbreviations. */
export async function getWeekSchedule(
  season: number,
  week: number
): Promise<Map<string, NflGame>> {
  const games = await cachedResilient(`nfl:schedule:${season}:${week}`, 10 * MINUTE, async () => {
    const url =
      `https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard` +
      `?dates=${season}&seasontype=2&week=${week}`;
    const data = await fetchJson<EspnScoreboard>(url);
    const out: NflGame[] = [];

    for (const event of data.events ?? []) {
      const competitors = event.competitions?.[0]?.competitors ?? [];
      const home = competitors.find((c) => c.homeAway === "home");
      const away = competitors.find((c) => c.homeAway === "away");
      const homeAbbr = normalizeTeam(home?.team?.abbreviation);
      const awayAbbr = normalizeTeam(away?.team?.abbreviation);
      if (!homeAbbr || !awayAbbr) continue;

      out.push({
        home: homeAbbr,
        away: awayAbbr,
        kickoffMs: new Date(event.date).getTime(),
        kickoffLabel: easternKickoffLabel(event.date),
        completed: event.status?.type?.completed ?? false,
        homeScore: home?.score != null ? Number(home.score) : null,
        awayScore: away?.score != null ? Number(away.score) : null,
      });
    }
    return out;
  });

  const byTeam = new Map<string, NflGame>();
  for (const game of games) {
    byTeam.set(game.home, game);
    byTeam.set(game.away, game);
  }
  return byTeam;
}

/** "vs NYG" / "@ NO", or null on a bye. */
export function opponentLabel(team: string | null, game: NflGame | undefined): string | null {
  if (!team || !game) return null;
  return game.home === team ? `vs ${game.away}` : `@ ${game.home}`;
}

interface SleeperState {
  week: number;
  season: string;
  season_type: string;
  display_week?: number;
}

/**
 * The NFL week to give advice for — the one being played next, not the one just
 * finished. Sleeper's `display_week` lags behind `week` from the end of Monday night
 * until the new week opens, which is exactly when lineups are being set, so `week`
 * is the one to trust here.
 */
export async function getNflState(): Promise<{ season: number; week: number }> {
  const state = await cachedResilient("nfl:state", 15 * MINUTE, () =>
    fetchJson<SleeperState>("https://api.sleeper.app/v1/state/nfl")
  );
  return {
    season: Number(state.season),
    week: Math.max(1, state.week ?? state.display_week ?? 1),
  };
}

/** Per-team bye weeks for the season, derived from the full schedule. */
export async function getByeWeeks(season: number): Promise<Map<string, number>> {
  return cachedResilient(`nfl:byes:${season}`, 12 * HOUR, async () => {
    const byes = new Map<string, number>();
    const allTeams = new Set(Object.values(ESPN_PRO_TEAMS).filter((t) => t !== "FA"));
    // Byes only fall in weeks 5-14 in the modern schedule.
    for (let week = 5; week <= 14; week++) {
      const schedule = await getWeekSchedule(season, week);
      for (const team of allTeams) {
        if (!schedule.has(team) && !byes.has(team)) byes.set(team, week);
      }
    }
    return byes;
  });
}
