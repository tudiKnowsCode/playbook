/**
 * End-to-end self test.  `npm run selftest`
 *
 * Checks the two things that can silently be wrong: the lineup optimizer (verified
 * against brute force, because a subtly broken assignment still returns a plausible
 * lineup) and the live upstream feeds (verified by actually calling them).
 *
 * With SLEEPER_USERNAME / ESPN_LEAGUES set in .env.local it also loads your real
 * leagues and prints a summary.
 */

import { analyzeLineup, optimizeLineup } from "../src/lib/analysis/optimizer";
import { getNflState, getWeekSchedule } from "../src/lib/nfl";
import {
  fallbackNameKey,
  getRankings,
  getRestOfSeasonRankings,
  nameKey,
} from "../src/lib/providers/fantasypros";
import {
  getPlayerDictionary,
  playerName,
  playerTeam,
  resolvePosition,
} from "../src/lib/providers/sleeper";
import { SLOT_ELIGIBILITY, type Player, type Pos, type SlotId, type Team } from "../src/lib/types";

let failures = 0;

function check(name: string, ok: boolean, detail = "") {
  const mark = ok ? "PASS" : "FAIL";
  if (!ok) failures++;
  console.log(`  [${mark}] ${name}${detail ? ` — ${detail}` : ""}`);
}

function section(title: string) {
  console.log(`\n${title}`);
}

// --- optimizer ------------------------------------------------------------

function fakePlayer(id: number, pos: Pos, proj: number): Player {
  return {
    id: `t:${id}`,
    source: "sleeper",
    providerId: String(id),
    sleeperId: String(id),
    name: `P${id}`,
    pos,
    nflTeam: "BAL",
    status: "ACTIVE",
    byeWeek: null,
    rosteredPct: null,
    opponent: "vs CLE",
    kickoff: "1:00",
    kickoffMs: null,
    proj,
    floor: proj * 0.6,
    ceil: proj * 1.5,
    actual: null,
    seasonAvg: proj,
    rosProj: proj,
    trendingAdds: null,
  };
}

function fakeTeam(roster: { player: Player; slot: SlotId }[]): Team {
  return {
    id: "t:me",
    name: "Test Team",
    owner: null,
    record: { wins: 0, losses: 0, ties: 0 },
    pf: 0,
    pa: 0,
    roster,
    isMine: true,
    faabLeft: null,
  };
}

/** Exhaustive best legal lineup, for comparison against the Hungarian solver. */
function bruteForce(slots: SlotId[], players: Player[]): number {
  let best = 0;
  const used = new Array<boolean>(players.length).fill(false);

  const walk = (slotIndex: number, total: number) => {
    if (slotIndex === slots.length) {
      best = Math.max(best, total);
      return;
    }
    // Leaving a slot empty is legal, so that branch is explored too.
    walk(slotIndex + 1, total);
    const slot = slots[slotIndex];
    for (let i = 0; i < players.length; i++) {
      if (used[i]) continue;
      if (!SLOT_ELIGIBILITY[slot].includes(players[i].pos)) continue;
      used[i] = true;
      walk(slotIndex + 1, total + players[i].proj);
      used[i] = false;
    }
  };

  walk(0, 0);
  return Math.round(best * 10) / 10;
}

function testOptimizer() {
  section("Lineup optimizer (vs brute force)");

  const positions: Pos[] = ["QB", "RB", "WR", "TE", "K", "DST"];
  const slotSets: SlotId[][] = [
    ["QB", "RB", "RB", "WR", "WR", "TE", "FLEX", "K", "DST"],
    ["QB", "RB", "RB", "WR", "WR", "WR", "TE", "FLEX", "FLEX", "SUPER_FLEX"],
    ["QB", "RB", "WR", "WR", "REC_FLEX", "TE"],
  ];

  let mismatches = 0;
  let trials = 0;

  // Deterministic pseudo-random so a failure is reproducible.
  let seed = 12345;
  const rand = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };

  for (const slots of slotSets) {
    for (let trial = 0; trial < 40; trial++) {
      const count = 10 + Math.floor(rand() * 5);
      const players = Array.from({ length: count }, (_, i) =>
        fakePlayer(i, positions[Math.floor(rand() * positions.length)], Math.round(rand() * 250) / 10)
      );
      const roster = players.map((player) => ({ player, slot: "BN" as SlotId }));

      const solved = optimizeLineup(slots, roster).projectedTotal;
      const optimal = bruteForce(slots, players);
      trials++;
      if (Math.abs(solved - optimal) > 0.05) {
        mismatches++;
        if (mismatches <= 3) {
          console.log(`      slots=${slots.join(",")} solver=${solved} brute=${optimal}`);
        }
      }
    }
  }

  check(`${trials} random rosters match the exhaustive optimum`, mismatches === 0,
    mismatches ? `${mismatches} mismatches` : "");

  // Overlapping slots are exactly where a greedy fill goes wrong: the best RB must go
  // to RB, not FLEX, even though FLEX is listed second.
  const tricky = [
    fakePlayer(1, "RB", 20),
    fakePlayer(2, "RB", 19),
    fakePlayer(3, "WR", 18),
  ];
  const result = optimizeLineup(
    ["RB", "FLEX"],
    tricky.map((player) => ({ player, slot: "BN" as SlotId }))
  );
  check("fills overlapping RB/FLEX slots optimally", result.projectedTotal === 39,
    `got ${result.projectedTotal}, want 39`);

  // A player who is out or on bye must never be optimized into a starting slot.
  const injured = fakePlayer(9, "RB", 30);
  injured.status = "O";
  const healthy = fakePlayer(10, "RB", 5);
  const safe = optimizeLineup(
    ["RB"],
    [injured, healthy].map((player) => ({ player, slot: "BN" as SlotId }))
  );
  check("never starts a player who is ruled out", safe.assignments[0]?.player?.id === healthy.id);

  // An unfilled starting slot is the case with no one to displace. The advice has to
  // survive that: the addition is the whole gain, and reporting zero moves would tell
  // you a lineup with a hole in it is already optimal.
  const vacancy = analyzeLineup(
    fakeTeam([
      { player: fakePlayer(11, "QB", 18), slot: "QB" },
      { player: fakePlayer(12, "RB", 12), slot: "RB" },
      { player: fakePlayer(13, "WR", 9), slot: "BN" },
    ]),
    ["QB", "RB", "WR"]
  );
  check(
    "fills an empty starting slot instead of reporting no moves",
    vacancy.swaps.length === 1 &&
      vacancy.swaps[0].starter === null &&
      vacancy.swaps[0].replacement.id === "t:13" &&
      vacancy.swaps[0].gain === 9,
    `${vacancy.swaps.length} move(s), ${vacancy.pointsLeftOnBench} pts on the bench`
  );
  check(
    "move gains add up to the points left on the bench",
    Math.abs(
      vacancy.swaps.reduce((sum, s) => sum + s.gain, 0) - vacancy.pointsLeftOnBench
    ) < 0.05
  );

  // The ordinary displacement case still reports its starter.
  const displaced = analyzeLineup(
    fakeTeam([
      { player: fakePlayer(14, "RB", 4), slot: "RB" },
      { player: fakePlayer(15, "RB", 17), slot: "BN" },
    ]),
    ["RB"]
  );
  check(
    "still names the displaced starter on a true swap",
    displaced.swaps.length === 1 &&
      displaced.swaps[0].starter?.id === "t:14" &&
      displaced.swaps[0].gain === 13
  );
}

// --- live feeds -----------------------------------------------------------

async function testFeeds() {
  section("Live data feeds");

  const state = await getNflState().catch(() => null);
  check("Sleeper NFL state", state != null && state.week >= 1 && state.season >= 2024,
    state ? `season ${state.season}, week ${state.week}` : "unreachable");

  // Sleeper's `display_week` lags `week` from the end of Monday night until the new
  // week opens — precisely when lineups get set. Following it would advise on the week
  // that just finished, so the state has to track `week`.
  const rawState = await fetch("https://api.sleeper.app/v1/state/nfl")
    .then((r) => r.json() as Promise<{ week?: number; display_week?: number }>)
    .catch(() => null);
  check(
    "NFL week follows the upcoming week, not display_week",
    state != null && rawState != null && state.week === Math.max(1, rawState.week ?? 1),
    rawState
      ? `app week ${state?.week}, sleeper week ${rawState.week}, display_week ${rawState.display_week}`
      : "state unreachable"
  );

  if (state) {
    const schedule = await getWeekSchedule(state.season, state.week).catch(() => new Map());
    check("NFL week schedule", schedule.size > 0, `${schedule.size} team entries`);
  }

  const rankings = await getRankings("HALF").catch(() => null);
  check("FantasyPros weekly ECR", rankings != null && rankings.byKey.size > 200,
    rankings ? `${rankings.byKey.size} players, week ${rankings.week}, ${rankings.expertCount} experts` : "unreachable");

  if (rankings) {
    // The rankings URL carries no week — FantasyPros serves whatever it has published.
    // A failure here means the boards lag the week being advised on, so the week's
    // projections are last week's. The dashboard warns in that case; the numbers are
    // still used, since stale consensus beats none.
    check(
      "weekly rankings are for the week being advised on",
      state != null && rankings.week === state.week,
      `rankings week ${rankings.week}, app week ${state?.week}`
    );

    const withProjections = [...rankings.byKey.values()].filter((r) => r.proj > 0).length;
    check("projections present", withProjections > 150, `${withProjections} players with r2p_pts`);

    const withOverall = [...rankings.byKey.values()].filter((r) => r.overallRank != null).length;
    check("cross-position FLEX ranks joined", withOverall > 100, `${withOverall} players`);

    const bandsOk = [...rankings.byKey.values()]
      .filter((r) => r.proj > 0)
      .every((r) => r.floor >= 0 && r.floor <= r.proj && r.ceil >= r.proj);
    check("floor <= proj <= ceil for every player", bandsOk);

    const sample = [...rankings.byKey.values()]
      .filter((r) => r.pos === "RB")
      .sort((a, b) => a.posRank - b.posRank)[0];
    if (sample) {
      console.log(
        `      top RB: ${sample.name} (${sample.team}) proj ${sample.proj}` +
          ` band ${sample.floor.toFixed(1)}-${sample.ceil.toFixed(1)} grade ${sample.startSitGrade}`
      );
    }
  }

  const ros = await getRestOfSeasonRankings("HALF").catch(() => null);
  check("FantasyPros rest-of-season ECR", ros != null && ros.size > 150,
    ros ? `${ros.size} players` : "unreachable");
}

// --- cross-provider name joining -----------------------------------------

/**
 * The enrichment step matches provider players to FantasyPros rows on a normalized
 * name key. If that join degrades, every projection silently falls back and the app
 * looks fine while being wrong — so the match rate is asserted, not assumed.
 */
async function testNameJoin() {
  section("Sleeper <-> FantasyPros name join");

  const [dictionary, rankings] = await Promise.all([
    getPlayerDictionary().catch(() => null),
    getRankings("HALF").catch(() => null),
  ]);

  if (!dictionary || !rankings) {
    check("both sources reachable", false);
    return;
  }
  check("Sleeper player dictionary", Object.keys(dictionary).length > 5000,
    `${Object.keys(dictionary).length} players`);

  const sleeperKeys = new Set<string>();
  const sleeperFallbackKeys = new Set<string>();
  for (const info of Object.values(dictionary)) {
    const pos = resolvePosition(info);
    if (!pos) continue;
    sleeperKeys.add(nameKey(playerName(info), pos, playerTeam(info)));
    const fallback = fallbackNameKey(playerName(info), pos, playerTeam(info));
    if (fallback) sleeperFallbackKeys.add(fallback);
  }

  // Only the fantasy-relevant top of each board matters; the deep tail is full of
  // camp bodies that no roster or waiver list will ever surface.
  const relevant = [...rankings.byKey.values()]
    .filter((r) => r.proj > 0)
    .sort((a, b) => (a.overallRank ?? 9999) - (b.overallRank ?? 9999))
    .slice(0, 300);

  const resolves = (r: { name: string; pos: typeof relevant[number]["pos"]; team: string | null }) => {
    if (sleeperKeys.has(nameKey(r.name, r.pos, r.team))) return true;
    const fallback = fallbackNameKey(r.name, r.pos, r.team);
    return fallback != null && sleeperFallbackKeys.has(fallback);
  };
  const missing = relevant.filter((r) => !resolves(r));
  const rate = (relevant.length - missing.length) / relevant.length;

  check("top-300 FantasyPros players resolve to a Sleeper id", rate >= 0.99,
    `${Math.round(rate * 1000) / 10}% matched (${missing.length} unmatched)`);

  for (const row of missing.slice(0, 8)) {
    console.log(`      unmatched: ${row.name} (${row.pos} ${row.team})`);
  }
}

// --- real leagues (only when configured) ----------------------------------

async function testLeagues() {
  section("Your leagues");

  if (!process.env.SLEEPER_USERNAME && !process.env.ESPN_LEAGUES) {
    console.log("  [SKIP] no SLEEPER_USERNAME or ESPN_LEAGUES set in .env.local");
    return;
  }

  const { getDashboard } = await import("../src/lib/insights");
  const result = await getDashboard();

  if ("error" in result) {
    check("dashboard loads", false, result.error);
    return;
  }

  check("dashboard loads", true,
    `${result.leagues.length} league(s), active: ${result.league.name}`);
  check("your team identified", result.me != null, result.me?.name ?? "not found");
  check("roster populated", (result.me?.roster.length ?? 0) > 0,
    `${result.me?.roster.length ?? 0} players`);
  check("projections attached", (result.me?.roster ?? []).some((e) => e.player.proj > 0));
  check("free-agent pool loaded", result.league.freeAgents.length > 0,
    `${result.league.freeAgents.length} players`);
  check("full season schedule", result.league.allMatchups.length > 0,
    `${result.league.allMatchups.length} matchups`);

  if (result.odds) {
    console.log(
      `      matchup: ${result.odds.myProjected} vs ${result.odds.oppProjected}` +
        ` — ${Math.round(result.odds.winProbability * 100)}% win`
    );
  }
  if (result.lineup) {
    console.log(
      `      lineup: ${result.lineup.currentTotal} now, ${result.lineup.optimalTotal} optimal` +
        ` (${result.lineup.swaps.length} move(s))`
    );
  }
  console.log(`      waiver targets: ${result.waivers.length}, trade ideas: ${result.tradeIdeas.length}`);
  for (const error of result.errors) console.log(`      warning: ${error}`);
}

async function main() {
  console.log("Playbook self test");
  testOptimizer();
  await testFeeds();
  await testNameJoin();
  await testLeagues();

  console.log(failures === 0 ? "\nAll checks passed.\n" : `\n${failures} check(s) failed.\n`);
  process.exit(failures === 0 ? 0 : 1);
}

void main();
