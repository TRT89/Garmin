'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Button } from '@/components/ui/Button';
import { InfoTip } from '@/components/ui/InfoTip';

export interface ProfileValues {
  name: string;
  age: number | null;
  sex: string | null;
  height: number | null;
  weight: number | null;
  maxHR: number | null;
  restingHR: number | null;
  preferredUnits: string;
}

const field =
  'w-full rounded-lg border border-line bg-surface-raised px-3 py-2 text-sm text-ink placeholder:text-ink-faint focus:border-accent/50';

/** Parse a form field into a number, treating empty as "not known". */
function toNumber(value: string): number | null {
  if (value.trim() === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function ProfileForm({ profile }: { profile: ProfileValues }) {
  const router = useRouter();
  const [values, setValues] = useState(profile);
  const [state, setState] = useState<'idle' | 'saving' | 'saved'>('idle');
  const [error, setError] = useState<string | null>(null);

  function set<K extends keyof ProfileValues>(key: K, value: ProfileValues[K]) {
    setValues((previous) => ({ ...previous, [key]: value }));
    setState('idle');
  }

  async function save() {
    setState('saving');
    setError(null);

    try {
      const response = await fetch('/api/profile', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(values),
      });
      const body = await response.json();

      if (!response.ok || !body.ok) {
        setError(body.error ?? 'Your profile could not be saved.');
        setState('idle');
        return;
      }

      setState('saved');
      router.refresh();
    } catch {
      setError('Could not reach the application server.');
      setState('idle');
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <label className="eyebrow mb-1.5 block" htmlFor="name">
          Name
        </label>
        <input
          id="name"
          className={field}
          value={values.name}
          onChange={(e) => set('name', e.target.value)}
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className="eyebrow mb-1.5 block" htmlFor="age">
            Age
          </label>
          <input
            id="age"
            type="number"
            className={field}
            value={values.age ?? ''}
            onChange={(e) => set('age', toNumber(e.target.value))}
          />
        </div>

        <div>
          <label className="eyebrow mb-1.5 flex items-center gap-1.5" htmlFor="sex">
            Sex
            <InfoTip text="Used only to pick the coefficient in the training-load formula, which differs slightly between published male and female versions. Leave blank to use the default." />
          </label>
          <select
            id="sex"
            className={field}
            value={values.sex ?? ''}
            onChange={(e) => set('sex', e.target.value === '' ? null : e.target.value)}
          >
            <option value="">Prefer not to say</option>
            <option value="female">Female</option>
            <option value="male">Male</option>
            <option value="other">Other</option>
          </select>
        </div>

        <div>
          <label className="eyebrow mb-1.5 block" htmlFor="height">
            Height (cm)
          </label>
          <input
            id="height"
            type="number"
            className={field}
            value={values.height ?? ''}
            onChange={(e) => set('height', toNumber(e.target.value))}
          />
        </div>

        <div>
          <label className="eyebrow mb-1.5 block" htmlFor="weight">
            Weight (kg)
          </label>
          <input
            id="weight"
            type="number"
            step="0.1"
            className={field}
            value={values.weight ?? ''}
            onChange={(e) => set('weight', toNumber(e.target.value))}
          />
        </div>
      </div>

      <div className="grid gap-4 border-t border-line pt-4 sm:grid-cols-2">
        <div>
          <label className="eyebrow mb-1.5 flex items-center gap-1.5" htmlFor="maxHR">
            Maximum heart rate
            <InfoTip text="Your training load and all heart-rate guidance are calculated from your heart-rate reserve, which is the gap between your resting and maximum heart rate. Getting these right matters more than any other setting here." />
          </label>
          <input
            id="maxHR"
            type="number"
            className={field}
            value={values.maxHR ?? ''}
            onChange={(e) => set('maxHR', toNumber(e.target.value))}
          />
        </div>

        <div>
          <label className="eyebrow mb-1.5 block" htmlFor="restingHR">
            Resting heart rate
          </label>
          <input
            id="restingHR"
            type="number"
            className={field}
            value={values.restingHR ?? ''}
            onChange={(e) => set('restingHR', toNumber(e.target.value))}
          />
        </div>
      </div>

      <div>
        <label className="eyebrow mb-1.5 block" htmlFor="units">
          Units
        </label>
        <select
          id="units"
          className={field}
          value={values.preferredUnits}
          onChange={(e) => set('preferredUnits', e.target.value)}
        >
          <option value="metric">Metric (kilometres)</option>
          <option value="imperial">Imperial (miles)</option>
        </select>
      </div>

      {error && (
        <p className="rounded-lg border border-alert/30 bg-alert/5 p-3 text-xs text-alert">
          {error}
        </p>
      )}

      <div className="flex items-center gap-3">
        <Button variant="primary" onClick={save} disabled={state === 'saving'}>
          {state === 'saving' ? 'Saving…' : 'Save profile'}
        </Button>
        {state === 'saved' && <span className="text-xs text-good">Saved.</span>}
      </div>

      <p className="text-xs leading-relaxed text-ink-faint">
        Changing your heart rates affects how training load is calculated for future imports.
        Activities already stored keep the figures they were given at the time.
      </p>
    </div>
  );
}
