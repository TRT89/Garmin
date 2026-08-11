import { Card } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';

export const dynamic = 'force-dynamic';

export default function CoachPage() {
  return (
    <Card title="AI Coach">
      <EmptyState
        icon="◍"
        title="Nothing to talk about yet"
        description="The AI Coach answers questions using your own training data. Load some data first and it will have something to work with."
      />
    </Card>
  );
}
