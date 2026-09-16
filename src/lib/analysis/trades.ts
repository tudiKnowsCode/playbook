// Trade valuation and the trade finder.
//
// Trade value here is not a made-up points curve — it is rest-of-season points above
// replacement, so the numbers stay tied to the league's own scoring and roster shape.

import type { League, Player, Pos, RosterEntry, Team } from "../types";
import { optimizeLineup, replacementLevel } from "./optimizer";

export interface TradeValue {
  player: Player;
  /** Rest-of-season points above replacement across the remaining schedule. */
  value: number;
}

export interface TradeAnalysis {
  send: Player[];
  receive: Player[];
  sendValue: number;
  receiveValue: number;
  /** Positive means you gain value. */
  valueDelta: number;
  /** Change in your optimal weekly starting-lineup projection. */
  lineupDelta: number;
  verdict: "win" | "fair" | "loss";
  /** Plain-language read on the deal. */
  note: string;
  /** How the trade reshapes your starting lineup. */
  rosterImpact: string;
}

export interface TradeIdea {
  partner: Team;
  /** What the partner is short on. */
  partnerNeed: string;
  send: Player[];
  receive: Player[];
  /** Your weekly starting-lineup gain. */
  myGain: number;
  /** Their weekly starting-lineup gain — both sides must improve. */
  theirGain: number;
  summary: string;
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

function weeksLeft(league: League): number {
  return Math.max(1, league.regularSeasonWeeks - league.currentWeek + 1);
}

/**
 * A player's tradeable value: points above replacement, projected over the games that
 * remain. Scaled to a friendly 0-100ish range so the numbers read like the trade
 * calculators people are used to.
 */
export function valuePlayers(league: League, players: Player[]): Map<string, number> {
  const pool = [...league.freeAgents, ...league.teams.flatMap((t) => t.roster.map((e) => e.player))];
  const replacement = new Map<Pos, number>();
  for (const pos of ["QB", "RB", "WR", "TE", "K", "DST"] as Pos[]) {
    replacement.set(pos, replacementLevel(pool, pos, league.teamCount));
  }

  const remaining = weeksLeft(league);
  const values = new Map<string, number>();
  for (const player of players) {
    const perWeek = Math.max(0, player.rosProj - (replacement.get(player.pos) ?? 0));
    // /3 keeps a top-5 overall player around 50-60, which is the scale people expect.
    values.set(player.id, Math.round((perWeek * remaining) / 3));
  }
  return values;
}

/** Optimal weekly projection for a roster, using rest-of-season rates. */
function lineupStrength(league: League, roster: RosterEntry[]): number {
  const optimal = optimizeLineup(league.startingSlots, roster, (p) => p.rosProj);
  return optimal.assignments.reduce((sum, a) => sum + (a.player?.rosProj ?? 0), 0);
}

function applyTrade(roster: RosterEntry[], out: Player[], incoming: Player[]): RosterEntry[] {
  const outIds = new Set(out.map((p) => p.id));
  return [
    ...roster.filter((e) => !outIds.has(e.player.id)),
    ...incoming.map((player) => ({ player, slot: "BN" as const })),
  ];
}

function positionSummary(league: League, before: RosterEntry[], after: RosterEntry[]): string {
  const b = optimizeLineup(league.startingSlots, before, (p) => p.rosProj);
  const a = optimizeLineup(league.startingSlots, after, (p) => p.rosProj);

  const changes: string[] = [];
  a.assignments.forEach((slot, index) => {
    const previous = b.assignments[index]?.player;
    const next = slot.player;
    if (!next || !previous || previous.id === next.id) return;
    const delta = next.rosProj - previous.rosProj;
    if (Math.abs(delta) < 0.4) return;
    changes.push(
      `${slot.slotLabel} ${delta > 0 ? "upgraded" : "downgraded"} to ${next.name} (${
        delta > 0 ? "+" : ""
      }${delta.toFixed(1)}/wk)`
    );
  });

  return changes.length ? changes.slice(0, 3).join(" · ") : "Starting lineup is unchanged.";
}

export function analyzeTrade(
  league: League,
  team: Team,
  send: Player[],
  receive: Player[]
): TradeAnalysis {
  const values = valuePlayers(league, [...send, ...receive]);
  const sendValue = send.reduce((s, p) => s + (values.get(p.id) ?? 0), 0);
  const receiveValue = receive.reduce((s, p) => s + (values.get(p.id) ?? 0), 0);
  const valueDelta = receiveValue - sendValue;

  const after = applyTrade(team.roster, send, receive);
  const lineupDelta = round1(lineupStrength(league, after) - lineupStrength(league, team.roster));

  // Fairness is judged relative to the size of the deal — being 6 points apart on a
  // 20-point swap is lopsided; on a 150-point blockbuster it is noise.
  const scale = Math.max(12, (sendValue + receiveValue) / 2);
  const tolerance = Math.max(4, scale * 0.12);
  const verdict: TradeAnalysis["verdict"] =
    valueDelta > tolerance ? "win" : valueDelta < -tolerance ? "loss" : "fair";

  let note: string;
  if (send.length === 0 || receive.length === 0) {
    note = "Pick players on both sides to evaluate the deal.";
  } else if (verdict === "win") {
    note =
      lineupDelta > 0
        ? `Adds ${lineupDelta.toFixed(1)} pts/week to your starting lineup.`
        : "You gain rest-of-season value, though it doesn't change this week's lineup.";
  } else if (verdict === "fair") {
    note =
      lineupDelta > 0.5
        ? `Even on value, but it adds ${lineupDelta.toFixed(1)} pts/week to your lineup.`
        : "Roughly even on rest-of-season value — decide on roster fit.";
  } else {
    note =
      lineupDelta > 0.5
        ? `You give up value, but it still adds ${lineupDelta.toFixed(1)} pts/week to your starters.`
        : "Their side gains more rest-of-season value.";
  }

  return {
    send,
    receive,
    sendValue,
    receiveValue,
    valueDelta,
    lineupDelta,
    verdict,
    note,
    rosterImpact:
      send.length && receive.length
        ? positionSummary(league, team.roster, after)
        : "Select players to see the roster impact.",
  };
}

/**
 * What it costs the team to give a player up: the drop in their best possible lineup.
 * A backup behind an established starter costs nearly nothing; a locked-in starter with
 * no replacement costs a lot. Cheapest-to-lose first.
 */
function tradeableFrom(league: League, team: Team, limit: number): Player[] {
  const baseline = lineupStrength(league, team.roster);
  return team.roster
    .map((entry) => entry.player)
    .map((player) => ({
      player,
      cost:
        baseline -
        lineupStrength(
          league,
          team.roster.filter((e) => e.player.id !== player.id)
        ),
    }))
    // Among equally painless players, offer the one with the most value to the other
    // side — that is what makes an offer attractive rather than insulting.
    .sort((a, b) => a.cost - b.cost || b.player.rosProj - a.player.rosProj)
    .slice(0, limit)
    .map((entry) => entry.player);
}

/** Their players that would most improve our starting lineup. */
function targetsFrom(league: League, team: Team, partner: Team, limit: number): Player[] {
  const baseline = lineupStrength(league, team.roster);
  return partner.roster
    .map((entry) => entry.player)
    .map((player) => ({
      player,
      gain:
        lineupStrength(league, [...team.roster, { player, slot: "BN" as const }]) - baseline,
    }))
    .filter((entry) => entry.gain > 0)
    .sort((a, b) => b.gain - a.gain)
    .slice(0, limit)
    .map((entry) => entry.player);
}

/**
 * Describes what a team actually gains from a package, by position. Derived from the
 * lineup effect rather than from roster counts — carrying a single quarterback in a
 * one-quarterback league is correct construction, not a need.
 */
function needLabelFor(league: League, partner: Team, incoming: Player[]): string {
  const baseline = lineupStrength(league, partner.roster);
  const positions = new Map<Pos, number>();
  for (const player of incoming) {
    const gain =
      lineupStrength(league, [...partner.roster, { player, slot: "BN" as const }]) - baseline;
    positions.set(player.pos, Math.max(positions.get(player.pos) ?? 0, gain));
  }
  const helped = [...positions.entries()]
    .filter(([, gain]) => gain > 0.3)
    .sort((a, b) => b[1] - a[1])
    .map(([pos]) => pos);

  return helped.length ? `upgrades ${helped.slice(0, 2).join(", ")}` : "depth for depth";
}

/**
 * Looks for deals where both teams' optimal lineups improve. That mutual-gain test is
 * what makes an offer worth sending — a proposal only you like gets declined.
 *
 * Candidates on each side are chosen by lineup impact (what you can spare, what they
 * have that you want) rather than by positional heuristics, so this works the same in
 * superflex, two-quarterback and tight-end-premium formats.
 */
export function findTrades(league: League, team: Team, limit = 6): TradeIdea[] {
  const myBaseline = lineupStrength(league, team.roster);
  const myOffers = tradeableFrom(league, team, 5);
  const ideas: TradeIdea[] = [];

  for (const partner of league.teams) {
    if (partner.id === team.id) continue;

    const theirBaseline = lineupStrength(league, partner.roster);
    const theirOffers = targetsFrom(league, team, partner, 5);
    if (myOffers.length === 0 || theirOffers.length === 0) continue;

    // One-for-one and two-for-two only; larger packages rarely get accepted.
    const combos: Array<{ send: Player[]; receive: Player[] }> = [];
    for (const mine of myOffers) {
      for (const theirs of theirOffers) {
        combos.push({ send: [mine], receive: [theirs] });
        for (const mine2 of myOffers) {
          if (mine2.id <= mine.id) continue;
          for (const theirs2 of theirOffers) {
            if (theirs2.id <= theirs.id) continue;
            combos.push({ send: [mine, mine2], receive: [theirs, theirs2] });
          }
        }
      }
    }

    let best: TradeIdea | null = null;
    for (const combo of combos) {
      const myAfter = lineupStrength(league, applyTrade(team.roster, combo.send, combo.receive));
      const theirAfter = lineupStrength(
        league,
        applyTrade(partner.roster, combo.receive, combo.send)
      );
      const myGain = round1(myAfter - myBaseline);
      const theirGain = round1(theirAfter - theirBaseline);
      if (myGain <= 0.3 || theirGain <= 0.3) continue;

      // Prefer the deal that helps us most, using their gain to break ties — a deal
      // they clearly like is likelier to be accepted.
      if (!best || myGain > best.myGain || (myGain === best.myGain && theirGain > best.theirGain)) {
        best = {
          partner,
          partnerNeed: needLabelFor(league, partner, combo.send),
          send: combo.send,
          receive: combo.receive,
          myGain,
          theirGain,
          summary: `Send ${combo.send.map((p) => p.name).join(" + ")} for ${combo.receive
            .map((p) => p.name)
            .join(" + ")}`,
        };
      }
    }

    if (best) ideas.push(best);
  }

  return ideas.sort((a, b) => b.myGain - a.myGain).slice(0, limit);
}
