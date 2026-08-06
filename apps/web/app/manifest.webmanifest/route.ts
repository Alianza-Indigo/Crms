/** PWA manifest (PRD §27). Served as a route so branding can be tenant-aware. */
export function GET() {
  return Response.json({
    name: 'CRMS',
    short_name: 'CRMS',
    description: 'Enterprise application platform',
    start_url: '/',
    display: 'standalone',
    background_color: '#0f172a',
    theme_color: '#0f172a',
    icons: [],
  });
}
