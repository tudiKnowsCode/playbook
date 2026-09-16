// Monte Carlo simulation for matchup win probability, playoff odds and title odds.
//
// Everything here is seeded off the league id and week, so a page refresh returns the
// same numbers rather than jittering by a percentage point each time.

import type { League, Matchup, Player, Team } from "../types";
import { isStartingSlot } from "../types";

const SIMULATIONS = 10_000;

/** mulberry32 — small, fast, and good enough for this. */
function makeRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hashSeed(text: string): number {
  let hash = 2166136261;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

/** Standard normal via Box-Muller. */
function gauss(rand: () => number): number {
  let u = 0;
  let v = 0;
  while (u === 0) u = rand();
  while (v === 0) v = rand();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

/**
 * A player's weekly spread. Floor and ceiling bound an ~80% interval, so the distance
 * between them is about 2.56 standard deviations.
 */
function playerSigma(player: Player): number {
  const spread = player.ceil - player.floor;
  if (spread > 0.5) return spread / 2.56;
  return Math.max(1.5, player.proj * 0.4);
}

/** Samples a player's score. Fantasy scoring is right-skewed and floored at zero. */
function samplePlayer(player: Player, rand: () => number): number {
  if (player.proj <= 0) return 0;
  const draw = player.proj + gauss(rand) * playerSigma(player);
  return Math.max(0, draw);
}

function startingPlayers(team: Team): Player[] {
  return team.roster.filter((e) => isStartingSlot(e.slot)).map((e) => e.player);
}

export interface MatchupOdds {
  /** Probability the first team wins, 0-1. */
  winProbability: number;
  myProjected: number;
  oppProjected: number;
  /** Median simulated margin. */
  projectedMargin: number;
  simulations: number;
}

/**
 * Win probability for a head-to-head matchup, simulated player by player so that a
 * boom/bust roster is correctly treated as more volatile than a steady one.
 */
export function simulateMatchup(league: League, me: Team, opponent: Team): MatchupOdds {
  const mine = startingPlayers(me);
  const theirs = startingPlayers(opponent);
  const rand = makeRandom(hashSeed(`${league.id}:${league.currentWeek}:${me.id}:${opponent.id}`));

  let wins = 0;
  let ties = 0;
  const margins: number[] = [];

  for (let i = 0; i < SIMULATIONS; i++) {
    let a = 0;
    let b = 0;
    for (const p of mine) a += samplePlayer(p, rand);
    for (const p of theirs) b += samplePlayer(p, rand);
    if (a > b) wins++;
    else if (a === b) ties++;
    margins.push(a - b);
  }

  margins.sort((x, y) => x - y);

  return {
    winProbability: (wins + ties / 2) / SIMULATIONS,
    myProjected: round1(mine.reduce((s, p) => s + p.proj, 0)),
    oppProjected: round1(theirs.reduce((s, p) => s + p.proj, 0)),
    projectedMargin: round1(margins[Math.floor(margins.length / 2)]),
    simulations: SIMULATIONS,
  };
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

interface TeamStrength {
  teamId: string;
  /** Expected points per week going forward. */
  mean: number;
  /** Week-to-week standard deviation of the team total. */
  sigma: number;
}

/**
 * A team's forward-looking scoring rate. Season points-per-game captures how the roster
 * has actually performed; the current starting lineup's projection captures how it looks
 * now (after injuries and waiver moves). Blended, weighted toward the season sample as
 * it grows.
 */
function teamStrength(league: League, team: Team): TeamStrength {
  const gamesPlayed = team.record.wins + team.record.losses + team.record.ties;
  const seasonRate = gamesPlayed > 0 ? team.pf / gamesPlayed : 0;
  const lineupRate = startingPlayers(team).reduce((s, p) => s + p.proj, 0);

  const seasonWeight = Math.min(0.65, gamesPlayed * 0.09);
  const mean =
    gamesPlayed > 0 ? seasonRate * seasonWeight + lineupRate * (1 - seasonWeight) : lineupRate;

  // Team totals are far less volatile than individual players — the independent
  // variances partially cancel. Empirically a starting lineup lands near 18-20% CV.
  return { teamId: team.id, mean: mean || 100, sigma: Math.max(12, (mean || 100) * 0.19) };
}

export interface SeasonOutlook {
  teamId: string;
  /** Probability of making the playoffs, 0-1. */
  playoffOdds: number;
  /** Probability of winning the championship, 0-1. */
  titleOdds: number;
  /** Probability of the #1 seed, 0-1. */
  byeOdds: number;
  /** Most likely final seed. */
  projectedSeed: number;
  projectedWins: number;
  projectedLosses: number;
}

/**
 * Simulates the rest of the regular season plus a single-elimination playoff bracket.
 * Returns an outlook for every team.
 */
export function simulateSeason(
  league: League,
  remainingSchedule: Matchup[]
): Map<string, SeasonOutlook> {
  const teams = league.teams;
  const strengths = new Map(teams.map((t) => [t.id, teamStrength(league, t)]));
  const rand = makeRandom(hashSeed(`${league.id}:season:${league.currentWeek}`));

  const playoffCount = Math.min(league.playoffTeams, teams.length);
  const madePlayoffs = new Map(teams.map((t) => [t.id, 0]));
  const wonTitle = new Map(teams.map((t) => [t.id, 0]));
  const gotBye = new Map(teams.map((t) => [t.id, 0]));
  const seedTotals = new Map(teams.map((t) => [t.id, 0]));
  const winTotals = new Map(teams.map((t) => [t.id, 0]));

  // Weeks still to be played, in order.
  const byWeek = new Map<number, Matchup[]>();
  for (const m of remainingSchedule) {
    const list = byWeek.get(m.week) ?? [];
    list.push(m);
    byWeek.set(m.week, list);
  }
  const weeks = [...byWeek.keys()].sort((a, b) => a - b);

  for (let sim = 0; sim < SIMULATIONS; sim++) {
    const wins = new Map(teams.map((t) => [t.id, t.record.wins]));
    const pointsFor = new Map(teams.map((t) => [t.id, t.pf]));

    for (const week of weeks) {
      for (const matchup of byWeek.get(week) ?? []) {
        const home = strengths.get(matchup.homeTeamId);
        const away = strengths.get(matchup.awayTeamId);
        if (!home || !away) continue;
        const homeScore = Math.max(0, home.mean + gauss(rand) * home.sigma);
        const awayScore = Math.max(0, away.mean + gauss(rand) * away.sigma);
        pointsFor.set(matchup.homeTeamId, (pointsFor.get(matchup.homeTeamId) ?? 0) + homeScore);
        pointsFor.set(matchup.awayTeamId, (pointsFor.get(matchup.awayTeamId) ?? 0) + awayScore);
        const winner = homeScore >= awayScore ? matchup.homeTeamId : matchup.awayTeamId;
        wins.set(winner, (wins.get(winner) ?? 0) + 1);
      }
    }

    // Standings: wins first, total points as the tiebreak — the near-universal rule.
    const finalOrder = [...teams]
      .map((t) => ({
        id: t.id,
        wins: wins.get(t.id) ?? 0,
        pf: pointsFor.get(t.id) ?? 0,
      }))
      .sort((a, b) => b.wins - a.wins || b.pf - a.pf);

    finalOrder.forEach((entry, index) => {
      seedTotals.set(entry.id, (seedTotals.get(entry.id) ?? 0) + index + 1);
      winTotals.set(entry.id, (winTotals.get(entry.id) ?? 0) + entry.wins);
      if (index < playoffCount) madePlayoffs.set(entry.id, (madePlayoffs.get(entry.id) ?? 0) + 1);
      if (index === 0) gotBye.set(entry.id, (gotBye.get(entry.id) ?? 0) + 1);
    });

    // Single-elimination bracket over the qualifying seeds.
    let bracket = finalOrder.slice(0, playoffCount).map((e) => e.id);
    while (bracket.length > 1) {
      const next: string[] = [];
      // Byes for the top seeds when the field isn't a power of two.
      const roundSize = 2 ** Math.floor(Math.log2(bracket.length));
      const byes = bracket.slice(0, bracket.length - roundSize);
      const playing = bracket.slice(bracket.length - roundSize);
      next.push(...byes);

      for (let i = 0; i < playing.length / 2; i++) {
        const a = playing[i];
        const b = playing[playing.length - 1 - i];
        const sa = strengths.get(a);
        const sb = strengths.get(b);
        if (!sa || !sb) {
          next.push(a);
          continue;
        }
        const scoreA = Math.max(0, sa.mean + gauss(rand) * sa.sigma);
        const scoreB = Math.max(0, sb.mean + gauss(rand) * sb.sigma);
        next.push(scoreA >= scoreB ? a : b);
      }
      bracket = next.sort(
        (x, y) => finalOrder.findIndex((e) => e.id === x) - finalOrder.findIndex((e) => e.id === y)
      );
    }
    if (bracket[0]) wonTitle.set(bracket[0], (wonTitle.get(bracket[0]) ?? 0) + 1);
  }

  const out = new Map<string, SeasonOutlook>();
  for (const team of teams) {
    const projectedWins = (winTotals.get(team.id) ?? 0) / SIMULATIONS;
    const totalGames = team.record.wins + team.record.losses + weeks.length;
    out.set(team.id, {
      teamId: team.id,
      playoffOdds: (madePlayoffs.get(team.id) ?? 0) / SIMULATIONS,
      titleOdds: (wonTitle.get(team.id) ?? 0) / SIMULATIONS,
      byeOdds: (gotBye.get(team.id) ?? 0) / SIMULATIONS,
      projectedSeed: Math.round((seedTotals.get(team.id) ?? 0) / SIMULATIONS),
      projectedWins: Math.round(projectedWins * 10) / 10,
      projectedLosses: Math.round((totalGames - projectedWins) * 10) / 10,
    });
  }
  return out;
}

export interface PowerRanking {
  teamId: string;
  rank: number;
  /** 0-100, where 100 is the strongest team in the league. */
  score: number;
  /** Change in rank versus a record-only ordering; positive means underrated. */
  trend: number;
}

/**
 * Power rankings blend three things a win-loss record alone hides: how much a team
 * actually scores, how strong its roster is right now, and how lucky it has been
 * (a 7-3 team that scores like a 5-5 team is not a 7-3 team).
 */
export function powerRankings(league: League): Map<string, PowerRanking> {
  const teams = league.teams;
  const gamesPlayed = Math.max(
    1,
    Math.max(...teams.map((t) => t.record.wins + t.record.losses + t.record.ties))
  );

  const rows = teams.map((team) => {
    const played = Math.max(1, team.record.wins + team.record.losses + team.record.ties);
    const winPct = (team.record.wins + team.record.ties * 0.5) / played;
    const ppg = team.pf / played;
    const papg = team.pa / played;
    const rosterStrength = team.roster.reduce((sum, e) => sum + e.player.rosProj, 0);
    return { team, winPct, ppg, papg, rosterStrength, played };
  });

  const normalize = (values: number[]) => {
    const min = Math.min(...values);
    const max = Math.max(...values);
    return (v: number) => (max === min ? 0.5 : (v - min) / (max - min));
  };

  const ppgScale = normalize(rows.map((r) => r.ppg));
  const paScale = normalize(rows.map((r) => r.papg));
  const rosterScale = normalize(rows.map((r) => r.rosterStrength));

  // Early in the season the record means very little; scoring and roster carry it.
  const recordWeight = Math.min(0.35, 0.05 * gamesPlayed);

  const scored = rows.map((r) => {
    const raw =
      recordWeight * r.winPct +
      0.34 * ppgScale(r.ppg) +
      0.24 * rosterScale(r.rosterStrength) +
      0.07 * (1 - paScale(r.papg));
    return { ...r, raw: raw / (recordWeight + 0.65) };
  });

  const best = Math.max(...scored.map((s) => s.raw)) || 1;
  const byPower = [...scored].sort((a, b) => b.raw - a.raw);
  const byRecord = [...scored].sort(
    (a, b) => b.winPct - a.winPct || b.team.pf - a.team.pf
  );

  const out = new Map<string, PowerRanking>();
  byPower.forEach((row, index) => {
    const recordRank = byRecord.findIndex((r) => r.team.id === row.team.id);
    out.set(row.team.id, {
      teamId: row.team.id,
      rank: index + 1,
      score: Math.round((row.raw / best) * 1000) / 10,
      trend: recordRank - index,
    });
  });
  return out;
}

/**
 * Strength of schedule for the remaining weeks: the average power score of the
 * opponents still on the slate, expressed as a league rank (1 = easiest).
 */
export function strengthOfSchedule(
  league: League,
  remainingSchedule: Matchup[],
  power: Map<string, PowerRanking>
): Map<string, { averageOpponentScore: number; rank: number }> {
  const totals = new Map<string, { sum: number; count: number }>();
  const bump = (teamId: string, oppId: string) => {
    const score = power.get(oppId)?.score ?? 50;
    const entry = totals.get(teamId) ?? { sum: 0, count: 0 };
    entry.sum += score;
    entry.count++;
    totals.set(teamId, entry);
  };

  for (const m of remainingSchedule) {
    bump(m.homeTeamId, m.awayTeamId);
    bump(m.awayTeamId, m.homeTeamId);
  }

  const averages = league.teams.map((team) => {
    const entry = totals.get(team.id);
    return {
      teamId: team.id,
      averageOpponentScore: entry && entry.count > 0 ? entry.sum / entry.count : 50,
    };
  });

  const ranked = [...averages].sort((a, b) => a.averageOpponentScore - b.averageOpponentScore);
  const out = new Map<string, { averageOpponentScore: number; rank: number }>();
  ranked.forEach((row, index) => {
    out.set(row.teamId, {
      averageOpponentScore: Math.round(row.averageOpponentScore * 10) / 10,
      rank: index + 1,
    });
  });
  return out;
}
