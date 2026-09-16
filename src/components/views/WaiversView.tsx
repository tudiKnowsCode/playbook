"use client";

import { useMemo, useState } from "react";
import type { Dashboard } from "@/lib/insights";
import { COLORS, MONO } from "@/lib/theme";
import type { Pos } from "@/lib/types";
import {
  Card,
  EmptyState,
  PageHeading,
  PositionChip,
  Truncate,
} from "../ui";

const FILTERS: Array<Pos | "ALL"> = ["ALL", "RB", "WR", "TE", "QB", "K", "DST"];

const GRID = "26px 40px minmax(0,1.6fr) 70px 78px 70px minmax(0,1.3fr) 92px";

export function WaiversView({ data }: { data: Dashboard }) {
  const [filter, setFilter] = useState<Pos | "ALL">("ALL");
  const [queued, setQueued] = useState<Record<string, boolean>>({});

  const rows = useMemo(
    () => data.waivers.filter((w) => filter === "ALL" || w.player.pos === filter),
    [data.waivers, filter]
  );

  const faab = data.me?.faabLeft ?? null;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      <div
        style={{
          display: "flex",
          alignItems: "flex-end",
          justifyContent: "space-between",
          gap: 20,
          flexWrap: "wrap",
        }}
      >
        <PageHeading eyebrow="Waiver wire" title="Best available for your roster" />
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 16,
            fontFamily: MONO,
            fontSize: 11.5,
            color: COLORS.dim,
          }}
        >
          {faab != null && (
            <span>
              FAAB left <span style={{ color: COLORS.text, fontWeight: 600 }}>${faab}</span>
            </span>
          )}
          <span style={{ color: COLORS.faint }}>·</span>
          <span>
            Pool <span style={{ color: COLORS.text, fontWeight: 600 }}>
              {data.league.freeAgents.length}
            </span>{" "}
            available
          </span>
        </div>
      </div>

      <div style={{ display: "flex", gap: 7, flexWrap: "wrap" }}>
        {FILTERS.map((option) => {
          const active = filter === option;
          return (
            <button
              key={option}
              type="button"
              onClick={() => setFilter(option)}
              style={{
                fontFamily: MONO,
                fontSize: 11,
                fontWeight: 600,
                letterSpacing: "0.06em",
                padding: "7px 12px",
                borderRadius: 7,
                cursor: "pointer",
                border: `1px solid ${active ? COLORS.mintBorder : COLORS.borderStrong}`,
                background: active ? COLORS.mintTint : COLORS.panelAlt,
                color: active ? COLORS.mint : COLORS.dimAlt,
              }}
            >
              {option}
            </button>
          );
        })}
      </div>

      <Card style={{ overflow: "hidden" }}>
        <div className="pb-scroll-x">
          <div style={{ minWidth: 900 }}>
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
              <div>Pos</div>
              <div>Player</div>
              <div style={{ textAlign: "right" }}>Add score</div>
              <div style={{ textAlign: "right" }}>ROS proj</div>
              <div style={{ textAlign: "right" }}>Bid</div>
              <div>Why</div>
              <div />
            </div>

            {rows.length === 0 && (
              <EmptyState>
                No {filter === "ALL" ? "" : `${filter} `}free agents worth adding right now.
              </EmptyState>
            )}

            {rows.map((target, index) => {
              const isQueued = queued[target.player.id] ?? false;
              const scoreColor =
                target.score >= 75 ? COLORS.mint : target.score >= 55 ? COLORS.text : COLORS.dim;
              return (
                <div
                  key={target.player.id}
                  className="pb-row"
                  style={{
                    display: "grid",
                    gridTemplateColumns: GRID,
                    gap: 12,
                    alignItems: "center",
                    padding: "11px 18px",
                    borderTop: `1px solid ${COLORS.borderFaint}`,
                  }}
                >
                  <div style={{ fontFamily: MONO, fontSize: 11.5, color: COLORS.dim }}>
                    {index + 1}
                  </div>
                  <PositionChip position={target.player.pos} />
                  <div style={{ minWidth: 0 }}>
                    <Truncate style={{ fontSize: 13.5, fontWeight: 600 }}>
                      {target.player.name}
                    </Truncate>
                    <div
                      style={{
                        fontFamily: MONO,
                        fontSize: 11,
                        color: COLORS.dim,
                        marginTop: 2,
                      }}
                    >
                      {target.player.nflTeam ?? "FA"}
                      {target.player.rosteredPct != null &&
                        ` · ${target.player.rosteredPct.toFixed(0)}% rostered`}
                      {target.player.opponent && ` · ${target.player.opponent}`}
                    </div>
                  </div>
                  <div
                    style={{
                      textAlign: "right",
                      fontFamily: MONO,
                      fontSize: 14,
                      fontWeight: 600,
                      color: scoreColor,
                    }}
                  >
                    {target.score}
                  </div>
                  <div
                    style={{
                      textAlign: "right",
                      fontFamily: MONO,
                      fontSize: 13,
                      color: COLORS.text2,
                    }}
                  >
                    {target.player.rosProj.toFixed(1)}
                  </div>
                  <div
                    style={{
                      textAlign: "right",
                      fontFamily: MONO,
                      fontSize: 13,
                      color: COLORS.mint,
                    }}
                  >
                    {target.suggestedBid != null ? `$${target.suggestedBid}` : "—"}
                  </div>
                  <div style={{ fontSize: 11.5, color: COLORS.dim, lineHeight: 1.35 }}>
                    {target.reason}
                  </div>
                  <button
                    type="button"
                    onClick={() =>
                      setQueued((current) => ({
                        ...current,
                        [target.player.id]: !current[target.player.id],
                      }))
                    }
                    title={
                      target.dropSuggestion
                        ? `Suggested drop: ${target.dropSuggestion.name}`
                        : undefined
                    }
                    style={{
                      fontSize: 12,
                      fontWeight: 600,
                      padding: "7px 0",
                      borderRadius: 7,
                      cursor: "pointer",
                      border: `1px solid ${isQueued ? "rgba(126,242,176,0.5)" : COLORS.borderStrong}`,
                      background: isQueued ? "rgba(126,242,176,0.16)" : COLORS.raisedAlt,
                      color: isQueued ? COLORS.mint : COLORS.text2,
                    }}
                  >
                    {isQueued ? "Queued" : "Queue"}
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      </Card>

      <Card style={{ padding: "16px 18px" }}>
        <h2 style={{ margin: "0 0 12px", fontSize: 14.5, fontWeight: 700 }}>Drop candidates</h2>
        {data.drops.length === 0 ? (
          <EmptyState>No obvious cuts — every roster spot is doing work.</EmptyState>
        ) : (
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr))",
              gap: 12,
            }}
          >
            {data.drops.map((drop) => (
              <div
                key={drop.player.id}
                style={{
                  padding: 12,
                  borderRadius: 10,
                  background: COLORS.raised,
                  border: "1px solid rgba(255,255,255,0.06)",
                }}
              >
                <div style={{ fontSize: 13, fontWeight: 600 }}>{drop.player.name}</div>
                <div
                  style={{ fontFamily: MONO, fontSize: 11, color: COLORS.dim, marginTop: 3 }}
                >
                  {drop.player.pos} · {drop.player.nflTeam ?? "FA"} ·{" "}
                  {drop.player.rosProj.toFixed(1)} ROS
                </div>
                <div style={{ fontSize: 11.5, color: COLORS.amber, marginTop: 8, lineHeight: 1.4 }}>
                  {drop.reason}
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
