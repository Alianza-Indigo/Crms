'use client';

const BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:4000';

/**
 * Thin API client. Stores the session token in localStorage and attaches the
 * active application/environment headers so the API scopes every call.
 */
export function getToken(): string | null {
  if (typeof window === 'undefined') return null;
  return window.localStorage.getItem('crms_token');
}

export function setToken(token: string): void {
  window.localStorage.setItem('crms_token', token);
}

export function setActiveApp(applicationId: string, environment = 'production'): void {
  window.localStorage.setItem('crms_app', applicationId);
  window.localStorage.setItem('crms_env', environment);
}

export async function api<T = unknown>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set('content-type', 'application/json');
  const token = getToken();
  if (token) headers.set('authorization', `Bearer ${token}`);
  if (typeof window !== 'undefined') {
    const app = window.localStorage.getItem('crms_app');
    const env = window.localStorage.getItem('crms_env');
    if (app) headers.set('x-application-id', app);
    if (env) headers.set('x-environment', env);
  }
  const res = await fetch(`${BASE}/v1${path}`, { ...init, headers });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((json as { error?: { message?: string } }).error?.message ?? `Request failed (${res.status})`);
  return json as T;
}
