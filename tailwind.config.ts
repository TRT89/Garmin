import type { Config } from 'tailwindcss';

/**
 * Design tokens for Garmin AI Coach.
 *
 * The look is a dark "instrument panel": near-black layered surfaces, one
 * confident accent, and colour reserved for meaning (sport identity, status,
 * good/bad deltas) rather than decoration.
 */
const config: Config = {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Layered surfaces, darkest at the back.
        base: '#08090c',
        surface: {
          DEFAULT: '#0e1015',
          raised: '#14171e',
          hover: '#1a1e27',
        },
        line: {
          DEFAULT: '#22262f',
          strong: '#31374260',
        },
        ink: {
          DEFAULT: '#f2f4f8',
          muted: '#9aa3b2',
          faint: '#616b7c',
        },
        // Primary accent — used for the athlete's own progress and focus states.
        accent: {
          DEFAULT: '#4ade80',
          dim: '#22c55e',
          faint: '#4ade8014',
        },
        // Semantic status colours.
        good: '#4ade80',
        caution: '#fbbf24',
        alert: '#fb7185',
        info: '#60a5fa',
        // Per-sport identity, reused by every chart so colour means one thing.
        sport: {
          running: '#4ade80',
          cycling: '#60a5fa',
          swimming: '#22d3ee',
          other: '#a78bfa',
        },
        // Training-load model series.
        load: {
          acute: '#fb7185',
          chronic: '#60a5fa',
          form: '#a78bfa',
        },
      },
      fontFamily: {
        sans: [
          'ui-sans-serif',
          '-apple-system',
          'BlinkMacSystemFont',
          'Segoe UI',
          'Helvetica Neue',
          'Arial',
          'sans-serif',
        ],
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'Consolas', 'monospace'],
      },
      fontSize: {
        // Deliberate step for the large KPI readouts.
        kpi: ['2rem', { lineHeight: '1.1', letterSpacing: '-0.02em' }],
        'kpi-lg': ['2.75rem', { lineHeight: '1.05', letterSpacing: '-0.03em' }],
      },
      borderRadius: {
        card: '14px',
      },
      boxShadow: {
        card: '0 1px 2px rgba(0,0,0,0.4), 0 8px 24px -12px rgba(0,0,0,0.6)',
      },
      keyframes: {
        'fade-in': {
          from: { opacity: '0', transform: 'translateY(4px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
        'pulse-soft': {
          '0%, 100%': { opacity: '1' },
          '50%': { opacity: '0.45' },
        },
      },
      animation: {
        'fade-in': 'fade-in 200ms ease-out',
        'pulse-soft': 'pulse-soft 1.6s ease-in-out infinite',
      },
    },
  },
  plugins: [],
};

export default config;
