"use client";

import { useMemo, useState } from "react";
import type { Dashboard } from "@/lib/insights";
import { analyzeTrade } from "@/lib/analysis/trades";
import { COLORS, MONO } from "@/lib/theme";
import type { Player } from "@/lib/types";
import {
  Card,
  EmptyState,
  PageHeading,
  PositionChip,
  PrimaryButton,
  Truncate,
} from "../ui";

const VERDICT_LABEL = {
  win: "You win this",
  fair: "Fair deal",
  loss: "You lose value",
} as const;

export function TradesView({ data }: { data: Dashboard }) {
  const { me, league, tradeIdeas, tradeValues } = data;

  const partners = useMemo(
    () => league.teams.filter((team) => team.id !== me?.id),
    [league.teams, me?.id]
  );

  const [partnerId, setPartnerId] = useState<string | null>(
    tradeIdeas[0]?.partner.id ?? partners[0]?.id ?? null
  );
  const [sendIds, setSendIds] = useState<string[]>(
    tradeIdeas[0]?.send.map((p) => p.id) ?? []
  );
  const [receiveIds, setReceiveIds] = useState<string[]>(
    tradeIdeas[0]?.receive.map((p) => p.id) ?? []
  );

  const partner = partners.find((team) => team.id === partnerId) ?? null;

  const myPlayers = useMemo(
    () =>
      [...(me?.roster ?? [])]
        .map((entry) => entry.player)
        .sort((a, b) => b.rosProj - a.rosProj),
    [me]
  );

  const theirPlayers = useMemo(
    () =>
      [...(partner?.roster ?? [])]
        .map((entry) => entry.player)
        .sort((a, b) => b.rosProj - a.rosProj),
    [partner]
  );

  const analysis = useMemo(() => {
    if (!me) return null;
    const send = myPlayers.filter((p) => sendIds.includes(p.id));
    const receive = theirPlayers.filter((p) => receiveIds.includes(p.id));
    return analyzeTrade(league, me, send, receive);
  }, [league, me, myPlayers, theirPlayers, sendIds, receiveIds]);

  if (!me) {
    return (
      <Card>
        <EmptyState>Connect the league that contains your team to use the trade desk.</EmptyState>
      </Card>
    );
  }

  const toggle = (
    id: string,
    setter: React.Dispatch<React.SetStateAction<string[]>>
  ) =>
    setter((current) =>
      current.includes(id) ? current.filter((value) => value !== id) : [...current, id]
    );

  const verdictColor =
    analysis?.verdict === "win"
      ? COLORS.mint
      : analysis?.verdict === "fair"
        ? COLORS.text
        : COLORS.amber;

  const total = (analysis?.sendValue ?? 0) + (analysis?.receiveValue ?? 0) || 1;
  const verdictPct = Math.round(((analysis?.receiveValue ?? 0) / total) * 100);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      <PageHeading eyebrow="Trade desk" title="Analyze a deal, or let it find one" />

      <Card style={{ overflow: "hidden" }}>
        <div className="pb-scroll-x">
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "minmax(0,1fr) 190px minmax(0,1fr)",
              minWidth: 820,
            }}
          >
            <TradeColumn
              title="You send"
              players={myPlayers}
              selected={sendIds}
              values={tradeValues}
              onToggle={(id) => toggle(id, setSendIds)}
            />

            <div
              style={{
                borderLeft: `1px solid ${COLORS.borderSoft}`,
                borderRight: `1px solid ${COLORS.borderSoft}`,
                background: COLORS.panelAlt,
                padding: 18,
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                textAlign: "center",
                gap: 4,
              }}
            >
              <div
                style={{
                  fontFamily: MONO,
                  fontSize: 10,
                  letterSpacing: "0.12em",
                  textTransform: "uppercase",
                  color: COLORS.dim,
                }}
              >
                Verdict
              </div>
              <div
                style={{
                  fontSize: 20,
                  fontWeight: 800,
                  letterSpacing: "-0.01em",
                  color: verdictColor,
                }}
              >
                {analysis ? VERDICT_LABEL[analysis.verdict] : "—"}
              </div>
              <div
                style={{
                  fontFamily: MONO,
                  fontSize: 30,
                  fontWeight: 600,
                  color: verdictColor,
                  marginTop: 2,
                }}
              >
                {analysis
                  ? `${analysis.valueDelta >= 0 ? "+" : ""}${analysis.valueDelta}`
                  : "—"}
              </div>
              <div
                style={{
                  fontSize: 11.5,
                  color: COLORS.dim,
                  lineHeight: 1.4,
                  marginTop: 6,
                }}
              >
                {analysis?.note}
              </div>
              <div
                style={{
                  width: "100%",
                  height: 5,
                  borderRadius: 3,
                  background: COLORS.track,
                  marginTop: 12,
                  overflow: "hidden",
                  display: "flex",
                }}
              >
                <div style={{ background: verdictColor, width: `${verdictPct}%` }} />
              </div>
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  width: "100%",
                  fontFamily: MONO,
                  fontSize: 10,
                  color: COLORS.dim,
                  marginTop: 5,
                }}
              >
                <span>You {analysis?.sendValue ?? 0}</span>
                <span>Them {analysis?.receiveValue ?? 0}</span>
              </div>
            </div>

            <TradeColumn
              title="You get"
              partnerSelect={
                <select
                  value={partnerId ?? ""}
                  onChange={(event) => {
                    setPartnerId(event.target.value);
                    setReceiveIds([]);
                  }}
                  style={{
                    fontFamily: MONO,
                    fontSize: 10,
                    letterSpacing: "0.06em",
                    textTransform: "uppercase",
                    color: COLORS.text2,
                    background: COLORS.raised,
                    border: `1px solid ${COLORS.borderStrong}`,
                    borderRadius: 6,
                    padding: "3px 6px",
                    cursor: "pointer",
                    maxWidth: 170,
                  }}
                >
                  {partners.map((team) => (
                    <option key={team.id} value={team.id}>
                      {team.name}
                    </option>
                  ))}
                </select>
              }
              players={theirPlayers}
              selected={receiveIds}
              values={tradeValues}
              onToggle={(id) => toggle(id, setReceiveIds)}
            />
          </div>
        </div>

        <div
          style={{
            borderTop: `1px solid ${COLORS.borderSoft}`,
            padding: "12px 18px",
            display: "flex",
            alignItems: "center",
            gap: 14,
            background: COLORS.panelAlt,
            flexWrap: "wrap",
          }}
        >
          <span style={{ fontSize: 12, color: COLORS.dim }}>{analysis?.rosterImpact}</span>
          <PrimaryButton
            style={{ marginLeft: "auto", fontSize: 12.5, padding: "9px 15px", borderRadius: 8 }}
            disabled={!sendIds.length || !receiveIds.length}
            onClick={() => {
              setSendIds([]);
              setReceiveIds([]);
            }}
          >
            Clear deal
          </PrimaryButton>
        </div>
      </Card>

      <Card style={{ padding: "16px 18px" }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            marginBottom: 4,
            gap: 10,
          }}
        >
          <h2 style={{ margin: 0, fontSize: 14.5, fontWeight: 700 }}>Trade finder</h2>
          <span style={{ fontFamily: MONO, fontSize: 10.5, color: COLORS.dim }}>
            matched on both teams&apos; needs
          </span>
        </div>
        <p style={{ margin: "0 0 14px", fontSize: 12.5, color: COLORS.dim }}>
          Deals where the projection model says both sides gain.
        </p>

        {tradeIdeas.length === 0 ? (
          <EmptyState>
            No mutually beneficial trades found. Every roster in the league is shaped much like
            yours right now.
          </EmptyState>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {tradeIdeas.map((idea, index) => (
              <div
                key={index}
                className="pb-trade-idea"
                style={{
                  display: "grid",
                  gridTemplateColumns: "150px minmax(0,1fr) 84px 96px",
                  gap: 14,
                  alignItems: "center",
                  padding: "13px 14px",
                  borderRadius: 11,
                  border: `1px solid ${COLORS.borderSoft}`,
                  background: COLORS.raised,
                }}
              >
                <div>
                  <div style={{ fontSize: 12.5, fontWeight: 700 }}>{idea.partner.name}</div>
                  <div
                    style={{
                      fontFamily: MONO,
                      fontSize: 10.5,
                      color: COLORS.dim,
                      marginTop: 2,
                    }}
                  >
                    {idea.partnerNeed}
                  </div>
                </div>
                <div style={{ fontSize: 13, lineHeight: 1.5, color: COLORS.text2 }}>
                  {idea.summary}
                </div>
                <div className="pb-trade-gain" style={{ textAlign: "right" }}>
                  <div
                    style={{
                      fontFamily: MONO,
                      fontSize: 15,
                      fontWeight: 600,
                      color: COLORS.mint,
                    }}
                  >
                    +{idea.myGain.toFixed(1)}
                  </div>
                  <div style={{ fontFamily: MONO, fontSize: 10, color: COLORS.dim }}>
                    your gain
                  </div>
                </div>
                <button
                  type="button"
                  className="pb-ghost-btn"
                  onClick={() => {
                    setPartnerId(idea.partner.id);
                    setSendIds(idea.send.map((p) => p.id));
                    setReceiveIds(idea.receive.map((p) => p.id));
                    window.scrollTo({ top: 0, behavior: "smooth" });
                  }}
                  style={{
                    fontSize: 12,
                    fontWeight: 600,
                    padding: "8px 0",
                    borderRadius: 7,
                    cursor: "pointer",
                    border: `1px solid ${COLORS.borderStrong}`,
                    background: COLORS.raisedAlt,
                    color: COLORS.text2,
                  }}
                >
                  Load deal
                </button>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}

function TradeColumn({
  title,
  players,
  selected,
  values,
  onToggle,
  partnerSelect,
}: {
  title: string;
  players: Player[];
  selected: string[];
  values: Record<string, number>;
  onToggle: (id: string) => void;
  partnerSelect?: React.ReactNode;
}) {
  return (
    <div style={{ padding: 18 }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 8,
          marginBottom: 10,
        }}
      >
        <div
          style={{
            fontFamily: MONO,
            fontSize: 10,
            letterSpacing: "0.1em",
            textTransform: "uppercase",
            color: COLORS.dim,
          }}
        >
          {title}
        </div>
        {partnerSelect}
      </div>
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 8,
          maxHeight: 460,
          overflowY: "auto",
        }}
      >
        {players.length === 0 && <EmptyState>No players.</EmptyState>}
        {players.map((player) => {
          const on = selected.includes(player.id);
          return (
            <button
              key={player.id}
              type="button"
              onClick={() => onToggle(player.id)}
              style={{
                display: "grid",
                gridTemplateColumns: "40px 1fr auto",
                gap: 11,
                alignItems: "center",
                textAlign: "left",
                padding: "10px 11px",
                borderRadius: 9,
                cursor: "pointer",
                border: `1px solid ${on ? COLORS.mintBorder : COLORS.border}`,
                background: on ? COLORS.mintTintSoft : COLORS.raised,
              }}
            >
              <PositionChip position={player.pos} />
              <span style={{ minWidth: 0 }}>
                <Truncate style={{ fontSize: 13.5, fontWeight: 600, color: COLORS.text }}>
                  {player.name}
                </Truncate>
                <span
                  style={{
                    display: "block",
                    fontFamily: MONO,
                    fontSize: 11,
                    color: COLORS.dim,
                    marginTop: 2,
                  }}
                >
                  {player.nflTeam ?? "FA"} · {player.rosProj.toFixed(1)}/wk ROS
                </span>
              </span>
              <span
                style={{
                  fontFamily: MONO,
                  fontSize: 13,
                  fontWeight: 600,
                  color: COLORS.text2,
                }}
              >
                {values[player.id] ?? 0}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
