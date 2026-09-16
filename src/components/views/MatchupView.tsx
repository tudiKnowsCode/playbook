"use client";

import type { Dashboard } from "@/lib/insights";
import { COLORS, MONO } from "@/lib/theme";
import {
  Card,
  CardTitle,
  Eyebrow,
  EmptyState,
  GhostButton,
  PageHeading,
  StatTile,
  Truncate,
  formatRecord,
  formatSigned,
  ordinal,
} from "../ui";
import type { ViewId } from "../Playbook";

const ACTION_TAGS: Record<string, { label: string; color: string }> = {
  start: { label: "Start", color: COLORS.mint },
  claim: { label: "Claim", color: COLORS.blue },
  trade: { label: "Trade", color: COLORS.violet },
  stream: { label: "Stream", color: COLORS.amber },
};

export function MatchupView({
  data,
  onNavigate,
}: {
  data: Dashboard;
  onNavigate: (view: ViewId) => void;
}) {
  const { me, opponent, odds, league, standings, outlook } = data;

  if (!me) {
    return (
      <Card>
        <EmptyState>
          Couldn&apos;t work out which team is yours in {league.name}.
          <br />
          Check that <code>SLEEPER_USERNAME</code> matches your Sleeper display name, or that{" "}
          <code>ESPN_SWID</code> belongs to an owner in this league.
        </EmptyState>
      </Card>
    );
  }

  const myRank = standings.find((row) => row.team.id === me.id)?.rank;
  const oppRank = opponent ? standings.find((row) => row.team.id === opponent.id)?.rank : null;
  const winPct = odds ? Math.round(odds.winProbability * 100) : 50;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <div
        style={{
          display: "flex",
          alignItems: "flex-end",
          justifyContent: "space-between",
          gap: 20,
          flexWrap: "wrap",
        }}
      >
        <PageHeading
          eyebrow={`Week ${league.currentWeek} matchup`}
          title={
            opponent ? (
              <>
                {me.name} <span style={{ color: COLORS.dim, fontWeight: 600 }}>vs</span>{" "}
                {opponent.name}
              </>
            ) : (
              <>{me.name} — bye week</>
            )
          }
        />
        <div style={{ display: "flex", gap: 8 }}>
          <GhostButton onClick={() => onNavigate("lineup")}>Fix my lineup</GhostButton>
          <GhostButton onClick={() => onNavigate("trades")}>Find a trade</GhostButton>
        </div>
      </div>

      {opponent && odds && (
        <Card style={{ overflow: "hidden" }}>
          <div
            className="pb-hero"
            style={{
              display: "grid",
              gridTemplateColumns: "minmax(0,1fr) auto minmax(0,1fr)",
              alignItems: "center",
              gap: 24,
              padding: "26px 28px",
            }}
          >
            <div>
              <div style={{ fontSize: 13, fontWeight: 700, color: COLORS.text }}>{me.name}</div>
              <div style={{ fontFamily: MONO, fontSize: 11.5, color: COLORS.dim, marginTop: 3 }}>
                {formatRecord(me.record)} · {myRank ? `${ordinal(myRank)} power` : "unranked"}
              </div>
              <div
                style={{
                  fontFamily: MONO,
                  fontSize: "var(--hero-score, 44px)",
                  fontWeight: 600,
                  letterSpacing: "-0.03em",
                  marginTop: 14,
                  color: COLORS.mint,
                }}
              >
                {odds.myProjected.toFixed(1)}
              </div>
              <Eyebrow style={{ fontSize: 10.5, marginTop: 2 }}>Projected</Eyebrow>
            </div>

            <div style={{ textAlign: "center" }}>
              <div
                style={{
                  fontFamily: MONO,
                  fontSize: 11,
                  letterSpacing: "0.12em",
                  textTransform: "uppercase",
                  color: COLORS.dim,
                }}
              >
                Win prob
              </div>
              <div
                style={{
                  fontFamily: MONO,
                  fontSize: "var(--hero-prob, 52px)",
                  fontWeight: 600,
                  letterSpacing: "-0.03em",
                  lineHeight: 1.05,
                  marginTop: 4,
                }}
              >
                {winPct}%
              </div>
              <div style={{ fontSize: 12, color: COLORS.dim, marginTop: 2 }}>
                based on {odds.simulations.toLocaleString()} sims
              </div>
            </div>

            <div style={{ textAlign: "right" }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: COLORS.text }}>
                {opponent.name}
              </div>
              <div style={{ fontFamily: MONO, fontSize: 11.5, color: COLORS.dim, marginTop: 3 }}>
                {formatRecord(opponent.record)} ·{" "}
                {oppRank ? `${ordinal(oppRank)} power` : "unranked"}
              </div>
              <div
                style={{
                  fontFamily: MONO,
                  fontSize: "var(--hero-score, 44px)",
                  fontWeight: 600,
                  letterSpacing: "-0.03em",
                  marginTop: 14,
                  color: COLORS.text2,
                }}
              >
                {odds.oppProjected.toFixed(1)}
              </div>
              <Eyebrow style={{ fontSize: 10.5, marginTop: 2 }}>Projected</Eyebrow>
            </div>
          </div>
          <div style={{ height: 6, display: "flex", background: COLORS.trackAlt }}>
            <div style={{ background: COLORS.mint, width: `${winPct}%` }} />
            <div style={{ background: COLORS.bar, flex: 1 }} />
          </div>
        </Card>
      )}

      <div
        className="pb-split"
        style={{
          display: "grid",
          gridTemplateColumns: "minmax(0,1.45fr) minmax(0,1fr)",
          gap: 18,
          alignItems: "start",
        }}
      >
        <Card>
          <CardTitle aside="edge shown per slot" style={{ padding: "16px 18px 12px" }}>
            Position-by-position
          </CardTitle>
          <div
            className="pb-slot-row"
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 62px 44px 62px 1fr",
              gap: "0 10px",
              padding: "0 18px 6px",
              fontFamily: MONO,
              fontSize: 10,
              letterSpacing: "0.1em",
              textTransform: "uppercase",
              color: COLORS.dim,
            }}
          >
            <div>You</div>
            <div style={{ textAlign: "right" }}>Proj</div>
            <div style={{ textAlign: "center" }}>Slot</div>
            <div>Proj</div>
            <div style={{ textAlign: "right" }}>Them</div>
          </div>

          {data.slotComparison.length === 0 && <EmptyState>No matchup this week.</EmptyState>}

          {data.slotComparison.map((row, index) => {
            const winning = row.edge >= 0;
            return (
              <div
                key={`${row.slot}-${index}`}
                className="pb-slot-row"
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr 62px 44px 62px 1fr",
                  gap: "0 10px",
                  alignItems: "center",
                  padding: "9px 18px",
                  borderTop: `1px solid ${COLORS.borderFaint}`,
                }}
              >
                <Truncate
                  style={{
                    fontSize: 13,
                    fontWeight: 600,
                    color: winning ? COLORS.text : COLORS.dim,
                  }}
                >
                  {row.mine?.name ?? "—"}
                </Truncate>
                <div
                  style={{
                    textAlign: "right",
                    fontFamily: MONO,
                    fontSize: 13,
                    color: winning ? COLORS.text : COLORS.dim,
                  }}
                >
                  {row.mine ? row.mine.proj.toFixed(1) : "—"}
                </div>
                <div
                  style={{
                    textAlign: "center",
                    fontFamily: MONO,
                    fontSize: 10,
                    fontWeight: 600,
                    color: COLORS.dim,
                    background: "rgba(255,255,255,0.05)",
                    borderRadius: 4,
                    padding: "3px 0",
                  }}
                >
                  {row.slot}
                </div>
                <div
                  style={{
                    fontFamily: MONO,
                    fontSize: 13,
                    color: winning ? COLORS.dim : COLORS.text,
                  }}
                >
                  {row.theirs ? row.theirs.proj.toFixed(1) : "—"}
                </div>
                <Truncate
                  style={{
                    textAlign: "right",
                    fontSize: 13,
                    fontWeight: 600,
                    color: winning ? COLORS.dim : COLORS.text,
                  }}
                >
                  {row.theirs?.name ?? "—"}
                </Truncate>
              </div>
            );
          })}
        </Card>

        <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
          <Card style={{ padding: "16px 18px" }}>
            <h2 style={{ margin: "0 0 4px", fontSize: 14.5, fontWeight: 700 }}>Do these first</h2>
            <p style={{ margin: "0 0 14px", fontSize: 12.5, color: COLORS.dim, lineHeight: 1.45 }}>
              Ranked by projected points added this week.
            </p>
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {data.actions.length === 0 && (
                <EmptyState>
                  Nothing to fix — your lineup is optimal and no upgrade is available.
                </EmptyState>
              )}
              {data.actions.map((action, index) => {
                const tag = ACTION_TAGS[action.kind] ?? ACTION_TAGS.start;
                return (
                  <button
                    key={index}
                    type="button"
                    onClick={() => onNavigate(action.target)}
                    className="pb-action-card"
                    style={{
                      display: "grid",
                      gridTemplateColumns: "auto 1fr auto",
                      gap: 12,
                      alignItems: "center",
                      textAlign: "left",
                      width: "100%",
                      padding: "11px 12px",
                      borderRadius: 10,
                      border: `1px solid ${COLORS.border}`,
                      background: COLORS.raised,
                      cursor: "pointer",
                    }}
                  >
                    <span
                      style={{
                        fontFamily: MONO,
                        fontSize: 10,
                        fontWeight: 600,
                        color: COLORS.bg,
                        background: tag.color,
                        padding: "3px 6px",
                        borderRadius: 5,
                        textTransform: "uppercase",
                        letterSpacing: "0.06em",
                      }}
                    >
                      {tag.label}
                    </span>
                    <span style={{ minWidth: 0 }}>
                      <span
                        style={{
                          display: "block",
                          fontSize: 13,
                          fontWeight: 600,
                          color: COLORS.text,
                        }}
                      >
                        {action.title}
                      </span>
                      <span
                        style={{
                          display: "block",
                          fontSize: 11.5,
                          color: COLORS.dim,
                          marginTop: 2,
                        }}
                      >
                        {action.detail}
                      </span>
                    </span>
                    <span
                      style={{
                        fontFamily: MONO,
                        fontSize: 13,
                        fontWeight: 600,
                        color: COLORS.mint,
                      }}
                    >
                      {formatSigned(action.gain)}
                    </span>
                  </button>
                );
              })}
            </div>
          </Card>

          <Card style={{ padding: "16px 18px" }}>
            <h2 style={{ margin: "0 0 12px", fontSize: 14.5, fontWeight: 700 }}>Season outlook</h2>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "minmax(0,1fr) minmax(0,1fr)",
                gap: 12,
              }}
            >
              <StatTile
                label="Playoff odds"
                value={`${Math.round((outlook?.playoffOdds ?? 0) * 100)}%`}
                note={`projected ${outlook?.projectedWins.toFixed(1) ?? "—"} wins`}
                valueColor={COLORS.mint}
              />
              <StatTile
                label="Proj seed"
                value={outlook ? ordinal(outlook.projectedSeed) : "—"}
                note={`top ${league.playoffTeams} make it`}
              />
              <StatTile
                label="Title odds"
                value={`${Math.round((outlook?.titleOdds ?? 0) * 100)}%`}
                note={`${Math.round((outlook?.byeOdds ?? 0) * 100)}% for the 1 seed`}
              />
              <StatTile
                label="Strength of sched"
                value={data.scheduleRank ? ordinal(data.scheduleRank) : "—"}
                note="easiest remaining = 1st"
              />
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
