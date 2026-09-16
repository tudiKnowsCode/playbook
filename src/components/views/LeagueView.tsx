"use client";

import type { Dashboard } from "@/lib/insights";
import { COLORS, MONO } from "@/lib/theme";
import { Card, EmptyState, PageHeading, Truncate, formatRecord } from "../ui";

const GRID = "30px minmax(0,1.7fr) 62px 78px 78px 80px minmax(0,1fr) 78px";

export function LeagueView({ data }: { data: Dashboard }) {
  const { standings, league } = data;
  const topPower = Math.max(1, ...standings.map((row) => row.powerScore));

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      <PageHeading eyebrow={league.name} title="Standings & power rankings" />

      <Card style={{ overflow: "hidden" }}>
        <div className="pb-scroll-x">
          <div style={{ minWidth: 820 }}>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: GRID,
                gap: 12,
                alignItems: "center",
                padding: "12px 18px",
                fontFamily: MONO,
                fontSize: 10,
                letterSpacing: "0.1em",
                textTransform: "uppercase",
                color: COLORS.dim,
                background: COLORS.panelAlt,
              }}
            >
              <div>#</div>
              <div>Team</div>
              <div style={{ textAlign: "right" }}>Rec</div>
              <div style={{ textAlign: "right" }}>PF</div>
              <div style={{ textAlign: "right" }}>PA</div>
              <div style={{ textAlign: "right" }}>Power</div>
              <div>Trend</div>
              <div style={{ textAlign: "right" }}>Playoff</div>
            </div>

            {standings.map((row) => {
              const trendColor =
                row.powerTrend > 0
                  ? COLORS.mint
                  : row.powerTrend === 0
                    ? COLORS.dim
                    : COLORS.red;
              const oddsPct = Math.round(row.playoffOdds * 100);
              return (
                <div
                  key={row.team.id}
                  style={{
                    display: "grid",
                    gridTemplateColumns: GRID,
                    gap: 12,
                    alignItems: "center",
                    padding: "11px 18px",
                    borderTop: `1px solid ${COLORS.borderFaint}`,
                    background: row.isMine ? "rgba(126,242,176,0.06)" : "transparent",
                  }}
                >
                  <div style={{ fontFamily: MONO, fontSize: 12, color: COLORS.dim }}>
                    {row.rank}
                  </div>
                  <div style={{ minWidth: 0, display: "flex", alignItems: "center", gap: 8 }}>
                    <Truncate
                      style={{
                        fontSize: 13.5,
                        fontWeight: 600,
                        color: row.isMine ? COLORS.mint : COLORS.text,
                      }}
                    >
                      {row.team.name}
                    </Truncate>
                    {row.isMine && (
                      <span
                        style={{
                          fontFamily: MONO,
                          fontSize: 9.5,
                          fontWeight: 600,
                          color: COLORS.bg,
                          background: COLORS.mint,
                          borderRadius: 4,
                          padding: "2px 5px",
                          flex: "none",
                        }}
                      >
                        YOU
                      </span>
                    )}
                  </div>
                  <div
                    style={{
                      textAlign: "right",
                      fontFamily: MONO,
                      fontSize: 12.5,
                      color: COLORS.text2,
                    }}
                  >
                    {formatRecord(row.team.record)}
                  </div>
                  <div
                    style={{
                      textAlign: "right",
                      fontFamily: MONO,
                      fontSize: 12.5,
                      color: COLORS.text2,
                    }}
                  >
                    {row.team.pf.toFixed(1)}
                  </div>
                  <div
                    style={{
                      textAlign: "right",
                      fontFamily: MONO,
                      fontSize: 12.5,
                      color: COLORS.dim,
                    }}
                  >
                    {row.team.pa.toFixed(1)}
                  </div>
                  <div
                    style={{
                      textAlign: "right",
                      fontFamily: MONO,
                      fontSize: 13,
                      fontWeight: 600,
                      color: COLORS.text,
                    }}
                  >
                    {row.powerScore.toFixed(1)}
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span
                      style={{
                        flex: 1,
                        height: 4,
                        borderRadius: 2,
                        background: COLORS.track,
                        overflow: "hidden",
                        display: "flex",
                      }}
                    >
                      <span
                        style={{
                          background: trendColor,
                          width: `${Math.round((row.powerScore / topPower) * 100)}%`,
                        }}
                      />
                    </span>
                    <span
                      style={{
                        fontFamily: MONO,
                        fontSize: 11,
                        color: trendColor,
                        width: 34,
                        textAlign: "right",
                      }}
                    >
                      {row.powerTrend === 0
                        ? "—"
                        : `${row.powerTrend > 0 ? "+" : ""}${row.powerTrend}`}
                    </span>
                  </div>
                  <div
                    style={{
                      textAlign: "right",
                      fontFamily: MONO,
                      fontSize: 12.5,
                      color: oddsPct >= 70 ? COLORS.mint : oddsPct >= 30 ? COLORS.text : COLORS.dim,
                    }}
                  >
                    {oddsPct}%
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </Card>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit,minmax(260px,1fr))",
          gap: 18,
        }}
      >
        <Card style={{ padding: "16px 18px" }}>
          <h2 style={{ margin: "0 0 12px", fontSize: 14.5, fontWeight: 700 }}>Rest of week</h2>
          {data.otherGames.length === 0 ? (
            <EmptyState>No other games this week.</EmptyState>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
              {data.otherGames.map((game, index) => (
                <div
                  key={index}
                  style={{
                    display: "grid",
                    gridTemplateColumns: "minmax(0,1fr) auto minmax(0,1fr)",
                    gap: 10,
                    alignItems: "center",
                    padding: "9px 0",
                    borderBottom: `1px solid ${COLORS.borderFaint}`,
                  }}
                >
                  <Truncate style={{ fontSize: 12.5, fontWeight: 600 }}>
                    {game.home.name}
                  </Truncate>
                  <span style={{ fontFamily: MONO, fontSize: 11, color: COLORS.dim }}>
                    {game.line >= 0 ? `-${game.line.toFixed(1)}` : `+${(-game.line).toFixed(1)}`}
                  </span>
                  <Truncate
                    style={{
                      fontSize: 12.5,
                      fontWeight: 600,
                      textAlign: "right",
                      color: COLORS.dim,
                    }}
                  >
                    {game.away.name}
                  </Truncate>
                </div>
              ))}
            </div>
          )}
        </Card>

        <Card style={{ padding: "16px 18px" }}>
          <h2 style={{ margin: "0 0 12px", fontSize: 14.5, fontWeight: 700 }}>Connections</h2>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {data.connections.map((connection) => (
              <div
                key={connection.name}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 12,
                  padding: 12,
                  borderRadius: 10,
                  background: COLORS.raised,
                  border: "1px solid rgba(255,255,255,0.06)",
                }}
              >
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 700 }}>{connection.name}</div>
                  <div
                    style={{
                      fontFamily: MONO,
                      fontSize: 11,
                      color: COLORS.dim,
                      marginTop: 3,
                      lineHeight: 1.4,
                    }}
                  >
                    {connection.detail}
                  </div>
                </div>
                <span
                  style={{
                    marginLeft: "auto",
                    fontFamily: MONO,
                    fontSize: 10,
                    fontWeight: 600,
                    color: connection.ok ? COLORS.mint : COLORS.red,
                    background: connection.ok ? COLORS.mintTint : "rgba(255,107,107,0.14)",
                    padding: "4px 7px",
                    borderRadius: 5,
                    flex: "none",
                  }}
                >
                  {connection.ok ? "Live" : "Error"}
                </span>
              </div>
            ))}
            <div
              style={{
                fontSize: 12.5,
                color: COLORS.dim,
                border: `1px dashed ${COLORS.borderStrong}`,
                borderRadius: 10,
                padding: 12,
                lineHeight: 1.5,
              }}
            >
              Add leagues by setting <code>SLEEPER_USERNAME</code> and <code>ESPN_LEAGUES</code> in{" "}
              <code>.env.local</code>, then hit Sync.
            </div>
          </div>
        </Card>
      </div>
    </div>
  );
}
