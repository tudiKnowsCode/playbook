import type { CSSProperties, ReactNode } from "react";
import { COLORS, MONO, positionColors } from "@/lib/theme";

/** Bordered surface used for every panel in the design. */
export function Card({
  children,
  style,
  accent,
}: {
  children: ReactNode;
  style?: CSSProperties;
  /** Overrides the border color — used for the mint/amber highlighted panels. */
  accent?: string;
}) {
  return (
    <section
      style={{
        border: `1px solid ${accent ?? COLORS.border}`,
        borderRadius: 14,
        background: COLORS.panel,
        ...style,
      }}
    >
      {children}
    </section>
  );
}

/** Small uppercase mono label, the design's workhorse for section eyebrows. */
export function Eyebrow({
  children,
  color = COLORS.dim,
  style,
}: {
  children: ReactNode;
  color?: string;
  style?: CSSProperties;
}) {
  return (
    <div
      style={{
        fontFamily: MONO,
        fontSize: 10,
        letterSpacing: "0.1em",
        textTransform: "uppercase",
        color,
        ...style,
      }}
    >
      {children}
    </div>
  );
}

export function PageHeading({ eyebrow, title }: { eyebrow: string; title: ReactNode }) {
  return (
    <div>
      <div
        style={{
          fontFamily: MONO,
          fontSize: 10.5,
          letterSpacing: "0.14em",
          textTransform: "uppercase",
          color: COLORS.mint,
          marginBottom: 6,
        }}
      >
        {eyebrow}
      </div>
      <h1
        className="pb-page-title"
        style={{
          margin: 0,
          fontSize: 30,
          fontWeight: 800,
          letterSpacing: "-0.02em",
          lineHeight: 1.1,
        }}
      >
        {title}
      </h1>
    </div>
  );
}

export function CardTitle({
  children,
  aside,
  style,
}: {
  children: ReactNode;
  aside?: ReactNode;
  style?: CSSProperties;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 10,
        ...style,
      }}
    >
      <h2 style={{ margin: 0, fontSize: 14.5, fontWeight: 700, letterSpacing: "-0.01em" }}>
        {children}
      </h2>
      {aside != null && (
        <span style={{ fontFamily: MONO, fontSize: 10.5, color: COLORS.dim }}>{aside}</span>
      )}
    </div>
  );
}

/** Colored position chip (QB/RB/WR/TE/FLEX/K/DST). */
export function PositionChip({ position, style }: { position: string; style?: CSSProperties }) {
  const [fg, bg] = positionColors(position);
  return (
    <div
      style={{
        fontFamily: MONO,
        fontSize: 10.5,
        fontWeight: 600,
        textAlign: "center",
        color: fg,
        background: bg,
        borderRadius: 5,
        padding: "4px 0",
        ...style,
      }}
    >
      {position}
    </div>
  );
}

/** Outlined tag next to a player name — injury status, "HOT", "NEW". */
export function Tag({ label, color }: { label: string; color: string }) {
  return (
    <span
      style={{
        fontFamily: MONO,
        fontSize: 9.5,
        fontWeight: 600,
        color,
        border: `1px solid ${color}`,
        borderRadius: 4,
        padding: "1px 4px",
        whiteSpace: "nowrap",
        flex: "none",
      }}
    >
      {label}
    </span>
  );
}

/** Label / big value / note tile used across the outlook and exposure views. */
export function StatTile({
  label,
  value,
  note,
  valueColor = COLORS.text,
  valueSize = 22,
}: {
  label: string;
  value: ReactNode;
  note?: ReactNode;
  valueColor?: string;
  valueSize?: number;
}) {
  return (
    <div
      style={{
        padding: "11px 12px",
        borderRadius: 10,
        background: COLORS.raised,
        border: "1px solid rgba(255,255,255,0.06)",
      }}
    >
      <Eyebrow>{label}</Eyebrow>
      <div
        style={{
          fontFamily: MONO,
          fontSize: valueSize,
          fontWeight: 600,
          marginTop: 6,
          color: valueColor,
        }}
      >
        {value}
      </div>
      {note != null && (
        <div style={{ fontSize: 11.5, color: COLORS.dim, marginTop: 2 }}>{note}</div>
      )}
    </div>
  );
}

/** Thin progress bar. */
export function Meter({
  percent,
  color = COLORS.mint,
  height = 4,
  track = COLORS.track,
}: {
  percent: number;
  color?: string;
  height?: number;
  track?: string;
}) {
  return (
    <span
      style={{
        flex: 1,
        height,
        borderRadius: height / 2,
        background: track,
        overflow: "hidden",
        display: "flex",
      }}
    >
      <span
        style={{
          background: color,
          width: `${Math.max(0, Math.min(100, percent))}%`,
        }}
      />
    </span>
  );
}

/** Single-line text that ellipsizes rather than wrapping. */
export function Truncate({
  children,
  style,
}: {
  children: ReactNode;
  style?: CSSProperties;
}) {
  return (
    <span
      style={{
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap",
        display: "block",
        minWidth: 0,
        ...style,
      }}
    >
      {children}
    </span>
  );
}

export function GhostButton({
  children,
  onClick,
  style,
  title,
}: {
  children: ReactNode;
  onClick?: () => void;
  style?: CSSProperties;
  title?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className="pb-ghost-btn"
      style={{
        fontSize: 12.5,
        fontWeight: 600,
        color: COLORS.text2,
        background: COLORS.panelAlt,
        border: `1px solid ${COLORS.borderStrong}`,
        borderRadius: 8,
        padding: "9px 13px",
        cursor: "pointer",
        ...style,
      }}
    >
      {children}
    </button>
  );
}

export function PrimaryButton({
  children,
  onClick,
  disabled,
  style,
}: {
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  style?: CSSProperties;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={disabled ? undefined : "pb-primary-btn"}
      style={{
        fontSize: 13,
        fontWeight: 700,
        color: COLORS.bg,
        background: disabled ? COLORS.bar : COLORS.mint,
        border: "none",
        borderRadius: 9,
        padding: "11px 16px",
        cursor: disabled ? "default" : "pointer",
        ...style,
      }}
    >
      {children}
    </button>
  );
}

/** Empty-state block shown when a section has nothing to say. */
export function EmptyState({ children }: { children: ReactNode }) {
  return (
    <div
      style={{
        padding: "22px 18px",
        textAlign: "center",
        fontSize: 12.5,
        color: COLORS.dim,
        lineHeight: 1.5,
      }}
    >
      {children}
    </div>
  );
}

export function formatSigned(value: number, digits = 1): string {
  return `${value >= 0 ? "+" : ""}${value.toFixed(digits)}`;
}

export function formatPercent(value: number): string {
  return `${Math.round(value * 100)}%`;
}

/** "7-3" or "7-3-1" when there are ties. */
export function formatRecord(record: { wins: number; losses: number; ties: number }): string {
  return record.ties > 0
    ? `${record.wins}-${record.losses}-${record.ties}`
    : `${record.wins}-${record.losses}`;
}

export function ordinal(n: number): string {
  const withinHundred = n % 100;
  if (withinHundred >= 11 && withinHundred <= 13) return `${n}th`;
  return `${n}${["th", "st", "nd", "rd"][n % 10] ?? "th"}`;
}
