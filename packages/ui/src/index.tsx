import type { CSSProperties, ButtonHTMLAttributes, InputHTMLAttributes, ReactNode } from 'react';
import { tokens } from './tokens.js';

export * from './tokens.js';

/**
 * Shared UI primitives (PRD §36 `/packages/ui`). Framework-light React
 * components styled from the design tokens, theme-aware via CSS variables so
 * white-label branding applies automatically.
 */

export function Button({
  variant = 'primary',
  style,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'ghost' | 'danger' }) {
  const base: CSSProperties = {
    padding: `${tokens.space(2.5)} ${tokens.space(4)}`,
    borderRadius: tokens.radius.md,
    fontWeight: 600,
    cursor: 'pointer',
    border: '1px solid transparent',
  };
  const variants: Record<string, CSSProperties> = {
    primary: { background: tokens.color.accent, color: '#fff' },
    ghost: { background: 'transparent', color: tokens.color.fg, borderColor: tokens.color.border },
    danger: { background: tokens.color.danger, color: '#fff' },
  };
  return <button style={{ ...base, ...variants[variant], ...style }} {...props} />;
}

export function Card({ children, style }: { children: ReactNode; style?: CSSProperties }) {
  return (
    <div
      style={{
        background: tokens.color.panel,
        border: `1px solid ${tokens.color.border}`,
        borderRadius: tokens.radius.lg,
        padding: tokens.space(5),
        ...style,
      }}
    >
      {children}
    </div>
  );
}

export function Input(props: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      style={{
        width: '100%',
        padding: `${tokens.space(2.4)} ${tokens.space(3)}`,
        borderRadius: tokens.radius.md,
        border: `1px solid ${tokens.color.border}`,
        background: '#0b1220',
        color: tokens.color.fg,
        ...props.style,
      }}
    />
  );
}

export function Badge({ children }: { children: ReactNode }) {
  return (
    <span
      style={{
        display: 'inline-block',
        fontSize: '0.72rem',
        padding: `${tokens.space(0.6)} ${tokens.space(2)}`,
        border: `1px solid ${tokens.color.border}`,
        borderRadius: tokens.radius.pill,
        color: tokens.color.muted,
      }}
    >
      {children}
    </span>
  );
}
