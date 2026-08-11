import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import type { CoachSummary } from '@/analytics/insights';

const TONE_MARKS = {
  positive: { symbol: '↑', className: 'text-good' },
  caution: { symbol: '!', className: 'text-caution' },
  neutral: { symbol: '·', className: 'text-ink-faint' },
} as const;

/**
 * The dashboard's headline assessment.
 *
 * Everything shown here comes from the deterministic analytics engine. The
 * evidence behind each statement is always one click away, which is the point:
 * the athlete should never have to take a claim on trust.
 */
export function CoachSummaryCard({ summary }: { summary: CoachSummary }) {
  return (
    <Card
      title="Coach Summary"
      subtitle="Assembled from your training data"
      info="Every statement here is generated from values calculated out of your own activities and health records. Expand any line to see the exact numbers behind it."
      action={<Badge tone="neutral">Calculated, not guessed</Badge>}
    >
      <ul className="space-y-3">
        {summary.insights.map((insight, index) => {
          const mark = TONE_MARKS[insight.tone];
          return (
            <li key={index}>
              <details className="group">
                <summary className="flex cursor-pointer list-none items-start gap-2.5 text-sm leading-relaxed text-ink marker:content-none">
                  <span className={`mt-0.5 shrink-0 font-bold ${mark.className}`}>
                    {mark.symbol}
                  </span>
                  <span className="flex-1">{insight.text}</span>
                  <span className="mt-0.5 shrink-0 text-[10px] text-ink-faint transition-transform group-open:rotate-90">
                    ▶
                  </span>
                </summary>
                <ul className="ml-6 mt-2 space-y-1 border-l border-line pl-3">
                  {insight.evidence.map((item, i) => (
                    <li key={i} className="tnum text-xs text-ink-muted">
                      {item}
                    </li>
                  ))}
                </ul>
              </details>
            </li>
          );
        })}
      </ul>

      <div className="mt-5 rounded-lg border border-accent/25 bg-accent/5 p-4">
        <p className="eyebrow text-accent/80">Recommended action</p>
        <p className="mt-1.5 text-sm font-medium text-ink">{summary.recommendation}</p>
        {summary.recommendationReasons.length > 0 && (
          <details className="group mt-2">
            <summary className="cursor-pointer list-none text-xs text-ink-muted hover:text-ink marker:content-none">
              Why? <span className="inline-block transition-transform group-open:rotate-90">▶</span>
            </summary>
            <ul className="mt-2 space-y-1 border-l border-line pl-3">
              {summary.recommendationReasons.map((reason, i) => (
                <li key={i} className="text-xs leading-relaxed text-ink-muted">
                  {reason}
                </li>
              ))}
            </ul>
          </details>
        )}
      </div>
    </Card>
  );
}
