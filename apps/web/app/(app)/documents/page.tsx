'use client';

import { useEffect, useState } from 'react';
import { getClient } from '../../../lib/crms';

interface ModuleRef {
  id: string;
  name: string;
}
interface Template {
  id: string;
  key: string;
  name: string;
}
interface GeneratedDoc {
  id: string;
  name?: string;
  createdAt?: string;
}

export default function DocumentsPage() {
  const [modules, setModules] = useState<ModuleRef[]>([]);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [docs, setDocs] = useState<GeneratedDoc[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [tpl, setTpl] = useState({ key: '', name: '', moduleId: '', html: '<h1>{{title}}</h1>\n<p>Hola {{nombre}}</p>' });
  const [gen, setGen] = useState({ templateId: '', recordId: '', data: '{\n  "title": "Documento",\n  "nombre": "Cliente"\n}' });

  async function load() {
    try {
      const c = getClient();
      const [t, d, m] = await Promise.all([c.documents.templates(), c.documents.list(), c.modules.list()]);
      setTemplates(t as unknown as Template[]);
      setDocs(d as unknown as GeneratedDoc[]);
      setModules(m as ModuleRef[]);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error');
    }
  }
  useEffect(() => {
    load();
  }, []);

  async function createTemplate(e: React.FormEvent) {
    e.preventDefault();
    try {
      await getClient().documents.createTemplate({ key: tpl.key, name: tpl.name, html: tpl.html, moduleId: tpl.moduleId || undefined });
      setTpl({ ...tpl, key: '', name: '' });
      setCreating(false);
      await load();
    } catch (e2) {
      setError(e2 instanceof Error ? e2.message : 'Error');
    }
  }

  async function generate(e: React.FormEvent) {
    e.preventDefault();
    setStatus(null);
    try {
      let data: Record<string, unknown> = {};
      try {
        data = JSON.parse(gen.data || '{}');
      } catch {
        throw new Error('Los datos no son JSON válido');
      }
      const res = await getClient().documents.generate({
        templateId: gen.templateId,
        recordId: gen.recordId || undefined,
        data,
        output: 'pdf',
      });
      setStatus(`Documento generado: ${res.documentId}`);
      await load();
    } catch (e2) {
      setError(e2 instanceof Error ? e2.message : 'Error');
    }
  }

  return (
    <div style={{ display: 'grid', gap: '1.25rem', maxWidth: 860 }}>
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <span className="badge">Documentos</span>
          <h1 style={{ margin: '0.4rem 0 0' }}>Plantillas y generación</h1>
        </div>
        <button className="btn" onClick={() => setCreating((v) => !v)}>{creating ? 'Cancelar' : '+ Plantilla'}</button>
      </header>

      {error && <div className="card" style={{ borderColor: '#7f1d1d', color: '#f87171' }}>{error}</div>}
      {status && <div className="card" style={{ borderColor: '#14532d', color: '#4ade80' }}>{status}</div>}

      <section style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(200px,1fr))', gap: '0.8rem' }}>
        {templates.map((t) => (
          <div key={t.id} className="card">
            <h3 style={{ margin: '0 0 0.2rem' }}>{t.name}</h3>
            <code className="muted">{t.key}</code>
          </div>
        ))}
        {templates.length === 0 && <p className="muted">Sin plantillas. Crea una con variables tipo {'{{nombre}}'}.</p>}
      </section>

      {creating && (
        <form onSubmit={createTemplate} className="card" style={{ display: 'grid', gap: '0.7rem' }}>
          <h3 style={{ margin: 0 }}>Nueva plantilla</h3>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '0.7rem' }}>
            <label>
              Nombre
              <input className="input" value={tpl.name} onChange={(e) => setTpl({ ...tpl, name: e.target.value })} required />
            </label>
            <label>
              Clave
              <input className="input" value={tpl.key} onChange={(e) => setTpl({ ...tpl, key: e.target.value })} placeholder="cotizacion" required />
            </label>
            <label>
              Módulo (opcional)
              <select className="input" value={tpl.moduleId} onChange={(e) => setTpl({ ...tpl, moduleId: e.target.value })}>
                <option value="">Ninguno</option>
                {modules.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <label>
            Contenido HTML (usa {'{{variable}}'})
            <textarea className="input" rows={6} value={tpl.html} onChange={(e) => setTpl({ ...tpl, html: e.target.value })} />
          </label>
          <button className="btn">Crear plantilla</button>
        </form>
      )}

      <section className="card" style={{ display: 'grid', gap: '0.7rem' }}>
        <h2 style={{ margin: 0, fontSize: '1.1rem' }}>Generar documento</h2>
        <form onSubmit={generate} style={{ display: 'grid', gap: '0.7rem' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.7rem' }}>
            <label>
              Plantilla
              <select className="input" value={gen.templateId} onChange={(e) => setGen({ ...gen, templateId: e.target.value })} required>
                <option value="">Elige…</option>
                {templates.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Registro (opcional)
              <input className="input" value={gen.recordId} onChange={(e) => setGen({ ...gen, recordId: e.target.value })} placeholder="rec_..." />
            </label>
          </div>
          <label>
            Datos (JSON)
            <textarea className="input" rows={4} value={gen.data} onChange={(e) => setGen({ ...gen, data: e.target.value })} />
          </label>
          <button className="btn">Generar PDF</button>
        </form>
      </section>

      <section style={{ display: 'grid', gap: '0.5rem' }}>
        <h2 style={{ margin: '0.5rem 0 0', fontSize: '1.1rem' }}>Documentos generados</h2>
        <div className="card">
          {docs.length === 0 && <p className="muted" style={{ margin: 0 }}>Aún no hay documentos generados.</p>}
          {docs.map((d) => (
            <div key={d.id} style={{ borderTop: '1px solid var(--border)', padding: '0.4rem 0' }}>
              <code className="muted">{d.id}</code> {d.name && <span>— {d.name}</span>}
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
