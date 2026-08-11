import { Card } from '@/components/ui/Card';
import { ButtonLink } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { prisma } from '@/lib/db';

export const dynamic = 'force-dynamic';

export default async function DashboardPage() {
  const activityCount = await prisma.activity.count();

  if (activityCount === 0) {
    return (
      <Card>
        <EmptyState
          icon="◷"
          title="No training data yet"
          description="Load the demo athlete to explore every feature with twelve weeks of realistic training data, or connect your own data from the settings page."
          action={
            <ButtonLink href="/settings" variant="primary">
              Go to Settings
            </ButtonLink>
          }
        />
      </Card>
    );
  }

  return (
    <Card title="Dashboard">
      <p className="text-sm text-ink-muted">{activityCount} activities loaded.</p>
    </Card>
  );
}
