# Playbook

A personal fantasy football command center for your ESPN and Sleeper leagues — matchup
odds, a start/sit optimizer, waiver targets, a trade desk, power rankings and
cross-league player exposure, all in one dashboard.

Projections and rankings come from **FantasyPros expert consensus (ECR)**, joined onto
your real rosters from ESPN and Sleeper.

## Setup

```bash
npm install
cp .env.local.example .env.local   # then fill it in
npm run dev
```

Open http://localhost:3000.

### Connecting leagues

Everything is configured through `.env.local`:

```ini
# Sleeper — public API, just your username
SLEEPER_USERNAME=your_sleeper_name

# ESPN — league ids, comma separated. Optionally `id:Label`.
ESPN_LEAGUES=123456789,987654321:Office League

# ESPN private leagues need these two cookies
ESPN_SWID={XXXXXXXX-XXXX-XXXX-XXXX-XXXXXXXXXXXX}
ESPN_S2=AEB...long...string
```

**Sleeper** needs nothing but your username — every league on that account is picked up
automatically.

**ESPN** needs the numeric league id from your league URL. Private leagues additionally
need two cookies from a signed-in browser session: open fantasy.espn.com → DevTools →
Application → Cookies → `https://fantasy.espn.com`, and copy `SWID` and `espn_s2`.
Public ESPN leagues work with just the league id.

`.env.local` is gitignored. Restart the dev server after editing it.

## Verifying it works

```bash
npm run selftest
```

This checks the lineup optimizer against an exhaustive brute-force search, calls every
upstream feed for real, and measures the FantasyPros ↔ Sleeper name-join rate. With
credentials configured it also loads your actual leagues and prints a summary.

## The six views

Keyboard shortcuts in brackets.

| View | | What it does |
| --- | --- | --- |
| **Matchup** | `M` | Win probability from a 10,000-run Monte Carlo simulation, slot-by-slot comparison against your opponent, a ranked "do these first" action list, and your season outlook. |
| **Exposure** | `E` | Every player you're *starting* across all connected leagues, the starters you're facing, and the players you both start *and* face. Bench players are excluded — they can't affect a result this week. |
| **Lineup** | `L` | Optimal start/sit, solved exactly. Shows the points your current lineup leaves on the bench and previews the swaps. |
| **Waivers** | `W` | Free agents scored against *your* roster's needs, with suggested FAAB bids and drop candidates. |
| **Trades** | `T` | Two-sided trade evaluation plus a trade finder that only surfaces deals where both teams improve. |
| **League** | `G` | Standings, power rankings, playoff odds and the rest of the week's games. |

## How the numbers are produced

**Projections** are FantasyPros ECR (`r2p_pts`), pulled per position for your league's
scoring format (standard / half-PPR / full PPR). Floor and ceiling are an ~80% interval
around the projection, widened when the experts disagree. Players off the FantasyPros
boards fall back to the provider's own projection.

**Lineup optimization** is an assignment problem, not a sort. A greedy fill ("best RB
into RB1, next best into FLEX") is provably wrong once slots overlap, so this solves it
exactly with the Hungarian algorithm — verified against brute force in the self test.

**Win probability** simulates each starter independently from their own floor/ceiling
spread, so a boom/bust roster is correctly treated as more volatile than a steady one.
Seeded off the league and week, so refreshing doesn't jitter the number.

**Playoff and title odds** simulate the remaining schedule 10,000 times, then run a
single-elimination bracket over the qualifying seeds.

**Power rankings** blend scoring rate, current roster strength and record — weighted
away from record early in the season, when a 2-0 start means very little.

**Waiver scores** are driven by how much a player would improve your *optimal* lineup,
not their raw ranking: a great player at a position you're deep at scores low.

**Trade values** are rest-of-season points above replacement across the games that
remain, so they stay tied to your league's scoring and roster shape.

## Notes

- Playbook is **read-only**. It never writes lineups, claims or offers back to ESPN or
  Sleeper — the "preview" and "queue" controls are local only. Make the actual move in
  the provider's own app.
- Upstream responses are cached in-process (see `src/lib/cache.ts`). The **Sync** button
  clears the cache and refetches.
- Sleeper's player dictionary is ~5MB and cached for 12 hours, per Sleeper's guidance.

## Layout

```
src/lib/providers/   ESPN, Sleeper and FantasyPros clients
src/lib/league.ts    normalizes both providers into one model
src/lib/analysis/    optimizer, simulation, waivers, trades, exposure
src/lib/insights.ts  assembles the dashboard payload
src/components/      UI, one component per view
scripts/selftest.ts  correctness and live-feed checks
```
