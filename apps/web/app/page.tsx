import Link from 'next/link';

const CAPABILITIES = [
  ['Multi-tenant al núcleo', 'tenant_id, RLS y contexto obligatorio en cada operación.'],
  ['Constructor no-code', 'Módulos, campos, relaciones, vistas, formularios y pipelines.'],
  ['IA como arquitecto', 'Genera y modifica aplicaciones con planes aprobables (AIPlan).'],
  ['BYO Credentials', 'Cada tenant conecta sus propias credenciales cifradas.'],
  ['Automatizaciones', 'Motor visual con outbox transaccional, reintentos e idempotencia.'],
  ['Independencia por app', 'Cada aplicación es un límite aislado de datos y despliegue.'],
];

export default function Home() {
  return (
    <div className="container grid" style={{ gap: '2rem' }}>
      <header className="grid" style={{ gap: '0.75rem' }}>
        <span className="badge">Plataforma empresarial multi-tenant · v3.0</span>
        <h1 style={{ fontSize: '2.4rem', margin: 0 }}>
          Construye CRMs y aplicaciones empresariales con IA, sin partir de cero.
        </h1>
        <p className="muted" style={{ maxWidth: 720 }}>
          El motor, los constructores, la seguridad, la ejecución y la administración los aporta la plataforma.
          Cada cliente aporta sus propias credenciales. Ninguna se comparte entre tenants.
        </p>
        <div style={{ display: 'flex', gap: '0.75rem' }}>
          <Link className="btn" href="/login">
            Entrar
          </Link>
          <Link className="btn" href="/builder" style={{ background: 'transparent', border: '1px solid var(--border)' }}>
            Centro de construcción
          </Link>
        </div>
      </header>

      <section className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))' }}>
        {CAPABILITIES.map(([title, body]) => (
          <div key={title} className="card">
            <h3 style={{ marginTop: 0 }}>{title}</h3>
            <p className="muted" style={{ margin: 0 }}>
              {body}
            </p>
          </div>
        ))}
      </section>
    </div>
  );
}
