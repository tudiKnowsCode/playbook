"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { Dashboard } from "@/lib/insights";
import { COLORS, MONO } from "@/lib/theme";
import { ExposureView } from "./views/ExposureView";
import { LeagueView } from "./views/LeagueView";
import { LineupView } from "./views/LineupView";
import { MatchupView } from "./views/MatchupView";
import { TradesView } from "./views/TradesView";
import { WaiversView } from "./views/WaiversView";

export type ViewId = "matchup" | "exposure" | "lineup" | "waivers" | "trades" | "league";

const NAV: Array<{ id: ViewId; label: string; key: string }> = [
  { id: "matchup", label: "Matchup", key: "M" },
  { id: "exposure", label: "Exposure", key: "E" },
  { id: "lineup", label: "Lineup", key: "L" },
  { id: "waivers", label: "Waivers", key: "W" },
  { id: "trades", label: "Trades", key: "T" },
  { id: "league", label: "League", key: "G" },
];

const SHORTCUTS: Record<string, ViewId> = {
  m: "matchup",
  e: "exposure",
  l: "lineup",
  w: "waivers",
  t: "trades",
  g: "league",
};

function relativeTime(timestamp: number, now: number): string {
  const seconds = Math.max(0, Math.round((now - timestamp) / 1000));
  if (seconds < 45) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  return `${hours} hr ago`;
}

export function Playbook({ data }: { data: Dashboard }) {
  const router = useRouter();
  const [view, setView] = useState<ViewId>("matchup");
  const [leagueMenuOpen, setLeagueMenuOpen] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [now, setNow] = useState(data.syncedAt);
  const menuRef = useRef<HTMLDivElement>(null);

  // Keeps the "synced N min ago" label honest without re-rendering the whole tree
  // more than once a minute.
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      if (
        target &&
        (target.isContentEditable || /^(input|textarea|select)$/i.test(target.tagName))
      ) {
        return;
      }
      const next = SHORTCUTS[event.key.toLowerCase()];
      if (next) {
        event.preventDefault();
        setView(next);
      }
      if (event.key === "Escape") setLeagueMenuOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (!leagueMenuOpen) return;
    const onClick = (event: MouseEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setLeagueMenuOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [leagueMenuOpen]);

  const resync = useCallback(async () => {
    setSyncing(true);
    try {
      await fetch("/api/sync", { method: "POST" });
      router.refresh();
    } finally {
      setSyncing(false);
    }
  }, [router]);

  const switchLeague = useCallback(
    (leagueId: string) => {
      setLeagueMenuOpen(false);
      router.push(`/?league=${encodeURIComponent(leagueId)}`);
    },
    [router]
  );

  const badges = useMemo(
    () => ({
      lineup: data.lineup && data.lineup.swaps.length > 0 ? String(data.lineup.swaps.length) : null,
      waivers: data.waivers.length > 0 ? String(Math.min(data.waivers.length, 99)) : null,
      trades: data.tradeIdeas.length > 0 ? String(data.tradeIdeas.length) : null,
    }),
    [data.lineup, data.waivers.length, data.tradeIdeas.length]
  );

  const sourceLabel = data.league.source === "espn" ? "ESPN" : "SLEEPER";

  return (
    <div
      style={{
        minHeight: "100vh",
        background: COLORS.bg,
        color: COLORS.text,
        display: "flex",
        flexDirection: "column",
      }}
    >
      <header
        className="pb-header"
        style={{
          display: "flex",
          alignItems: "center",
          gap: 24,
          padding: "0 22px",
          height: 60,
          borderBottom: `1px solid ${COLORS.borderSoft}`,
          background: COLORS.header,
          position: "sticky",
          top: 0,
          zIndex: 20,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div
            style={{
              width: 26,
              height: 26,
              borderRadius: 6,
              background: COLORS.mint,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: COLORS.bg,
              fontWeight: 800,
              fontSize: 14,
              letterSpacing: "-0.04em",
            }}
          >
            P
          </div>
          <span
            className="pb-wordmark"
            style={{
              fontWeight: 800,
              fontSize: 15,
              letterSpacing: "0.14em",
              textTransform: "uppercase",
            }}
          >
            Playbook
          </span>
        </div>

        <div ref={menuRef} style={{ position: "relative" }}>
          <button
            type="button"
            onClick={() => setLeagueMenuOpen((open) => !open)}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              padding: "5px 6px 5px 10px",
              border: `1px solid ${COLORS.borderStrong}`,
              borderRadius: 8,
              background: COLORS.panelAlt,
              color: COLORS.text,
              cursor: "pointer",
            }}
          >
            <span
              style={{ width: 6, height: 6, borderRadius: "50%", background: COLORS.mint }}
            />
            <span className="pb-league-name" style={{ fontSize: 12.5, fontWeight: 600 }}>
              {data.league.name}
            </span>
            <span
              className="pb-league-source"
              style={{
                fontFamily: MONO,
                fontSize: 10.5,
                color: COLORS.dim,
                padding: "2px 5px",
                borderRadius: 4,
                background: "rgba(255,255,255,0.06)",
              }}
            >
              {sourceLabel}
            </span>
            <span style={{ color: COLORS.dim, fontSize: 11, padding: "0 4px" }}>▾</span>
          </button>

          {leagueMenuOpen && (
            <div
              style={{
                position: "absolute",
                top: "calc(100% + 6px)",
                left: 0,
                minWidth: 260,
                background: COLORS.panel,
                border: `1px solid ${COLORS.border}`,
                borderRadius: 10,
                padding: 6,
                boxShadow: "0 18px 40px rgba(0,0,0,0.55)",
                zIndex: 30,
              }}
            >
              {data.leagues.map((league) => {
                const active = league.id === data.league.id;
                return (
                  <button
                    key={league.id}
                    type="button"
                    onClick={() => switchLeague(league.id)}
                    className="pb-nav-btn"
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 9,
                      width: "100%",
                      textAlign: "left",
                      padding: "8px 10px",
                      borderRadius: 7,
                      border: "1px solid transparent",
                      background: active ? COLORS.active : "transparent",
                      color: active ? COLORS.text : COLORS.dimAlt,
                      cursor: "pointer",
                      fontSize: 13,
                      fontWeight: 600,
                    }}
                  >
                    <span style={{ flex: 1, minWidth: 0 }}>{league.name}</span>
                    <span style={{ fontFamily: MONO, fontSize: 10, color: COLORS.dim }}>
                      {league.source === "espn" ? "ESPN" : "SLEEPER"}
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 2,
            marginLeft: "auto",
            fontFamily: MONO,
            fontSize: 11.5,
            color: COLORS.dim,
          }}
        >
          <span>Week</span>
          <span style={{ color: COLORS.text, fontWeight: 600, padding: "0 6px" }}>
            {data.league.currentWeek}
          </span>
          <span className="pb-synced" style={{ color: COLORS.faint }}>
            ·
          </span>
          <span className="pb-synced" style={{ paddingLeft: 6 }}>
            synced {relativeTime(data.syncedAt, now)}
          </span>
        </div>

        <button
          type="button"
          onClick={resync}
          disabled={syncing}
          className="pb-ghost-btn"
          style={{
            fontFamily: MONO,
            fontSize: 11,
            letterSpacing: "0.06em",
            textTransform: "uppercase",
            color: COLORS.text2,
            background: COLORS.panelAlt,
            border: `1px solid ${COLORS.borderStrong}`,
            borderRadius: 7,
            padding: "7px 11px",
            cursor: syncing ? "default" : "pointer",
            opacity: syncing ? 0.6 : 1,
          }}
        >
          {syncing ? "Syncing…" : "Sync"}
        </button>
      </header>

      {/* The sidebar is hidden below 900px, so navigation moves into a scrollable strip
          pinned directly under the header. Without it a phone is stuck on one view. */}
      <nav
        className="pb-mobile-nav"
        style={{
          alignItems: "center",
          gap: 6,
          padding: "8px 12px",
          overflowX: "auto",
          borderBottom: `1px solid ${COLORS.borderSoft}`,
          background: COLORS.header,
          position: "sticky",
          top: 60,
          zIndex: 19,
        }}
      >
        {NAV.map((item) => {
          const active = view === item.id;
          const badge = badges[item.id as keyof typeof badges] ?? null;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => setView(item.id)}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                flex: "none",
                padding: "9px 13px",
                borderRadius: 8,
                border: `1px solid ${active ? COLORS.mintBorderSoft : "transparent"}`,
                background: active ? COLORS.active : "transparent",
                color: active ? COLORS.text : COLORS.dimAlt,
                fontSize: 13,
                fontWeight: 600,
                cursor: "pointer",
                whiteSpace: "nowrap",
              }}
            >
              {item.label}
              {badge && (
                <span
                  style={{
                    fontFamily: MONO,
                    fontSize: 10,
                    fontWeight: 600,
                    background: COLORS.mintTint,
                    color: COLORS.mint,
                    padding: "2px 6px",
                    borderRadius: 5,
                  }}
                >
                  {badge}
                </span>
              )}
            </button>
          );
        })}
      </nav>

      <div style={{ display: "flex", flex: 1, minHeight: 0 }}>
        <nav
          className="pb-sidebar"
          style={{
            width: 196,
            flex: "none",
            borderRight: `1px solid ${COLORS.borderSoft}`,
            padding: "16px 12px",
            display: "flex",
            flexDirection: "column",
            gap: 3,
            background: COLORS.header,
          }}
        >
          {NAV.map((item) => {
            const active = view === item.id;
            const badge = badges[item.id as keyof typeof badges] ?? null;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setView(item.id)}
                className="pb-nav-btn"
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  width: "100%",
                  textAlign: "left",
                  padding: "9px 11px",
                  borderRadius: 8,
                  border: "1px solid transparent",
                  cursor: "pointer",
                  fontSize: 13.5,
                  fontWeight: 600,
                  background: active ? COLORS.active : "transparent",
                  color: active ? COLORS.text : COLORS.dimAlt,
                }}
              >
                <span
                  style={{
                    fontFamily: MONO,
                    fontSize: 10,
                    color: active ? COLORS.mint : COLORS.dim,
                    width: 14,
                  }}
                >
                  {item.key}
                </span>
                {item.label}
                {badge && (
                  <span
                    style={{
                      marginLeft: "auto",
                      fontFamily: MONO,
                      fontSize: 10,
                      fontWeight: 600,
                      background: COLORS.mintTint,
                      color: COLORS.mint,
                      padding: "2px 6px",
                      borderRadius: 5,
                    }}
                  >
                    {badge}
                  </span>
                )}
              </button>
            );
          })}

          <div
            style={{
              marginTop: "auto",
              padding: "12px 11px",
              borderTop: `1px solid ${COLORS.borderSoft}`,
            }}
          >
            <div
              style={{
                fontFamily: MONO,
                fontSize: 10,
                letterSpacing: "0.1em",
                textTransform: "uppercase",
                color: COLORS.dim,
                marginBottom: 9,
              }}
            >
              Connected
            </div>
            {data.connections.map((connection) => (
              <div
                key={connection.name}
                style={{ display: "flex", alignItems: "center", gap: 8, padding: "5px 0" }}
              >
                <span
                  style={{
                    width: 5,
                    height: 5,
                    borderRadius: "50%",
                    background: connection.ok ? COLORS.mint : COLORS.red,
                  }}
                />
                <span style={{ fontSize: 12, fontWeight: 600, color: COLORS.text2 }}>
                  {connection.name}
                </span>
                <span
                  style={{
                    marginLeft: "auto",
                    fontFamily: MONO,
                    fontSize: 10,
                    color: COLORS.dim,
                  }}
                >
                  {connection.leagueCount} {connection.leagueCount === 1 ? "league" : "leagues"}
                </span>
              </div>
            ))}
          </div>
        </nav>

        <main
          className="pb-main"
          style={{
            flex: 1,
            minWidth: 0,
            padding: "24px 26px 60px",
            display: "flex",
            flexDirection: "column",
            gap: 20,
          }}
        >
          {data.errors.length > 0 && (
            <div
              style={{
                border: `1px solid ${COLORS.amberBorder}`,
                background: COLORS.amberTint,
                borderRadius: 10,
                padding: "10px 13px",
                fontSize: 12.5,
                color: COLORS.amber,
                lineHeight: 1.5,
              }}
            >
              {data.errors.map((error, index) => (
                <div key={index}>{error}</div>
              ))}
            </div>
          )}

          {view === "matchup" && <MatchupView data={data} onNavigate={setView} />}
          {view === "exposure" && <ExposureView data={data} />}
          {view === "lineup" && <LineupView data={data} />}
          {view === "waivers" && <WaiversView data={data} />}
          {view === "trades" && <TradesView data={data} />}
          {view === "league" && <LeagueView data={data} />}
        </main>
      </div>
    </div>
  );
}
