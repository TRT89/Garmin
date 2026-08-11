import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { EmptyState } from '@/components/ui/EmptyState';
import { ButtonLink } from '@/components/ui/Button';
import { CoachChat } from '@/components/coach/CoachChat';
import { findUser, prisma } from '@/lib/db';
import { getLLMProvider } from '@/ai/llm/ollama';

export const dynamic = 'force-dynamic';

export default async function CoachPage() {
  const user = await findUser();
  const activityCount = user ? await prisma.activity.count({ where: { userId: user.id } }) : 0;

  if (activityCount === 0) {
    return (
      <Card title="AI Coach">
        <EmptyState
          icon="◍"
          title="Nothing to talk about yet"
          description="The coach answers questions using your own training data, so it needs some first. Load the demo athlete or import a FIT file."
          action={
            <ButtonLink href="/settings" variant="primary">
              Go to Settings
            </ButtonLink>
          }
        />
      </Card>
    );
  }

  const llm = await getLLMProvider().status();

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">AI Coach</h1>
          <p className="mt-1 text-sm text-ink-muted">
            Answers computed from your training data, never guessed.
          </p>
        </div>
        <Badge tone={llm.available ? 'good' : 'neutral'}>
          {llm.available ? `Language model: ${llm.model}` : 'Running without a language model'}
        </Badge>
      </div>

      {!llm.available && llm.reason && (
        <Card>
          <p className="text-xs leading-relaxed text-ink-muted">
            <span className="text-ink">The coach is fully usable right now.</span> {llm.reason} The
            calculations behind every answer are the same either way — a language model only makes
            the wording more conversational.
          </p>
        </Card>
      )}

      <Card bodyClassName="p-5">
        <CoachChat />
      </Card>
    </div>
  );
}
