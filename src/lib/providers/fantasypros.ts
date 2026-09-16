// FantasyPros expert consensus rankings (ECR).
//
// Every rankings page embeds the full ranking set as a `var ecrData = {...}` literal
// in the HTML, which carries far more than the visible table: consensus rank, the
// min/max/std of the expert spread, projected points (`r2p_pts`), a start/sit letter
// grade, roster percentage and the week's opponent. We parse that object rather than
// scraping the rendered table.
//
// Pages are cached for 30 minutes; a full refresh is 7 requests per scoring format.

import { cachedResilient, MINUTE } from "../cache";
import { normalizeTeam } from "../nfl";
import type { Pos } from "../types";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

export type FpScoring = "STD" | "HALF" | "PPR";

/** URL prefix for the scoring format. QB/K/DST rankings are format-independent. */
const SCORING_PREFIX: Record<FpScoring, string> = {
  STD: "",
  HALF: "half-point-ppr-",
  PPR: "ppr-",
};

interface EcrPlayer {
  player_id: number;
  player_name: string;
  player_team_id: string | null;
  player_position_id: string;
  player_positions: string;
  player_bye_week: string | null;
  player_owned_avg: number | null;
  player_opponent: string | null;
  player_ecr_delta: number | null;
  rank_ecr: number;
  rank_min: string | null;
  rank_max: string | null;
  rank_ave: string | null;
  rank_std: string | null;
  pos_rank: string | null;
  start_sit_grade: string | null;
  r2p_pts: string | null;
  tag: string | null;
  note: string | null;
}

interface EcrData {
  /** Shipped as strings ("2", "2026"), despite looking numeric. */
  week: string | number;
  year: string | number;
  scoring: string;
  total_experts: number;
  last_updated: string;
  players: EcrPlayer[];
}

export interface FpRanking {
  fpId: number;
  name: string;
  pos: Pos;
  team: string | null;
  /** Consensus rank within the position. */
  posRank: number;
  /** Rank across all flex-eligible positions; null for QB/K/DST. */
  overallRank: number | null;
  /** How far apart the experts are — the basis for our floor/ceiling spread. */
  rankStd: number;
  bestRank: number;
  worstRank: number;
  /** FantasyPros projected points for the week. */
  proj: number;
  floor: number;
  ceil: number;
  /** Letter grade, e.g. "A+", "C-". */
  startSitGrade: string | null;
  /** Percent of leagues rostering the player, 0-100. */
  rosteredPct: number | null;
  byeWeek: number | null;
  /** e.g. "vs NO" / "@ KC", already normalized. */
  opponent: string | null;
  /** Week-over-week movement in consensus rank; positive means rising. */
  ecrDelta: number | null;
  note: string | null;
}

/**
 * Pulls the `ecrData` object out of a rankings page by brace-matching from the first
 * `{` after the declaration. A regex can't do this safely — the object contains
 * braces inside string values.
 */
function extractEcrData(html: string): EcrData | null {
  const declaration = html.indexOf("var ecrData");
  if (declaration < 0) return null;
  const start = html.indexOf("{", declaration);
  if (start < 0) return null;

  let depth = 0;
  let inString = false;
  let quote = "";
  let escaped = false;

  for (let i = start; i < html.length; i++) {
    const ch = html[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === quote) inString = false;
      continue;
    }
    if (ch === '"' || ch === "'") {
      inString = true;
      quote = ch;
      continue;
    }
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) {
        try {
          return JSON.parse(html.slice(start, i + 1)) as EcrData;
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

async function fetchPage(slug: string): Promise<EcrData | null> {
  return cachedResilient(`fp:page:${slug}`, 30 * MINUTE, async () => {
    const res = await fetch(`https://www.fantasypros.com/nfl/rankings/${slug}.php`, {
      headers: { "user-agent": UA, accept: "text/html" },
      cache: "no-store",
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) return null;
    return extractEcrData(await res.text());
  });
}

/**
 * Per-position coefficient of variation for weekly fantasy scoring. Used to turn a
 * point projection into a floor/ceiling band. These are the well-established shapes:
 * quarterbacks are the most predictable week to week, defenses by far the least.
 */
const POSITION_CV: Record<Pos, number> = {
  QB: 0.3,
  RB: 0.42,
  WR: 0.46,
  TE: 0.48,
  K: 0.38,
  DST: 0.58,
};

/**
 * Floor/ceiling as an ~80% interval around the projection. The width is the position's
 * baseline volatility, widened when the experts themselves disagree (a high rank_std
 * relative to the position's rank means a genuinely uncertain player). Scoring is
 * right-skewed — the ceiling gets more room than the floor.
 */
function band(proj: number, pos: Pos, rankStd: number, posRank: number): { floor: number; ceil: number } {
  const disagreement = Math.min(0.5, rankStd / Math.max(6, posRank * 0.75));
  const cv = POSITION_CV[pos] * (1 + disagreement);
  const sd = proj * cv;
  return {
    floor: Math.max(0, proj - 1.28 * sd),
    ceil: proj + 1.28 * sd * 1.12,
  };
}

/** "vs. NO" / "at KC" as FantasyPros writes it, normalized to our display form. */
function parseOpponent(raw: string | null): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed || trimmed === "BYE") return null;
  const away = /^(?:at|@)\s+(.+)$/i.exec(trimmed);
  if (away) return `@ ${normalizeTeam(away[1]) ?? away[1]}`;
  const home = /^vs\.?\s+(.+)$/i.exec(trimmed);
  if (home) return `vs ${normalizeTeam(home[1]) ?? home[1]}`;
  return trimmed;
}

function toPos(raw: string): Pos | null {
  const upper = raw.toUpperCase();
  if (upper === "DST" || upper === "DEF" || upper === "D/ST") return "DST";
  if (upper === "QB" || upper === "RB" || upper === "WR" || upper === "TE" || upper === "K") {
    return upper;
  }
  return null;
}

function num(raw: string | number | null | undefined): number | null {
  if (raw == null) return null;
  const value = typeof raw === "number" ? raw : Number.parseFloat(raw);
  return Number.isFinite(value) ? value : null;
}

/**
 * Nicknames FantasyPros uses where the providers carry the legal name. Only true
 * first-name substitutions belong here — shortenings like Gabe/Gabriel are handled
 * structurally by `fallbackNameKey`.
 */
const NICKNAMES: Record<string, string> = {
  "hollywood brown": "marquise brown",
  "bam knight": "zonovan knight",
  "chig okonkwo": "chigoziem okonkwo",
  "tank dell": "nathaniel dell",
  "scotty miller": "scott miller",
  "jr rutledge": "jaylen rutledge",
};

function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z ]/g, " ")
    .replace(/\s+(?:jr|sr|ii|iii|iv|v)(?=\s|$)/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * A stable join key for matching FantasyPros players against Sleeper and ESPN.
 * Strips punctuation, diacritics, generational suffixes and casing, then resolves
 * known nicknames — "Marvin Harrison Jr." and "Marvin Harrison" collapse together.
 */
export function nameKey(name: string, pos: Pos, team: string | null): string {
  // Team defenses are named inconsistently everywhere ("Ravens D/ST", "Baltimore
  // Ravens DST", "BAL"), so they join on team abbreviation alone.
  if (pos === "DST") return `DST|${team ?? ""}`;

  const cleaned = normalizeName(name);
  return `${pos}|${NICKNAMES[cleaned] ?? cleaned}`;
}

/**
 * A looser key used only when `nameKey` misses: position, first initial and last
 * name. This absorbs the common shortenings the two sides disagree on — Gabe vs
 * Gabriel Davis, Josh vs Joshua Palmer, Cam vs Cameron Akers — without needing an
 * entry per player. It is deliberately the second choice, since it can collide
 * (two "J. Smith" wide receivers), so callers must not overwrite a primary match.
 */
export function fallbackNameKey(name: string, pos: Pos, team: string | null): string | null {
  if (pos === "DST") return null;
  const cleaned = NICKNAMES[normalizeName(name)] ?? normalizeName(name);
  const parts = cleaned.split(" ").filter(Boolean);
  if (parts.length < 2) return null;
  const last = parts[parts.length - 1];
  return `${pos}|${parts[0][0]}|${last}|${team ?? ""}`;
}

export interface FpRankingSet {
  week: number;
  season: number;
  expertCount: number;
  lastUpdated: string | null;
  /** Keyed by `nameKey`. */
  byKey: Map<string, FpRanking>;
  /** Keyed by `fallbackNameKey`; consulted only when `byKey` misses. */
  byFallbackKey: Map<string, FpRanking>;
}

/**
 * Every position for one scoring format, plus the cross-position FLEX board that
 * supplies overall ranks.
 */
export async function getRankings(scoring: FpScoring): Promise<FpRankingSet> {
  const prefix = SCORING_PREFIX[scoring];
  const positions: Array<{ pos: Pos; slug: string }> = [
    { pos: "QB", slug: "qb" },
    { pos: "RB", slug: `${prefix}rb` },
    { pos: "WR", slug: `${prefix}wr` },
    { pos: "TE", slug: `${prefix}te` },
    { pos: "K", slug: "k" },
    { pos: "DST", slug: "dst" },
  ];

  const [pages, flexPage] = await Promise.all([
    Promise.all(positions.map((p) => fetchPage(p.slug).then((data) => ({ ...p, data })))),
    fetchPage(`${prefix}flex`),
  ]);

  // Overall (cross-position) rank for every flex-eligible player.
  const overallByKey = new Map<string, number>();
  for (const player of flexPage?.players ?? []) {
    const pos = toPos(player.player_position_id);
    if (!pos) continue;
    const key = nameKey(player.player_name, pos, normalizeTeam(player.player_team_id));
    if (!overallByKey.has(key)) overallByKey.set(key, player.rank_ecr);
  }

  const byKey = new Map<string, FpRanking>();
  const byFallbackKey = new Map<string, FpRanking>();
  let week = 0;
  let season = 0;
  let expertCount = 0;
  let lastUpdated: string | null = null;

  for (const { pos, data } of pages) {
    if (!data) continue;
    // Coerce: these arrive as strings, so `||` would let a "0" through (truthy) and
    // leave the field a string that compares unequal to any week number.
    const pageWeek = Number(data.week);
    const pageYear = Number(data.year);
    if (Number.isFinite(pageWeek) && pageWeek > 0) week = pageWeek;
    if (Number.isFinite(pageYear) && pageYear > 0) season = pageYear;
    expertCount = Math.max(expertCount, data.total_experts ?? 0);
    lastUpdated = data.last_updated ?? lastUpdated;

    for (const row of data.players) {
      const rowPos = toPos(row.player_position_id) ?? pos;
      const team = normalizeTeam(row.player_team_id);
      const key = nameKey(row.player_name, rowPos, team);
      if (byKey.has(key)) continue;

      const proj = num(row.r2p_pts) ?? 0;
      const rankStd = num(row.rank_std) ?? 0;
      const posRank = row.rank_ecr;
      const { floor, ceil } = band(proj, rowPos, rankStd, posRank);

      const ranking: FpRanking = {
        fpId: row.player_id,
        name: row.player_name,
        pos: rowPos,
        team,
        posRank,
        overallRank: overallByKey.get(key) ?? null,
        rankStd,
        bestRank: num(row.rank_min) ?? posRank,
        worstRank: num(row.rank_max) ?? posRank,
        proj,
        floor,
        ceil,
        startSitGrade: row.start_sit_grade,
        rosteredPct: row.player_owned_avg,
        byeWeek: num(row.player_bye_week),
        opponent: parseOpponent(row.player_opponent),
        ecrDelta: row.player_ecr_delta,
        note: row.note,
      };

      byKey.set(key, ranking);
      const fallback = fallbackNameKey(row.player_name, rowPos, team);
      // First writer wins: a looser key must never displace a better-ranked player.
      if (fallback && !byFallbackKey.has(fallback)) byFallbackKey.set(fallback, ranking);
    }
  }

  return { week, season, expertCount, lastUpdated, byKey, byFallbackKey };
}

/** Picks the rankings page matching a league's reception scoring. */
export function scoringFor(pointsPerReception: number): FpScoring {
  if (pointsPerReception >= 0.75) return "PPR";
  if (pointsPerReception >= 0.25) return "HALF";
  return "STD";
}

export interface FpRosRanking {
  name: string;
  pos: Pos;
  team: string | null;
  posRank: number;
  overallRank: number | null;
  /** Projected points for the whole remaining season, not per game. */
  projTotal: number;
}

/**
 * Rest-of-season rankings. Same page shape as the weekly boards, but `r2p_pts` is a
 * season total and there are no start/sit grades. Used for trade values, waiver
 * priority and playoff projections.
 */
export async function getRestOfSeasonRankings(
  scoring: FpScoring
): Promise<Map<string, FpRosRanking>> {
  const prefix = SCORING_PREFIX[scoring];
  const positions: Array<{ pos: Pos; slug: string }> = [
    { pos: "QB", slug: "ros-qb" },
    { pos: "RB", slug: `ros-${prefix}rb` },
    { pos: "WR", slug: `ros-${prefix}wr` },
    { pos: "TE", slug: `ros-${prefix}te` },
    { pos: "K", slug: "ros-k" },
    { pos: "DST", slug: "ros-dst" },
  ];

  const [pages, flexPage] = await Promise.all([
    Promise.all(positions.map((p) => fetchPage(p.slug).then((data) => ({ ...p, data })))),
    fetchPage(`ros-${prefix}flex`),
  ]);

  const overallByKey = new Map<string, number>();
  for (const player of flexPage?.players ?? []) {
    const pos = toPos(player.player_position_id);
    if (!pos) continue;
    const key = nameKey(player.player_name, pos, normalizeTeam(player.player_team_id));
    if (!overallByKey.has(key)) overallByKey.set(key, player.rank_ecr);
  }

  const out = new Map<string, FpRosRanking>();
  for (const { pos, data } of pages) {
    for (const row of data?.players ?? []) {
      const rowPos = toPos(row.player_position_id) ?? pos;
      const team = normalizeTeam(row.player_team_id);
      const key = nameKey(row.player_name, rowPos, team);
      if (out.has(key)) continue;
      out.set(key, {
        name: row.player_name,
        pos: rowPos,
        team,
        posRank: row.rank_ecr,
        overallRank: overallByKey.get(key) ?? null,
        projTotal: num(row.r2p_pts) ?? 0,
      });
    }
  }
  return out;
}
