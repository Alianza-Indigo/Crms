'use client';

import { CrmsClient } from '@crms/sdk';

const BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:4000';

/**
 * Build a CrmsClient from the browser's stored token + active application.
 * Cheap to create; call per action so it always reflects current localStorage.
 */
export function getClient(): CrmsClient {
  const token = typeof window !== 'undefined' ? window.localStorage.getItem('crms_token') ?? undefined : undefined;
  const applicationId = typeof window !== 'undefined' ? window.localStorage.getItem('crms_app') ?? undefined : undefined;
  const environment = typeof window !== 'undefined' ? window.localStorage.getItem('crms_env') ?? 'production' : 'production';
  const client = new CrmsClient({ baseUrl: BASE, token, applicationId, environment });
  return client;
}

export function setActiveApp(applicationId: string, environment = 'production'): void {
  window.localStorage.setItem('crms_app', applicationId);
  window.localStorage.setItem('crms_env', environment);
}
export function getActiveApp(): { applicationId: string | null; environment: string } {
  return {
    applicationId: typeof window !== 'undefined' ? window.localStorage.getItem('crms_app') : null,
    environment: (typeof window !== 'undefined' ? window.localStorage.getItem('crms_env') : null) ?? 'production',
  };
}
export function isAuthed(): boolean {
  return typeof window !== 'undefined' && !!window.localStorage.getItem('crms_token');
}
export function logout(): void {
  window.localStorage.removeItem('crms_token');
  window.localStorage.removeItem('crms_app');
}
