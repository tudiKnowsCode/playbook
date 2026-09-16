"use client";

import { useMemo, useState } from "react";
import type { Dashboard } from "@/lib/insights";
import { COLORS, MONO, statusColor } from "@/lib/theme";
import type { Player, RosterEntry, SlotId } from "@/lib/types";
import { isStartingSlot, slotLabel } from "@/lib/types";
import {
  Card,
  CardTitle,
  EmptyState,
  PageHeading,
  PositionChip,
  PrimaryButton,
  Tag,
  Truncate,
} from "../ui";

interface Row {
  key: string;
  slot: string;
  /** null for a starting slot the roster hasn't filled. */
  player: Player | null;
  /** Highlighted when this player is a below-par starter. */
  weak: boolean;
  tag: string | null;
}

/**
 * Lays the starters out in the league's own slot order, keeping the slots the roster
 * never filled. An empty slot scores zero, so it has to stay visible.
 */
function orderStarters(
  entries: RosterEntry[],
  startingSlots: SlotId[]
): { slot: SlotId; entry: RosterEntry | null }[] {
  const pool = entries.filter((e) => isStartingSlot(e.slot));
  const ordered = startingSlots.map((slot) => {
    const index = pool.findIndex((e) => e.slot === slot);
    return { slot, entry: index >= 0 ? pool.splice(index, 1)[0] : null };
  });
  // Anything left sits in a slot the league config doesn't list — show it rather than
  // silently drop a player who is actually starting.
  return [...ordered, ...pool.map((entry) => ({ slot: entry.slot, entry }))];
}

function playerMeta(player: Player): string {
  const parts: string[] = [];
  if (player.nflTeam) parts.push(player.nflTeam);
  if (player.opponent) parts.push(player.opponent);
  if (player.kickoff && player.opponent !== "BYE") parts.push(player.kickoff);
  return parts.join(" · ") || "—";
}

function playerTag(player: Player): string | null {
  if (player.status !== "ACTIVE" && player.status !== "NA") return player.status;
  if ((player.trendingAdds ?? 0) > 8000) return "HOT";
  return null;
}

export function LineupView({ data }: { data: Dashboard }) {
  const { me, lineup, league } = data;
  const [applied, setApplied] = useState(false);

  const rows = useMemo(() => {
    if (!me) return { starters: [] as Row[], bench: [] as Row[] };

    // "Applied" is a local preview of the optimal lineup — it doesn't write back to
    // ESPN or Sleeper, so the roster on disk is untouched either way.
    const entries: RosterEntry[] =
      applied && lineup
        ? [
            ...lineup.optimal.assignments
              .filter((a) => a.player)
              .map((a) => ({ player: a.player as Player, slot: a.slot })),
            ...lineup.optimal.benched.map((player) => ({ player, slot: "BN" as const })),
          ]
        : me.roster;

    const optimalIds = new Set(
      lineup?.optimal.assignments.map((a) => a.player?.id).filter(Boolean) ?? []
    );
    const currentStarterIds = new Set(
      me.roster.filter((e) => isStartingSlot(e.slot)).map((e) => e.player.id)
    );

    const toRow = (entry: RosterEntry, starting: boolean): Row => {
      // Flag a starter the optimizer wants benched, and a bench player it wants started.
      const shouldStart = optimalIds.has(entry.player.id);
      const isChanged = applied
        ? starting
          ? !currentStarterIds.has(entry.player.id)
          : currentStarterIds.has(entry.player.id)
        : false;
      return {
        key: `${entry.player.id}-${entry.slot}`,
        slot: slotLabel(entry.slot),
        player: entry.player,
        weak: starting && !shouldStart,
        tag: isChanged ? (starting ? "NEW" : "OUT") : playerTag(entry.player),
      };
    };

    return {
      starters: orderStarters(entries, league.startingSlots).map(({ slot, entry }, i) =>
        entry
          ? toRow(entry, true)
          : { key: `empty-${slot}-${i}`, slot: slotLabel(slot), player: null, weak: true, tag: null }
      ),
      bench: entries.filter((e) => !isStartingSlot(e.slot)).map((e) => toRow(e, false)),
    };
  }, [me, lineup, league, applied]);

  if (!me || !lineup) {
    return (
      <Card>
        <EmptyState>Connect the league that contains your team to use the optimizer.</EmptyState>
      </Card>
    );
  }

  const gain = lineup.pointsLeftOnBench;
  const hasUpgrade = lineup.swaps.length > 0 && gain > 0.05;
  const shownTotal = applied ? lineup.optimalTotal : lineup.currentTotal;

  const moveWord = lineup.swaps.every((s) => s.starter) ? "swap" : "move";

  const headline = applied
    ? `Lineup optimized — ${lineup.optimalTotal.toFixed(1)} projected`
    : hasUpgrade
      ? `${
          lineup.swaps.length === 1
            ? `One ${moveWord} adds`
            : `${lineup.swaps.length} ${moveWord}s add`
        } ${gain.toFixed(1)} projected points`
      : "Your lineup is already optimal";

  const sub = applied
    ? lineup.swaps
        .map((s) => `${s.replacement.name} is in your ${s.slotLabel} slot.`)
        .join(" ")
    : hasUpgrade
      ? lineup.swaps
          .slice(0, 2)
          .map((s) =>
            s.starter
              ? `${s.replacement.name} (${s.replacement.proj.toFixed(1)}) into ${s.slotLabel} for ${s.starter.name} (${s.starter.proj.toFixed(1)}).`
              : `${s.replacement.name} (${s.replacement.proj.toFixed(1)}) into ${s.slotLabel}, filling an empty slot.`
          )
          .join(" ")
      : "Every starter is the best available option for their slot.";

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      <PageHeading
        eyebrow="Start / sit optimizer"
        title={
          hasUpgrade
            ? `Your lineup is leaving ${gain.toFixed(1)} pts on the bench`
            : "Your lineup is set"
        }
      />

      <Card
        accent={COLORS.mintBorderSoft}
        style={{
          padding: "16px 18px",
          display: "flex",
          alignItems: "center",
          gap: 18,
          flexWrap: "wrap",
        }}
      >
        <div style={{ flex: 1, minWidth: 240 }}>
          <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 4 }}>{headline}</div>
          <div style={{ fontSize: 12.5, color: COLORS.dim, lineHeight: 1.45 }}>{sub}</div>
        </div>
        {hasUpgrade && (
          <PrimaryButton onClick={() => setApplied((value) => !value)}>
            {applied ? "Undo preview" : "Preview optimal lineup"}
          </PrimaryButton>
        )}
      </Card>

      {applied && (
        <div style={{ fontSize: 12, color: COLORS.dim, marginTop: -6 }}>
          This is a local preview — Playbook never writes lineup changes back to{" "}
          {league.source === "espn" ? "ESPN" : "Sleeper"}. Make the swap in the app to lock it in.
        </div>
      )}

      <div
        className="pb-split"
        style={{
          display: "grid",
          gridTemplateColumns: "minmax(0,1fr) minmax(0,1fr)",
          gap: 18,
          alignItems: "start",
        }}
      >
        <RosterCard
          title="Starters"
          aside={`${shownTotal.toFixed(1)} proj`}
          rows={rows.starters}
        />
        <RosterCard
          title="Bench"
          aside={`${rows.bench.length} players`}
          rows={rows.bench}
        />
      </div>
    </div>
  );
}

function RosterCard({ title, aside, rows }: { title: string; aside: string; rows: Row[] }) {
  return (
    <Card>
      <CardTitle aside={aside} style={{ padding: "16px 18px 10px" }}>
        {title}
      </CardTitle>
      {rows.length === 0 && <EmptyState>Nothing here.</EmptyState>}
      {rows.map((row) => (
        <div
          key={row.key}
          style={{
            display: "grid",
            gridTemplateColumns: "40px 1fr auto",
            gap: 11,
            alignItems: "center",
            padding: "9px 18px",
            borderTop: `1px solid ${COLORS.borderFaint}`,
            background: row.weak ? COLORS.amberTint : "transparent",
          }}
        >
          <PositionChip position={row.slot} />
          <div style={{ minWidth: 0 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
              <Truncate
                style={{
                  fontSize: 13.5,
                  fontWeight: 600,
                  color: row.player ? undefined : COLORS.amber,
                }}
              >
                {row.player ? row.player.name : "Empty slot"}
              </Truncate>
              {row.tag && (
                <Tag
                  label={row.tag}
                  color={
                    row.tag === "NEW"
                      ? COLORS.mint
                      : row.tag === "OUT"
                        ? COLORS.dim
                        : row.tag === "HOT"
                          ? COLORS.mint
                          : statusColor(row.tag)
                  }
                />
              )}
            </div>
            <div style={{ fontFamily: MONO, fontSize: 11, color: COLORS.dim, marginTop: 2 }}>
              {row.player ? playerMeta(row.player) : "nobody started here"}
            </div>
          </div>
          <div style={{ textAlign: "right" }}>
            <div
              style={{
                fontFamily: MONO,
                fontSize: 14,
                fontWeight: 600,
                color: row.weak ? COLORS.amber : COLORS.text,
              }}
            >
              {row.player ? row.player.proj.toFixed(1) : "0.0"}
            </div>
            {row.player && (
              <div style={{ fontFamily: MONO, fontSize: 10, color: COLORS.dim }}>
                {row.player.floor.toFixed(1)} / {row.player.ceil.toFixed(1)}
              </div>
            )}
          </div>
        </div>
      ))}
    </Card>
  );
}
