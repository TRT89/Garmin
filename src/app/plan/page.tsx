import { Card } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';

export const dynamic = 'force-dynamic';

export default function PlanPage() {
  return (
    <Card title="Training Plan">
      <EmptyState
        icon="◎"
        title="No training goal set"
        description="Set a goal — a race, a distance and a target time — and a week-by-week plan will be generated from your recent training."
      />
    </Card>
  );
}
