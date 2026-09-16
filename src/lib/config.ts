import type { EspnCredentials } from "./providers/espn";

export interface EspnLeagueConfig {
  leagueId: string;
  /** Optional friendly override; otherwise ESPN's own league name is used. */
  label?: string;
}

export interface AppConfig {
  sleeperUsername: string | null;
  espnCredentials: EspnCredentials | null;
  espnLeagues: EspnLeagueConfig[];
  /** Forces a season; otherwise the live NFL season is used. */
  seasonOverride: number | null;
}

/**
 * `ESPN_LEAGUES` accepts either a bare comma-separated list of league ids
 * (`12345,67890`) or `id:Label` pairs (`12345:Office League`).
 */
function parseEspnLeagues(raw: string | undefined): EspnLeagueConfig[] {
  if (!raw?.trim()) return [];
  return raw
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const [leagueId, ...label] = entry.split(":");
      return { leagueId: leagueId.trim(), label: label.join(":").trim() || undefined };
    })
    .filter((l) => /^\d+$/.test(l.leagueId));
}

export function getConfig(): AppConfig {
  const swid = process.env.ESPN_SWID?.trim();
  const espnS2 = process.env.ESPN_S2?.trim();
  const season = process.env.FANTASY_SEASON?.trim();

  return {
    sleeperUsername: process.env.SLEEPER_USERNAME?.trim() || null,
    espnCredentials: swid && espnS2 ? { swid, espnS2 } : null,
    espnLeagues: parseEspnLeagues(process.env.ESPN_LEAGUES),
    seasonOverride: season && /^\d{4}$/.test(season) ? Number(season) : null,
  };
}

export function isConfigured(config: AppConfig): boolean {
  return Boolean(config.sleeperUsername) || config.espnLeagues.length > 0;
}
