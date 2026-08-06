/**
 * Design tokens (PRD §34.1, §36). The single source of truth for the platform's
 * default look. White-label branding overrides these at runtime via CSS
 * variables (see the web BrandingProvider).
 */
export const tokens = {
  color: {
    bg: 'var(--bg, #0f172a)',
    panel: 'var(--panel, #1e293b)',
    fg: 'var(--fg, #e2e8f0)',
    muted: 'var(--muted, #94a3b8)',
    accent: 'var(--accent, #6366f1)',
    border: 'var(--border, #334155)',
    danger: '#b91c1c',
    success: '#16a34a',
  },
  radius: { sm: '6px', md: '8px', lg: '12px', pill: '999px' },
  space: (n: number) => `${n * 0.25}rem`,
  font: 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
} as const;

export type Tokens = typeof tokens;
