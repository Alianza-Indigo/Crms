import { inArray, schema, withTenant } from '@crms/database';
import { Forbidden } from '@crms/kernel';
import { getContext, type TenantContext } from '@crms/tenant-context';
import { parseGrant, type Action, type Grant, type ResourceRef } from './model.js';

export interface Decision {
  allowed: boolean;
  /** Human-readable explanation (PRD §18: system must explain access). */
  reason: string;
  matchedGrant?: string;
}

/** Simple per-request cache of resolved role grants to avoid repeated loads. */
const grantCache = new WeakMap<TenantContext, Grant[]>();

async function loadGrants(ctx: TenantContext): Promise<Grant[]> {
  const cached = grantCache.get(ctx);
  if (cached) return cached;
  if (ctx.roleIds.length === 0) {
    grantCache.set(ctx, []);
    return [];
  }
  const grants = await withTenant(async (tx) => {
    const roles = await tx.select().from(schema.roles).where(inArray(schema.roles.id, ctx.roleIds));
    const all: Grant[] = [];
    for (const role of roles) {
      for (const raw of role.permissions as string[]) {
        const g = parseGrant(raw);
        if (g) all.push(g);
      }
    }
    return all;
  }, ctx);
  grantCache.set(ctx, grants);
  return grants;
}

function grantMatchesResource(grant: Grant, action: Action, resource: ResourceRef): boolean {
  if (grant.action !== '*' && grant.action !== action) return false;
  if (grant.resourceType !== '*' && grant.resourceType !== resource.type) return false;
  if (grant.selector !== '*' && resource.selector && grant.selector !== resource.selector) return false;
  return true;
}

function scopeSatisfied(grant: Grant, ctx: TenantContext, resource: ResourceRef): boolean {
  switch (grant.scope) {
    case 'all':
      return true;
    case 'own':
      return !!ctx.userId && resource.ownerUserId === ctx.userId;
    case 'team':
      return !!resource.teamId && ctx.teamIds.includes(resource.teamId);
    case 'branch':
      return !!resource.branchId && ctx.branchId === resource.branchId;
    default:
      return false;
  }
}

/**
 * Core decision function. Owners and platform admins short-circuit to allow.
 * Otherwise every grant is evaluated and the first satisfying one wins. When
 * nothing matches, the densest near-miss is reported so the UI can explain why.
 */
export async function check(action: Action, resource: ResourceRef): Promise<Decision> {
  const ctx = getContext();

  if (ctx.isPlatformAdmin) {
    return { allowed: true, reason: 'Platform administrator (audited)', matchedGrant: 'platform_admin' };
  }

  // Tenant owners have full control of their tenant (PRD §5.3). The auth layer
  // injects the synthetic '__owner__' role id for owner memberships.
  if (ctx.roleIds.includes('__owner__')) {
    return { allowed: true, reason: 'Tenant owner', matchedGrant: 'tenant_owner' };
  }

  const grants = await loadGrants(ctx);
  // Tenant owners have full control (PRD §5.3). Owner flag is injected as a
  // synthetic wildcard grant by the auth layer via roleIds → owner role, but we
  // also honor an explicit '*:*' grant here.
  for (const grant of grants) {
    if (grantMatchesResource(grant, action, resource)) {
      if (scopeSatisfied(grant, ctx, resource)) {
        return {
          allowed: true,
          reason: `Granted by ${grant.action}:${grant.resourceType}${grant.scope !== 'all' ? `/${grant.scope}` : ''}`,
          matchedGrant: `${grant.action}:${grant.resourceType}:${grant.selector}/${grant.scope}`,
        };
      }
    }
  }

  const nearMiss = grants.find((g) => grantMatchesResource(g, action, resource));
  const reason = nearMiss
    ? `A grant for ${action} on ${resource.type} exists but its scope '${nearMiss.scope}' is not satisfied for this record`
    : `No role grants ${action} on ${resource.type}${resource.selector ? ` (${resource.selector})` : ''}`;
  return { allowed: false, reason };
}

/** Throwing variant used at call sites that must enforce. */
export async function assert(action: Action, resource: ResourceRef): Promise<void> {
  const decision = await check(action, resource);
  if (!decision.allowed) {
    throw Forbidden(decision.reason, { action, resourceType: resource.type });
  }
}

/** Explain endpoint helper (PRD §18): returns the decision without throwing. */
export async function explain(action: Action, resource: ResourceRef): Promise<Decision> {
  return check(action, resource);
}
