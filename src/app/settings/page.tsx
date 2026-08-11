import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { DemoControls } from '@/components/settings/DemoControls';
import { env, garminDisabledReason, isGarminConfigured } from '@/lib/env';
import { prisma } from '@/lib/db';

export const dynamic = 'force-dynamic';

export default async function SettingsPage() {
  const [activities, health, users] = await Promise.all([
    prisma.activity.count(),
    prisma.dailyHealth.count(),
    prisma.user.count(),
  ]);

  const garminOk = isGarminConfigured();

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Card title="Data sources" subtitle="Where your training data can come from">
        <ul className="space-y-4 text-sm">
          <li className="flex items-start justify-between gap-4">
            <div>
              <p className="font-medium text-ink">Garmin Connect API</p>
              <p className="mt-1 text-xs leading-relaxed text-ink-muted">
                {garminDisabledReason() ??
                  'Configured. Activities and health data can be synced directly from Garmin.'}
              </p>
            </div>
            <Badge tone={garminOk ? 'good' : 'neutral'}>
              {garminOk ? 'Configured' : 'Not configured'}
            </Badge>
          </li>
          <li className="flex items-start justify-between gap-4">
            <div>
              <p className="font-medium text-ink">Demo athlete</p>
              <p className="mt-1 text-xs leading-relaxed text-ink-muted">
                Twelve weeks of realistic synthetic training data so every feature can be tried
                without a Garmin account.
              </p>
            </div>
            <Badge tone={env.demoMode ? 'good' : 'neutral'}>
              {env.demoMode ? 'Available' : 'Disabled'}
            </Badge>
          </li>
        </ul>
      </Card>

      <Card
        title="Demo data"
        subtitle="Try every feature without a Garmin account"
        info="The demo athlete is generated locally from a fixed seed, so the same data is produced every time. Every record is stored as demo data and labelled as such throughout the application."
      >
        <p className="mb-4 text-xs leading-relaxed text-ink-muted">
          Loads twelve weeks of training and daily health data for a fictional marathon runner,
          including a deliberately poor recovery week and an unusually hard long run so the
          adaptive features have something real to react to.
        </p>
        <DemoControls enabled={env.demoMode} />
      </Card>

      <Card title="Database" subtitle="A single local SQLite file — nothing is uploaded anywhere">
        <dl className="space-y-3 text-sm">
          <div className="flex justify-between gap-4">
            <dt className="text-ink-muted">Location</dt>
            <dd className="tnum font-mono text-xs text-ink">{env.databaseUrl}</dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-ink-muted">Athlete profiles</dt>
            <dd className="tnum text-ink">{users}</dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-ink-muted">Activities</dt>
            <dd className="tnum text-ink">{activities}</dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-ink-muted">Daily health records</dt>
            <dd className="tnum text-ink">{health}</dd>
          </div>
        </dl>
      </Card>

      <Card title="AI Coach language model" subtitle="Optional, free, and runs on your own machine">
        <dl className="space-y-3 text-sm">
          <div className="flex justify-between gap-4">
            <dt className="text-ink-muted">Server</dt>
            <dd className="font-mono text-xs text-ink">{env.ollama.baseUrl}</dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-ink-muted">Model</dt>
            <dd className="font-mono text-xs text-ink">{env.ollama.model}</dd>
          </div>
        </dl>
        <p className="mt-4 text-xs leading-relaxed text-ink-muted">
          The coach analyses your data with built-in calculations either way. A language model
          only changes how the answers are worded.
        </p>
      </Card>
    </div>
  );
}
