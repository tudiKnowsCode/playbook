// Design tokens lifted from the Playbook design file. Kept in one place so the
// components can stay literal about the values the design specifies.

export const COLORS = {
  bg: "#0c0e11",
  header: "#0f1216",
  panel: "#12151a",
  panelAlt: "#14181d",
  raised: "#171b21",
  raisedAlt: "#1d232a",
  hover: "#191e24",
  rowHover: "#171b21",
  active: "#1c2229",
  track: "#232931",
  trackAlt: "#1c2128",
  bar: "#3a424c",

  text: "#eceef1",
  text2: "#c8cdd4",
  dim: "#8b939e",
  dimAlt: "#98a0aa",
  faint: "#4c545f",

  mint: "#7ef2b0",
  mintHover: "#a6f7c8",
  amber: "#f0a35c",
  red: "#ff6b6b",
  blue: "#8ec5ff",
  violet: "#c9b6ff",

  border: "rgba(255,255,255,0.08)",
  borderSoft: "rgba(255,255,255,0.07)",
  borderFaint: "rgba(255,255,255,0.05)",
  borderGhost: "rgba(255,255,255,0.04)",
  borderStrong: "rgba(255,255,255,0.12)",
  mintBorder: "rgba(126,242,176,0.45)",
  mintBorderSoft: "rgba(126,242,176,0.28)",
  mintTint: "rgba(126,242,176,0.14)",
  mintTintSoft: "rgba(126,242,176,0.07)",
  amberBorder: "rgba(240,163,92,0.5)",
  amberTint: "rgba(240,163,92,0.05)",
} as const;

export const MONO = "'IBM Plex Mono', ui-monospace, SFMono-Regular, Menlo, monospace";
export const SANS = "Archivo, system-ui, -apple-system, sans-serif";

/** Position chip colors: [foreground, background]. */
export const POSITION_COLORS: Record<string, [string, string]> = {
  QB: ["#f5a3c7", "rgba(245,163,199,0.14)"],
  RB: ["#7ef2b0", "rgba(126,242,176,0.14)"],
  WR: ["#8ec5ff", "rgba(142,197,255,0.14)"],
  TE: ["#f0a35c", "rgba(240,163,92,0.14)"],
  FLEX: ["#c9b6ff", "rgba(201,182,255,0.14)"],
  "WR/TE": ["#c9b6ff", "rgba(201,182,255,0.14)"],
  SFLX: ["#c9b6ff", "rgba(201,182,255,0.14)"],
  K: ["#c8cdd4", "rgba(255,255,255,0.08)"],
  DST: ["#c8cdd4", "rgba(255,255,255,0.08)"],
};

export function positionColors(position: string): [string, string] {
  return POSITION_COLORS[position] ?? POSITION_COLORS.K;
}

/** Injury tag color — amber for game-time decisions, red for ruled out. */
export function statusColor(status: string): string {
  if (status === "O" || status === "IR" || status === "SUS") return COLORS.red;
  if (status === "Q" || status === "D") return COLORS.amber;
  return COLORS.mint;
}
