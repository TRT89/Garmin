import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { DemoControls } from '@/components/settings/DemoControls';
import { FitUpload } from '@/components/settings/FitUpload';
import { ProfileForm } from '@/components/settings/ProfileForm';
import { DataTransfer } from '@/components/settings/DataTransfer';
import { SyncButton } from '@/components/SyncButton';
import { env, garminDisabledReason, isGarminConfigured } from '@/lib/env';
import { getUser, prisma } from '@/lib/db';
import { getLastSync, describeSyncAge } from '@/garmin/syncPipeline';
import { getLLMProvider } from '@/ai/llm/ollama';
import { GarminProvider } from '@/garmin/providers/GarminProvider';
import { LOAD_EXPLANATION } from '@/analytics/trainingLoad';

export const dynamic = 'force-dynamic';

export default async function SettingsPage() {
  const user = await getUser();

  const [activities, health, goals, llm, lastSync] = await Promise.all([
    prisma.activity.count(),
    prisma.dailyHealth.count(),
    prisma.trainingGoal.count(),
    getLLMProvider().status(),
    getLastSync(),
  ]);

  const garmin = new GarminProvider();
  const garminReady = garmin.isConfigured();
  const credentialsPresent = isGarminConfigured();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
        <p className="mt-1 text-sm text-ink-muted">
          Everything runs on this computer. Nothing is uploaded anywhere.
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* --- Profile --------------------------------------------------- */}
        <Card
          title="Profile"
          subtitle="Used to calculate your training load and heart-rate guidance"
          info={LOAD_EXPLANATION}
          className="lg:row-span-2"
        >
          <ProfileForm
            profile={{
              name: user.name,
              age: user.age,
              sex: user.sex,
              height: user.height,
              weight: user.weight,
              maxHR: user.maxHR,
              restingHR: user.restingHR,
              preferredUnits: user.preferredUnits,
            }}
          />
        </Card>

        {/* --- Sync ------------------------------------------------------- */}
        <Card
          title="Sync"
          subtitle="Import new training and re-evaluate your plan"
          info="A sync retrieves new data, recalculates your metrics, matches completed sessions to your plan, and considers whether upcoming sessions should change."
        >
          <SyncButton lastSynced={describeSyncAge(lastSync?.startedAt ?? null)} />
        </Card>

        {/* --- Garmin ----------------------------------------------------- */}
        <Card
          title="Garmin Connect API"
          subtitle="Optional — requires approval from Garmin"
          action={
            <Badge tone={garminReady ? 'good' : 'neutral'}>
              {garminReady ? 'Connected' : 'Not configured'}
            </Badge>
          }
        >
          <p className="text-xs leading-relaxed text-ink-muted">
            {garmin.unavailableReason() ??
              'The connector is configured and can sync activities and health data directly from Garmin.'}
          </p>

          {!garminReady && (
            <div className="mt-4 space-y-2 border-t border-line pt-4 text-xs text-ink-faint">
              <p className="text-ink-muted">To connect your Garmin account:</p>
              <ol className="ml-4 list-decimal space-y-1">
                <li>
                  Apply to the{' '}
                  <a
                    href="https://developer.garmin.com/gc-developer-program/"
                    target="_blank"
                    rel="noreferrer"
                    className="text-ink-muted underline hover:text-ink"
                  >
                    Garmin Connect Developer Program
                  </a>
                  .
                </li>
                <li>
                  Put the credentials Garmin issues into your <code>.env</code> file as{' '}
                  <code>GARMIN_CLIENT_ID</code> and <code>GARMIN_CLIENT_SECRET</code>, and set{' '}
                  <code>GARMIN_ENABLED=&quot;true&quot;</code>.
                </li>
                <li>
                  Complete the endpoint configuration in{' '}
                  <code>src/garmin/providers/GarminProvider.ts</code> using the documentation
                  Garmin supplies on approval.
                </li>
              </ol>
              <p className="pt-2">
                Until then, use FIT file upload or the demo athlete — every feature works with
                either. This connector is never quietly substituted with made-up data.
              </p>
              {credentialsPresent && (
                <p className="text-caution">
                  Credentials are present, but the endpoint configuration is still empty.
                </p>
              )}
            </div>
          )}
        </Card>

        {/* --- FIT upload -------------------------------------------------- */}
        <Card
          title="FIT file upload"
          subtitle="Import real activities from your watch"
          info="FIT is the format Garmin devices record in. Files are decoded with Garmin's own free SDK, and any metric a file does not contain is stored as missing rather than estimated."
        >
          <FitUpload />
        </Card>

        {/* --- Demo -------------------------------------------------------- */}
        <Card
          title="Demo athlete"
          subtitle="Try every feature without a Garmin account"
          info="Generated locally from a fixed seed, so the same data is produced every time. Every record is stored and labelled as demo data."
        >
          <p className="mb-4 text-xs leading-relaxed text-ink-muted">
            Twelve weeks of training and daily health data for a fictional marathon runner —
            including a deliberately poor recovery week, an unusually hard long run and a dip in
            the last few days, so the adaptive features have something real to react to.
          </p>
          <DemoControls enabled={env.demoMode} />
        </Card>

        {/* --- AI Coach ---------------------------------------------------- */}
        <Card
          title="AI Coach language model"
          subtitle="Optional, free, and runs on your own machine"
          action={
            <Badge tone={llm.available ? 'good' : 'neutral'}>
              {llm.available ? 'Available' : 'Not running'}
            </Badge>
          }
        >
          <dl className="space-y-2 text-sm">
            <div className="flex justify-between gap-4">
              <dt className="text-ink-muted">Server</dt>
              <dd className="font-mono text-xs text-ink">{llm.baseUrl}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-ink-muted">Model</dt>
              <dd className="font-mono text-xs text-ink">{llm.model || 'not set'}</dd>
            </div>
          </dl>

          {llm.reason && (
            <p className="mt-3 rounded-lg border border-line bg-surface-raised p-3 text-xs leading-relaxed text-ink-muted">
              {llm.reason}
            </p>
          )}

          {llm.availableModels && llm.availableModels.length > 0 && (
            <p className="mt-2 text-xs text-ink-faint">
              Models currently installed: {llm.availableModels.join(', ')}
            </p>
          )}

          <p className="mt-3 text-xs leading-relaxed text-ink-faint">
            The coach works without a language model — it answers from the same calculations
            either way, just in plainer wording. Installing{' '}
            <a
              href="https://ollama.com"
              target="_blank"
              rel="noreferrer"
              className="text-ink-muted underline hover:text-ink"
            >
              Ollama
            </a>{' '}
            (free) only makes the answers more conversational.
          </p>
        </Card>

        {/* --- Database ----------------------------------------------------- */}
        <Card title="Database" subtitle="A single local file — nothing leaves this computer">
          <dl className="space-y-2 text-sm">
            <div className="flex justify-between gap-4">
              <dt className="text-ink-muted">Location</dt>
              <dd className="tnum font-mono text-xs text-ink">{env.databaseUrl}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-ink-muted">Activities</dt>
              <dd className="tnum text-ink">{activities}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-ink-muted">Daily health records</dt>
              <dd className="tnum text-ink">{health}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-ink-muted">Training goals</dt>
              <dd className="tnum text-ink">{goals}</dd>
            </div>
          </dl>

          <div className="mt-5 border-t border-line pt-5">
            <DataTransfer />
          </div>
        </Card>
      </div>
    </div>
  );
}
