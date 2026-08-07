'use client';

import { use, useEffect, useState } from 'react';
import { api } from '../../../lib/api';

interface PField {
  key: string;
  name: string;
  type: string;
  required: boolean;
  config: { options?: Array<{ value: string; label?: string }> };
}
interface PForm {
  id: string;
  name: string;
  kind: string;
  fields: PField[];
}

const STEP_SIZE = 4;

/** Public form (PRD §14): anonymous capture, optional multi-step. */
export default function PublicFormPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = use(params);
  const [form, setForm] = useState<PForm | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});
  const [step, setStep] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api<PForm>(`/forms/public/${slug}`)
      .then(setForm)
      .catch((e) => setError(e instanceof Error ? e.message : 'Error'));
  }, [slug]);

  if (error && !form) return <Centered><p style={{ color: '#f87171' }}>{error}</p></Centered>;
  if (!form) return <Centered><p className="muted">Cargando…</p></Centered>;
  if (done)
    return (
      <Centered>
        <div className="card" style={{ maxWidth: 460, textAlign: 'center' }}>
          <h2 style={{ marginTop: 0 }}>¡Gracias! ✅</h2>
          <p className="muted">Tu información fue enviada correctamente.</p>
        </div>
      </Centered>
    );

  const multiStep = form.kind === 'multi_step';
  const steps = multiStep ? chunk(form.fields, STEP_SIZE) : [form.fields];
  const current = steps[step] ?? [];
  const isLast = step === steps.length - 1;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!isLast) {
      setStep((s) => s + 1);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const data: Record<string, unknown> = {};
      for (const f of form!.fields) {
        const v = values[f.key];
        if (v !== undefined && v !== '') data[f.key] = ['integer', 'decimal', 'currency', 'percent'].includes(f.type) ? Number(v) : v;
      }
      await api(`/forms/public/${slug}/submit`, { method: 'POST', body: JSON.stringify({ data }) });
      setDone(true);
    } catch (e2) {
      setError(e2 instanceof Error ? e2.message : 'Error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Centered>
      <form onSubmit={submit} className="card" style={{ maxWidth: 480, width: '100%', display: 'grid', gap: '0.8rem' }}>
        <h2 style={{ margin: 0 }}>{form.name}</h2>
        {multiStep && <div className="muted" style={{ fontSize: '0.85rem' }}>Paso {step + 1} de {steps.length}</div>}
        {error && <div style={{ color: '#f87171' }}>{error}</div>}
        {current.map((f) => (
          <label key={f.key}>
            {f.name}
            {f.required ? ' *' : ''}
            <FieldInput field={f} value={values[f.key] ?? ''} onChange={(v) => setValues({ ...values, [f.key]: v })} />
          </label>
        ))}
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          {multiStep && step > 0 && (
            <button type="button" className="btn" style={{ background: 'transparent', border: '1px solid var(--border)', color: 'var(--muted)' }} onClick={() => setStep((s) => s - 1)}>
              Atrás
            </button>
          )}
          <button className="btn" disabled={busy} style={{ flex: 1 }}>
            {busy ? '…' : isLast ? 'Enviar' : 'Siguiente'}
          </button>
        </div>
      </form>
    </Centered>
  );
}

function FieldInput({ field, value, onChange }: { field: PField; value: string; onChange: (v: string) => void }) {
  const opts = field.config?.options;
  if (opts) {
    return (
      <select className="input" value={value} onChange={(e) => onChange(e.target.value)} required={field.required}>
        <option value="">—</option>
        {opts.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label ?? o.value}
          </option>
        ))}
      </select>
    );
  }
  if (field.type === 'text_long') return <textarea className="input" rows={3} value={value} onChange={(e) => onChange(e.target.value)} required={field.required} />;
  if (field.type === 'boolean')
    return <input type="checkbox" checked={value === 'true'} onChange={(e) => onChange(e.target.checked ? 'true' : 'false')} />;
  const type = field.type === 'email' ? 'email' : field.type === 'phone' ? 'tel' : field.type === 'url' ? 'url' : ['integer', 'decimal', 'currency', 'percent'].includes(field.type) ? 'number' : field.type === 'date' ? 'date' : field.type === 'datetime' ? 'datetime-local' : 'text';
  return <input className="input" type={type} value={value} onChange={(e) => onChange(e.target.value)} required={field.required} />;
}

function Centered({ children }: { children: React.ReactNode }) {
  return <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '2rem 1rem' }}>{children}</div>;
}
function chunk<T>(arr: T[], n: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out.length ? out : [[]];
}
