// Waiver wire scoring: which free agents actually help *this* roster, and what to bid.

import type { League, Player, Pos, Team } from "../types";
import { isStartingSlot } from "../types";
import { optimizeLineup, replacementLevel } from "./optimizer";

export interface WaiverTarget {
  player: Player;
  /** 0-100 composite. */
  score: number;
  /** Points per game this player adds to the optimal starting lineup. */
  lineupGain: number;
  /** Rest-of-season points above a freely available replacement at the position. */
  valueOverReplacement: number;
  /** Suggested FAAB bid in dollars, or null in a league without FAAB. */
  suggestedBid: number | null;
  /** One-line justification shown in the table. */
  reason: string;
  /** The player this claim should drop, when the roster is full. */
  dropSuggestion: Player | null;
}

export interface DropCandidate {
  player: Player;
  reason: string;
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

/**
 * How much a player would improve the team's best possible lineup, in points per week.
 * This is the number that actually matters: a great player at a position you're already
 * deep at adds nothing to your Sunday score.
 */
function marginalLineupGain(league: League, team: Team, candidate: Player): number {
  const before = optimizeLineup(league.startingSlots, team.roster, (p) => p.rosProj);
  const after = optimizeLineup(
    league.startingSlots,
    [...team.roster, { player: candidate, slot: "BN" as const }],
    (p) => p.rosProj
  );
  const gain =
    after.assignments.reduce((s, a) => s + (a.player?.rosProj ?? 0), 0) -
    before.assignments.reduce((s, a) => s + (a.player?.rosProj ?? 0), 0);
  return round1(Math.max(0, gain));
}

/**
 * Positional need, measured the only way that matters: how much a merely
 * replacement-level player at that position would improve the team's best lineup.
 *
 * Counting roster slots does not work — a one-quarterback league team carrying exactly
 * one quarterback has correct roster construction, not a need, and a naive count reads
 * "no backup" as a hole and floods the waiver board with backup QBs.
 */
function positionalNeed(
  league: League,
  team: Team,
  replacement: Map<Pos, number>
): Map<Pos, number> {
  const baseline = optimizeLineup(league.startingSlots, team.roster, (p) => p.rosProj)
    .assignments.reduce((s, a) => s + (a.player?.rosProj ?? 0), 0);

  const need = new Map<Pos, number>();
  for (const pos of ["QB", "RB", "WR", "TE", "K", "DST"] as Pos[]) {
    const level = replacement.get(pos) ?? 0;
    // A synthetic, freely-available player at this position.
    const filler: Player = {
      ...team.roster[0].player,
      id: `__filler_${pos}`,
      name: "replacement",
      pos,
      status: "ACTIVE",
      opponent: null,
      proj: level,
      rosProj: level,
    };
    const after = optimizeLineup(
      league.startingSlots,
      [...team.roster, { player: filler, slot: "BN" as const }],
      (p) => p.rosProj
    ).assignments.reduce((s, a) => s + (a.player?.rosProj ?? 0), 0);

    // Normalized against the replacement level itself, so the scale is comparable
    // across positions that score very differently.
    need.set(pos, Math.max(0, Math.min(1, (after - baseline) / Math.max(1, level))));
  }
  return need;
}

/**
 * Suggested FAAB bid. Anchored to the share of the remaining budget a target is worth:
 * a genuine every-week starter is worth a large fraction of what's left, a speculative
 * stash is worth a dollar.
 */
function suggestBid(score: number, budgetLeft: number | null, weeksLeft: number): number | null {
  if (budgetLeft == null) return null;
  if (budgetLeft <= 0) return 0;

  // Below ~35 the player is a stash; above ~85 they are a league-winner.
  const share =
    score >= 85 ? 0.45 : score >= 72 ? 0.26 : score >= 58 ? 0.13 : score >= 42 ? 0.05 : 0.01;

  // Budget gets more expendable as the season closes out — hoarding FAAB into Week 14
  // is a losing strategy.
  const urgency = weeksLeft <= 3 ? 1.5 : weeksLeft <= 6 ? 1.2 : 1;

  return Math.max(score >= 35 ? 1 : 0, Math.round(budgetLeft * share * urgency));
}

function describe(
  player: Player,
  lineupGain: number,
  need: number,
  trendingRank: number | null
): string {
  if (lineupGain >= 2) {
    return `Immediate starter — adds ${lineupGain.toFixed(1)} pts/wk to your best lineup.`;
  }
  if (player.status === "Q" || player.status === "D") {
    return `Upside play, but listed ${player.status === "Q" ? "questionable" : "doubtful"}.`;
  }
  if (trendingRank != null && trendingRank <= 15) {
    return `Top-${trendingRank} add across Sleeper in the last 24 hours.`;
  }
  if (need > 0.5) {
    return `You're thin at ${player.pos} — this is depth you actually need.`;
  }
  if (player.rosteredPct != null && player.rosteredPct < 25 && player.rosProj > 8) {
    return `Only ${player.rosteredPct.toFixed(0)}% rostered with real rest-of-season value.`;
  }
  if (lineupGain > 0) {
    return `Marginal upgrade — ${lineupGain.toFixed(1)} pts/wk if you need the slot.`;
  }
  return "Speculative stash if you have an open roster spot.";
}

export function rankWaiverTargets(league: League, team: Team, limit = 40): WaiverTarget[] {
  const pool = league.freeAgents;
  if (pool.length === 0) return [];

  const weeksLeft = Math.max(1, league.regularSeasonWeeks - league.currentWeek + 1);

  const trendingOrder = [...pool]
    .filter((p) => p.trendingAdds != null)
    .sort((a, b) => (b.trendingAdds ?? 0) - (a.trendingAdds ?? 0))
    .map((p) => p.id);

  // Replacement level is measured against every player in the league, rostered or not
  // — see replacementLevel. Measuring it against the free-agent pool alone would make
  // every startable unrostered quarterback look like a league-winning add.
  const universe = [
    ...pool,
    ...league.teams.flatMap((t) => t.roster.map((e) => e.player)),
  ];
  const replacement = new Map<Pos, number>();
  for (const pos of ["QB", "RB", "WR", "TE", "K", "DST"] as Pos[]) {
    replacement.set(pos, replacementLevel(universe, pos, league.teamCount));
  }

  const need = positionalNeed(league, team, replacement);

  // Shortlist on value over replacement, not raw points. Sorting by raw projection
  // would fill the list with quarterbacks, who simply score more than running backs
  // in any format, regardless of whether they are worth adding.
  const valueOver = (p: Player) => p.rosProj - (replacement.get(p.pos) ?? 0);
  const shortlist = [...pool].sort((a, b) => valueOver(b) - valueOver(a)).slice(0, limit * 3);

  const scored = shortlist.map((player) => {
    const vor = round1(valueOver(player));
    const lineupGain = marginalLineupGain(league, team, player);
    const posNeed = need.get(player.pos) ?? 0;
    const trendingIndex = trendingOrder.indexOf(player.id);
    const trendingRank = trendingIndex >= 0 ? trendingIndex + 1 : null;

    // Composite, each term capped so no single signal can dominate.
    const raw =
      46 * Math.min(1, lineupGain / 4) +
      28 * Math.min(1, Math.max(0, vor) / 6) +
      10 * posNeed +
      10 * (trendingRank != null ? Math.max(0, 1 - trendingRank / 60) : 0) +
      6 * (player.rosteredPct != null ? Math.max(0, 1 - player.rosteredPct / 60) : 0);

    return {
      player,
      score: Math.round(Math.min(100, raw)),
      lineupGain,
      valueOverReplacement: vor,
      suggestedBid: suggestBid(raw, team.faabLeft, weeksLeft),
      reason: describe(player, lineupGain, posNeed, trendingRank),
      dropSuggestion: null as Player | null,
    };
  });

  const drops = dropCandidates(league, team, 5);
  for (const target of scored) {
    // Suggest dropping the weakest player who isn't at a position we're already thin at.
    target.dropSuggestion =
      drops.find((d) => d.player.pos === target.player.pos)?.player ??
      drops[0]?.player ??
      null;
  }

  return scored.sort((a, b) => b.score - a.score).slice(0, limit);
}

/**
 * Who to cut. Weighted toward players who are neither in the optimal lineup nor a
 * meaningful piece of depth behind it.
 */
export function dropCandidates(league: League, team: Team, limit = 5): DropCandidate[] {
  const optimal = optimizeLineup(league.startingSlots, team.roster, (p) => p.rosProj);
  const startingIds = new Set(
    optimal.assignments.map((a) => a.player?.id).filter((id): id is string => Boolean(id))
  );

  // Rank each position's bench depth so we can tell a needed backup from a spare part.
  const depthRank = new Map<string, number>();
  const byPos = new Map<Pos, Player[]>();
  for (const entry of team.roster) {
    const list = byPos.get(entry.player.pos) ?? [];
    list.push(entry.player);
    byPos.set(entry.player.pos, list);
  }
  for (const list of byPos.values()) {
    list
      .sort((a, b) => b.rosProj - a.rosProj)
      .forEach((player, index) => depthRank.set(player.id, index + 1));
  }

  const candidates = team.roster
    .filter((e) => !startingIds.has(e.player.id) && e.slot !== "IR")
    .map((e) => {
      const player = e.player;
      const rank = depthRank.get(player.id) ?? 99;
      const isKickerOrDst = player.pos === "K" || player.pos === "DST";
      // Second kickers and defenses are almost always the correct cut.
      const surplus = isKickerOrDst && rank > 1;
      const score = player.rosProj - (surplus ? 20 : 0) - (player.status === "IR" ? 5 : 0);

      let reason: string;
      if (surplus) reason = `Second ${player.pos} on the roster — stream this slot instead.`;
      else if (player.status === "O" || player.status === "IR") {
        reason = "Out with no near-term return; the roster spot is worth more.";
      } else if (rank >= 4) reason = `${player.pos}${rank} on your depth chart with no path to snaps.`;
      else reason = `Lowest rest-of-season value outside your best lineup (${player.rosProj.toFixed(1)}/wk).`;

      return { player, reason, score };
    })
    .sort((a, b) => a.score - b.score)
    .slice(0, limit);

  return candidates.map(({ player, reason }) => ({ player, reason }));
}

/** Streaming picks for a single position — used for the weekly K/DST churn. */
export function bestStreamers(league: League, pos: Pos, limit = 5): Player[] {
  return league.freeAgents
    .filter((p) => p.pos === pos)
    .sort((a, b) => b.proj - a.proj)
    .slice(0, limit);
}

export function rosterIsFull(league: League, team: Team): boolean {
  const capacity = league.startingSlots.length + league.benchSlots;
  const active = team.roster.filter((e) => e.slot !== "IR").length;
  return active >= capacity;
}

export function startingSlotCount(league: League): number {
  return league.startingSlots.filter((s) => isStartingSlot(s)).length;
}
