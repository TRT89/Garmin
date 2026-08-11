# Testing guide

A walk-through for checking that this application actually works, start to finish, in about
twenty minutes.

Each step states the **expected result**, so you can tell pass from fail rather than just
"it looked fine". Steps 1–8 need no Garmin account and cost nothing.

If you only have five minutes, do the setup plus tests 1, 2 and 5 — those cover the
installation, the analytics and the adaptive engine, which is the feature everything else
exists to serve.

---

## Setup (once, ~3 minutes)

```bash
cd Garmin          # wherever you saved the project
npm install
cp .env.example .env
npm run setup
npm run dev
```

Then open **http://localhost:3000**.

> Upgrading an existing copy? Re-run `npm install` (dependencies have changed) and compare your
> `.env` against `.env.example` for any new settings.

**Expected:** terminal prints `✓ Ready in …` (about 30 seconds the first time), and the browser
shows a dark dashboard reading **"No training data yet"**. An empty database is the correct
starting state.

---

## Test 1 — The automated tests

```bash
npm test
```

**Expect:** `Test Files 9 passed (9)`, `Tests 223 passed (223)`, no failures.

This covers the training-load maths, pace/format conversions, the fitness snapshot, recovery
baselines, personal records, workout matching, every adaptation safety limit, plan progression,
FIT decoding against real binaries, and the coach's answer rendering.

---

## Test 2 — Demo athlete and dashboard

**Settings → Load Demo Athlete.**

**Expect:** "Loaded 66 activities and 84 daily health records for Alex Rivera."

Go to **Dashboard**.

**Expect:**
- Four KPI cards across the top: running distance, training time, training load, recovery
- A **Coach Summary** where each line expands — click one and it shows the actual numbers
  behind the claim
- A training-load chart (fatigue line over a fitness band) and a pace/heart-rate chart
- A recovery chart at the bottom

**The real test:** expand any Coach Summary line. Every statement must be backed by figures.
If a claim appears with no numbers under it, that's a bug worth reporting.

---

## Test 3 — Activities and one run in detail

**Activities** → filter by sport and date range → click any **Long Run**.

**Expect on the detail page:**
- Headline metrics, with **em dashes (—) where data genuinely doesn't exist** — average power
  on a run, heart rate on a swim. A dash is correct behaviour, not a failure.
- **Workout Insights** comparing the session to your recent similar ones, each with its
  supporting numbers
- Four charts: pace, heart rate, elevation, cadence
- A per-kilometre splits table where heart rate creeps up over a long run (cardiac drift)

**Check the splits column:** times should be varied (5:38, 5:41, 5:37…), not all multiples of
15 seconds. This was a genuine bug during development, and the test above guards against it returning.

---

## Test 4 — Goal wizard and plan generation

**Training Plan → Set a goal.** Use: Running → Marathon → *Frankfurt Marathon* → date about
12 weeks out → target **3:40** → 12 weeks → 4 runs/week → long run Sunday.

**Expect:**
- Goal pace shown as roughly **5:05–5:18/km** (3:40 over 42.195 km is 5:13/km)
- A 12-week table where volume builds from about 30 km to a peak near 48 km
- **Lighter weeks at 4 and 8**, and the last two weeks tapering sharply
- Phase badges progressing BASE → BUILD → PEAK → TAPER
- Early BASE weeks contain no interval sessions; they appear once BUILD starts

**The real test:** the plan must start from *Alex's actual 33 km/week*, not a generic template.
Change the goal to 3 runs/week and regenerate — the sessions per week should change accordingly.

---

## Test 5 — The adaptive engine (the key feature)

**Settings → Sync Garmin** (in demo mode this simulates a completed session).

**Expect the eight-step report**, then on **Training Plan**, a **"Why did my plan change?"**
card showing:
- Before: about 19.0 km · After: about 16.1 km
- A reason naming **two** indicators — resting heart rate ~4 bpm above baseline *and* sleep
  ~56 min below it
- An expandable "Show the data behind this decision" with the raw current/baseline/delta values

**The real test — the safety rule.** The engine must never act on a single indicator. Two
independent signals are required, the volume cut is capped at 15%, and a session you edit
yourself is never overwritten. `npm test` proves these; this screen shows one in action.

---

## Test 6 — AI Coach

Click **Ask the coach** (bottom right, on any page) or open the **AI Coach** page. Try the
suggested questions, or:

| Ask | Expect |
|---|---|
| Compare my last two long runs | A metric-by-metric table with a change column |
| Am I improving? | Pace at a comparable heart rate, ~9 s/km faster, naming how many runs |
| Was my training load too high this week? | 7-day vs 28-day figures and recovery indicators |
| What is my hardest workout this week? | Reads your real plan and names the session |
| Why did my plan change? | The adaptation reason with its numbers |
| Show me all runs longer than 15 km from the last 3 months | A filtered table |

**The real test:** expand **"Data used"** under any answer. It must show the tool called, its
arguments, the date range, links to the source activities, and the raw JSON. Cross-check one
number against the Activities page — they must match exactly.

A banner saying it's running without a language model is **expected and correct**. The coach
works fully without one; Ollama only changes the wording.

---

## Test 7 — FIT file import

Export a real activity from [Garmin Connect](https://connect.garmin.com) (open an activity →
gear icon → **Export Original**), then **Settings → FIT file upload**.

**Expect:** the activity appears with splits and charts, and importing triggers the same
matching and plan review as a sync. Try uploading a non-FIT file too — it should be refused
with a clear reason, not crash.

---

## Test 8 — Export and import

**Settings → Database → Export data**, then **Reset Database**, then **Import data** with the
file you just downloaded.

**Expect:** activities, health records, your goal, the plan and the adaptation history all
return intact.

---

## Test 9 — Your Garmin account (the unverified part)

Add to `.env`, then restart the app:

```
GARMIN_CONNECT_EMAIL="you@example.com"
GARMIN_CONNECT_PASSWORD="your-garmin-password"
```

Reset the database first, or Alex's demo data and your real training end up mixed in the same
charts.

**Expect if it works:** your activities import, the ~15 most recent gain splits and charts,
and 30 days of sleep/resting-HR/steps arrive. Stress and Body Battery show as dashes — that is
honest, not broken.

**If it fails**, the message distinguishes three cases deliberately:
- *"Could not reach Garmin"* → network or firewall; your credentials were never checked
- *"Garmin rejected those credentials"* → check the two `.env` lines; **2FA accounts cannot
  work this way at all**
- *"not clear whether the cause was your credentials or the connection"* → genuinely ambiguous

**This is the one part that could not be verified during development**, because
`connect.garmin.com` was unreachable from the build environment. The field mapping is covered by
19 unit tests, and the failure paths were exercised, but a live sign-in has never been run.

---

## Test 10 — Responsive layout

Narrow the browser to phone width, or open it on your phone via your Mac's local IP.

**Expect:** no horizontal scrolling on any page (measured at 0 px overflow at 390 px wide —
a 163 px overflow bug was fixed here during development). The nav scrolls within its own bar.

---

## Known limitations — not bugs

- **The official Garmin Developer API connector is architected but not completed.** Its
  endpoints need documentation Garmin only issues on approval, and guessing at them was a
  deliberate non-goal. It reports itself as unconfigured; the app routes around it and never substitutes
  invented data.
- **The plan engine generates running plans only.** Cycling, triathlon and general fitness
  appear in the wizard as unavailable rather than silently producing a running plan.
- **Stress and Body Battery are unreadable via the unofficial Garmin route**, so the recovery
  analysis uses three indicators instead of five and is correspondingly more conservative.
- **The unofficial Garmin connection will break eventually** when Garmin changes their site.
  `npm install garmin-connect@latest` usually fixes it; FIT upload always keeps working.

---

## If something fails

Note the test number, what you saw, and the exact message. Failure messages throughout the
application are written to name *which* thing went wrong, so the text usually identifies the
cause on its own — a sync that cannot reach Garmin says so, rather than blaming your password.
