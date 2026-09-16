"use client";

import type { Dashboard } from "@/lib/insights";
import type { ExposureGroup } from "@/lib/analysis/exposure";
import { COLORS, MONO } from "@/lib/theme";
import { Card, EmptyState, PageHeading, StatTile, Tag, Truncate } from "../ui";

export function ExposureView({ data }: { data: Dashboard }) {
  const exposure = data.exposure;

  if (!exposure || exposure.leagueCount === 0) {
    return (
      <Card>
        <EmptyState>
          Exposure spans the starting lineups in every connected league. Add a second league to
          see who you&apos;re rooting for across all of them.
        </EmptyState>
      </Card>
    );
  }

  const maxCount = exposure.leagueCount;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      <PageHeading
        eyebrow={`Player exposure · Week ${data.league.currentWeek}`}
        title="Who you're starting — and facing"
      />

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit,minmax(190px,1fr))",
          gap: 12,
        }}
      >
        <StatTile
          label="Leagues"
          value={String(exposure.leagueCount)}
          note={exposure.sourceLabel}
          valueSize={24}
        />
        <StatTile
          label="Your starters"
          value={String(exposure.myPlayerCount)}
          note={`${exposure.myStartingSpots} starting spots`}
          valueSize={24}
        />
        <StatTile
          label="Opponent starters"
          value={String(exposure.oppPlayerCount)}
          note={`${exposure.oppStartingSpots} starting spots`}
          valueSize={24}
        />
        <StatTile
          label="Conflicts"
          value={String(exposure.conflicts.length)}
          note="you start & face them"
          valueSize={24}
        />
      </div>

      <div
        className="pb-split"
        style={{
          display: "grid",
          gridTemplateColumns: "minmax(0,1fr) minmax(0,1fr)",
          gap: 18,
          alignItems: "start",
        }}
      >
        <ExposureColumn
          title="Your starters"
          aside="across all leagues"
          groups={exposure.mine}
          maxCount={maxCount}
          mine
        />
        <ExposureColumn
          title="Opponent starters"
          aside="this week's matchups"
          groups={exposure.opponents}
          maxCount={maxCount}
          mine={false}
        />
      </div>

      {exposure.conflicts.length > 0 && (
        <Card accent="rgba(240,163,92,0.28)" style={{ padding: "16px 18px" }}>
          <h2 style={{ margin: "0 0 4px", fontSize: 14.5, fontWeight: 700 }}>
            Split rooting interest
          </h2>
          <p style={{ margin: "0 0 13px", fontSize: 12.5, color: COLORS.dim }}>
            You start these players in some leagues and face them in others.
          </p>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit,minmax(210px,1fr))",
              gap: 10,
            }}
          >
            {exposure.conflicts.map((conflict) => (
              <div
                key={`${conflict.pos}-${conflict.name}`}
                style={{
                  padding: "11px 12px",
                  borderRadius: 10,
                  background: COLORS.raised,
                  border: "1px solid rgba(255,255,255,0.06)",
                }}
              >
                <div style={{ fontSize: 13, fontWeight: 600 }}>{conflict.name}</div>
                <div
                  style={{
                    fontFamily: MONO,
                    fontSize: 11,
                    color: COLORS.amber,
                    marginTop: 3,
                  }}
                >
                  start in {conflict.startedIn} · faced in {conflict.facedIn}
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}

function ExposureColumn({
  title,
  aside,
  groups,
  maxCount,
  mine,
}: {
  title: string;
  aside: string;
  groups: ExposureGroup[];
  maxCount: number;
  mine: boolean;
}) {
  return (
    <Card accent={mine ? "rgba(126,242,176,0.24)" : undefined} style={{ overflow: "hidden" }}>
      <div
        style={{
          display: "flex",
          alignItems: "baseline",
          gap: 10,
          padding: "16px 18px 12px",
          borderBottom: `1px solid ${COLORS.borderSoft}`,
        }}
      >
        <h2 style={{ margin: 0, fontSize: 15, fontWeight: 700 }}>{title}</h2>
        <span style={{ fontFamily: MONO, fontSize: 10.5, color: COLORS.dim }}>{aside}</span>
      </div>

      {groups.length === 0 && <EmptyState>Nothing to show.</EmptyState>}

      {groups.map((group) => (
        <div key={group.pos}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 9,
              padding: "10px 18px",
              background: COLORS.panelAlt,
              borderBottom: "1px solid rgba(255,255,255,0.06)",
            }}
          >
            <span style={{ fontFamily: MONO, fontSize: 11, fontWeight: 600, letterSpacing: "0.1em" }}>
              {group.label}
            </span>
            <span style={{ fontFamily: MONO, fontSize: 10.5, color: COLORS.dim }}>
              {group.players.length} {group.players.length === 1 ? "player" : "players"}
            </span>
          </div>

          {group.players.map((player) => {
            const everywhere = player.count >= maxCount;
            return (
              <div
                key={`${group.pos}-${player.name}`}
                className="pb-row"
                style={{
                  display: "grid",
                  gridTemplateColumns: "34px minmax(0,1fr) 54px",
                  gap: 11,
                  alignItems: "center",
                  padding: "9px 18px",
                  borderBottom: `1px solid ${COLORS.borderGhost}`,
                }}
              >
                <div
                  style={{
                    fontFamily: MONO,
                    fontSize: 11.5,
                    fontWeight: 600,
                    textAlign: "center",
                    padding: "4px 0",
                    borderRadius: 5,
                    color: everywhere ? COLORS.bg : mine ? COLORS.mint : COLORS.text2,
                    background: everywhere
                      ? mine
                        ? COLORS.mint
                        : COLORS.text2
                      : "rgba(255,255,255,0.07)",
                  }}
                >
                  ×{player.count}
                </div>
                <div style={{ minWidth: 0 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
                    <Truncate style={{ fontSize: 13.5, fontWeight: 600 }}>{player.name}</Truncate>
                    <span style={{ fontFamily: MONO, fontSize: 10, color: COLORS.dim }}>
                      {player.nflTeam ?? "FA"}
                    </span>
                    {player.conflicted && (
                      <Tag label={mine ? "vs you" : "you start"} color={COLORS.amber} />
                    )}
                  </div>
                  {/* The league list is the point of this row — a player in four leagues
                      needs all four visible, so it wraps rather than truncating. */}
                  <div
                    style={{
                      fontFamily: MONO,
                      fontSize: 10.5,
                      color: COLORS.dim,
                      marginTop: 2,
                      lineHeight: 1.45,
                      overflowWrap: "anywhere",
                    }}
                  >
                    {player.leagues.join(" · ")}
                  </div>
                </div>
                <div
                  style={{
                    height: 4,
                    borderRadius: 2,
                    background: COLORS.track,
                    overflow: "hidden",
                    display: "flex",
                  }}
                >
                  <span
                    style={{
                      background: mine ? COLORS.mint : "#6f7a86",
                      width: `${Math.round((player.count / maxCount) * 100)}%`,
                    }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      ))}
    </Card>
  );
}
