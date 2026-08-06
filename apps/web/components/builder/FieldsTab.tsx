'use client';

import { useCallback, useEffect, useState } from 'react';
import { getClient } from '../../lib/crms';

export interface Field {
  id: string;
  key: string;
  name: string;
  type: string;
  required: boolean;
  unique: boolean;
  indexed: boolean;
  helpText?: string | null;
  defaultValue?: unknown;
  config: Record<string, unknown>;
  position: number;
}
interface ModuleRef {
  id: string;
  name: string;
}
interface RelationRef {
  id: string;
  name: string;
}

// All 40 field types (schema-engine/types.ts), grouped for a friendlier picker.
const FIELD_TYPE_GROUPS: Array<[string, string[]]> = [
  ['Texto', ['text_short', 'text_long', 'text_rich', 'email', 'phone', 'url', 'code', 'color']],
  ['Números', ['integer', 'decimal', 'currency', 'percent', 'duration']],
  ['Fecha/hora', ['date', 'time', 'datetime']],
  ['Selección', ['boolean', 'select', 'multi_select', 'status']],
  ['Personas', ['user', 'team']],
  ['Archivos/medios', ['file', 'image', 'signature', 'qr', 'barcode']],
  ['Ubicación', ['location', 'coordinates']],
  ['Relación/derivados', ['relation', 'formula', 'computed', 'rollup', 'count', 'autonumber', 'auto_id', 'ai_generated']],
  ['Otros', ['json']],
];
const OPTION_TYPES = new Set(['select', 'multi_select', 'status']);
const AGGREGATES = ['sum', 'count', 'avg', 'min', 'max'];

const emptyForm = {
  key: '',
  name: '',
  type: 'text_short',
  required: false,
  unique: false,
  indexed: false,
  helpText: '',
  defaultValue: '',
  config: {} as Record<string, unknown>,
};
type FormState = typeof emptyForm;

export function FieldsTab({
  moduleId,
  modules,
  relations,
}: {
  moduleId: string;
  modules: ModuleRef[];
  relations: RelationRef[];
}) {
  const [fields, setFields] = useState<Field[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null); // field id, 'new', or null
  const [form, setForm] = useState<FormState>(emptyForm);
  const [options, setOptions] = useState<Array<{ value: string; label: string }>>([]);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setFields((await getClient().modules.listFields(moduleId)) as unknown as Field[]);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error');
    }
  }, [moduleId]);
  useEffect(() => {
    load();
  }, [load]);

  function openNew() {
    setForm({ ...emptyForm });
    setOptions([{ value: 'opcion_1', label: 'Opción 1' }]);
    setEditingId('new');
  }
  function openEdit(f: Field) {
    setForm({
      key: f.key,
      name: f.name,
      type: f.type,
      required: f.required,
      unique: f.unique,
      indexed: f.indexed,
      helpText: f.helpText ?? '',
      defaultValue: f.defaultValue == null ? '' : String(f.defaultValue),
      config: (f.config ?? {}) as Record<string, unknown>,
    });
    setOptions(((f.config?.options as Array<{ value: string; label: string }>) ?? []).map((o) => ({ ...o })));
    setEditingId(f.id);
  }
  function close() {
    setEditingId(null);
    setError(null);
  }

  function buildConfig(): Record<string, unknown> {
    const c: Record<string, unknown> = { ...form.config };
    if (OPTION_TYPES.has(form.type)) c.options = options.filter((o) => o.value.trim());
    return c;
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const config = buildConfig();
      const payload = {
        name: form.name,
        type: form.type,
        required: form.required,
        unique: form.unique,
        indexed: form.indexed,
        helpText: form.helpText || undefined,
        defaultValue: form.defaultValue === '' ? undefined : form.defaultValue,
        config,
      };
      if (editingId === 'new') {
        await getClient().modules.createField(moduleId, { ...payload, key: form.key });
      } else if (editingId) {
        try {
          await getClient().modules.updateField(editingId, payload);
        } catch (err) {
          // Type change on populated field needs confirmation.
          if (err instanceof Error && /confirm|destructive|invalidate/i.test(err.message)) {
            if (!confirm('Cambiar el tipo puede invalidar datos existentes. ¿Continuar?')) throw err;
            await getClient().modules.updateField(editingId, payload, true);
          } else throw err;
        }
      }
      close();
      await load();
    } catch (e2) {
      setError(e2 instanceof Error ? e2.message : 'Error');
    } finally {
      setBusy(false);
    }
  }

  async function remove(f: Field) {
    if (!confirm(`¿Eliminar el campo "${f.name}"? Se descartan sus valores guardados.`)) return;
    try {
      await getClient().modules.deleteField(f.id, true);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error');
    }
  }

  async function move(index: number, dir: -1 | 1) {
    const next = [...fields];
    const j = index + dir;
    if (j < 0 || j >= next.length) return;
    [next[index], next[j]] = [next[j]!, next[index]!];
    setFields(next);
    try {
      await getClient().modules.reorderFields(
        moduleId,
        next.map((f) => f.id),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error');
      await load();
    }
  }

  return (
    <div style={{ display: 'grid', gap: '1rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <p className="muted" style={{ margin: 0 }}>
          {fields.length} campo(s). Arrastra el orden con ↑ ↓.
        </p>
        <button className="btn" onClick={openNew}>
          + Campo
        </button>
      </div>

      {error && <div className="card" style={{ borderColor: '#7f1d1d', color: '#f87171' }}>{error}</div>}

      <div className="card" style={{ padding: 0, overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 560 }}>
          <thead>
            <tr style={{ textAlign: 'left', color: 'var(--muted)' }}>
              <th style={{ padding: '0.6rem 0.9rem', width: 70 }}>Orden</th>
              <th>Nombre</th>
              <th>Clave</th>
              <th>Tipo</th>
              <th>Req.</th>
              <th style={{ width: 120 }}></th>
            </tr>
          </thead>
          <tbody>
            {fields.map((f, i) => (
              <tr key={f.id} style={{ borderTop: '1px solid var(--border)' }}>
                <td style={{ padding: '0.5rem 0.9rem', whiteSpace: 'nowrap' }}>
                  <button className="mini" onClick={() => move(i, -1)} disabled={i === 0} aria-label="Subir">↑</button>{' '}
                  <button className="mini" onClick={() => move(i, 1)} disabled={i === fields.length - 1} aria-label="Bajar">↓</button>
                </td>
                <td>{f.name}</td>
                <td>
                  <code className="muted">{f.key}</code>
                </td>
                <td>
                  <span className="badge">{f.type}</span>
                </td>
                <td>{f.required ? 'Sí' : '—'}</td>
                <td style={{ textAlign: 'right', paddingRight: '0.9rem', whiteSpace: 'nowrap' }}>
                  <button className="mini" onClick={() => openEdit(f)}>Editar</button>{' '}
                  <button className="mini danger" onClick={() => remove(f)}>Eliminar</button>
                </td>
              </tr>
            ))}
            {fields.length === 0 && (
              <tr>
                <td colSpan={6} style={{ padding: '1rem 0.9rem' }} className="muted">
                  Sin campos todavía.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {editingId && (
        <form onSubmit={save} className="card" style={{ display: 'grid', gap: '0.7rem', maxWidth: 620 }}>
          <h3 style={{ margin: 0 }}>{editingId === 'new' ? 'Nuevo campo' : `Editar campo`}</h3>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.7rem' }}>
            <label>
              Nombre
              <input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
            </label>
            <label>
              Clave (snake_case)
              <input
                className="input"
                value={form.key}
                onChange={(e) => setForm({ ...form, key: e.target.value })}
                placeholder="nombre_campo"
                required
                disabled={editingId !== 'new'}
              />
            </label>
          </div>
          <label>
            Tipo
            <select className="input" value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>
              {FIELD_TYPE_GROUPS.map(([group, types]) => (
                <optgroup key={group} label={group}>
                  {types.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          </label>

          {/* Per-type configuration */}
          <TypeConfig
            type={form.type}
            config={form.config}
            setConfig={(c) => setForm({ ...form, config: c })}
            options={options}
            setOptions={setOptions}
            modules={modules}
            relations={relations}
          />

          <label>
            Texto de ayuda (opcional)
            <input className="input" value={form.helpText} onChange={(e) => setForm({ ...form, helpText: e.target.value })} />
          </label>
          <label>
            Valor por defecto (opcional)
            <input className="input" value={form.defaultValue} onChange={(e) => setForm({ ...form, defaultValue: e.target.value })} />
          </label>

          <div style={{ display: 'flex', gap: '1.2rem', flexWrap: 'wrap' }}>
            <label style={{ display: 'flex', gap: '0.4rem', alignItems: 'center' }}>
              <input type="checkbox" checked={form.required} onChange={(e) => setForm({ ...form, required: e.target.checked })} /> Requerido
            </label>
            <label style={{ display: 'flex', gap: '0.4rem', alignItems: 'center' }}>
              <input type="checkbox" checked={form.unique} onChange={(e) => setForm({ ...form, unique: e.target.checked })} /> Único
            </label>
            <label style={{ display: 'flex', gap: '0.4rem', alignItems: 'center' }}>
              <input type="checkbox" checked={form.indexed} onChange={(e) => setForm({ ...form, indexed: e.target.checked })} /> Indexado
            </label>
          </div>

          <div style={{ display: 'flex', gap: '0.6rem' }}>
            <button className="btn" disabled={busy}>
              {busy ? '…' : editingId === 'new' ? 'Crear campo' : 'Guardar'}
            </button>
            <button type="button" className="btn ghost" onClick={close}>
              Cancelar
            </button>
          </div>
        </form>
      )}

      <style jsx>{`
        .mini {
          background: transparent;
          border: 1px solid var(--border);
          color: var(--muted);
          border-radius: 6px;
          padding: 0.2rem 0.5rem;
          cursor: pointer;
          font-size: 0.8rem;
        }
        .mini:disabled {
          opacity: 0.4;
          cursor: default;
        }
        .mini.danger {
          color: #f87171;
          border-color: #7f1d1d;
        }
        .btn.ghost {
          background: transparent;
          border: 1px solid var(--border);
          color: var(--muted);
        }
      `}</style>
    </div>
  );
}

/** Type-specific configuration inputs. */
function TypeConfig({
  type,
  config,
  setConfig,
  options,
  setOptions,
  modules,
  relations,
}: {
  type: string;
  config: Record<string, unknown>;
  setConfig: (c: Record<string, unknown>) => void;
  options: Array<{ value: string; label: string }>;
  setOptions: (o: Array<{ value: string; label: string }>) => void;
  modules: ModuleRef[];
  relations: RelationRef[];
}) {
  const set = (k: string, v: unknown) => setConfig({ ...config, [k]: v });

  if (OPTION_TYPES.has(type)) {
    return (
      <div className="card" style={{ background: 'var(--surface-2, transparent)', display: 'grid', gap: '0.4rem' }}>
        <strong style={{ fontSize: '0.9rem' }}>Opciones</strong>
        {options.map((o, i) => (
          <div key={i} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr auto', gap: '0.4rem' }}>
            <input
              className="input"
              placeholder="valor"
              value={o.value}
              onChange={(e) => setOptions(options.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)))}
            />
            <input
              className="input"
              placeholder="Etiqueta"
              value={o.label}
              onChange={(e) => setOptions(options.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))}
            />
            <button type="button" className="btn ghost" onClick={() => setOptions(options.filter((_, j) => j !== i))}>
              ✕
            </button>
          </div>
        ))}
        <button type="button" className="btn ghost" onClick={() => setOptions([...options, { value: '', label: '' }])}>
          + Opción
        </button>
      </div>
    );
  }
  if (type === 'currency') {
    return (
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.6rem' }}>
        <label>
          Moneda (ISO)
          <input className="input" value={(config.currencyCode as string) ?? ''} onChange={(e) => set('currencyCode', e.target.value)} placeholder="MXN" />
        </label>
        <label>
          Decimales
          <input className="input" type="number" value={(config.decimals as number) ?? 2} onChange={(e) => set('decimals', Number(e.target.value))} />
        </label>
      </div>
    );
  }
  if (type === 'decimal' || type === 'percent') {
    return (
      <label>
        Decimales
        <input className="input" type="number" value={(config.decimals as number) ?? 2} onChange={(e) => set('decimals', Number(e.target.value))} />
      </label>
    );
  }
  if (type === 'relation') {
    return (
      <label>
        Módulo destino
        <select className="input" value={(config.targetModuleId as string) ?? ''} onChange={(e) => set('targetModuleId', e.target.value)}>
          <option value="">Elige un módulo…</option>
          {modules.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
        </select>
      </label>
    );
  }
  if (type === 'formula' || type === 'computed') {
    return (
      <label>
        Expresión
        <input className="input" value={(config.expression as string) ?? ''} onChange={(e) => set('expression', e.target.value)} placeholder="precio * cantidad" />
      </label>
    );
  }
  if (type === 'rollup') {
    return (
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.6rem' }}>
        <label>
          Relación
          <select className="input" value={(config.relationId as string) ?? ''} onChange={(e) => set('relationId', e.target.value)}>
            <option value="">Elige…</option>
            {relations.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Agregación
          <select className="input" value={(config.aggregate as string) ?? 'sum'} onChange={(e) => set('aggregate', e.target.value)}>
            {AGGREGATES.map((a) => (
              <option key={a}>{a}</option>
            ))}
          </select>
        </label>
      </div>
    );
  }
  if (type === 'autonumber' || type === 'auto_id') {
    return (
      <label>
        Patrón (opcional)
        <input className="input" value={(config.pattern as string) ?? ''} onChange={(e) => set('pattern', e.target.value)} placeholder="INV-{0000}" />
      </label>
    );
  }
  return null;
}
