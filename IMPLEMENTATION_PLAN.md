# Implementation Plan — Garmin AI Coach

This document records the architecture, the data model, the build phases and the known
technical risks. It is written to be readable by someone who is not a developer.

---

## 1. What we are building

A personal endurance training platform that turns Garmin data into decisions:

```
Garmin data
   ↓  normalise into one common shape
Activities + daily health records
   ↓  calculate
Training metrics (load, fitness, recovery, efficiency)
   ↓  combine with a goal
A week-by-week training plan
   ↓  compare planned against actual
An assessment of every completed workout
   ↓  apply cautious rules
Adjustments to upcoming workouts, with reasons
   ↓  put into words
An AI coach you can ask questions
```

### The engineering principle that shapes everything

```
RAW DATA → NORMALISED DATA → ANALYTICS → TRAINING DECISION → AI EXPLANATION
```

The language model is **not** the analytics engine. Questions like *"was my last run better?"*
are answered by real code doing real arithmetic on the database; the model's only job is to
express that already-computed answer in natural language. This is what stops the coach from
inventing numbers.

---

## 2. Cost and constraints

| Constraint | How it is met |
|---|---|
| 0 EUR total cost | SQLite file on disk, local Ollama model, no paid API, no hosting |
| Runs locally on macOS | One `npm run dev` command, no Docker, no services to provision |
| Usable by a non-developer | Exact copy-paste commands in `README.md`, one-command setup |
| Secrets in `.env` only | Nothing is hard-coded; `.env` is git-ignored, `.env.example` is committed |
| Works without Garmin API | Demo athlete and FIT upload cover every feature |
| Never fabricate data | Missing metrics are stored and shown as null, never guessed |

---

## 3. Technology choices

| Layer | Choice | Reason |
|---|---|---|
| Application | Next.js 15 (App Router), React 19, TypeScript | One process serves both the pages and the API. No separate backend to run. |
| Styling | Tailwind CSS 3 | Fast, consistent, no component library bloat. |
| Charts | Recharts 3 | Interactive charts that work well with React 19. |
| Database | SQLite via Prisma 6 | A single local file. No database server, no cloud account. |
| Tests | Vitest | Fast unit tests for the calculations. |
| FIT parsing | `@garmin/fitsdk` | Garmin's own free JavaScript SDK — no reverse-engineering. |
| Language model | Ollama (local, free) | Runs on your machine. Optional: the app works fully without it. |

Two limitations of SQLite shape the schema:

1. It has no `enum` type, so those columns are text with the allowed values defined in
   `src/lib/constants.ts`.
2. It has no JSON type in Prisma, so structured fields (workout steps, record streams,
   adaptation snapshots) are stored as JSON text and read through `src/lib/json.ts`.

---

## 4. Folder architecture

```
prisma/schema.prisma      the database model
src/
  app/                    pages and API routes
  components/             UI building blocks (ui, charts, dashboard, activities, plan, coach)
  lib/                    database client, config, formatting, dates, JSON helpers
  analytics/              every fitness calculation, as pure tested functions
  training/               plan generation, workout matching, plan adaptation
  garmin/                 data providers and the sync pipeline
  demo/                   the synthetic demo athlete
  ai/                     coach tools, question routing, language model layer
tests/                    unit tests
```

**No calculation lives inside a UI component.** Everything numeric is a pure function in
`analytics/` or `training/`, which is what makes it testable and reusable by the AI tools.

---

## 5. Database model

| Model | Purpose |
|---|---|
| `User` | The athlete profile — age, heart rates, units. Single user, no login. |
| `Activity` | One workout. Every metric is nullable because sources differ. |
| `ActivitySplit` | Per-kilometre splits belonging to an activity. |
| `DailyHealth` | One row per day: resting HR, sleep, stress, body battery, steps. |
| `TrainingGoal` | What you are training for and how much you can train. |
| `TrainingPlan` | A generated plan. Version 1 is kept forever as the original. |
| `PlannedWorkout` | A single prescribed session, optionally linked to the activity that fulfilled it. |
| `TrainingAdaptation` | The audit trail: what changed, why, and on which numbers. |
| `ChatMessage` | Coach conversation, including which data tools produced each answer. |
| `SyncLog` | When each sync ran and what it did, step by step. |

Design decisions worth noting:

- `Activity` is unique on `(externalId, source)`, so re-syncing never creates duplicates.
- `PlannedWorkout.userModified` means a session you edited by hand is never overwritten
  automatically.
- `TrainingPlan.isOriginal` preserves the untouched first version of every plan.

---

## 6. Analytics engine

Each module is a set of pure functions with unit tests.

| Module | Responsibility |
|---|---|
| `activityMetrics.ts` | Per-activity derived values and activity-to-activity comparison. |
| `trainingLoad.ts` | Session load, acute (7-day), chronic (28-day), acute:chronic ratio. |
| `runningFitness.ts` | The fitness snapshot: weekly volume, longest run, pace estimates, consistency. |
| `trends.ts` | Pace at comparable heart rate, aerobic efficiency over time. |
| `recovery.ts` | Resting HR, sleep, stress and readiness against your own 14-day baseline. |
| `compliance.ts` | Planned versus actual — sessions and volume. |
| `personalRecords.ts` | Bests over standard distances, only where the data genuinely supports it. |
| `insights.ts` | Turns the above into short factual statements with the evidence attached. |

**Training load** is a transparent Banister TRIMP calculation from duration and heart-rate
reserve, with a documented pace-based fallback when heart rate is missing, and `null` when
neither is available. It is our own figure — never presented as a Garmin metric. Garmin's own
values (Training Effect, Body Battery, sleep score) are only ever displayed when Garmin
actually supplied them.

---

## 7. Training plan engine

`training/planGenerator.ts` is deterministic: the same inputs always produce exactly the same
plan. No language model is involved in creating it.

- **Phases**: BASE 40% of weeks, BUILD 35%, PEAK 15%, TAPER 10% (at least two taper weeks for
  a marathon).
- **Volume**: starts from your measured current weekly distance, increases by no more than
  10% per week, drops 25% every fourth week, and is capped at 1.6× your starting volume.
- **Long run**: grows by at most 2 km per week and is capped by goal distance.
- **Paces**: derived from both your goal time and your current fitness — whichever is more
  conservative wins.

---

## 8. Adaptive engine

`training/adaptationEngine.ts` decides whether upcoming sessions should change. It is
rule-based, not model-based, so its behaviour is predictable and testable.

Safety rules, all enforced in code and covered by tests:

- At least **two independent indicators** must agree before anything changes. A single data
  point never moves the plan.
- Weekly volume changes are bounded (−15% / +10%).
- Interval sessions can be cut by at most a third.
- A workout will not be changed twice within three days.
- A session you edited yourself is never touched automatically.

Every change writes a `TrainingAdaptation` record with the before/after snapshot, a plain
sentence explaining the decision, and the exact metric values behind it.

---

## 9. AI Coach

```
your question
   ↓  pick the right data tool
a real database query or analytics function
   ↓  structured result (numbers)
put into words
   ↓
the answer, plus a panel showing exactly which data was used
```

The coach has a fixed set of tools (`get_activity`, `compare_activities`, `get_week_summary`,
`get_training_load`, `get_running_trend`, `get_plan_changes`, and so on). The whole database
is never handed to the model.

**Without Ollama installed**, the same tools still run and the answer is assembled from
built-in templates, with a banner saying no language model is active. The coach is therefore
usable — and the numbers identical — whether or not you install anything extra.

---

## 10. Build phases

| Phase | Contents |
|---|---|
| 0 | Project scaffold, database schema, design system, configuration |
| 1 | Demo athlete, analytics engine, dashboard, activity list and detail, charts, goal wizard |
| 2 | Plan generation, calendar, planned versus actual, compliance |
| 3 | Workout matching, adaptive engine, audit trail, sync pipeline |
| 4 | FIT file upload |
| 5 | AI Coach: tools, routing, Ollama, chat interface |
| 6 | Garmin API connector architecture, settings, export/import, final documentation |

After each phase: build, run the tests, check the pages in a browser, update the README,
commit and push.

---

## 11. Technical risks and how they are handled

| Risk | Handling |
|---|---|
| Garmin API needs Developer Program approval | The connector is fully architected but stays switched off, and says so plainly. It never substitutes invented data. |
| Ollama may not be installed | The coach falls back to template answers built from the same real calculations. |
| SQLite has no JSON or enum types | JSON text columns with typed helpers; string columns with TypeScript unions. |
| Recorded data streams could bloat the database | Streams are sampled at roughly 10-second intervals. |
| Plans changing unpredictably would be useless | Adaptation is bounded by hard limits and covered by tests that assert the limits hold. |
| Setup friction for a non-developer | One `npm run setup` command and exact copy-paste instructions in the README. |
