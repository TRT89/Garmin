# Garmin AI Coach

A personal, adaptive endurance training coach that runs entirely on your own Mac.

It takes your Garmin training and health data, works out how your fitness is actually
developing, builds a training plan for a goal race, checks every completed workout against that
plan, adjusts upcoming sessions when your body says it should — and lets you ask questions
about all of it in plain English.

**Everything is free.** No subscriptions, no paid APIs, no cloud database, no account to
create. Your data never leaves your computer.

---

## Contents

- [What it does](#what-it-does)
- [Setup on macOS](#setup-on-macos)
- [Trying it without a Garmin account](#trying-it-without-a-garmin-account)
- [Importing your own activities](#importing-your-own-activities)
- [Turning on the AI Coach](#turning-on-the-ai-coach)
- [Connecting the Garmin API](#connecting-the-garmin-api)
- [Troubleshooting](#troubleshooting)
- [How it works](#how-it-works)
- [For developers](#for-developers)

---

## What it does

- **Reads your training data** from uploaded `.FIT` files, a Garmin API connection, or a
  built-in demo athlete so you can try everything immediately.
- **Calculates your fitness** — training load, the balance between recent and long-term work,
  your pace at a given heart rate, recovery trends, personal bests. Every figure is calculated
  transparently and labelled as ours rather than passed off as a Garmin metric.
- **Builds a training plan** for a goal — say a 3:40 marathon in twelve weeks, running four
  days a week — based on what you have actually been running lately, not a generic template.
- **Adapts the plan** when your recovery and performance data justify it, and always tells you
  exactly which numbers drove the change.
- **Answers questions** through an AI Coach that reads your real database rather than guessing:
  *"Compare my last two long runs"*, *"Am I improving?"*, *"Why was Thursday's workout
  changed?"*

---

## Setup on macOS

You do not need to be a developer to run this. Follow the steps in order. Each one is a single
line you paste into the **Terminal** app — press `Cmd + Space`, type `Terminal`, press Enter.

### 1. Install Node.js

Node.js is the engine that runs the application. First check whether you already have it:

```bash
node --version
```

If that prints `v20` or higher, skip to step 2. Otherwise download the **LTS** installer from
[nodejs.org](https://nodejs.org), run it, then close and reopen Terminal.

### 2. Go to the project folder

```bash
cd ~/Downloads/Garmin
```

Replace `~/Downloads/Garmin` with wherever you saved this folder. A shortcut: type `cd `
(with a space), then drag the folder from Finder into the Terminal window and press Enter.

### 3. Install what the app needs

```bash
npm install
```

This downloads the libraries the application uses. It takes a minute or two the first time and
prints a lot of text — that is normal.

### 4. Create your settings file

```bash
cp .env.example .env
```

The defaults work as they are. You only need to edit `.env` later if you connect the real
Garmin API or change which AI model is used.

### 5. Set up the database

```bash
npm run setup
```

This creates a single file, `prisma/dev.db`, holding all your data on your own machine.

### 6. Start the application

```bash
npm run dev
```

Leave that Terminal window open, and open **http://localhost:3000** in your browser.

To stop the app, click the Terminal window and press `Ctrl + C`. To start it again later,
repeat steps 2 and 6 — the earlier steps are one-time only.

---

## Trying it without a Garmin account

Open **Settings** and click **Load Demo Athlete**.

That creates twelve weeks of realistic training history for a fictional runner, Alex, along
with daily sleep, resting-heart-rate and readiness data. It deliberately includes a bad week, an
unusually hard long run and a dip over the last few days, so the adaptive features have
something real to react to rather than a flawless record that never needs adjusting.

A good route through the app from there:

1. **Dashboard** — how training is going, with the evidence behind each statement one click away.
2. **Activities** — filter by sport, open any run to see its splits and in-session charts.
3. **Training Plan → Set a goal** — try Frankfurt Marathon, 3:40, twelve weeks, four runs a week.
4. **Sync** — simulates a completed session, matches it to your plan and re-evaluates it.
5. **AI Coach** — ask *"Compare my last two long runs"* or *"Why did my plan change?"*

Demo data is labelled as demo data everywhere it appears. It is never mixed up with, or
presented as, real Garmin data.

---

## Importing your own activities

You do not need API access to use your real training.

1. Open [Garmin Connect](https://connect.garmin.com) in a browser.
2. Open an activity, click the gear icon, and choose **Export Original**. You get a `.fit` file.
3. In this app, go to **Settings → FIT file upload** and choose the files. You can select many
   at once.

Files are decoded with Garmin's own free SDK. Anything a file does not contain — heart rate on
a swim, power on a watch without a meter — is stored as missing rather than estimated. A
corrupted or incomplete file is refused with an explanation rather than imported as a partial
activity.

Importing runs the same steps as a sync, so your plan is updated too.

---

## Turning on the AI Coach

**The coach already works.** It answers from your real data using built-in calculations, and
shows you exactly which activities each answer came from. You do not have to install anything.

A language model only changes the *wording* — the numbers are identical either way. If you want
the more conversational version, install [Ollama](https://ollama.com), which is free and runs
entirely on your own machine:

```bash
brew install ollama
```

(If you do not have Homebrew, download the installer from [ollama.com](https://ollama.com)
instead.)

Then, in a **new** Terminal window, start it:

```bash
ollama serve
```

And in another window, download a model — this is a few gigabytes and takes a while:

```bash
ollama pull llama3.1:8b
```

Reload the app. **Settings → AI Coach language model** should now say *Available*. If you use a
different model, set `OLLAMA_MODEL` in your `.env` file to match.

---

## Connecting the Garmin API

**This is optional and most people will not need it** — FIT upload gives you the same data.

Garmin's Activity and Health APIs are not public. Access requires approval through the
[Garmin Connect Developer Program](https://developer.garmin.com/gc-developer-program/), after
which Garmin issues credentials and the endpoint documentation.

Once you have been approved:

1. Put the credentials in `.env` as `GARMIN_CLIENT_ID` and `GARMIN_CLIENT_SECRET`, and set
   `GARMIN_ENABLED="true"`.
2. Fill in the endpoint configuration in `src/garmin/providers/GarminProvider.ts`, following
   the instructions at the top of that file.

The connector is fully structured and ready for those details. Until they are supplied it
reports itself as not configured and the app routes around it — it never invents data to cover
the gap.

---

## Troubleshooting

**`command not found: npm`**
Node.js is not installed, or Terminal has not noticed it yet. Do step 1, then close and reopen
Terminal.

**`Error: listen EADDRINUSE: address already in use :::3000`**
The app is already running in another Terminal window. Either use that one, or stop it with
`Ctrl + C`.

**The page says "No training data yet"**
Nothing has been imported. Go to **Settings** and either load the demo athlete or upload a FIT
file.

**"Cannot find module" or similar after updating**
Dependencies changed. Run `npm install` again.

**The database seems wrong, and I want to start over**
**Settings → Demo data → Reset Database** deletes everything. Alternatively:

```bash
npm run db:reset
```

**The AI Coach says it is running without a language model**
That is expected unless you installed Ollama, and the coach still works. See
[Turning on the AI Coach](#turning-on-the-ai-coach).

**Ollama is installed but the app cannot see it**
Check `ollama serve` is running in its own Terminal window, and that the model named in `.env`
matches one from `ollama list`.

**I want to move my data to another computer**
**Settings → Database → Export data** writes one JSON file with everything in it. On the other
machine, set the app up, then use **Import data**.

---

## How it works

The architecture deliberately separates five stages:

```
RAW DATA → NORMALISED DATA → ANALYTICS → TRAINING DECISION → EXPLANATION
```

Every source — Garmin API, FIT file, demo generator — is converted into one common shape before
anything else touches it. All the arithmetic lives in plain, tested functions. Training
decisions are made by explicit rules with stated limits. **The language model is never the
analytics engine**; it only puts already-computed results into words, which is what stops it
inventing numbers.

Some consequences worth knowing about:

- **Training load is ours, not Garmin's.** It is calculated from your duration and heart rate
  using the published TRIMP method, and labelled as ours throughout. Garmin's own values
  (Training Effect, Body Battery, sleep score) are only shown when Garmin actually supplied
  them.
- **Missing data stays missing.** If a metric was not recorded, you see a dash, not a guess.
- **The plan will not swing about.** At least two independent indicators must agree before any
  session is changed; weekly volume moves by at most −15%/+10%; interval sessions lose at most a
  third of their repetitions; and a session you edit yourself is never overwritten.
- **Every change is accountable.** *Why did my plan change?* on the plan page shows what a
  session was, what it became, why, and the exact numbers behind the decision.

---

## For developers

```bash
npm run dev        # start in development mode
npm run build      # production build (type-checks everything)
npm test           # run the unit tests
npm run db:studio  # browse the database in a visual editor
npm run db:reset   # wipe and recreate the database
```

### Project structure

```
prisma/schema.prisma   database model
src/app/               pages and API routes (Next.js App Router)
src/components/        user interface building blocks
src/lib/               database client, config, formatting, dates, JSON helpers
src/analytics/         every fitness calculation, as pure tested functions
src/training/          plan generation, workout matching, plan adaptation
src/garmin/            data providers and the sync pipeline
src/demo/              the synthetic demo athlete
src/ai/                coach tools, question routing, language model layer
tests/                 unit tests
```

No calculation lives inside a UI component. Everything numeric is a pure function in
`analytics/` or `training/`, which is what makes it testable and lets the AI tools reuse the
exact code the screen uses.

See `IMPLEMENTATION_PLAN.md` for the architecture, data model and design decisions in full.

---

## Licence

Personal project, provided as-is.
