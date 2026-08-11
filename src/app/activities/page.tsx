import { Card } from '@/components/ui/Card';
import { ButtonLink } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { prisma } from '@/lib/db';

export const dynamic = 'force-dynamic';

export default async function ActivitiesPage() {
  const count = await prisma.activity.count();
  return (
    <Card title="Activities">
      {count === 0 ? (
        <EmptyState
          icon="◷"
          title="No activities yet"
          description="Activities appear here once you load the demo athlete, upload a FIT file, or sync from Garmin."
          action={
            <ButtonLink href="/settings" variant="primary">
              Go to Settings
            </ButtonLink>
          }
        />
      ) : (
        <p className="text-sm text-ink-muted">{count} activities.</p>
      )}
    </Card>
  );
}
