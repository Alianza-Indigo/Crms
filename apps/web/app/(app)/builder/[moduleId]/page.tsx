'use client';

import { use, useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { getClient } from '../../../../lib/crms';
import { FieldsTab, type Field } from '../../../../components/builder/FieldsTab';
import { ViewsTab } from '../../../../components/builder/ViewsTab';
import { FormsTab } from '../../../../components/builder/FormsTab';
import { PipelinesTab } from '../../../../components/builder/PipelinesTab';
import { RelationsTab } from '../../../../components/builder/RelationsTab';

interface ModuleRef {
  id: string;
  name: string;
}
const TABS = ['Campos', 'Vistas', 'Formularios', 'Pipelines', 'Relaciones'] as const;
type Tab = (typeof TABS)[number];

/** Module hub (PRD §43.2): fields + views + forms + pipelines + relations. */
export default function ModulePage({ params }: { params: Promise<{ moduleId: string }> }) {
  const { moduleId } = use(params);
  const [tab, setTab] = useState<Tab>('Campos');
  const [modules, setModules] = useState<ModuleRef[]>([]);
  const [relations, setRelations] = useState<Array<{ id: string; name: string }>>([]);
  const [fields, setFields] = useState<Field[]>([]);
  const [moduleName, setModuleName] = useState('');

  const refresh = useCallback(async () => {
    const client = getClient();
    const [mods, rels, flds] = await Promise.all([
      client.modules.list().catch(() => []),
      client.relations.list().catch(() => []),
      client.modules.listFields(moduleId).catch(() => []),
    ]);
    setModules(mods as ModuleRef[]);
    setRelations(rels as Array<{ id: string; name: string }>);
    setFields(flds as unknown as Field[]);
    setModuleName((mods as ModuleRef[]).find((m) => m.id === moduleId)?.name ?? 'Módulo');
  }, [moduleId]);

  useEffect(() => {
    refresh();
  }, [refresh, tab]);

  return (
    <div style={{ display: 'grid', gap: '1.25rem' }}>
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.6rem' }}>
        <div>
          <Link href="/builder" className="muted" style={{ textDecoration: 'none' }}>
            ← Módulos
          </Link>
          <h1 style={{ margin: '0.3rem 0 0' }}>{moduleName}</h1>
        </div>
        <Link className="btn" href={`/data/${moduleId}`}>
          Ver datos →
        </Link>
      </header>

      <nav style={{ display: 'flex', gap: '0.3rem', borderBottom: '1px solid var(--border)', flexWrap: 'wrap' }}>
        {TABS.map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            style={{
              background: 'transparent',
              border: 'none',
              borderBottom: tab === t ? '2px solid var(--accent)' : '2px solid transparent',
              color: tab === t ? 'var(--fg)' : 'var(--muted)',
              padding: '0.6rem 0.8rem',
              cursor: 'pointer',
              fontWeight: 600,
              fontSize: '0.95rem',
            }}
          >
            {t}
          </button>
        ))}
      </nav>

      {tab === 'Campos' && <FieldsTab moduleId={moduleId} modules={modules} relations={relations} />}
      {tab === 'Vistas' && <ViewsTab moduleId={moduleId} fields={fields} />}
      {tab === 'Formularios' && <FormsTab moduleId={moduleId} fields={fields} />}
      {tab === 'Pipelines' && <PipelinesTab moduleId={moduleId} fields={fields} />}
      {tab === 'Relaciones' && <RelationsTab moduleId={moduleId} modules={modules.filter((m) => m.id !== moduleId)} />}
    </div>
  );
}
