'use client';

import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import {
  GOAL_DISTANCES,
  GOAL_TYPE_LABELS,
  type GoalSport,
  type GoalType,
} from '@/lib/constants';
import { formatDistance, formatPace, parseTimeToSeconds } from '@/lib/format';

const SPORTS: { value: GoalSport; label: string; available: boolean; note?: string }[] = [
  { value: 'running', label: 'Running', available: true },
  {
    value: 'cycling',
    label: 'Cycling',
    available: false,
    note: 'Cycling plans are not built yet — the plan engine currently generates running plans only.',
  },
  {
    value: 'triathlon',
    label: 'Triathlon',
    available: false,
    note: 'Triathlon plans are not built yet.',
  },
  {
    value: 'general_fitness',
    label: 'General fitness',
    available: false,
    note: 'General fitness plans are not built yet.',
  },
];

const RUNNING_GOALS: GoalType[] = ['5k', '10k', 'half_marathon', 'marathon', 'custom'];

const DAYS = [
  { value: 0, label: 'Sunday' },
  { value: 1, label: 'Monday' },
  { value: 2, label: 'Tuesday' },
  { value: 3, label: 'Wednesday' },
  { value: 4, label: 'Thursday' },
  { value: 5, label: 'Friday' },
  { value: 6, label: 'Saturday' },
];

function fieldClasses(invalid = false) {
  return `w-full rounded-lg border bg-surface-raised px-3 py-2 text-sm text-ink placeholder:text-ink-faint focus:border-accent/50 ${
    invalid ? 'border-alert/60' : 'border-line'
  }`;
}

/** A default event date twelve weeks out, so the form starts somewhere sensible. */
function defaultEventDate(weeks: number): string {
  const date = new Date();
  date.setDate(date.getDate() + weeks * 7);
  return date.toISOString().slice(0, 10);
}

export function GoalWizard() {
  const router = useRouter();

  const [step, setStep] = useState(1);
  const [sport, setSport] = useState<GoalSport>('running');
  const [goalType, setGoalType] = useState<GoalType>('marathon');
  const [eventName, setEventName] = useState('Frankfurt Marathon');
  const [trainingWeeks, setTrainingWeeks] = useState(12);
  const [eventDate, setEventDate] = useState(defaultEventDate(12));
  const [targetTime, setTargetTime] = useState('3:40');
  const [customDistance, setCustomDistance] = useState('');
  const [sessionsPerWeek, setSessionsPerWeek] = useState(4);
  const [longRunDay, setLongRunDay] = useState(0);

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const targetSeconds = useMemo(() => parseTimeToSeconds(targetTime), [targetTime]);

  const distance = useMemo(() => {
    if (goalType === 'custom') {
      const km = Number(customDistance);
      return Number.isFinite(km) && km > 0 ? km * 1000 : null;
    }
    return GOAL_DISTANCES[goalType];
  }, [goalType, customDistance]);

  /** The pace the goal implies — shown live so the target is grounded in reality. */
  const goalPace = useMemo(() => {
    if (!distance || !targetSeconds) return null;
    return Math.round((targetSeconds / distance) * 1000);
  }, [distance, targetSeconds]);

  const timeInvalid = targetTime.trim() !== '' && targetSeconds === null;

  async function submit() {
    setSubmitting(true);
    setError(null);

    try {
      const response = await fetch('/api/goal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sport,
          goalType,
          eventName: eventName.trim() || GOAL_TYPE_LABELS[goalType],
          targetDate: eventDate,
          targetDistance: goalType === 'custom' ? distance : null,
          targetTime: targetSeconds,
          trainingWeeks,
          sessionsPerWeek,
          longRunDay,
        }),
      });

      const body = await response.json();
      if (!response.ok || !body.ok) {
        setError(body.error ?? 'The plan could not be generated.');
        setSubmitting(false);
        return;
      }

      router.push('/plan');
      router.refresh();
    } catch {
      setError('Could not reach the application server. Is it still running?');
      setSubmitting(false);
    }
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Set your training goal</h1>
        <p className="mt-1 text-sm text-ink-muted">
          Your plan is built from your recent training, so it starts where you actually are.
        </p>
      </div>

      {/* Step indicator */}
      <div className="flex items-center gap-2">
        {[1, 2, 3].map((n) => (
          <div
            key={n}
            className={`h-1 flex-1 rounded-full transition-colors ${
              n <= step ? 'bg-accent' : 'bg-line'
            }`}
          />
        ))}
      </div>

      {/* --- Step 1: what are you training for? ---------------------------- */}
      {step === 1 && (
        <Card title="What are you training for?">
          <div className="grid gap-2 sm:grid-cols-2">
            {SPORTS.map((option) => (
              <button
                key={option.value}
                type="button"
                disabled={!option.available}
                onClick={() => setSport(option.value)}
                className={`rounded-lg border p-4 text-left transition-colors ${
                  sport === option.value
                    ? 'border-accent/50 bg-accent/5'
                    : 'border-line hover:border-line-strong'
                } ${!option.available ? 'cursor-not-allowed opacity-45' : ''}`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-medium text-ink">{option.label}</span>
                  {!option.available && <Badge tone="neutral">Not yet</Badge>}
                </div>
                {option.note && (
                  <p className="mt-1.5 text-xs leading-relaxed text-ink-faint">{option.note}</p>
                )}
              </button>
            ))}
          </div>

          <div className="mt-6">
            <p className="eyebrow mb-2">Distance</p>
            <div className="flex flex-wrap gap-2">
              {RUNNING_GOALS.map((type) => (
                <button
                  key={type}
                  type="button"
                  onClick={() => setGoalType(type)}
                  className={`rounded-lg border px-3 py-2 text-sm transition-colors ${
                    goalType === type
                      ? 'border-accent/50 bg-accent/10 text-accent'
                      : 'border-line text-ink-muted hover:border-line-strong hover:text-ink'
                  }`}
                >
                  {GOAL_TYPE_LABELS[type]}
                </button>
              ))}
            </div>

            {goalType === 'custom' && (
              <div className="mt-3">
                <label className="eyebrow mb-1.5 block" htmlFor="customDistance">
                  Distance in kilometres
                </label>
                <input
                  id="customDistance"
                  type="number"
                  min="1"
                  step="0.1"
                  value={customDistance}
                  onChange={(e) => setCustomDistance(e.target.value)}
                  placeholder="e.g. 30"
                  className={fieldClasses()}
                />
              </div>
            )}
          </div>

          <div className="mt-6 flex justify-end">
            <Button variant="primary" onClick={() => setStep(2)}>
              Continue
            </Button>
          </div>
        </Card>
      )}

      {/* --- Step 2: the event -------------------------------------------- */}
      {step === 2 && (
        <Card title="Your event">
          <div className="space-y-4">
            <div>
              <label className="eyebrow mb-1.5 block" htmlFor="eventName">
                Event name
              </label>
              <input
                id="eventName"
                value={eventName}
                onChange={(e) => setEventName(e.target.value)}
                placeholder="Frankfurt Marathon"
                className={fieldClasses()}
              />
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label className="eyebrow mb-1.5 block" htmlFor="eventDate">
                  Event date
                </label>
                <input
                  id="eventDate"
                  type="date"
                  value={eventDate}
                  onChange={(e) => setEventDate(e.target.value)}
                  className={fieldClasses()}
                />
              </div>

              <div>
                <label className="eyebrow mb-1.5 block" htmlFor="targetTime">
                  Target time (hours:minutes)
                </label>
                <input
                  id="targetTime"
                  value={targetTime}
                  onChange={(e) => setTargetTime(e.target.value)}
                  placeholder="3:40"
                  className={fieldClasses(timeInvalid)}
                />
                {timeInvalid ? (
                  <p className="mt-1.5 text-xs text-alert">
                    Enter a time like 3:40 (3 hours 40 minutes) or 0:45 for 45 minutes.
                  </p>
                ) : goalPace ? (
                  <p className="mt-1.5 text-xs text-ink-muted">
                    That is {formatPace(goalPace)} for {formatDistance(distance)}.
                  </p>
                ) : (
                  <p className="mt-1.5 text-xs text-ink-faint">
                    Optional — leave blank to train by effort rather than a time target.
                  </p>
                )}
              </div>
            </div>
          </div>

          <div className="mt-6 flex justify-between">
            <Button variant="ghost" onClick={() => setStep(1)}>
              Back
            </Button>
            <Button variant="primary" onClick={() => setStep(3)}>
              Continue
            </Button>
          </div>
        </Card>
      )}

      {/* --- Step 3: how you train ---------------------------------------- */}
      {step === 3 && (
        <Card title="How you train">
          <div className="space-y-5">
            <div>
              <label className="eyebrow mb-1.5 block" htmlFor="weeks">
                Training weeks: <span className="text-ink">{trainingWeeks}</span>
              </label>
              <input
                id="weeks"
                type="range"
                min="4"
                max="24"
                value={trainingWeeks}
                onChange={(e) => setTrainingWeeks(Number(e.target.value))}
                className="w-full accent-accent"
              />
              <p className="mt-1 text-xs text-ink-faint">
                The plan counts back from your event date, so the last week is race week.
              </p>
            </div>

            <div>
              <label className="eyebrow mb-1.5 block" htmlFor="sessions">
                Running days per week: <span className="text-ink">{sessionsPerWeek}</span>
              </label>
              <input
                id="sessions"
                type="range"
                min="3"
                max="6"
                value={sessionsPerWeek}
                onChange={(e) => setSessionsPerWeek(Number(e.target.value))}
                className="w-full accent-accent"
              />
              <p className="mt-1 text-xs text-ink-faint">
                Be honest about what you can sustain — a plan you can follow beats an ambitious
                one you cannot.
              </p>
            </div>

            <div>
              <label className="eyebrow mb-1.5 block" htmlFor="longRunDay">
                Preferred long-run day
              </label>
              <select
                id="longRunDay"
                value={longRunDay}
                onChange={(e) => setLongRunDay(Number(e.target.value))}
                className={fieldClasses()}
              >
                {DAYS.map((day) => (
                  <option key={day.value} value={day.value}>
                    {day.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {error && (
            <p className="mt-4 rounded-lg border border-alert/30 bg-alert/5 p-3 text-xs text-alert">
              {error}
            </p>
          )}

          <div className="mt-6 flex justify-between">
            <Button variant="ghost" onClick={() => setStep(2)} disabled={submitting}>
              Back
            </Button>
            <Button variant="primary" onClick={submit} disabled={submitting}>
              {submitting ? 'Generating your plan…' : 'Generate training plan'}
            </Button>
          </div>
        </Card>
      )}
    </div>
  );
}
