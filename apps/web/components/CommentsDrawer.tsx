'use client';

import { useCallback, useEffect, useState } from 'react';
import { getClient } from '../lib/crms';

interface Comment {
  id: string;
  body: string;
  mentions?: string[];
  createdBy?: string | null;
  createdAt?: string | null;
}

/** Record comments + @mentions drawer (PRD §20). */
export function CommentsDrawer({ moduleId, recordId, title, onClose }: { moduleId: string; recordId: string; title: string; onClose: () => void }) {
  const [comments, setComments] = useState<Comment[]>([]);
  const [body, setBody] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setComments((await getClient().records.comments(moduleId, recordId)) as unknown as Comment[]);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error');
    }
  }, [moduleId, recordId]);
  useEffect(() => {
    load();
  }, [load]);

  async function send(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const mentions = Array.from(body.matchAll(/@([a-zA-Z0-9_.-]+)/g)).map((m) => m[1]!);
      await getClient().records.addComment(moduleId, recordId, body, mentions);
      setBody('');
      await load();
    } catch (e2) {
      setError(e2 instanceof Error ? e2.message : 'Error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', justifyContent: 'flex-end', zIndex: 900 }}>
      <div
        onClick={(e) => e.stopPropagation()}
        className="card"
        style={{ width: 'min(420px, 94vw)', height: '100%', borderRadius: 0, display: 'flex', flexDirection: 'column', gap: '0.7rem' }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h3 style={{ margin: 0 }}>💬 {title}</h3>
          <button onClick={onClose} style={{ background: 'transparent', border: '1px solid var(--border)', color: 'var(--muted)', borderRadius: 6, padding: '0.2rem 0.55rem', cursor: 'pointer' }}>
            ✕
          </button>
        </div>
        {error && <div style={{ color: '#f87171', fontSize: '0.9rem' }}>{error}</div>}
        <div style={{ flex: 1, overflowY: 'auto', display: 'grid', gap: '0.5rem', alignContent: 'start' }}>
          {comments.map((c) => (
            <div key={c.id} className="card" style={{ background: 'var(--bg)', padding: '0.6rem 0.7rem' }}>
              <div style={{ whiteSpace: 'pre-wrap' }}>{c.body}</div>
              <div className="muted" style={{ fontSize: '0.72rem', marginTop: '0.3rem' }}>
                {c.createdAt ? new Date(c.createdAt).toLocaleString() : ''}
                {c.mentions && c.mentions.length > 0 && ` · menciona a ${c.mentions.join(', ')}`}
              </div>
            </div>
          ))}
          {comments.length === 0 && <p className="muted">Sé el primero en comentar. Usa @usuario para mencionar.</p>}
        </div>
        <form onSubmit={send} style={{ display: 'grid', gap: '0.5rem' }}>
          <textarea className="input" rows={3} value={body} onChange={(e) => setBody(e.target.value)} placeholder="Escribe un comentario… (@usuario para mencionar)" required />
          <button className="btn" disabled={busy}>{busy ? '…' : 'Comentar'}</button>
        </form>
      </div>
    </div>
  );
}
