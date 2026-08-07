'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { getClient } from '../../../lib/crms';

interface Op {
  op: string;
  args: Record<string, unknown>;
}
interface Cred {
  id: string;
  key: string;
  name: string;
  provider: string;
}

const AI_PROVIDERS = new Set(['openai', 'anthropic', 'google_ai', 'gemini', 'azure_openai']);

/** AI application generation (PRD §9.1): prompt → plan → approve → execute. */
export default function AiPage() {
  const [prompt, setPrompt] = useState('');
  const [creds, setCreds] = useState<Cred[]>([]);
  const [credentialKey, setCredentialKey] = useState('');
  const [planId, setPlanId] = useState<string | null>(null);
  const [ops, setOps] = useState<Op[]>([]);
  const [summary, setSummary] = useState('');
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getClient()
      .credentials.list()
      .then((list) => {
        const ai = (list as unknown as Cred[]).filter((c) => AI_PROVIDERS.has(c.provider));
        setCreds(ai);
        if (ai[0]) setCredentialKey(ai[0].key);
      })
      .catch(() => {});
  }, []);

  async function generate(e: React.FormEvent) {
    e.preventDefault();
    if (!credentialKey) {
      setError('Elige una credencial de IA (o agrega una en Credenciales).');
      return;
    }
    setBusy(true);
    setError(null);
    setStatus(null);
    try {
      const provider = creds.find((c) => c.key === credentialKey)?.provider ?? 'openai';
      const res = await getClient().ai.generate(prompt, provider, credentialKey);
      setPlanId(res.planId);
      const plan = res.plan as { summary?: string; operations?: Op[] };
      setSummary(plan.summary ?? '');
      setOps(plan.operations ?? []);
    } catch (e2) {
      setError(e2 instanceof Error ? e2.message : 'Error');
    } finally {
      setBusy(false);
    }
  }

  async function run() {
    if (!planId) return;
    setBusy(true);
    try {
      await getClient().ai.approvePlan(planId).catch(() => {});
      const res = await getClient().ai.executePlan(planId);
      setStatus(`Ejecutado (${res.executionId}). Revisa el Constructor.`);
    } catch (e2) {
      setError(e2 instanceof Error ? e2.message : 'Error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ display: 'grid', gap: '1.25rem', maxWidth: 760 }}>
      <div>
        <span className="badge">IA</span>
        <h1 style={{ margin: '0.4rem 0 0' }}>Generar aplicación por IA</h1>
        <p className="muted">Describe tu negocio; la IA propone un plan de módulos/campos que puedes aprobar y ejecutar. Requiere una credencial de IA (BYO).</p>
      </div>

      <form onSubmit={generate} className="card" style={{ display: 'grid', gap: '0.6rem' }}>
        <label>
          Descripción
          <textarea
            className="input"
            rows={4}
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="Un sistema para una clínica con pacientes, médicos, citas y expedientes…"
            required
          />
        </label>
        <label>
          Credencial de IA
          {creds.length > 0 ? (
            <select className="input" value={credentialKey} onChange={(e) => setCredentialKey(e.target.value)}>
              {creds.map((c) => (
                <option key={c.id} value={c.key}>
                  {c.name} ({c.provider})
                </option>
              ))}
            </select>
          ) : (
            <div className="muted" style={{ fontSize: '0.9rem' }}>
              No tienes credenciales de IA. <Link href="/credentials">Agrega una</Link> (OpenAI, Anthropic o Google Gemini).
            </div>
          )}
        </label>
        <button className="btn" disabled={busy || creds.length === 0}>
          {busy ? '…' : 'Generar plan'}
        </button>
      </form>

      {error && <div className="card" style={{ borderColor: '#7f1d1d', color: '#f87171' }}>{error}</div>}

      {planId && (
        <div className="card" style={{ display: 'grid', gap: '0.75rem' }}>
          <h3 style={{ margin: 0 }}>Plan propuesto</h3>
          <p className="muted" style={{ margin: 0 }}>{summary}</p>
          <ul style={{ margin: 0 }}>
            {ops.map((o, i) => (
              <li key={i}>
                <code>{o.op}</code> {String(o.args.name ?? o.args.key ?? '')}
              </li>
            ))}
          </ul>
          <button className="btn" onClick={run} disabled={busy}>
            Aprobar y ejecutar
          </button>
          {status && <p style={{ color: '#4ade80', margin: 0 }}>{status}</p>}
        </div>
      )}
    </div>
  );
}
