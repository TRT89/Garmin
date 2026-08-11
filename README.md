# Garmin AI Coach

A personal, adaptive endurance training coach that runs entirely on your own Mac.

It takes your Garmin training and health data, works out how your fitness is actually
developing, builds a training plan for a goal race, checks every completed workout against
that plan, adjusts the upcoming sessions when your body says it should — and lets you ask
questions about all of it in plain English.

**Everything is free.** No subscriptions, no paid APIs, no cloud database, no account to
create. Your data never leaves your computer.

---

## What it does

- **Reads your training data** from a Garmin API connection, uploaded `.FIT` files, or a
  built-in demo athlete so you can try everything immediately.
- **Calculates your fitness** — training load, acute/chronic balance, pace at a given heart
  rate, recovery trends, personal bests. Every number is calculated transparently and
  labelled as ours rather than passed off as a Garmin metric.
- **Builds a training plan** for a goal (say, a 3:40 marathon in 12 weeks, running 4 days a
  week), based on what you have actually been running lately.
- **Adapts the plan** when your recovery and performance data suggest it should — and always
  tells you exactly which numbers drove the change.
- **Answers questions** through an AI Coach that reads your real database rather than
  guessing: *"Compare my last two long runs"*, *"Am I improving?"*, *"Why was Thursday's
  workout changed?"*

---

## Setup on macOS

You do not need to be a developer to run this. Follow the steps in order — each one is a
single line you paste into the **Terminal** app (press `Cmd + Space`, type `Terminal`,
press Enter).

### 1. Install Node.js

Node.js is the engine that runs the application. Check whether you already have it:

```bash
node --version
```

If that prints a version number of `v20` or higher, skip to step 2. Otherwise download the
**LTS** installer from [nodejs.org](https://nodejs.org) and run it, then close and reopen
Terminal.

### 2. Get the project and install its dependencies

```bash
cd ~/Downloads/Garmin        # or wherever you saved this folder
npm install
```

This downloads the libraries the app needs. It takes a minute or two the first time.

### 3. Create your settings file

```bash
cp .env.example .env
```

The defaults work as-is. You only need to edit `.env` later if you want to connect the real
Garmin API or change which AI model is used.

### 4. Set up the database

```bash
npm run setup
```

This creates a single file, `prisma/dev.db`, which holds all your data locally.

### 5. Start the application

```bash
npm run dev
```

Then open **http://localhost:3000** in your browser.

To stop the app, click in the Terminal window and press `Ctrl + C`.

---

## Trying it without a Garmin account

Open **Settings** and click **Load Demo Athlete**. This creates twelve weeks of realistic
training history for a fictional runner, including good weeks and bad ones, so every feature
of the app has something to work with.

The demo data is clearly marked as demo data everywhere it appears — it is never mixed up
with, or presented as, real Garmin data.

---

## Development

```bash
npm run dev      # start the app in development mode
npm run build    # production build (also type-checks everything)
npm test         # run the unit tests
npm run db:studio # browse the database in a visual editor
```

### Project structure

```
prisma/schema.prisma   database model
src/app/               pages and API routes (Next.js App Router)
src/components/        user interface building blocks
src/lib/               shared utilities (formatting, dates, database, config)
src/analytics/         all fitness and training-load calculations
src/training/          plan generation, workout matching, plan adaptation
src/garmin/            data providers (Garmin API, FIT upload, demo) and the sync pipeline
src/demo/              the synthetic demo athlete generator
src/ai/                the AI Coach: data tools, question routing, language model
tests/                 unit tests for the calculations
```

The architecture deliberately separates **raw data → normalised data → analytics → training
decision → explanation**. All the arithmetic lives in `src/analytics` and `src/training` as
plain, tested functions. The language model never calculates anything; it only puts already-
computed results into words.

---

## Status

This is a working prototype under active development. See `IMPLEMENTATION_PLAN.md` for the
architecture and the build phases.

---

## Licence

Personal project, provided as-is.
