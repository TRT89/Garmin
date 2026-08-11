import { clsx } from 'clsx';
import Link from 'next/link';
import type { ButtonHTMLAttributes, ReactNode } from 'react';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';
type Size = 'sm' | 'md';

const VARIANTS: Record<Variant, string> = {
  primary:
    'bg-accent text-base font-semibold hover:bg-accent-dim disabled:bg-accent/40 disabled:text-base/60',
  secondary:
    'border border-line bg-surface-raised text-ink hover:border-line-strong hover:bg-surface-hover disabled:text-ink-faint',
  ghost: 'text-ink-muted hover:bg-surface-raised hover:text-ink disabled:text-ink-faint',
  danger:
    'border border-alert/40 bg-alert/10 text-alert hover:bg-alert/20 disabled:text-alert/40',
};

const SIZES: Record<Size, string> = {
  sm: 'h-8 px-3 text-xs',
  md: 'h-10 px-4 text-sm',
};

function classes(variant: Variant, size: Size, className?: string) {
  return clsx(
    'inline-flex items-center justify-center gap-2 rounded-lg transition-colors disabled:cursor-not-allowed',
    VARIANTS[variant],
    SIZES[size],
    className,
  );
}

export function Button({
  variant = 'secondary',
  size = 'md',
  className,
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: Size }) {
  return (
    <button className={classes(variant, size, className)} {...props}>
      {children}
    </button>
  );
}

/** A link styled as a button, for navigation rather than actions. */
export function ButtonLink({
  href,
  variant = 'secondary',
  size = 'md',
  className,
  children,
}: {
  href: string;
  variant?: Variant;
  size?: Size;
  className?: string;
  children: ReactNode;
}) {
  return (
    <Link href={href} className={classes(variant, size, className)}>
      {children}
    </Link>
  );
}
