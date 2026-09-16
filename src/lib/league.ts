// Builds the normalized `League` model from either provider, layering FantasyPros
// expert consensus on top as the projection and ranking source of record.

import { getConfig } from "./config";
import * as espn from "./providers/espn";
import * as fp from "./providers/fantasypros";
import * as sleeper from "./providers/sleeper";
import { getByeWeeks, getNflState, getWeekSchedule, opponentLabel } from "./nfl";
import type {
  League,
  Matchup,
  Player,
  Pos,
  RosterEntry,
  ScoringSettings,
  SlotId,
  Source,
  Team,
} from "./types";
import { isStartingSlot, startablePositions } from "./types";

export interface LeagueSummary {
  id: string;
  source: Source;
  providerId: string;
  name: string;
  teamCount: number;
  season: number;
}

/** Final week of the NFL regular season. */
const NFL_FINAL_WEEK = 18;

/**
 * NFL games a player still has left, which is what a FantasyPros rest-of-season total
 * is spread across.
 *
 * This is deliberately *not* the fantasy regular season: the ROS boards project every
 * remaining NFL game, so dividing by a 14-week fantasy season would overstate the
 * per-game rate by around 25% in Week 1. The player's bye is subtracted when it is
 * still ahead of them.
 */
function nflGamesRemaining(week: number, byeWeek: number | null): number {
  const weeksLeft = NFL_FINAL_WEEK - week + 1;
  const byeAhead = byeWeek != null && byeWeek >= week ? 1 : 0;
  return Math.max(1, weeksLeft - byeAhead);
}

interface Enrichment {
  weekly: fp.FpRankingSet;
  ros: Map<string, fp.FpRosRanking>;
  rosFallback: Map<string, fp.FpRosRanking>;
  byes: Map<string, number>;
  schedule: Awaited<ReturnType<typeof getWeekSchedule>>;
  trending: Map<string, number>;
  week: number;
  regularSeasonWeeks: number;
}

/**
 * Applies FantasyPros data to a partially-built player. Provider projections are kept
 * as the fallback for anyone off the FantasyPros boards (deep bench, practice squad),
 * since a missing player should read as low-projected rather than as zero.
 */
function enrich(
  base: Omit<Player, "proj" | "floor" | "ceil" | "rosProj" | "opponent" | "kickoff" | "kickoffMs">,
  fallbackProj: number | null,
  ctx: Enrichment
): Player {
  const key = fp.nameKey(base.name, base.pos, base.nflTeam);
  const fallbackKey = fp.fallbackNameKey(base.name, base.pos, base.nflTeam);
  const weekly =
    ctx.weekly.byKey.get(key) ??
    (fallbackKey ? ctx.weekly.byFallbackKey.get(fallbackKey) : undefined);
  const ros =
    ctx.ros.get(key) ?? (fallbackKey ? ctx.rosFallback.get(fallbackKey) : undefined);

  const game = base.nflTeam ? ctx.schedule.get(base.nflTeam) : undefined;
  const onBye = base.nflTeam != null && game == null;

  // A player on bye or ruled out scores nothing regardless of what a stale board says.
  const unavailable = onBye || base.status === "O" || base.status === "IR";

  // A player can sit on the board with no projected points at all — deep bench, or a
  // board that came back malformed. Zero is a claim, not a missing value, so fall back
  // to the provider's own number and derive the band from it rather than reporting 0.
  const fpProj = weekly?.proj ?? 0;
  const usingFp = fpProj > 0;
  const proj = unavailable ? 0 : usingFp ? fpProj : (fallbackProj ?? 0);
  const floor = unavailable ? 0 : usingFp ? (weekly?.floor ?? proj * 0.55) : proj * 0.55;
  const ceil = unavailable ? 0 : usingFp ? (weekly?.ceil ?? proj * 1.6) : proj * 1.6;

  const byeWeek =
    base.byeWeek ?? weekly?.byeWeek ?? (base.nflTeam ? ctx.byes.get(base.nflTeam) ?? null : null);
  const rosProj = ros ? ros.projTotal / nflGamesRemaining(ctx.week, byeWeek) : proj;

  return {
    ...base,
    byeWeek,
    rosteredPct: base.rosteredPct ?? weekly?.rosteredPct ?? null,
    trendingAdds: base.sleeperId ? ctx.trending.get(base.sleeperId) ?? null : null,
    opponent: onBye ? "BYE" : opponentLabel(base.nflTeam, game) ?? weekly?.opponent ?? null,
    kickoff: game?.kickoffLabel ?? null,
    kickoffMs: game?.kickoffMs ?? null,
    proj: round1(proj),
    floor: round1(floor),
    ceil: round1(ceil),
    rosProj: round1(rosProj),
  };
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

/**
 * FantasyPros serves one live board per position with no week in the URL, so what it
 * publishes can lag the week being advised on — most likely early in the week, before
 * the new boards go up. Stale consensus still beats no consensus, so the numbers are
 * used either way, but silently pinning last week's projections onto this week's
 * lineup is exactly the kind of wrong that looks right.
 */
function rankingsWeekWarning(weekly: fp.FpRankingSet, week: number): string | null {
  if (weekly.byKey.size === 0 || weekly.week === 0 || weekly.week === week) return null;
  return `FantasyPros is still publishing week ${weekly.week} rankings; week ${week} projections may be stale.`;
}

async function buildEnrichment(
  scoring: fp.FpScoring,
  season: number,
  week: number,
  regularSeasonWeeks: number
): Promise<Enrichment> {
  const [weekly, ros, byes, schedule, trending] = await Promise.all([
    fp.getRankings(scoring),
    fp.getRestOfSeasonRankings(scoring).catch(() => new Map<string, fp.FpRosRanking>()),
    getByeWeeks(season).catch(() => new Map<string, number>()),
    getWeekSchedule(season, week).catch(() => new Map()),
    sleeper.getTrendingAdds().catch(() => new Map<string, number>()),
  ]);
  // Second-chance index for the rest-of-season board, mirroring the weekly one.
  const rosFallback = new Map<string, fp.FpRosRanking>();
  for (const entry of ros.values()) {
    const key = fp.fallbackNameKey(entry.name, entry.pos, entry.team);
    if (key && !rosFallback.has(key)) rosFallback.set(key, entry);
  }

  return { weekly, ros, rosFallback, byes, schedule, trending, week, regularSeasonWeeks };
}

// ---------------------------------------------------------------------------
// Sleeper
// ---------------------------------------------------------------------------

export async function loadSleeperLeague(
  leagueId: string,
  username: string | null,
  week: number
): Promise<League> {
  const warnings: string[] = [];
  const raw = await sleeper.getLeague(leagueId);
  const season = Number(raw.season);

  const [rosters, users, matchups, dictionary] = await Promise.all([
    sleeper.getRosters(leagueId),
    sleeper.getLeagueUsers(leagueId),
    sleeper.getMatchups(leagueId, week).catch(() => []),
    sleeper.getPlayerDictionary(),
  ]);

  const seasonWeeks = raw.settings?.playoff_week_start
    ? raw.settings.playoff_week_start - 1
    : 14;
  // Sleeper exposes matchups a week at a time, so the full slate needs one call per
  // remaining week. They are small and cached, and they fan out in parallel.
  const futureWeeks = Array.from(
    { length: Math.max(0, seasonWeeks - week) },
    (_, i) => week + i + 1
  );
  const futureMatchups = await Promise.all(
    futureWeeks.map((w) =>
      sleeper
        .getMatchups(leagueId, w)
        .then((rows) => ({ week: w, rows }))
        .catch(() => ({ week: w, rows: [] as sleeper.SleeperMatchup[] }))
    )
  );

  const [weekProjections, weekStats, seasonStats] = await Promise.all([
    sleeper.getWeekProjections(season, week).catch(() => new Map<string, Record<string, number>>()),
    sleeper.getWeekStats(season, week).catch(() => new Map<string, Record<string, number>>()),
    sleeper.getSeasonStats(season).catch(() => new Map<string, Record<string, number>>()),
  ]);

  const ppr = raw.scoring_settings?.rec ?? 0;
  const regularSeasonWeeks = seasonWeeks;
  const ctx = await buildEnrichment(fp.scoringFor(ppr), season, week, regularSeasonWeeks);
  if (ctx.weekly.byKey.size === 0) {
    warnings.push("FantasyPros rankings unavailable; using Sleeper projections.");
  }
  const sleeperStale = rankingsWeekWarning(ctx.weekly, week);
  if (sleeperStale) warnings.push(sleeperStale);

  const startingSlots: SlotId[] = [];
  let benchSlots = 0;
  let irSlots = 0;
  for (const raw_slot of raw.roster_positions ?? []) {
    const slot = sleeper.mapSlot(raw_slot);
    if (!slot) continue;
    if (slot === "BN") benchSlots++;
    else if (slot === "IR") irSlots++;
    else startingSlots.push(slot);
  }

  const usersById = new Map(users.map((u) => [u.user_id, u]));
  const myUserId = username
    ? users.find((u) => u.display_name?.toLowerCase() === username.toLowerCase())?.user_id ?? null
    : null;

  const buildPlayer = (playerId: string): Player | null => {
    const info = dictionary[playerId];
    if (!info) return null;
    const pos = sleeper.resolvePosition(info);
    if (!pos) return null;

    const seasonLine = seasonStats.get(playerId);
    const games = seasonLine?.gp ?? 0;
    const seasonPoints = sleeper.scoreStatLine(seasonLine, raw.scoring_settings ?? {});

    return enrich(
      {
        id: `sleeper:${playerId}`,
        source: "sleeper",
        providerId: playerId,
        sleeperId: playerId,
        name: sleeper.playerName(info),
        pos,
        nflTeam: sleeper.playerTeam(info),
        status: sleeper.mapInjury(info.injury_status),
        byeWeek: null,
        rosteredPct: null,
        actual: weekStats.has(playerId)
          ? round1(sleeper.scoreStatLine(weekStats.get(playerId), raw.scoring_settings ?? {}))
          : null,
        seasonAvg: games > 0 ? round1(seasonPoints / games) : 0,
        trendingAdds: null,
      },
      sleeper.scoreStatLine(weekProjections.get(playerId), raw.scoring_settings ?? {}),
      ctx
    );
  };

  // A roster's `starters` array is a live scratchpad: when a starter is moved to IR or
  // dropped it leaves a hole, and it isn't the lineup locked for any particular week.
  // The week's own matchup row is authoritative, so prefer it and keep `starters` as
  // the fallback for weeks Sleeper hasn't opened yet.
  const weekStarters = new Map<number, string[]>();
  for (const row of matchups) {
    if (row.starters?.some((id) => id && id !== "0")) {
      weekStarters.set(row.roster_id, row.starters);
    }
  }

  const rosteredIds = new Set<string>();
  const teams: Team[] = rosters.map((roster) => {
    const user = roster.owner_id ? usersById.get(roster.owner_id) : undefined;
    const starters = weekStarters.get(roster.roster_id) ?? roster.starters ?? [];
    const reserve = new Set(roster.reserve ?? []);
    const all = roster.players ?? [];
    for (const id of all) rosteredIds.add(id);

    const entries: RosterEntry[] = [];
    // Sleeper's `starters` array is positional: index i fills startingSlots[i].
    starters.forEach((playerId, index) => {
      if (!playerId || playerId === "0") return;
      const player = buildPlayer(playerId);
      if (player) entries.push({ player, slot: startingSlots[index] ?? "FLEX" });
    });

    const startersSet = new Set(starters);
    for (const playerId of all) {
      if (startersSet.has(playerId)) continue;
      const player = buildPlayer(playerId);
      if (player) entries.push({ player, slot: reserve.has(playerId) ? "IR" : "BN" });
    }

    const s = roster.settings;
    const faabBudget = raw.settings?.waiver_budget ?? null;

    return {
      id: String(roster.roster_id),
      name: user?.metadata?.team_name || user?.display_name || `Team ${roster.roster_id}`,
      owner: user?.display_name ?? null,
      record: { wins: s?.wins ?? 0, losses: s?.losses ?? 0, ties: s?.ties ?? 0 },
      pf: (s?.fpts ?? 0) + (s?.fpts_decimal ?? 0) / 100,
      pa: (s?.fpts_against ?? 0) + (s?.fpts_against_decimal ?? 0) / 100,
      roster: entries,
      isMine: myUserId != null && roster.owner_id === myUserId,
      faabLeft: faabBudget != null ? faabBudget - (s?.waiver_budget_used ?? 0) : null,
    };
  });

  // Sleeper groups a week's matchups by a shared matchup_id.
  const pairUp = (rows: sleeper.SleeperMatchup[], forWeek: number): Matchup[] => {
    const byMatchupId = new Map<number, sleeper.SleeperMatchup[]>();
    for (const m of rows) {
      if (m.matchup_id == null) continue;
      const list = byMatchupId.get(m.matchup_id) ?? [];
      list.push(m);
      byMatchupId.set(m.matchup_id, list);
    }
    const out: Matchup[] = [];
    for (const pair of byMatchupId.values()) {
      if (pair.length !== 2) continue;
      const [home, away] = pair;
      out.push({
        week: forWeek,
        homeTeamId: String(home.roster_id),
        awayTeamId: String(away.roster_id),
        homeScore: home.points ?? 0,
        awayScore: away.points ?? 0,
        complete: forWeek < week,
      });
    }
    return out;
  };

  const normalizedMatchups = pairUp(matchups, week);
  const allMatchups: Matchup[] = [
    ...normalizedMatchups,
    ...futureMatchups.flatMap((entry) => pairUp(entry.rows, entry.week)),
  ];

  const freeAgents = buildFreeAgentPool(
    ctx,
    rosteredIds,
    dictionary,
    (playerId) => buildPlayer(playerId),
    startablePositions(startingSlots)
  );

  return {
    id: `sleeper:${leagueId}`,
    source: "sleeper",
    providerId: leagueId,
    name: raw.name,
    season,
    currentWeek: week,
    startingSlots,
    benchSlots,
    irSlots,
    teamCount: raw.total_rosters,
    scoring: {
      ppr,
      tePremium: raw.scoring_settings?.bonus_rec_te ?? 0,
      passTd: raw.scoring_settings?.pass_td ?? 4,
    },
    faabBudget: raw.settings?.waiver_budget ?? null,
    playoffTeams: raw.settings?.playoff_teams ?? 6,
    regularSeasonWeeks,
    myTeamId: teams.find((t) => t.isMine)?.id ?? null,
    teams,
    matchups: normalizedMatchups,
    allMatchups,
    freeAgents,
    warnings,
  };
}

/**
 * The waiver pool. Rather than walking Sleeper's entire 11k-player dictionary, we take
 * the FantasyPros boards — which are already ranked and already exclude irrelevant
 * players — and keep whoever isn't rostered.
 */
function buildFreeAgentPool(
  ctx: Enrichment,
  rosteredIds: Set<string>,
  dictionary: Record<string, sleeper.SleeperPlayer>,
  build: (playerId: string) => Player | null,
  startable: Set<Pos>
): Player[] {
  // Index the dictionary by our join key once so FantasyPros rows can find their
  // Sleeper id (and therefore their trending count and stats).
  const byKey = new Map<string, string>();
  for (const [playerId, info] of Object.entries(dictionary)) {
    const pos = sleeper.resolvePosition(info);
    if (!pos) continue;
    if (info.active === false && pos !== "DST") continue;
    const key = fp.nameKey(sleeper.playerName(info), pos, sleeper.playerTeam(info));
    if (!byKey.has(key)) byKey.set(key, playerId);
  }

  const pool: Player[] = [];
  for (const ranking of ctx.weekly.byKey.values()) {
    if (!startable.has(ranking.pos)) continue;
    const key = fp.nameKey(ranking.name, ranking.pos, ranking.team);
    const playerId = byKey.get(key);
    if (!playerId || rosteredIds.has(playerId)) continue;
    const player = build(playerId);
    if (player) pool.push(player);
  }
  return pool.sort((a, b) => b.rosProj - a.rosProj).slice(0, 200);
}

// ---------------------------------------------------------------------------
// ESPN
// ---------------------------------------------------------------------------

export async function loadEspnLeague(
  leagueId: string,
  credentials: espn.EspnCredentials | null,
  season: number,
  week: number
): Promise<League> {
  const warnings: string[] = [];
  const raw = await espn.getLeague(leagueId, season, week, credentials);

  const ppr = espn.pointsPerReception(raw);
  const { starters: startingSlots, bench: benchSlots, ir: irSlots } = espn.startingSlots(raw);
  const regularSeasonWeeks = raw.settings?.scheduleSettings?.matchupPeriodCount ?? 14;
  const ctx = await buildEnrichment(fp.scoringFor(ppr), season, week, regularSeasonWeeks);
  if (ctx.weekly.byKey.size === 0) warnings.push("FantasyPros rankings unavailable; using ESPN projections.");
  const espnStale = rankingsWeekWarning(ctx.weekly, week);
  if (espnStale) warnings.push(espnStale);

  const swid = credentials?.swid
    ? credentials.swid.startsWith("{")
      ? credentials.swid
      : `{${credentials.swid}}`
    : null;

  const memberNames = new Map((raw.members ?? []).map((m) => [m.id, m.displayName ?? m.firstName ?? null]));

  const buildPlayer = (player: espn.EspnPlayer): Player | null => {
    const pos = espn.mapPosition(player.defaultPositionId);
    if (!pos) return null;
    return enrich(
      {
        id: `espn:${player.id}`,
        source: "espn",
        providerId: String(player.id),
        sleeperId: null,
        name: player.fullName,
        pos,
        nflTeam: espn.proTeam(player.proTeamId),
        status: espn.mapInjury(player.injuryStatus),
        byeWeek: null,
        rosteredPct:
          player.ownership?.percentOwned != null
            ? Math.round(player.ownership.percentOwned * 10) / 10
            : null,
        actual: espn.weeklyActual(player, season, week),
        seasonAvg: round1(espn.seasonAverage(player, season) ?? 0),
        trendingAdds: null,
      },
      espn.weeklyProjection(player, season, week),
      ctx
    );
  };

  const teams: Team[] = (raw.teams ?? []).map((team) => {
    const entries: RosterEntry[] = [];
    for (const entry of team.roster?.entries ?? []) {
      const player = entry.playerPoolEntry?.player;
      if (!player) continue;
      const built = buildPlayer(player);
      if (!built) continue;
      entries.push({ player: built, slot: espn.mapLineupSlot(entry.lineupSlotId) ?? "BN" });
    }

    const overall = team.record?.overall;
    const budget = raw.settings?.acquisitionSettings?.acquisitionBudget ?? null;
    const owned = team.owners ?? (team.primaryOwner ? [team.primaryOwner] : []);

    return {
      id: String(team.id),
      name: espn.teamName(team),
      owner: owned.map((id) => memberNames.get(id)).find(Boolean) ?? null,
      record: {
        wins: overall?.wins ?? 0,
        losses: overall?.losses ?? 0,
        ties: overall?.ties ?? 0,
      },
      pf: overall?.pointsFor ?? 0,
      pa: overall?.pointsAgainst ?? 0,
      roster: entries,
      isMine: swid != null && owned.includes(swid),
      faabLeft:
        budget != null ? budget - (team.transactionCounter?.acquisitionBudgetSpent ?? 0) : null,
    };
  });

  // ESPN returns the whole regular season in one payload.
  const allMatchups: Matchup[] = (raw.schedule ?? [])
    .filter((item) => item.home && item.away && item.matchupPeriodId <= regularSeasonWeeks)
    .map((item) => ({
      week: item.matchupPeriodId,
      homeTeamId: String(item.home!.teamId),
      awayTeamId: String(item.away!.teamId),
      homeScore: item.home!.totalPoints ?? 0,
      awayScore: item.away!.totalPoints ?? 0,
      complete: Boolean(item.winner && item.winner !== "UNDECIDED"),
    }));
  const matchups = allMatchups.filter((m) => m.week === week);

  let freeAgents: Player[] = [];
  try {
    const pool = await espn.getFreeAgents(leagueId, season, week, credentials, 250);
    const startable = startablePositions(startingSlots);
    freeAgents = pool
      .map(buildPlayer)
      .filter((p): p is Player => p != null && startable.has(p.pos))
      .sort((a, b) => b.rosProj - a.rosProj);
  } catch {
    warnings.push("Could not load the ESPN free-agent pool.");
  }

  return {
    id: `espn:${leagueId}`,
    source: "espn",
    providerId: leagueId,
    name: raw.settings?.name ?? `ESPN League ${leagueId}`,
    season,
    currentWeek: week,
    startingSlots,
    benchSlots,
    irSlots,
    teamCount: raw.settings?.size ?? teams.length,
    scoring: { ppr, tePremium: 0, passTd: 4 },
    faabBudget: raw.settings?.acquisitionSettings?.isUsingAcquisitionBudget
      ? raw.settings.acquisitionSettings.acquisitionBudget ?? null
      : null,
    playoffTeams: raw.settings?.scheduleSettings?.playoffTeamCount ?? 6,
    regularSeasonWeeks,
    myTeamId: teams.find((t) => t.isMine)?.id ?? null,
    teams,
    matchups,
    allMatchups,
    warnings,
    freeAgents,
  };
}

// ---------------------------------------------------------------------------
// Discovery
// ---------------------------------------------------------------------------

/** Every league the configured accounts can see, without loading rosters. */
export async function listLeagues(): Promise<{
  leagues: LeagueSummary[];
  errors: string[];
}> {
  const config = getConfig();
  const { season: liveSeason } = await getNflState().catch(() => ({
    season: new Date().getFullYear(),
    week: 1,
  }));
  const season = config.seasonOverride ?? liveSeason;

  const leagues: LeagueSummary[] = [];
  const errors: string[] = [];

  if (config.sleeperUsername) {
    try {
      const user = await sleeper.getUser(config.sleeperUsername);
      const raw = await sleeper.getUserLeagues(user.user_id, season);
      for (const l of raw) {
        leagues.push({
          id: `sleeper:${l.league_id}`,
          source: "sleeper",
          providerId: l.league_id,
          name: l.name,
          teamCount: l.total_rosters,
          season: Number(l.season),
        });
      }
    } catch (err) {
      errors.push(`Sleeper: ${err instanceof Error ? err.message : "lookup failed"}`);
    }
  }

  for (const entry of config.espnLeagues) {
    try {
      const raw = await espn.getLeague(entry.leagueId, season, 1, config.espnCredentials);
      leagues.push({
        id: `espn:${entry.leagueId}`,
        source: "espn",
        providerId: entry.leagueId,
        name: entry.label ?? raw.settings?.name ?? `ESPN League ${entry.leagueId}`,
        teamCount: raw.settings?.size ?? raw.teams?.length ?? 0,
        season,
      });
    } catch (err) {
      const reason = espn.isAuthError(err)
        ? "authentication failed — check ESPN_SWID and ESPN_S2"
        : err instanceof Error
          ? err.message
          : "lookup failed";
      errors.push(`ESPN ${entry.leagueId}: ${reason}`);
    }
  }

  return { leagues, errors };
}

/** Loads one league by its prefixed id, e.g. `sleeper:123` or `espn:456`. */
export async function loadLeague(id: string, weekOverride?: number): Promise<League> {
  const config = getConfig();
  const state = await getNflState().catch(() => ({
    season: new Date().getFullYear(),
    week: 1,
  }));
  const season = config.seasonOverride ?? state.season;
  const week = weekOverride ?? state.week;

  const separator = id.indexOf(":");
  const source = id.slice(0, separator) as Source;
  const providerId = id.slice(separator + 1);

  if (source === "sleeper") {
    return loadSleeperLeague(providerId, config.sleeperUsername, week);
  }
  if (source === "espn") {
    return loadEspnLeague(providerId, config.espnCredentials, season, week);
  }
  throw new Error(`Unknown league source in "${id}"`);
}

/** Convenience accessors used across the analysis modules. */
export function myTeam(league: League): Team | null {
  return league.teams.find((t) => t.isMine) ?? null;
}

export function teamById(league: League, id: string | null): Team | null {
  if (!id) return null;
  return league.teams.find((t) => t.id === id) ?? null;
}

export function opponentOf(league: League, teamId: string | null): Team | null {
  if (!teamId) return null;
  const matchup = league.matchups.find(
    (m) => m.homeTeamId === teamId || m.awayTeamId === teamId
  );
  if (!matchup) return null;
  const oppId = matchup.homeTeamId === teamId ? matchup.awayTeamId : matchup.homeTeamId;
  return teamById(league, oppId);
}

export function starters(team: Team): RosterEntry[] {
  return team.roster.filter((e) => isStartingSlot(e.slot));
}

export function bench(team: Team): RosterEntry[] {
  return team.roster.filter((e) => !isStartingSlot(e.slot));
}

export function projectedTotal(entries: RosterEntry[]): number {
  return round1(entries.reduce((sum, e) => sum + e.player.proj, 0));
}

export type { Pos, ScoringSettings };
