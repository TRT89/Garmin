'use client';

import { clsx } from 'clsx';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

const LINKS = [
  { href: '/', label: 'Dashboard' },
  { href: '/activities', label: 'Activities' },
  { href: '/plan', label: 'Training Plan' },
  { href: '/coach', label: 'AI Coach' },
  { href: '/settings', label: 'Settings' },
];

export function Nav() {
  const pathname = usePathname();

  const isActive = (href: string) =>
    href === '/' ? pathname === '/' : pathname.startsWith(href);

  return (
    <header className="sticky top-0 z-40 border-b border-line bg-base/85 backdrop-blur">
      <div className="mx-auto flex h-14 max-w-[1400px] items-center gap-4 px-4 sm:gap-8 sm:px-6">
        <Link href="/" className="flex shrink-0 items-center gap-2.5">
          <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-accent text-sm font-bold text-base">
            AC
          </span>
          <span className="hidden text-sm font-semibold tracking-tight sm:inline">AI Coach</span>
        </Link>

        {/*
          `min-w-0` plus `overflow-x-auto` keeps the links inside the bar on a
          narrow screen. Without it the row cannot shrink, and it pushes the
          whole page wider than the viewport so every page scrolls sideways.
        */}
        <nav className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto">
          {LINKS.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className={clsx(
                'shrink-0 whitespace-nowrap rounded-lg px-3 py-1.5 text-sm transition-colors',
                isActive(link.href)
                  ? 'bg-surface-raised font-medium text-ink'
                  : 'text-ink-muted hover:bg-surface hover:text-ink',
              )}
            >
              {link.label}
            </Link>
          ))}
        </nav>
      </div>
    </header>
  );
}
