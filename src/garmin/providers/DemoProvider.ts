import { env } from '@/lib/env';
import { generateDemoData } from '@/demo/generator';
import type { GarminDataProvider } from '../provider';
import type { DateRange, ProviderData } from '../types';

/**
 * Supplies the synthetic demo athlete.
 *
 * Everything it returns carries `source: "demo"`, which the interface shows
 * plainly wherever the data appears. This provider is the reason the whole
 * application can be evaluated without a Garmin account — but it is never a
 * silent stand-in for a real connection that failed.
 */
export class DemoProvider implements GarminDataProvider {
  readonly id = 'demo' as const;
  readonly label = 'Demo athlete';

  isConfigured(): boolean {
    return env.demoMode;
  }

  unavailableReason(): string | null {
    return this.isConfigured()
      ? null
      : 'Demo mode is switched off. Set DEMO_MODE="true" in your .env file to use the demo athlete.';
  }

  async fetch(range: DateRange): Promise<ProviderData> {
    const weeks = Math.max(
      1,
      Math.ceil((range.end.getTime() - range.start.getTime()) / (7 * 24 * 60 * 60 * 1000)),
    );

    const { profile, activities, health } = generateDemoData({
      weeks,
      endDate: range.end,
    });

    return { profile, activities, health };
  }
}
