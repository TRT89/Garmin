import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderAnswer, renderToolResult } from '@/ai/render';
import { OllamaProvider } from '@/ai/llm/ollama';
import { SYSTEM_PROMPT } from '@/ai/llm/provider';
import type { ToolResult } from '@/ai/tools';

const emptyProvenance = { activityIds: [], dateRange: null, howCalculated: [] };

const toolResult = (over: Partial<ToolResult> = {}): ToolResult => ({
  tool: 'get_goal',
  args: {},
  data: null,
  unavailable: null,
  provenance: emptyProvenance,
  ...over,
});

// ---------------------------------------------------------------------------
// The renderer — the coach's floor when no language model is available
// ---------------------------------------------------------------------------

describe('renderToolResult', () => {
  it('reports why data is unavailable rather than apologising vaguely', () => {
    const output = renderToolResult(
      toolResult({ unavailable: 'No training plan exists yet. Set a goal to have one generated.' }),
    );
    expect(output).toContain('No training plan exists yet');
  });

  it('renders an activity comparison as a table', () => {
    const output = renderToolResult(
      toolResult({
        tool: 'compare_activities',
        data: {
          earlier: { title: 'Long Run', date: '2026-08-04' },
          later: { title: 'Long Run', date: '2026-08-11' },
          comparable: true,
          comparabilityNote: null,
          metrics: [
            { label: 'Distance', earlier: 18000, later: 16700, change: -1300, format: 'distance' },
            { label: 'Average pace', earlier: 338, later: 337, change: -1, format: 'pace' },
            { label: 'Average heart rate', earlier: 150, later: 150, change: 0, format: 'number' },
          ],
          observations: ['The two sessions were closely matched.'],
        },
      }),
    );

    expect(output).toContain('| Metric | Earlier | Later | Change |');
    expect(output).toContain('18.0 km');
    expect(output).toContain('5:37/km');
    expect(output).toContain('closely matched');
  });

  it('prints an unchanged whole number as 0, not 0.000', () => {
    const output = renderToolResult(
      toolResult({
        tool: 'compare_activities',
        data: {
          earlier: { title: 'A', date: '2026-08-04' },
          later: { title: 'B', date: '2026-08-11' },
          comparable: true,
          comparabilityNote: null,
          metrics: [
            { label: 'Average heart rate', earlier: 150, later: 150, change: 0, format: 'number' },
          ],
          observations: [],
        },
      }),
    );

    expect(output).toContain('| Average heart rate | 150 | 150 | 0 |');
    expect(output).not.toContain('0.000');
  });

  it('keeps enough precision for aerobic efficiency to be meaningful', () => {
    const output = renderToolResult(
      toolResult({
        tool: 'compare_activities',
        data: {
          earlier: { title: 'A', date: '2026-08-04' },
          later: { title: 'B', date: '2026-08-11' },
          comparable: true,
          comparabilityNote: null,
          metrics: [
            {
              label: 'Aerobic efficiency',
              earlier: 0.01985,
              later: 0.02011,
              change: 0.00026,
              format: 'number',
            },
          ],
          observations: [],
        },
      }),
    );

    expect(output).toContain('0.01985');
    expect(output).toContain('0.02011');
  });

  it('omits rows where neither side has a value', () => {
    const output = renderToolResult(
      toolResult({
        tool: 'compare_activities',
        data: {
          earlier: { title: 'A', date: '2026-08-04' },
          later: { title: 'B', date: '2026-08-11' },
          comparable: true,
          comparabilityNote: null,
          metrics: [
            { label: 'Average power', earlier: null, later: null, change: null, format: 'number' },
            { label: 'Distance', earlier: 10000, later: 10000, change: 0, format: 'distance' },
          ],
          observations: [],
        },
      }),
    );

    expect(output).not.toContain('Average power');
    expect(output).toContain('Distance');
  });

  it('warns when two sessions are not fairly comparable', () => {
    const output = renderToolResult(
      toolResult({
        tool: 'compare_activities',
        data: {
          earlier: { title: 'A', date: '2026-08-04' },
          later: { title: 'B', date: '2026-08-11' },
          comparable: false,
          comparabilityNote: 'These are different sports, so most metrics cannot be compared.',
          metrics: [],
          observations: [],
        },
      }),
    );

    expect(output).toContain('different sports');
  });

  it('states the evidence behind a plan change', () => {
    const output = renderToolResult(
      toolResult({
        tool: 'get_plan_changes',
        data: {
          changeCount: 1,
          reviewCount: 1,
          changes: [
            {
              when: '2026-08-11',
              outcome: 'REDUCE_VOLUME',
              reason: 'Your next long session has been shortened because your resting heart rate is 4 bpm above your 14-day average.',
              before: { description: '19.0 km at long-run pace' },
              after: { description: '16.1 km at long-run pace' },
              reverted: false,
            },
          ],
          latestReviewWithoutChange: null,
        },
      }),
    );

    expect(output).toContain('Before: 19.0 km');
    expect(output).toContain('After: 16.1 km');
    expect(output).toContain('resting heart rate is 4 bpm');
  });

  it('says plainly when the plan has not been changed', () => {
    const output = renderToolResult(
      toolResult({
        tool: 'get_plan_changes',
        data: {
          changeCount: 0,
          reviewCount: 1,
          changes: [],
          latestReviewWithoutChange: 'Your training and recovery are both in line with your recent norms.',
        },
      }),
    );

    expect(output).toContain('No automatic changes');
    expect(output).toContain('in line with your recent norms');
  });

  it('names the hardest session of the week', () => {
    const output = renderToolResult(
      toolResult({
        tool: 'get_training_plan',
        data: {
          week: 6,
          totalWeeks: 12,
          phase: 'BUILD',
          plannedDistance: 42000,
          workouts: [
            {
              weekday: 'Tuesday',
              type: 'EASY',
              description: '8 km easy',
              distanceText: '8.0 km',
              paceRange: '5:40–6:05/km',
              status: 'planned',
              wasAdjusted: false,
            },
            {
              weekday: 'Thursday',
              type: 'INTERVAL',
              description: '5 × 1 km at interval pace',
              distanceText: '12.0 km',
              paceRange: '4:45–4:55/km',
              status: 'planned',
              wasAdjusted: false,
            },
          ],
        },
      }),
    );

    expect(output).toContain('Thursday');
    expect(output).toContain('most demanding session');
    expect(output).toContain('5 × 1 km');
  });

  it('flags a session that was adjusted, with the reason', () => {
    const output = renderToolResult(
      toolResult({
        tool: 'get_training_plan',
        data: {
          week: 6,
          totalWeeks: 12,
          phase: 'BUILD',
          plannedDistance: 30000,
          workouts: [
            {
              weekday: 'Thursday',
              type: 'INTERVAL',
              description: '4 × 1 km',
              distanceText: '10.0 km',
              paceRange: '4:45–4:55/km',
              status: 'planned',
              wasAdjusted: true,
              adjustmentReason: 'Reduced because your recovery indicators are below baseline.',
            },
          ],
        },
      }),
    );

    expect(output).toContain('Thursday was adjusted');
    expect(output).toContain('below baseline');
  });

  it('admits when a trend is too weak to claim', () => {
    const output = renderToolResult(
      toolResult({
        tool: 'get_running_trend',
        data: {
          efficiencySummary: 'Across 12 easy runs there is no clear direction.',
          isMeaningfulTrend: false,
          percentChange: null,
          trendStrengthR2: 0.04,
          runsAnalysed: 12,
          paceAtComparableHeartRate: null,
        },
      }),
    );

    expect(output).toContain('no clear direction');
    expect(output).toContain('not yet strong evidence');
  });

  it('reports pace at a comparable heart rate as the evidence for improvement', () => {
    const output = renderToolResult(
      toolResult({
        tool: 'get_running_trend',
        data: {
          efficiencySummary: 'Your speed at a given heart rate has improved by about 5.3%.',
          isMeaningfulTrend: true,
          percentChange: 0.053,
          trendStrengthR2: 0.19,
          runsAnalysed: 34,
          paceAtComparableHeartRate: {
            heartRate: 143,
            recentPaceText: '5:43/km',
            earlierPaceText: '5:52/km',
            secondsPerKmChange: -9,
            recentRuns: 10,
            earlierRuns: 17,
          },
        },
      }),
    );

    expect(output).toContain('143 bpm');
    expect(output).toContain('a gain of');
    expect(output).toContain('9 seconds per kilometre');
  });

  it('lists which record distances could not be established, and why', () => {
    const output = renderToolResult(
      toolResult({
        tool: 'get_personal_bests',
        data: {
          records: [
            { distance: '10 km', timeText: '48:20', paceText: '4:50/km', date: '2026-07-01' },
          ],
          longestRun: { distanceText: '22.0 km', date: '2026-07-14' },
          longestRide: null,
          whereNoRecordExists: ['No Marathon record: you have no recorded run of at least that distance.'],
        },
      }),
    );

    expect(output).toContain('10 km');
    expect(output).toContain('22.0 km');
    expect(output).toContain('No Marathon record');
  });

  it('falls back to raw JSON rather than losing data it cannot render', () => {
    const output = renderToolResult(
      toolResult({ tool: 'something_unknown', data: { value: 42 } }),
    );
    expect(output).toContain('42');
  });
});

describe('renderAnswer', () => {
  it('joins several tool results into one answer', () => {
    const output = renderAnswer([
      toolResult({ tool: 'get_goal', data: { eventName: 'Frankfurt Marathon', targetDate: '2026-11-03', weeksAway: 12, trainingWeeks: 12, sessionsPlanned: 0 } }),
      toolResult({ tool: 'get_plan_changes', data: { changeCount: 0, reviewCount: 0, changes: [], latestReviewWithoutChange: null } }),
    ]);

    expect(output).toContain('Frankfurt Marathon');
    expect(output).toContain('No automatic changes');
  });

  it('says so when nothing could be answered', () => {
    expect(renderAnswer([])).toContain('could not find any data');
  });
});

// ---------------------------------------------------------------------------
// The language-model layer
// ---------------------------------------------------------------------------

describe('OllamaProvider.status', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('reports available when the server has the configured model', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(JSON.stringify({ models: [{ name: 'llama3.1:8b' }] }), { status: 200 }),
      ),
    );

    const status = await new OllamaProvider('http://localhost:11434', 'llama3.1:8b').status();

    expect(status.available).toBe(true);
    expect(status.reason).toBeNull();
  });

  it('matches a model configured without its tag', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(JSON.stringify({ models: [{ name: 'llama3.1:8b' }] }), { status: 200 }),
      ),
    );

    const status = await new OllamaProvider('http://localhost:11434', 'llama3.1').status();
    expect(status.available).toBe(true);
  });

  it('explains how to install a missing model', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(JSON.stringify({ models: [{ name: 'mistral:7b' }] }), { status: 200 }),
      ),
    );

    const status = await new OllamaProvider('http://localhost:11434', 'llama3.1:8b').status();

    expect(status.available).toBe(false);
    expect(status.modelMissing).toBe(true);
    expect(status.reason).toContain("ollama pull llama3.1:8b");
    expect(status.availableModels).toEqual(['mistral:7b']);
  });

  it('explains how to start a server that is not running', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('ECONNREFUSED'); }));

    const status = await new OllamaProvider().status();

    expect(status.available).toBe(false);
    expect(status.reason).toContain('ollama serve');
  });

  it('never throws, whatever the server does', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('nonsense', { status: 500 })));
    await expect(new OllamaProvider().status()).resolves.toBeDefined();
  });

  it('says so when no model has been configured at all', async () => {
    const status = await new OllamaProvider('http://localhost:11434', '').status();
    expect(status.available).toBe(false);
    expect(status.reason).toContain('OLLAMA_MODEL');
  });
});

describe('the system prompt', () => {
  it('forbids inventing or calculating numbers', () => {
    expect(SYSTEM_PROMPT).toContain('Never estimate, infer, recall or invent');
    expect(SYSTEM_PROMPT).toContain('Never perform calculations yourself');
  });

  it('requires the model to say when data is unavailable', () => {
    expect(SYSTEM_PROMPT).toContain('say so plainly');
  });

  it('rules out medical advice', () => {
    expect(SYSTEM_PROMPT).toContain('Never give medical advice');
  });

  it('keeps our calculated metrics distinct from Garmin’s own', () => {
    expect(SYSTEM_PROMPT).toContain("not Garmin's");
  });
});
