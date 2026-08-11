/**
 * Training phases.
 *
 * A plan is divided into four blocks, each with a different job:
 *
 *   BASE   build the aerobic engine — mostly easy running, growing long run
 *   BUILD  add quality work on top of that base to raise sustainable pace
 *   PEAK   the hardest weeks: highest volume, most race-specific sessions
 *   TAPER  volume falls sharply, a little intensity is kept, you arrive fresh
 *
 * The split is proportional so it works for a 6-week plan and a 20-week plan
 * alike, with a floor on the taper because arriving tired is the one mistake
 * that cannot be fixed on race day.
 */

import type { Phase } from '@/lib/constants';

/** Proportion of the plan given to each phase, before the taper floor applies. */
const PROPORTIONS: Record<Phase, number> = {
  BASE: 0.4,
  BUILD: 0.35,
  PEAK: 0.15,
  TAPER: 0.1,
};

/**
 * Work out which phase each week belongs to.
 *
 * Returns an array of length `totalWeeks`, where index 0 is week 1.
 * Deterministic and total — every week gets exactly one phase.
 */
export function assignPhases(totalWeeks: number, isMarathon = false): Phase[] {
  if (totalWeeks <= 0) return [];

  // Very short plans cannot afford a full four-phase structure.
  if (totalWeeks === 1) return ['TAPER'];
  if (totalWeeks === 2) return ['BUILD', 'TAPER'];
  if (totalWeeks === 3) return ['BASE', 'BUILD', 'TAPER'];

  // A marathon needs at least two taper weeks; anything else at least one.
  const minTaper = isMarathon ? 2 : 1;
  const taper = Math.max(minTaper, Math.round(totalWeeks * PROPORTIONS.TAPER));
  const remaining = totalWeeks - taper;

  const base = Math.max(1, Math.round(remaining * (PROPORTIONS.BASE / 0.9)));
  const peak = Math.max(1, Math.round(remaining * (PROPORTIONS.PEAK / 0.9)));
  // Whatever is left goes to BUILD, which absorbs the rounding.
  const build = Math.max(1, remaining - base - peak);

  const phases: Phase[] = [
    ...Array<Phase>(base).fill('BASE'),
    ...Array<Phase>(build).fill('BUILD'),
    ...Array<Phase>(peak).fill('PEAK'),
    ...Array<Phase>(taper).fill('TAPER'),
  ];

  // Rounding can overshoot or undershoot by a week; trim or pad from BUILD.
  if (phases.length > totalWeeks) {
    return phases.slice(phases.length - totalWeeks);
  }
  while (phases.length < totalWeeks) {
    phases.splice(base, 0, 'BUILD');
  }

  return phases;
}

/** How many weeks of each phase a plan contains. */
export function phaseCounts(phases: Phase[]): Record<Phase, number> {
  const counts: Record<Phase, number> = { BASE: 0, BUILD: 0, PEAK: 0, TAPER: 0 };
  for (const phase of phases) counts[phase] += 1;
  return counts;
}

/** What this phase is for, in one sentence, shown alongside the current week. */
export function phaseGoal(phase: Phase): string {
  switch (phase) {
    case 'BASE':
      return 'Building your aerobic foundation. Most running is easy, and the long run grows steadily.';
    case 'BUILD':
      return 'Adding tempo and interval work on top of your base to raise the pace you can sustain.';
    case 'PEAK':
      return 'The most demanding block — your highest volume and the most race-specific sessions.';
    case 'TAPER':
      return 'Volume drops sharply while a little intensity is kept, so you arrive at the start line fresh.';
  }
}
