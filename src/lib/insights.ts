// Assembles everything the dashboard renders into one serializable payload, so the
// page is a pure function of this object and the client does no fetching of its own.

import { buildExposure, type ExposureReport } from "./analysis/exposure";
import { analyzeLineup, type LineupAdvice } from "./analysis/optimizer";
import {
  powerRankings,
  simulateMatchup,
  simulateSeason,
  strengthOfSchedule,
  type MatchupOdds,
  type SeasonOutlook,
} from "./analysis/simulation";
import { analyzeTrade, findTrades, valuePlayers, type TradeIdea } from "./analysis/trades";
import { dropCandidates, rankWaiverTargets, type DropCandidate, type WaiverTarget } from "./analysis/waivers";
import { listLeagues, loadLeague, opponentOf, type LeagueSummary } from "./league";
import type { League, Matchup, Player, Team } from "./types";
import { isStartingSlot, slotLabel } from "./types";

export interface SlotComparison {
  slot: string;
  mine: Player | null;
  theirs: Player | null;
  /** Positive when you're favored in this slot. */
  edge: number;
}

export interface StandingsRow {
  team: Team;
  rank: number;
  powerScore: number;
  powerTrend: number;
  playoffOdds: number;
  titleOdds: number;
  projectedSeed: number;
  isMine: boolean;
}

export interface ActionItem {
  kind: "start" | "claim" | "trade" | "stream";
  title: string;
  detail: string;
  /** Projected points added this week. */
  gain: number;
  /** Which view answers this action. */
  target: "lineup" | "waivers" | "trades";
}

export interface OtherGame {
  home: Team;
  away: Team;
  /** Projected margin for the home team. */
  line: number;
}

export interface Connection {
  name: string;
  detail: string;
  leagueCount: number;
  ok: boolean;
}

export interface Dashboard {
  league: League;
  leagues: LeagueSummary[];
  me: Team | null;
  opponent: Team | null;
  odds: MatchupOdds | null;
  slotComparison: SlotComparison[];
  lineup: LineupAdvice | null;
  waivers: WaiverTarget[];
  drops: DropCandidate[];
  tradeIdeas: TradeIdea[];
  tradeValues: Record<string, number>;
  standings: StandingsRow[];
  outlook: SeasonOutlook | null;
  scheduleRank: number | null;
  otherGames: OtherGame[];
  actions: ActionItem[];
  exposure: ExposureReport | null;
  connections: Connection[];
  errors: string[];
  syncedAt: number;
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

/**
 * Lines the two starting lineups up slot by slot. Both teams get their starters sorted
 * into the league's slot order so the comparison is apples to apples even when one
 * manager has left a slot empty.
 */
function compareSlots(league: League, me: Team | null, opponent: Team | null): SlotComparison[] {
  if (!me) return [];

  const bucket = (team: Team | null) => {
    const map = new Map<string, Player[]>();
    for (const entry of team?.roster ?? []) {
      if (!isStartingSlot(entry.slot)) continue;
      const list = map.get(entry.slot) ?? [];
      list.push(entry.player);
      map.set(entry.slot, list);
    }
    for (const list of map.values()) list.sort((a, b) => b.proj - a.proj);
    return map;
  };

  const mine = bucket(me);
  const theirs = bucket(opponent);

  return league.startingSlots.map((slot) => {
    const a = mine.get(slot)?.shift() ?? null;
    const b = theirs.get(slot)?.shift() ?? null;
    return {
      slot: slotLabel(slot),
      mine: a,
      theirs: b,
      edge: round1((a?.proj ?? 0) - (b?.proj ?? 0)),
    };
  });
}

/** Matchups still to be played, which is what the season simulation runs over. */
function remainingSchedule(league: League): Matchup[] {
  return league.allMatchups.filter((m) => m.week >= league.currentWeek && !m.complete);
}

/**
 * The "do these first" list: the highest-leverage moves available this week, from every
 * corner of the app, ranked by the points each one actually adds.
 */
function buildActions(
  lineup: LineupAdvice | null,
  waivers: WaiverTarget[],
  trades: TradeIdea[]
): ActionItem[] {
  const actions: ActionItem[] = [];

  for (const swap of lineup?.swaps.slice(0, 3) ?? []) {
    if (swap.gain <= 0.2) continue;
    const starter = swap.starter;
    const why = !starter
      ? `An empty slot in your lineup is scoring 0.0`
      : starter.status === "Q" || starter.status === "D"
        ? `${starter.name} is ${starter.status === "Q" ? "questionable" : "doubtful"}`
        : `${swap.replacement.name} projects ${swap.replacement.proj.toFixed(1)} to ${starter.proj.toFixed(1)}`;
    actions.push({
      kind: "start",
      title: starter
        ? `Start ${swap.replacement.name} over ${starter.name}`
        : `Start ${swap.replacement.name} at ${swap.slotLabel} to fill an empty slot`,
      detail: why,
      gain: swap.gain,
      target: "lineup",
    });
  }

  for (const target of waivers.slice(0, 2)) {
    if (target.score < 45) continue;
    actions.push({
      kind: target.player.pos === "K" || target.player.pos === "DST" ? "stream" : "claim",
      title:
        target.suggestedBid != null
          ? `Claim ${target.player.name} · bid $${target.suggestedBid}`
          : `Claim ${target.player.name}`,
      detail: target.reason,
      gain: round1(Math.max(target.lineupGain, target.score / 25)),
      target: "waivers",
    });
  }

  for (const idea of trades.slice(0, 2)) {
    actions.push({
      kind: "trade",
      title: idea.summary,
      detail: `${idea.partner.name} ${idea.partnerNeed}`,
      gain: idea.myGain,
      target: "trades",
    });
  }

  return actions.sort((a, b) => b.gain - a.gain).slice(0, 5);
}

async function buildDashboard(
  league: League,
  summaries: LeagueSummary[],
  errors: string[],
  exposure: ExposureReport | null
): Promise<Dashboard> {
  const me = league.teams.find((t) => t.isMine) ?? null;
  const opponent = me ? opponentOf(league, me.id) : null;

  const odds = me && opponent ? simulateMatchup(league, me, opponent) : null;
  const lineup = me ? analyzeLineup(me, league.startingSlots) : null;
  const waivers = me ? rankWaiverTargets(league, me, 40) : [];
  const drops = me ? dropCandidates(league, me, 6) : [];
  const tradeIdeas = me ? findTrades(league, me, 6) : [];

  const power = powerRankings(league);
  const remaining = remainingSchedule(league);
  const season = simulateSeason(league, remaining);
  const sos = strengthOfSchedule(league, remaining, power);

  const standings: StandingsRow[] = league.teams
    .map((team) => {
      const p = power.get(team.id);
      const s = season.get(team.id);
      return {
        team,
        rank: p?.rank ?? 99,
        powerScore: p?.score ?? 0,
        powerTrend: p?.trend ?? 0,
        playoffOdds: s?.playoffOdds ?? 0,
        titleOdds: s?.titleOdds ?? 0,
        projectedSeed: s?.projectedSeed ?? 0,
        isMine: team.isMine,
      };
    })
    .sort((a, b) => a.rank - b.rank);

  // Everyone else's games this week, with a projected line.
  const teamById = new Map(league.teams.map((t) => [t.id, t]));
  const projectedFor = (team: Team) =>
    team.roster.filter((e) => isStartingSlot(e.slot)).reduce((sum, e) => sum + e.player.proj, 0);

  const otherGames: OtherGame[] = league.matchups
    .filter((m) => !me || (m.homeTeamId !== me.id && m.awayTeamId !== me.id))
    .map((m) => {
      const home = teamById.get(m.homeTeamId);
      const away = teamById.get(m.awayTeamId);
      if (!home || !away) return null;
      return { home, away, line: round1(projectedFor(home) - projectedFor(away)) };
    })
    .filter((g): g is OtherGame => g != null);

  const allPlayers = league.teams.flatMap((t) => t.roster.map((e) => e.player));
  const values = valuePlayers(league, allPlayers);

  const sourceGroups = new Map<string, number>();
  for (const summary of summaries) {
    const name = summary.source === "espn" ? "ESPN" : "Sleeper";
    sourceGroups.set(name, (sourceGroups.get(name) ?? 0) + 1);
  }
  const connections: Connection[] = [...sourceGroups.entries()].map(([name, count]) => ({
    name,
    detail: summaries
      .filter((s) => (s.source === "espn" ? "ESPN" : "Sleeper") === name)
      .map((s) => s.name)
      .join(", "),
    leagueCount: count,
    ok: true,
  }));

  return {
    league,
    leagues: summaries,
    me,
    opponent,
    odds,
    slotComparison: compareSlots(league, me, opponent),
    lineup,
    waivers,
    drops,
    tradeIdeas,
    tradeValues: Object.fromEntries(values),
    standings,
    outlook: me ? season.get(me.id) ?? null : null,
    scheduleRank: me ? sos.get(me.id)?.rank ?? null : null,
    otherGames,
    actions: buildActions(lineup, waivers, tradeIdeas),
    exposure,
    connections,
    errors: [...errors, ...league.warnings],
    syncedAt: Date.now(),
  };
}

/**
 * Loads the active league plus every other league (needed for cross-league exposure)
 * and produces the full dashboard.
 */
export async function getDashboard(
  leagueId?: string,
  week?: number
): Promise<Dashboard | { error: string; leagues: LeagueSummary[] }> {
  const { leagues, errors } = await listLeagues();
  if (leagues.length === 0) {
    return {
      error:
        errors[0] ??
        "No leagues configured. Set SLEEPER_USERNAME and/or ESPN_LEAGUES in .env.local.",
      leagues: [],
    };
  }

  const activeId = leagueId && leagues.some((l) => l.id === leagueId) ? leagueId : leagues[0].id;

  // Every league is loaded so exposure can span them; failures are reported rather than
  // fatal, so one broken ESPN cookie doesn't take down the whole dashboard.
  const loaded = await Promise.all(
    leagues.map((summary) =>
      loadLeague(summary.id, week)
        .then((league) => ({ league, error: null as string | null }))
        .catch((err) => ({
          league: null,
          error: `${summary.name}: ${err instanceof Error ? err.message : "failed to load"}`,
        }))
    )
  );

  const loadErrors = loaded.map((l) => l.error).filter((e): e is string => Boolean(e));
  const allLeagues = loaded.map((l) => l.league).filter((l): l is League => l != null);

  const active = allLeagues.find((l) => l.id === activeId) ?? allLeagues[0];
  if (!active) {
    return { error: [...errors, ...loadErrors][0] ?? "Could not load any league.", leagues };
  }

  const exposure = allLeagues.length > 0 ? buildExposure(allLeagues) : null;
  return buildDashboard(active, leagues, [...errors, ...loadErrors], exposure);
}

export { analyzeTrade };
export type { LeagueSummary, TradeIdea, WaiverTarget, DropCandidate, LineupAdvice, MatchupOdds };
