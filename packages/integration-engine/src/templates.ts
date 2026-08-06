import type { ConnectorDefinition } from './index.js';

/**
 * Official connector templates (PRD §17). Pre-built definitions for common
 * providers. A tenant clones one and attaches its own BYO credential — the
 * template carries NO secret, only the request shape + auth scheme.
 */
export interface ConnectorTemplate {
  provider: string;
  name: string;
  category: string;
  /** Credential provider slug + auth type this connector expects. */
  credentialProvider: string;
  authType: string;
  definition: ConnectorDefinition;
}

export const CONNECTOR_TEMPLATES: ConnectorTemplate[] = [
  {
    provider: 'slack',
    name: 'Slack — Post message',
    category: 'messaging',
    credentialProvider: 'slack',
    authType: 'bearer',
    definition: {
      baseUrl: 'https://slack.com',
      endpoint: '/api/chat.postMessage',
      method: 'POST',
      auth: { type: 'bearer' },
      body: { channel: '{{channel}}', text: '{{text}}' },
    },
  },
  {
    provider: 'stripe',
    name: 'Stripe — Create payment link',
    category: 'payments',
    credentialProvider: 'stripe',
    authType: 'bearer',
    definition: {
      baseUrl: 'https://api.stripe.com',
      endpoint: '/v1/payment_links',
      method: 'POST',
      auth: { type: 'bearer' },
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
    },
  },
  {
    provider: 'whatsapp',
    name: 'WhatsApp Cloud — Send message',
    category: 'messaging',
    credentialProvider: 'whatsapp',
    authType: 'bearer',
    definition: {
      baseUrl: 'https://graph.facebook.com',
      endpoint: '/v20.0/{{phoneNumberId}}/messages',
      method: 'POST',
      auth: { type: 'bearer' },
      body: { messaging_product: 'whatsapp', to: '{{to}}', type: 'text', text: { body: '{{text}}' } },
    },
  },
  {
    provider: 'gmail',
    name: 'Gmail — Send email',
    category: 'email',
    credentialProvider: 'gmail',
    authType: 'oauth2_refresh',
    definition: {
      baseUrl: 'https://gmail.googleapis.com',
      endpoint: '/gmail/v1/users/me/messages/send',
      method: 'POST',
      auth: { type: 'oauth2' },
      body: { raw: '{{rawBase64}}' },
    },
  },
  {
    provider: 'mercadopago',
    name: 'Mercado Pago — Create preference',
    category: 'payments',
    credentialProvider: 'mercadopago',
    authType: 'bearer',
    definition: {
      baseUrl: 'https://api.mercadopago.com',
      endpoint: '/checkout/preferences',
      method: 'POST',
      auth: { type: 'bearer' },
    },
  },
  {
    provider: 'telegram',
    name: 'Telegram — Send message',
    category: 'messaging',
    credentialProvider: 'telegram',
    authType: 'api_key',
    definition: {
      baseUrl: 'https://api.telegram.org',
      endpoint: '/bot{{secret.apiKey}}/sendMessage',
      method: 'POST',
      body: { chat_id: '{{chatId}}', text: '{{text}}' },
    },
  },
];

export function listConnectorTemplates(): ConnectorTemplate[] {
  return CONNECTOR_TEMPLATES;
}

export function getConnectorTemplate(provider: string): ConnectorTemplate | undefined {
  return CONNECTOR_TEMPLATES.find((t) => t.provider === provider);
}
