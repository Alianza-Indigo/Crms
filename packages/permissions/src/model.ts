/**
 * Permission model (PRD §18). Combines RBAC (roles → permission grants), ABAC
 * (attribute conditions), ownership, teams, branches, and record/field scope.
 *
 * A permission grant is a string:  action:resourceType[:selector][/scope]
 *   view:record:mod_leads            -> view records in module mod_leads
 *   edit:record:any/own              -> edit records the user owns, any module
 *   wildcard:module:any              -> full control over all modules
 *   manage_credentials:credential:any -> manage all credentials
 *
 * The '*' wildcard is allowed in place of action/resourceType/selector.
 * Scope suffix (after the slash):  own | team | branch | all (default all)
 */

export const ACTIONS = [
  'view',
  'create',
  'edit',
  'delete',
  'export',
  'import',
  'assign',
  'share',
  'approve',
  'execute_automation',
  'execute_ai',
  'view_history',
  'view_files',
  'manage_config',
  'manage_credentials',
] as const;
export type Action = (typeof ACTIONS)[number];

export const RESOURCE_TYPES = [
  'tenant',
  'application',
  'module',
  'view',
  'record',
  'field',
  'action',
  'automation',
  'dashboard',
  'document',
  'portal',
  'api',
  'integration',
  'credential',
] as const;
export type ResourceType = (typeof RESOURCE_TYPES)[number];

export type Scope = 'own' | 'team' | 'branch' | 'all';

export interface Grant {
  action: Action | '*';
  resourceType: ResourceType | '*';
  selector: string; // module key/id or '*'
  scope: Scope;
}

export interface ResourceRef {
  type: ResourceType;
  /** module id/key or resource id for selector matching. */
  selector?: string;
  /** Attributes for ABAC/ownership checks. */
  ownerUserId?: string | null;
  teamId?: string | null;
  branchId?: string | null;
  fieldKey?: string;
}

export function parseGrant(raw: string): Grant | null {
  const [main, scopePart] = raw.split('/');
  const scope = (scopePart as Scope) || 'all';
  const parts = (main ?? '').split(':');
  const [action, resourceType, selector] = parts;
  if (!action || !resourceType) return null;
  return {
    action: action as Grant['action'],
    resourceType: resourceType as Grant['resourceType'],
    selector: selector ?? '*',
    scope: (['own', 'team', 'branch', 'all'] as string[]).includes(scope) ? scope : 'all',
  };
}
