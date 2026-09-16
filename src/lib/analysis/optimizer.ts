// Optimal lineup selection.
//
// Filling a lineup is an assignment problem, not a sorting problem: a greedy pass
// ("best RB into RB1, best remaining into FLEX") is provably wrong whenever slots
// overlap, which they always do once a FLEX or SUPER_FLEX is in play. This solves it
// exactly with the Hungarian algorithm over a slots x players cost matrix.

import type { Player, RosterEntry, SlotId, Team } from "../types";
import { SLOT_ELIGIBILITY, isStartingSlot, slotLabel } from "../types";

/** Cost assigned to an ineligible pairing — large, but finite so the potentials work. */
const FORBIDDEN = 1e6;

/**
 * Minimum-cost assignment for a rectangular matrix (rows <= cols).
 * Returns `assignment[row] = column`, or -1 when a row went unassigned.
 * O(rows^2 * cols); the matrices here are at most ~12 x 25.
 */
function hungarian(cost: number[][]): number[] {
  const rows = cost.length;
  if (rows === 0) return [];
  const cols = cost[0].length;

  const u = new Array<number>(rows + 1).fill(0);
  const v = new Array<number>(cols + 1).fill(0);
  // parent[j] is the row currently matched to column j.
  const parent = new Array<number>(cols + 1).fill(0);
  const way = new Array<number>(cols + 1).fill(0);

  for (let i = 1; i <= rows; i++) {
    parent[0] = i;
    let j0 = 0;
    const minv = new Array<number>(cols + 1).fill(Infinity);
    const used = new Array<boolean>(cols + 1).fill(false);

    do {
      used[j0] = true;
      const i0 = parent[j0];
      let delta = Infinity;
      let j1 = 0;

      for (let j = 1; j <= cols; j++) {
        if (used[j]) continue;
        const cur = cost[i0 - 1][j - 1] - u[i0] - v[j];
        if (cur < minv[j]) {
          minv[j] = cur;
          way[j] = j0;
        }
        if (minv[j] < delta) {
          delta = minv[j];
          j1 = j;
        }
      }

      for (let j = 0; j <= cols; j++) {
        if (used[j]) {
          u[parent[j]] += delta;
          v[j] -= delta;
        } else {
          minv[j] -= delta;
        }
      }
      j0 = j1;
    } while (parent[j0] !== 0);

    do {
      const j1 = way[j0];
      parent[j0] = parent[j1];
      j0 = j1;
    } while (j0);
  }

  const assignment = new Array<number>(rows).fill(-1);
  for (let j = 1; j <= cols; j++) {
    if (parent[j] > 0) assignment[parent[j] - 1] = j - 1;
  }
  return assignment;
}

export function eligibleFor(slot: SlotId, player: Player): boolean {
  return SLOT_ELIGIBILITY[slot].includes(player.pos);
}

/** A player who cannot play this week should never be optimized into a starting slot. */
export function isPlayable(player: Player): boolean {
  return player.status !== "O" && player.status !== "IR" && player.opponent !== "BYE";
}

export interface LineupSlotAssignment {
  slot: SlotId;
  slotLabel: string;
  player: Player | null;
  /** The player currently in this slot, when different from the optimal one. */
  current: Player | null;
}

export interface OptimalLineup {
  assignments: LineupSlotAssignment[];
  /** Players left on the bench by the optimal lineup. */
  benched: Player[];
  projectedTotal: number;
}

/**
 * Best legal lineup from a full roster, scored on `value` (projection by default).
 */
export function optimizeLineup(
  slots: SlotId[],
  roster: RosterEntry[],
  value: (player: Player) => number = (p) => p.proj
): OptimalLineup {
  const candidates = roster.map((e) => e.player).filter(isPlayable);
  const currentBySlot = new Map<SlotId, Player[]>();
  for (const entry of roster) {
    if (!isStartingSlot(entry.slot)) continue;
    const list = currentBySlot.get(entry.slot) ?? [];
    list.push(entry.player);
    currentBySlot.set(entry.slot, list);
  }

  if (slots.length === 0) {
    return { assignments: [], benched: candidates, projectedTotal: 0 };
  }

  // Pad the player list so there are never fewer columns than rows; padded columns
  // represent leaving a slot empty, which costs nothing.
  const padded = candidates.length < slots.length ? slots.length : candidates.length;
  const cost: number[][] = slots.map((slot) =>
    Array.from({ length: padded }, (_, j) => {
      const player = candidates[j];
      if (!player) return 0;
      return eligibleFor(slot, player) ? -value(player) : FORBIDDEN;
    })
  );

  const assignment = hungarian(cost);
  const used = new Set<number>();
  const assignments: LineupSlotAssignment[] = slots.map((slot, i) => {
    const col = assignment[i];
    const player = col >= 0 && col < candidates.length ? candidates[col] : null;
    const eligible = player && eligibleFor(slot, player) ? player : null;
    if (eligible && col >= 0) used.add(col);
    return {
      slot,
      slotLabel: slotLabel(slot),
      player: eligible,
      current: null,
    };
  });

  // Pair each optimal slot with whoever currently occupies it, so the UI can render
  // "X replaces Y" without re-deriving the mapping.
  const remaining = new Map(currentBySlot);
  for (const item of assignments) {
    const list = remaining.get(item.slot);
    if (list?.length) item.current = list.shift() ?? null;
  }

  const benched = candidates.filter((_, i) => !used.has(i));
  const projectedTotal =
    Math.round(assignments.reduce((sum, a) => sum + (a.player ? a.player.proj : 0), 0) * 10) / 10;

  return { assignments, benched, projectedTotal };
}

export interface LineupSwap {
  slot: SlotId;
  slotLabel: string;
  /** The displaced starter, or null when the move fills an empty starting slot. */
  starter: Player | null;
  replacement: Player;
  /** Projected points gained by making this single move. */
  gain: number;
}

export interface LineupAdvice {
  optimal: OptimalLineup;
  currentTotal: number;
  optimalTotal: number;
  /** Total points the current lineup leaves on the bench. */
  pointsLeftOnBench: number;
  swaps: LineupSwap[];
}

/**
 * Compares the current lineup against the optimal one and expresses the difference as
 * a list of concrete moves — swaps, and additions into slots left empty.
 */
export function analyzeLineup(team: Team, slots: SlotId[]): LineupAdvice {
  const optimal = optimizeLineup(slots, team.roster);
  const currentStarters = team.roster.filter((e) => isStartingSlot(e.slot));
  const currentTotal =
    Math.round(currentStarters.reduce((sum, e) => sum + e.player.proj, 0) * 10) / 10;

  const optimalIds = new Set(
    optimal.assignments.map((a) => a.player?.id).filter((id): id is string => Boolean(id))
  );
  const currentIds = new Set(currentStarters.map((e) => e.player.id));

  // Players the optimizer wants in, and the ones it wants out, matched by slot.
  const incoming = optimal.assignments.filter(
    (a) => a.player && !currentIds.has(a.player.id)
  );
  const outgoing = currentStarters
    .filter((e) => !optimalIds.has(e.player.id))
    .sort((a, b) => a.player.proj - b.player.proj);

  const swaps: LineupSwap[] = [];
  for (const item of incoming) {
    if (!item.player) continue;
    // Prefer displacing someone from the same slot; otherwise take the weakest starter
    // the incoming player is eligible to replace.
    const index =
      outgoing.findIndex((e) => e.slot === item.slot) >= 0
        ? outgoing.findIndex((e) => e.slot === item.slot)
        : outgoing.findIndex((e) => eligibleFor(item.slot, e.player));
    // Nobody to displace means the slot is simply unfilled — an addition rather than a
    // swap. Skipping it here would drop the move and report a lineup with a hole in it
    // as already optimal.
    const dropped = index >= 0 ? outgoing.splice(index, 1)[0] : null;
    swaps.push({
      slot: item.slot,
      slotLabel: slotLabel(item.slot),
      starter: dropped?.player ?? null,
      replacement: item.player,
      gain: Math.round((item.player.proj - (dropped?.player.proj ?? 0)) * 10) / 10,
    });
  }

  swaps.sort((a, b) => b.gain - a.gain);

  return {
    optimal,
    currentTotal,
    optimalTotal: optimal.projectedTotal,
    pointsLeftOnBench: Math.round((optimal.projectedTotal - currentTotal) * 10) / 10,
    swaps,
  };
}

/**
 * The replacement-level projection at a position: what the best freely available player
 * there is worth, found by counting down past everyone the league would already have
 * rostered. Used to price waiver adds and trades in points, not vibes.
 *
 * `universe` must be EVERY player — rostered plus free agents. Passing only the free
 * agent pool counts down into the unrostered tail and collapses replacement level,
 * which massively overvalues positions that are deep in real life (most notably
 * quarterbacks in a one-quarterback league, where ~20 startable QBs go unrostered).
 */
export function replacementLevel(
  universe: Player[],
  pos: Player["pos"],
  teamCount: number
): number {
  const startersNeeded: Record<Player["pos"], number> = {
    QB: 1,
    RB: 2.5,
    WR: 3,
    TE: 1.2,
    K: 1,
    DST: 1,
  };
  const depth = Math.round(teamCount * startersNeeded[pos]);
  const ranked = universe
    .filter((p) => p.pos === pos)
    .sort((a, b) => b.rosProj - a.rosProj);
  return ranked[Math.min(depth, ranked.length - 1)]?.rosProj ?? 0;
}
