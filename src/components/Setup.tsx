import { COLORS, MONO } from "@/lib/theme";

/**
 * Shown when no league could be loaded. This is the first screen on a fresh clone, so
 * it carries the full connection instructions rather than a bare error.
 */
export function Setup({ message }: { message: string }) {
  return (
    <div
      style={{
        minHeight: "100vh",
        background: COLORS.bg,
        color: COLORS.text,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 24,
      }}
    >
      <div style={{ maxWidth: 620, width: "100%" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 22 }}>
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

        <h1 style={{ margin: "0 0 8px", fontSize: 28, fontWeight: 800, letterSpacing: "-0.02em" }}>
          Connect a league to get started
        </h1>
        <p style={{ margin: "0 0 22px", fontSize: 13.5, color: COLORS.dim, lineHeight: 1.6 }}>
          {message}
        </p>

        <div
          style={{
            border: `1px solid ${COLORS.border}`,
            borderRadius: 14,
            background: COLORS.panel,
            padding: "18px 20px",
          }}
        >
          <div
            style={{
              fontFamily: MONO,
              fontSize: 10,
              letterSpacing: "0.1em",
              textTransform: "uppercase",
              color: COLORS.dim,
              marginBottom: 12,
            }}
          >
            .env.local
          </div>

          <pre
            style={{
              margin: 0,
              fontFamily: MONO,
              fontSize: 12,
              lineHeight: 1.75,
              color: COLORS.text2,
              background: COLORS.raised,
              border: "1px solid rgba(255,255,255,0.06)",
              borderRadius: 10,
              padding: "14px 16px",
              overflowX: "auto",
            }}
          >
            {`# Sleeper — public API, just your username
SLEEPER_USERNAME=your_sleeper_name

# ESPN — league ids, comma separated (id or id:Label)
ESPN_LEAGUES=123456789,987654321:Office League

# ESPN private leagues need these two cookies
ESPN_SWID={XXXXXXXX-XXXX-XXXX-XXXX-XXXXXXXXXXXX}
ESPN_S2=AEB...long...string`}
          </pre>

          <div style={{ marginTop: 18, fontSize: 12.5, color: COLORS.dim, lineHeight: 1.65 }}>
            <strong style={{ color: COLORS.text2 }}>Finding your ESPN cookies:</strong> sign in at
            fantasy.espn.com, open DevTools → Application → Cookies → https://fantasy.espn.com, and
            copy the values of <code style={{ color: COLORS.mint }}>SWID</code> and{" "}
            <code style={{ color: COLORS.mint }}>espn_s2</code>. Your league id is the{" "}
            <code style={{ color: COLORS.mint }}>leagueId</code> in the URL of your league page.
            Public ESPN leagues need only the league id.
          </div>

          <div style={{ marginTop: 14, fontSize: 12.5, color: COLORS.dim, lineHeight: 1.65 }}>
            Restart the dev server after editing <code style={{ color: COLORS.mint }}>.env.local</code>.
          </div>
        </div>
      </div>
    </div>
  );
}
