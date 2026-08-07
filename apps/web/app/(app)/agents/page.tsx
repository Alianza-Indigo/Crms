'use client';

import { useEffect, useState } from 'react';
import { getClient } from '../../../lib/crms';

interface ModuleRef {
  id: string;
  name: string;
}
interface Cred {
  id: string;
  name: string;
  provider: string;
}
interface Agent {
  id: string;
  name: string;
  purpose?: string | null;
}

const ACTIONS = ['read_records', 'create_record', 'update_record', 'run_view', 'send_notification'];

export default function AgentsPage() {
  const [modules, setModules] = useState<ModuleRef[]>([]);
  const [creds, setCreds] = useState<Cred[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    name: '',
    purpose: '',
    instructions: '',
    provider: 'google_ai',
    credentialId: '',
    accessibleModuleIds: [] as string[],
    allowedActions: ['read_records'] as string[],
  });
  const [chatWith, setChatWith] = useState<Agent | null>(null);
  const [message, setMessage] = useState('');
  const [reply, setReply] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function load() {
    try {
      const c = getClient();
      const [a, m, cr] = await Promise.all([c.agents.list(), c.modules.list(), c.credentials.list()]);
      setAgents(a as unknown as Agent[]);
      setModules(m as ModuleRef[]);
      setCreds(cr as unknown as Cred[]);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error');
    }
  }
  useEffect(() => {
    load();
  }, []);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    try {
      await getClient().agents.create({
        name: form.name,
        purpose: form.purpose || undefined,
        instructions: form.instructions || undefined,
        provider: form.provider,
        credentialId: form.credentialId || undefined,
        accessibleModuleIds: form.accessibleModuleIds,
        allowedActions: form.allowedActions,
      });
      setForm({ ...form, name: '', purpose: '', instructions: '' });
      setOpen(false);
      await load();
    } catch (e2) {
      setError(e2 instanceof Error ? e2.message : 'Error');
    }
  }

  async function run(e: React.FormEvent) {
    e.preventDefault();
    if (!chatWith) return;
    setBusy(true);
    setReply(null);
    try {
      const turn = (await getClient().agents.run(chatWith.id, message)) as Record<string, unknown>;
      const text =
        (turn.reply as string) ??
        ((turn.messages as Array<{ role: string; content: string }>) ?? []).filter((m) => m.role === 'assistant').pop()?.content ??
        `Respondió en ${turn.rounds ?? '?'} ronda(s), ${(turn.toolCalls as unknown[])?.length ?? 0} acción(es).`;
      setReply(text);
    } catch (e2) {
      setError(e2 instanceof Error ? e2.message : 'Error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ display: 'grid', gap: '1.25rem', maxWidth: 860 }}>
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <span className="badge">Agentes</span>
          <h1 style={{ margin: '0.4rem 0 0' }}>Agentes de IA</h1>
        </div>
        <button className="btn" onClick={() => setOpen((v) => !v)}>{open ? 'Cancelar' : '+ Agente'}</button>
      </header>
      <p className="muted" style={{ margin: 0 }}>
        Un agente usa una credencial de IA y puede leer/operar los módulos que le permitas, con acciones acotadas.
      </p>

      {error && <div className="card" style={{ borderColor: '#7f1d1d', color: '#f87171' }}>{error}</div>}

      <section style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(220px,1fr))', gap: '0.8rem' }}>
        {agents.map((a) => (
          <div key={a.id} className="card" style={{ display: 'grid', gap: '0.4rem' }}>
            <h3 style={{ margin: 0 }}>{a.name}</h3>
            {a.purpose && <p className="muted" style={{ margin: 0, fontSize: '0.85rem' }}>{a.purpose}</p>}
            <button className="btn" style={{ justifySelf: 'start' }} onClick={() => { setChatWith(a); setReply(null); setMessage(''); }}>
              Conversar
            </button>
          </div>
        ))}
        {agents.length === 0 && <p className="muted">Sin agentes. Crea uno con una credencial de IA (BYO).</p>}
      </section>

      {open && (
        <form onSubmit={create} className="card" style={{ display: 'grid', gap: '0.7rem' }}>
          <h3 style={{ margin: 0 }}>Nuevo agente</h3>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.7rem' }}>
            <label>
              Nombre
              <input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
            </label>
            <label>
              Propósito
              <input className="input" value={form.purpose} onChange={(e) => setForm({ ...form, purpose: e.target.value })} placeholder="Asistente de ventas" />
            </label>
          </div>
          <label>
            Instrucciones
            <textarea className="input" rows={3} value={form.instructions} onChange={(e) => setForm({ ...form, instructions: e.target.value })} placeholder="Responde en español, usa datos del módulo Leads…" />
          </label>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.7rem' }}>
            <label>
              Proveedor
              <select className="input" value={form.provider} onChange={(e) => setForm({ ...form, provider: e.target.value })}>
                {['google_ai', 'openai', 'anthropic'].map((p) => (
                  <option key={p}>{p}</option>
                ))}
              </select>
            </label>
            <label>
              Credencial de IA
              <select className="input" value={form.credentialId} onChange={(e) => setForm({ ...form, credentialId: e.target.value })}>
                <option value="">Elige…</option>
                {creds.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name} ({c.provider})
                  </option>
                ))}
              </select>
            </label>
          </div>
          <label>
            Módulos accesibles
            <select
              className="input"
              multiple
              value={form.accessibleModuleIds}
              onChange={(e) => setForm({ ...form, accessibleModuleIds: Array.from(e.target.selectedOptions).map((o) => o.value) })}
              style={{ minHeight: 90 }}
            >
              {modules.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Acciones permitidas
            <select
              className="input"
              multiple
              value={form.allowedActions}
              onChange={(e) => setForm({ ...form, allowedActions: Array.from(e.target.selectedOptions).map((o) => o.value) })}
              style={{ minHeight: 90 }}
            >
              {ACTIONS.map((a) => (
                <option key={a}>{a}</option>
              ))}
            </select>
          </label>
          <button className="btn">Crear agente</button>
        </form>
      )}

      {chatWith && (
        <section className="card" style={{ display: 'grid', gap: '0.7rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <h2 style={{ margin: 0, fontSize: '1.1rem' }}>Conversar con {chatWith.name}</h2>
            <button className="btn" style={{ background: 'transparent', border: '1px solid var(--border)', color: 'var(--muted)' }} onClick={() => setChatWith(null)}>
              Cerrar
            </button>
          </div>
          <form onSubmit={run} style={{ display: 'grid', gap: '0.6rem' }}>
            <textarea className="input" rows={3} value={message} onChange={(e) => setMessage(e.target.value)} placeholder="Pregúntale algo…" required />
            <button className="btn" disabled={busy}>{busy ? '…' : 'Enviar'}</button>
          </form>
          {reply && (
            <div className="card" style={{ whiteSpace: 'pre-wrap', background: 'var(--surface-2, transparent)' }}>{reply}</div>
          )}
        </section>
      )}
    </div>
  );
}
