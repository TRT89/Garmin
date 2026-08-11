import type { Metadata } from 'next';
import { Nav } from '@/components/Nav';
import { CoachDock } from '@/components/coach/CoachDock';
import './globals.css';

export const metadata: Metadata = {
  title: 'Garmin AI Coach',
  description:
    'A personal adaptive endurance training coach that analyses your Garmin data, builds a training plan and explains every decision.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen">
        <Nav />
        <main className="mx-auto max-w-[1400px] px-4 py-8 pb-24 sm:px-6">{children}</main>
        <CoachDock />
      </body>
    </html>
  );
}
