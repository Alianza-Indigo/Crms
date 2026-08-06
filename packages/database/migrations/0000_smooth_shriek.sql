CREATE TYPE "public"."ai_plan_status" AS ENUM('draft', 'pending_approval', 'approved', 'executing', 'executed', 'rejected', 'failed', 'rolled_back');--> statement-breakpoint
CREATE TYPE "public"."audit_retention" AS ENUM('1y', '3y', '5y', 'indefinite', 'custom');--> statement-breakpoint
CREATE TYPE "public"."auth_type" AS ENUM('api_key', 'bearer', 'basic', 'oauth2', 'oauth2_refresh', 'client_credentials', 'jwt', 'hmac', 'service_account', 'certificate', 'custom_headers', 'temporary_token');--> statement-breakpoint
CREATE TYPE "public"."automation_status" AS ENUM('active', 'paused', 'disabled', 'draft');--> statement-breakpoint
CREATE TYPE "public"."credential_status" AS ENUM('pending', 'active', 'invalid', 'expired', 'revoked', 'insufficient_scopes', 'limit_exceeded', 'suspended');--> statement-breakpoint
CREATE TYPE "public"."deployment_status" AS ENUM('draft', 'pending_approval', 'approved', 'deploying', 'deployed', 'failed', 'rolled_back');--> statement-breakpoint
CREATE TYPE "public"."environment" AS ENUM('draft', 'development', 'testing', 'staging', 'production');--> statement-breakpoint
CREATE TYPE "public"."field_type" AS ENUM('text_short', 'text_long', 'text_rich', 'integer', 'decimal', 'currency', 'percent', 'date', 'time', 'datetime', 'duration', 'email', 'phone', 'url', 'boolean', 'select', 'multi_select', 'status', 'user', 'team', 'file', 'image', 'signature', 'location', 'coordinates', 'color', 'code', 'json', 'auto_id', 'relation', 'formula', 'computed', 'rollup', 'count', 'autonumber', 'qr', 'barcode', 'ai_generated');--> statement-breakpoint
CREATE TYPE "public"."idempotency_status" AS ENUM('in_progress', 'completed', 'failed');--> statement-breakpoint
CREATE TYPE "public"."isolation_tier" AS ENUM('shared', 'schema', 'dedicated');--> statement-breakpoint
CREATE TYPE "public"."membership_status" AS ENUM('invited', 'active', 'suspended', 'removed');--> statement-breakpoint
CREATE TYPE "public"."relation_on_delete" AS ENUM('restrict', 'cascade', 'set_null', 'unlink');--> statement-breakpoint
CREATE TYPE "public"."outbox_status" AS ENUM('pending', 'processing', 'published', 'failed', 'dead_letter');--> statement-breakpoint
CREATE TYPE "public"."relation_type" AS ENUM('one_to_one', 'one_to_many', 'many_to_many', 'polymorphic', 'hierarchical', 'self');--> statement-breakpoint
CREATE TYPE "public"."risk_level" AS ENUM('low', 'medium', 'high', 'critical');--> statement-breakpoint
CREATE TYPE "public"."run_status" AS ENUM('queued', 'running', 'waiting', 'succeeded', 'failed', 'cancelled', 'compensating', 'dead_letter');--> statement-breakpoint
CREATE TYPE "public"."subscription_status" AS ENUM('trialing', 'active', 'past_due', 'suspended', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."tenant_status" AS ENUM('active', 'suspended', 'deleting', 'migrating');--> statement-breakpoint
CREATE TYPE "public"."user_type" AS ENUM('internal', 'external', 'service');--> statement-breakpoint
CREATE TYPE "public"."webhook_delivery_status" AS ENUM('pending', 'delivering', 'delivered', 'failed', 'dead_letter');--> statement-breakpoint
CREATE TABLE "memberships" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"user_id" text NOT NULL,
	"status" "membership_status" DEFAULT 'invited' NOT NULL,
	"role_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"team_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"branch_id" text,
	"is_owner" boolean DEFAULT false NOT NULL,
	"invited_by" text,
	"invited_at" timestamp with time zone,
	"accepted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"sync_version" text DEFAULT '1' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "resellers" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"branding" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"plan_catalog" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"feature_restrictions" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_by" text,
	"updated_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"sync_version" text DEFAULT '1' NOT NULL,
	CONSTRAINT "resellers_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "tenant_domains" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"domain" text NOT NULL,
	"kind" text DEFAULT 'app' NOT NULL,
	"portal_id" text,
	"verified" boolean DEFAULT false NOT NULL,
	"verification_token" text,
	"ssl_status" text DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"sync_version" text DEFAULT '1' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tenant_routing" (
	"tenant_id" text PRIMARY KEY NOT NULL,
	"isolation_tier" "isolation_tier" DEFAULT 'shared' NOT NULL,
	"schema_name" text,
	"connection_ref" text,
	"routing_state" text DEFAULT 'stable' NOT NULL,
	"region" text DEFAULT 'us-east-1' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tenants" (
	"id" text PRIMARY KEY NOT NULL,
	"reseller_id" text,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"status" "tenant_status" DEFAULT 'active' NOT NULL,
	"isolation_tier" "isolation_tier" DEFAULT 'shared' NOT NULL,
	"region" text DEFAULT 'us-east-1' NOT NULL,
	"branding" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"limits" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"audit_retention" "audit_retention" DEFAULT '1y' NOT NULL,
	"audit_retention_custom_days" text,
	"settings" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_by" text,
	"updated_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"sync_version" text DEFAULT '1' NOT NULL,
	CONSTRAINT "tenants_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "api_keys" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"application_id" text,
	"service_account_id" text,
	"name" text NOT NULL,
	"prefix" text NOT NULL,
	"key_hash" text NOT NULL,
	"scopes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"allowed_ips" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"last_used_at" timestamp with time zone,
	"expires_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_by" text,
	"updated_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"sync_version" text DEFAULT '1' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "branches" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"name" text NOT NULL,
	"parent_branch_id" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_by" text,
	"updated_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"sync_version" text DEFAULT '1' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "roles" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"application_id" text,
	"name" text NOT NULL,
	"description" text,
	"permissions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"conditions" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"is_system" boolean DEFAULT false NOT NULL,
	"created_by" text,
	"updated_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"sync_version" text DEFAULT '1' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "service_accounts" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"application_id" text,
	"name" text NOT NULL,
	"role_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_by" text,
	"updated_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"sync_version" text DEFAULT '1' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"token_hash" text NOT NULL,
	"active_tenant_id" text,
	"portal_id" text,
	"device" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"ip" text,
	"trusted" boolean DEFAULT false NOT NULL,
	"impersonated_user_id" text,
	"impersonated_by" text,
	"impersonation_expires_at" timestamp with time zone,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"sync_version" text DEFAULT '1' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "teams" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"name" text NOT NULL,
	"parent_team_id" text,
	"member_user_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"lead_user_id" text,
	"created_by" text,
	"updated_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"sync_version" text DEFAULT '1' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" text PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"password_hash" text,
	"name" text,
	"avatar_url" text,
	"type" "user_type" DEFAULT 'internal' NOT NULL,
	"locale" text DEFAULT 'es' NOT NULL,
	"timezone" text DEFAULT 'UTC' NOT NULL,
	"oauth_provider" text,
	"oauth_subject" text,
	"is_platform_admin" boolean DEFAULT false NOT NULL,
	"failed_login_attempts" text DEFAULT '0' NOT NULL,
	"locked_until" timestamp with time zone,
	"last_login_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"sync_version" text DEFAULT '1' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "application_versions" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"application_id" text NOT NULL,
	"version" text NOT NULL,
	"environment" "environment" NOT NULL,
	"snapshot" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"changelog" text,
	"published_at" timestamp with time zone,
	"created_by" text,
	"updated_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"sync_version" text DEFAULT '1' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "applications" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"description" text,
	"icon" text,
	"color" text,
	"sector" text,
	"branding" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"published_versions" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"settings" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_by" text,
	"updated_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"sync_version" text DEFAULT '1' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "deployment_manifests" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"application_id" text NOT NULL,
	"source_version" text NOT NULL,
	"source_environment" "environment" NOT NULL,
	"target_environment" "environment" NOT NULL,
	"changes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"dependencies" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"required_variables" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"credential_refs" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"migration_plan" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"rollback_plan" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"risks" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"risk_level" "risk_level" DEFAULT 'low' NOT NULL,
	"approvals" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"required_approvals" text DEFAULT '1' NOT NULL,
	"status" "deployment_status" DEFAULT 'draft' NOT NULL,
	"result" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_by" text,
	"updated_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"sync_version" text DEFAULT '1' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "feature_flags" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text,
	"key" text NOT NULL,
	"description" text,
	"enabled" boolean DEFAULT false NOT NULL,
	"rules" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"rollout_percentage" text DEFAULT '100' NOT NULL,
	"created_by" text,
	"updated_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"sync_version" text DEFAULT '1' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "dashboard_definitions" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"application_id" text NOT NULL,
	"environment" text DEFAULT 'production' NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"widgets" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"filters" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"permissions" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"is_shared" boolean DEFAULT false NOT NULL,
	"owner_user_id" text,
	"schedule" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_by" text,
	"updated_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"sync_version" text DEFAULT '1' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "field_definitions" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"application_id" text NOT NULL,
	"environment" text DEFAULT 'production' NOT NULL,
	"module_id" text NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"type" "field_type" NOT NULL,
	"required" boolean DEFAULT false NOT NULL,
	"unique" boolean DEFAULT false NOT NULL,
	"indexed" boolean DEFAULT false NOT NULL,
	"default_value" jsonb,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"validations" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"permissions" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"help_text" text,
	"is_system" boolean DEFAULT false NOT NULL,
	"created_by" text,
	"updated_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"sync_version" text DEFAULT '1' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "form_definitions" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"application_id" text NOT NULL,
	"environment" text DEFAULT 'production' NOT NULL,
	"module_id" text,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"kind" text DEFAULT 'internal' NOT NULL,
	"layout" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"fields" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"conditional_logic" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"settings" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"public_slug" text,
	"captcha_enabled" boolean DEFAULT false NOT NULL,
	"dedupe_config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"redirect_url" text,
	"created_by" text,
	"updated_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"sync_version" text DEFAULT '1' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "module_definitions" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"application_id" text NOT NULL,
	"environment" text DEFAULT 'production' NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"name_plural" text,
	"icon" text,
	"color" text,
	"description" text,
	"primary_field_id" text,
	"position" integer DEFAULT 0 NOT NULL,
	"settings" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"enable_comments" boolean DEFAULT true NOT NULL,
	"enable_activity" boolean DEFAULT true NOT NULL,
	"enable_versioning" boolean DEFAULT true NOT NULL,
	"created_by" text,
	"updated_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"sync_version" text DEFAULT '1' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pipeline_definitions" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"application_id" text NOT NULL,
	"environment" text DEFAULT 'production' NOT NULL,
	"module_id" text NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"stages" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"transitions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"stage_field_id" text,
	"settings" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_by" text,
	"updated_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"sync_version" text DEFAULT '1' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "relation_definitions" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"application_id" text NOT NULL,
	"environment" text DEFAULT 'production' NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"type" "relation_type" NOT NULL,
	"source_module_id" text NOT NULL,
	"target_module_id" text NOT NULL,
	"polymorphic_targets" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"on_delete" "relation_on_delete" DEFAULT 'restrict' NOT NULL,
	"inverse_name" text,
	"required" boolean DEFAULT false NOT NULL,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_by" text,
	"updated_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"sync_version" text DEFAULT '1' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "view_definitions" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"application_id" text NOT NULL,
	"environment" text DEFAULT 'production' NOT NULL,
	"module_id" text NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"type" text NOT NULL,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"filters" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"sorts" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"grouping" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"visible_field_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"permissions" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"is_shared" boolean DEFAULT true NOT NULL,
	"owner_user_id" text,
	"position" integer DEFAULT 0 NOT NULL,
	"created_by" text,
	"updated_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"sync_version" text DEFAULT '1' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "activities" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"application_id" text NOT NULL,
	"environment" text DEFAULT 'production' NOT NULL,
	"record_id" text,
	"module_id" text,
	"type" text NOT NULL,
	"summary" text,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"actor" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "comments" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"application_id" text NOT NULL,
	"environment" text DEFAULT 'production' NOT NULL,
	"record_id" text NOT NULL,
	"module_id" text NOT NULL,
	"parent_comment_id" text,
	"body" text NOT NULL,
	"mentions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_by" text,
	"updated_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"sync_version" text DEFAULT '1' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "files" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"application_id" text,
	"environment" text DEFAULT 'production' NOT NULL,
	"record_id" text,
	"module_id" text,
	"field_id" text,
	"name" text NOT NULL,
	"content_type" text NOT NULL,
	"size_bytes" text DEFAULT '0' NOT NULL,
	"storage_key" text NOT NULL,
	"storage_credential_id" text,
	"checksum" text,
	"scan_status" text DEFAULT 'pending' NOT NULL,
	"created_by" text,
	"updated_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"sync_version" text DEFAULT '1' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "record_followers" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"record_id" text NOT NULL,
	"user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "record_history" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"application_id" text NOT NULL,
	"environment" text DEFAULT 'production' NOT NULL,
	"record_id" text NOT NULL,
	"module_id" text NOT NULL,
	"version" integer NOT NULL,
	"change_type" text NOT NULL,
	"changes" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"actor" text,
	"correlation_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "record_relations" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"application_id" text NOT NULL,
	"environment" text DEFAULT 'production' NOT NULL,
	"relation_id" text NOT NULL,
	"source_record_id" text NOT NULL,
	"target_record_id" text NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"created_by" text,
	"updated_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"sync_version" text DEFAULT '1' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "record_values" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"application_id" text NOT NULL,
	"environment" text DEFAULT 'production' NOT NULL,
	"record_id" text NOT NULL,
	"module_id" text NOT NULL,
	"field_id" text NOT NULL,
	"field_key" text NOT NULL,
	"value_text" text,
	"value_number" text,
	"value_bool" boolean,
	"value_date" timestamp with time zone,
	"value_json" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"sync_version" text DEFAULT '1' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "records" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"application_id" text NOT NULL,
	"environment" text DEFAULT 'production' NOT NULL,
	"module_id" text NOT NULL,
	"display_title" text,
	"owner_user_id" text,
	"assignee_user_id" text,
	"team_id" text,
	"branch_id" text,
	"stage" text,
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"archived_at" timestamp with time zone,
	"locked_at" timestamp with time zone,
	"locked_by" text,
	"created_by" text,
	"updated_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"sync_version" text DEFAULT '1' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_definitions" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"application_id" text NOT NULL,
	"environment" text DEFAULT 'production' NOT NULL,
	"name" text NOT NULL,
	"purpose" text,
	"instructions" text,
	"provider" text DEFAULT 'openai' NOT NULL,
	"model" text,
	"credential_id" text,
	"service_account_id" text,
	"tools" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"accessible_module_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"allowed_actions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"memory_config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"triggers" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"limits" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"budget" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"schedule" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"require_human_review" boolean DEFAULT true NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_by" text,
	"updated_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"sync_version" text DEFAULT '1' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "credential_assignments" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"application_id" text,
	"environment" "environment",
	"credential_id" text NOT NULL,
	"consumer_type" text NOT NULL,
	"consumer_id" text NOT NULL,
	"variable_name" text,
	"created_by" text,
	"updated_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"sync_version" text DEFAULT '1' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "credential_secrets" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"credential_id" text NOT NULL,
	"version" text NOT NULL,
	"ciphertext" text NOT NULL,
	"key_version" text DEFAULT '1' NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"rotated_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "credentials" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"application_id" text,
	"environment" "environment",
	"key" text NOT NULL,
	"name" text NOT NULL,
	"provider" text NOT NULL,
	"auth_type" "auth_type" NOT NULL,
	"status" "credential_status" DEFAULT 'pending' NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"scopes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"account_label" text,
	"last_validated_at" timestamp with time zone,
	"last_used_at" timestamp with time zone,
	"expires_at" timestamp with time zone,
	"last_error" text,
	"connected_by" text,
	"created_by" text,
	"updated_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"sync_version" text DEFAULT '1' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "federated_connections" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"application_id" text NOT NULL,
	"environment" text DEFAULT 'production' NOT NULL,
	"name" text NOT NULL,
	"driver" text NOT NULL,
	"credential_id" text NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"max_rows" text DEFAULT '1000' NOT NULL,
	"timeout_ms" text DEFAULT '5000' NOT NULL,
	"masking_rules" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_by" text,
	"updated_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"sync_version" text DEFAULT '1' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "integration_connections" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"application_id" text NOT NULL,
	"environment" text DEFAULT 'production' NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"provider" text NOT NULL,
	"credential_id" text,
	"definition" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"rate_limits" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_by" text,
	"updated_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"sync_version" text DEFAULT '1' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "automation_definitions" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"application_id" text NOT NULL,
	"environment" text DEFAULT 'production' NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"status" "automation_status" DEFAULT 'draft' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"trigger" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"graph" jsonb DEFAULT '{"nodes":[],"edges":[]}'::jsonb NOT NULL,
	"max_concurrency" integer DEFAULT 5 NOT NULL,
	"loop_guard" jsonb DEFAULT '{"maxDepth":10}'::jsonb NOT NULL,
	"timeout_seconds" integer DEFAULT 300 NOT NULL,
	"created_by" text,
	"updated_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"sync_version" text DEFAULT '1' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "automation_runs" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"application_id" text NOT NULL,
	"environment" text DEFAULT 'production' NOT NULL,
	"automation_id" text NOT NULL,
	"automation_version" integer NOT NULL,
	"status" "run_status" DEFAULT 'queued' NOT NULL,
	"trigger_event" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"depth" integer DEFAULT 0 NOT NULL,
	"idempotency_key" text,
	"context" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"step_history" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"error" jsonb,
	"correlation_id" text,
	"started_at" timestamp with time zone,
	"resume_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"sync_version" text DEFAULT '1' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "document_signatures" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"application_id" text NOT NULL,
	"document_id" text NOT NULL,
	"signer_email" text NOT NULL,
	"signer_name" text,
	"token" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"signature_data" text,
	"signed_at" timestamp with time zone,
	"ip" text,
	"created_by" text,
	"updated_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"sync_version" text DEFAULT '1' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "document_templates" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"application_id" text NOT NULL,
	"environment" text DEFAULT 'production' NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"kind" text DEFAULT 'document' NOT NULL,
	"body" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"outputs" jsonb DEFAULT '["pdf"]'::jsonb NOT NULL,
	"module_id" text,
	"settings" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_by" text,
	"updated_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"sync_version" text DEFAULT '1' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "generated_documents" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"application_id" text NOT NULL,
	"environment" text DEFAULT 'production' NOT NULL,
	"template_id" text NOT NULL,
	"record_id" text,
	"file_id" text,
	"status" text DEFAULT 'generating' NOT NULL,
	"signature_status" text,
	"idempotency_key" text,
	"created_by" text,
	"updated_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"sync_version" text DEFAULT '1' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "portal_definitions" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"application_id" text NOT NULL,
	"environment" text DEFAULT 'production' NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"audience" text DEFAULT 'clients' NOT NULL,
	"branding" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"domain_id" text,
	"exposure" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"auth_config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"payment_credential_id" text,
	"active" boolean DEFAULT false NOT NULL,
	"created_by" text,
	"updated_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"sync_version" text DEFAULT '1' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_contexts" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"conversation_id" text NOT NULL,
	"snapshot" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"sync_version" text DEFAULT '1' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_conversations" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"application_id" text,
	"environment" text DEFAULT 'production' NOT NULL,
	"title" text,
	"user_id" text,
	"created_by" text,
	"updated_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"sync_version" text DEFAULT '1' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_executions" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"plan_id" text NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"results" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"error" jsonb,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"correlation_id" text,
	"created_by" text,
	"updated_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"sync_version" text DEFAULT '1' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_plans" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"application_id" text,
	"environment" text DEFAULT 'production' NOT NULL,
	"conversation_id" text,
	"summary" text NOT NULL,
	"operations" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"risk_level" "risk_level" DEFAULT 'low' NOT NULL,
	"dependencies" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"environment_impact" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"required_credentials" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"required_approvals" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"rollback_plan" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" "ai_plan_status" DEFAULT 'draft' NOT NULL,
	"created_by_user_id" text,
	"approved_by_user_id" text,
	"expires_at" timestamp with time zone,
	"created_by" text,
	"updated_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"sync_version" text DEFAULT '1' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"conversation_id" text NOT NULL,
	"provider" text NOT NULL,
	"model" text,
	"credential_id" text,
	"messages" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"usage" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"sync_version" text DEFAULT '1' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_archive_jobs" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"cutoff_date" timestamp with time zone NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"archived_count" integer DEFAULT 0 NOT NULL,
	"storage_key" text,
	"legal_hold" boolean DEFAULT false NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_events" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"application_id" text,
	"environment" text,
	"action" text NOT NULL,
	"resource_type" text,
	"resource_id" text,
	"actor_user_id" text,
	"actor_service_account_id" text,
	"original_user_id" text,
	"impersonated_user_id" text,
	"impersonated_by" text,
	"ip" text,
	"user_agent" text,
	"correlation_id" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "idempotency_store" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"application_id" text,
	"environment" text DEFAULT 'production' NOT NULL,
	"operation" text NOT NULL,
	"key" text NOT NULL,
	"request_hash" text NOT NULL,
	"response_reference" jsonb,
	"status" "idempotency_status" DEFAULT 'in_progress' NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "import_jobs" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"application_id" text NOT NULL,
	"environment" text DEFAULT 'production' NOT NULL,
	"module_id" text NOT NULL,
	"format" text DEFAULT 'csv' NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"mapping" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"dedupe_field" text,
	"update_existing" boolean DEFAULT false NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"storage_key" text,
	"total" integer DEFAULT 0 NOT NULL,
	"created" integer DEFAULT 0 NOT NULL,
	"updated" integer DEFAULT 0 NOT NULL,
	"failed" integer DEFAULT 0 NOT NULL,
	"errors" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"application_id" text,
	"user_id" text NOT NULL,
	"channel" text DEFAULT 'in_app' NOT NULL,
	"title" text NOT NULL,
	"body" text,
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"sent_at" timestamp with time zone,
	"recipient" text,
	"read_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "outbox_messages" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"application_id" text,
	"environment" text DEFAULT 'production' NOT NULL,
	"type" text NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"schema_version" integer DEFAULT 1 NOT NULL,
	"aggregate_type" text,
	"aggregate_id" text,
	"correlation_id" text,
	"status" "outbox_status" DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_error" text,
	"available_at" timestamp with time zone DEFAULT now() NOT NULL,
	"published_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "subscriptions" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"reseller_id" text,
	"plan" text NOT NULL,
	"status" "subscription_status" DEFAULT 'trialing' NOT NULL,
	"seats" integer DEFAULT 1 NOT NULL,
	"limits" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"provider_refs" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"trial_ends_at" timestamp with time zone,
	"current_period_end" timestamp with time zone,
	"created_by" text,
	"updated_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"sync_version" text DEFAULT '1' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tenant_migration_jobs" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"from_tier" text NOT NULL,
	"to_tier" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"phase" text DEFAULT 'created' NOT NULL,
	"checksums" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"rollback_deadline" timestamp with time zone,
	"error" text,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "usage_events" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"application_id" text,
	"environment" text,
	"provider" text,
	"kind" text NOT NULL,
	"requests" integer DEFAULT 1 NOT NULL,
	"duration_ms" integer DEFAULT 0 NOT NULL,
	"bytes_in" integer DEFAULT 0 NOT NULL,
	"bytes_out" integer DEFAULT 0 NOT NULL,
	"tokens" integer DEFAULT 0 NOT NULL,
	"status" text,
	"error_count" integer DEFAULT 0 NOT NULL,
	"retries" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "usage_metrics" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"period" text NOT NULL,
	"metric" text NOT NULL,
	"value" text DEFAULT '0' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "webhook_deliveries" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"subscription_id" text NOT NULL,
	"outbox_message_id" text,
	"event_type" text NOT NULL,
	"status" "webhook_delivery_status" DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"request_hash" text,
	"response_status" integer,
	"last_error" text,
	"next_attempt_at" timestamp with time zone,
	"delivered_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "webhook_subscriptions" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"application_id" text NOT NULL,
	"environment" text DEFAULT 'production' NOT NULL,
	"url" text NOT NULL,
	"events" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"secret_ref" text,
	"active" boolean DEFAULT true NOT NULL,
	"created_by" text,
	"updated_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"sync_version" text DEFAULT '1' NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "memberships_tenant_user_idx" ON "memberships" USING btree ("tenant_id","user_id");--> statement-breakpoint
CREATE INDEX "memberships_user_idx" ON "memberships" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "tenant_domains_domain_idx" ON "tenant_domains" USING btree ("domain");--> statement-breakpoint
CREATE INDEX "tenant_domains_tenant_idx" ON "tenant_domains" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "tenants_reseller_idx" ON "tenants" USING btree ("reseller_id");--> statement-breakpoint
CREATE INDEX "tenants_status_idx" ON "tenants" USING btree ("status");--> statement-breakpoint
CREATE INDEX "api_keys_tenant_idx" ON "api_keys" USING btree ("tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "api_keys_prefix_idx" ON "api_keys" USING btree ("prefix");--> statement-breakpoint
CREATE INDEX "branches_tenant_idx" ON "branches" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "roles_tenant_idx" ON "roles" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "roles_app_idx" ON "roles" USING btree ("application_id");--> statement-breakpoint
CREATE INDEX "service_accounts_tenant_idx" ON "service_accounts" USING btree ("tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "sessions_token_idx" ON "sessions" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "sessions_user_idx" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "teams_tenant_idx" ON "teams" USING btree ("tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_idx" ON "users" USING btree ("email");--> statement-breakpoint
CREATE INDEX "application_versions_app_idx" ON "application_versions" USING btree ("application_id","environment");--> statement-breakpoint
CREATE UNIQUE INDEX "application_versions_unique_idx" ON "application_versions" USING btree ("application_id","environment","version");--> statement-breakpoint
CREATE UNIQUE INDEX "applications_tenant_slug_idx" ON "applications" USING btree ("tenant_id","slug");--> statement-breakpoint
CREATE INDEX "applications_tenant_idx" ON "applications" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "deployment_manifests_app_idx" ON "deployment_manifests" USING btree ("application_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "feature_flags_scope_key_idx" ON "feature_flags" USING btree ("tenant_id","key");--> statement-breakpoint
CREATE INDEX "dashboard_defs_app_idx" ON "dashboard_definitions" USING btree ("tenant_id","application_id","environment");--> statement-breakpoint
CREATE UNIQUE INDEX "field_defs_scope_key_idx" ON "field_definitions" USING btree ("module_id","key");--> statement-breakpoint
CREATE INDEX "field_defs_module_idx" ON "field_definitions" USING btree ("tenant_id","application_id","environment","module_id");--> statement-breakpoint
CREATE INDEX "form_defs_module_idx" ON "form_definitions" USING btree ("module_id");--> statement-breakpoint
CREATE UNIQUE INDEX "form_defs_public_slug_idx" ON "form_definitions" USING btree ("public_slug");--> statement-breakpoint
CREATE UNIQUE INDEX "module_defs_scope_key_idx" ON "module_definitions" USING btree ("tenant_id","application_id","environment","key");--> statement-breakpoint
CREATE INDEX "module_defs_app_idx" ON "module_definitions" USING btree ("tenant_id","application_id","environment");--> statement-breakpoint
CREATE INDEX "pipeline_defs_module_idx" ON "pipeline_definitions" USING btree ("module_id");--> statement-breakpoint
CREATE INDEX "relation_defs_source_idx" ON "relation_definitions" USING btree ("source_module_id");--> statement-breakpoint
CREATE INDEX "relation_defs_target_idx" ON "relation_definitions" USING btree ("target_module_id");--> statement-breakpoint
CREATE UNIQUE INDEX "relation_defs_scope_key_idx" ON "relation_definitions" USING btree ("tenant_id","application_id","environment","key");--> statement-breakpoint
CREATE INDEX "view_defs_module_idx" ON "view_definitions" USING btree ("module_id");--> statement-breakpoint
CREATE INDEX "activities_record_idx" ON "activities" USING btree ("record_id");--> statement-breakpoint
CREATE INDEX "activities_tenant_idx" ON "activities" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "comments_record_idx" ON "comments" USING btree ("record_id");--> statement-breakpoint
CREATE INDEX "files_tenant_idx" ON "files" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "files_record_idx" ON "files" USING btree ("record_id");--> statement-breakpoint
CREATE UNIQUE INDEX "record_followers_unique_idx" ON "record_followers" USING btree ("record_id","user_id");--> statement-breakpoint
CREATE INDEX "record_history_record_idx" ON "record_history" USING btree ("record_id","version");--> statement-breakpoint
CREATE UNIQUE INDEX "record_relations_unique_idx" ON "record_relations" USING btree ("relation_id","source_record_id","target_record_id");--> statement-breakpoint
CREATE INDEX "record_relations_source_idx" ON "record_relations" USING btree ("tenant_id","source_record_id");--> statement-breakpoint
CREATE INDEX "record_relations_target_idx" ON "record_relations" USING btree ("tenant_id","target_record_id");--> statement-breakpoint
CREATE UNIQUE INDEX "record_values_unique_idx" ON "record_values" USING btree ("record_id","field_id");--> statement-breakpoint
CREATE INDEX "record_values_filter_idx" ON "record_values" USING btree ("tenant_id","application_id","environment","field_id","value_text");--> statement-breakpoint
CREATE INDEX "record_values_number_idx" ON "record_values" USING btree ("tenant_id","field_id","value_number");--> statement-breakpoint
CREATE INDEX "records_scope_idx" ON "records" USING btree ("tenant_id","application_id","environment","module_id");--> statement-breakpoint
CREATE INDEX "records_owner_idx" ON "records" USING btree ("tenant_id","owner_user_id");--> statement-breakpoint
CREATE INDEX "records_assignee_idx" ON "records" USING btree ("tenant_id","assignee_user_id");--> statement-breakpoint
CREATE INDEX "records_stage_idx" ON "records" USING btree ("tenant_id","module_id","stage");--> statement-breakpoint
CREATE INDEX "agent_defs_app_idx" ON "agent_definitions" USING btree ("tenant_id","application_id","environment");--> statement-breakpoint
CREATE INDEX "credential_assignments_cred_idx" ON "credential_assignments" USING btree ("credential_id");--> statement-breakpoint
CREATE UNIQUE INDEX "credential_assignments_unique_idx" ON "credential_assignments" USING btree ("credential_id","consumer_type","consumer_id");--> statement-breakpoint
CREATE INDEX "credential_secrets_cred_idx" ON "credential_secrets" USING btree ("credential_id","active");--> statement-breakpoint
CREATE UNIQUE INDEX "credential_secrets_version_idx" ON "credential_secrets" USING btree ("credential_id","version");--> statement-breakpoint
CREATE INDEX "credentials_tenant_idx" ON "credentials" USING btree ("tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "credentials_scope_key_idx" ON "credentials" USING btree ("tenant_id","application_id","environment","key");--> statement-breakpoint
CREATE INDEX "credentials_provider_idx" ON "credentials" USING btree ("tenant_id","provider");--> statement-breakpoint
CREATE INDEX "federated_connections_app_idx" ON "federated_connections" USING btree ("tenant_id","application_id","environment");--> statement-breakpoint
CREATE INDEX "integrations_app_idx" ON "integration_connections" USING btree ("tenant_id","application_id","environment");--> statement-breakpoint
CREATE INDEX "automation_defs_app_idx" ON "automation_definitions" USING btree ("tenant_id","application_id","environment","status");--> statement-breakpoint
CREATE INDEX "automation_runs_status_idx" ON "automation_runs" USING btree ("tenant_id","status");--> statement-breakpoint
CREATE INDEX "automation_runs_automation_idx" ON "automation_runs" USING btree ("automation_id");--> statement-breakpoint
CREATE INDEX "automation_runs_resume_idx" ON "automation_runs" USING btree ("resume_at");--> statement-breakpoint
CREATE UNIQUE INDEX "document_signatures_token_idx" ON "document_signatures" USING btree ("token");--> statement-breakpoint
CREATE INDEX "document_signatures_doc_idx" ON "document_signatures" USING btree ("document_id");--> statement-breakpoint
CREATE INDEX "document_templates_app_idx" ON "document_templates" USING btree ("tenant_id","application_id","environment");--> statement-breakpoint
CREATE INDEX "generated_documents_template_idx" ON "generated_documents" USING btree ("template_id");--> statement-breakpoint
CREATE INDEX "portal_defs_app_idx" ON "portal_definitions" USING btree ("tenant_id","application_id","environment");--> statement-breakpoint
CREATE INDEX "ai_contexts_conversation_idx" ON "ai_contexts" USING btree ("conversation_id");--> statement-breakpoint
CREATE INDEX "ai_conversations_tenant_idx" ON "ai_conversations" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "ai_executions_plan_idx" ON "ai_executions" USING btree ("plan_id");--> statement-breakpoint
CREATE INDEX "ai_plans_status_idx" ON "ai_plans" USING btree ("tenant_id","status");--> statement-breakpoint
CREATE INDEX "ai_sessions_conversation_idx" ON "ai_sessions" USING btree ("conversation_id");--> statement-breakpoint
CREATE INDEX "audit_archive_jobs_tenant_idx" ON "audit_archive_jobs" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "audit_events_tenant_idx" ON "audit_events" USING btree ("tenant_id","created_at");--> statement-breakpoint
CREATE INDEX "audit_events_resource_idx" ON "audit_events" USING btree ("tenant_id","resource_type","resource_id");--> statement-breakpoint
CREATE UNIQUE INDEX "idempotency_unique_idx" ON "idempotency_store" USING btree ("tenant_id","application_id","environment","operation","key");--> statement-breakpoint
CREATE INDEX "idempotency_expiry_idx" ON "idempotency_store" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "import_jobs_tenant_idx" ON "import_jobs" USING btree ("tenant_id","status");--> statement-breakpoint
CREATE INDEX "notifications_user_idx" ON "notifications" USING btree ("tenant_id","user_id","read_at");--> statement-breakpoint
CREATE INDEX "notifications_delivery_idx" ON "notifications" USING btree ("status","channel");--> statement-breakpoint
CREATE INDEX "outbox_dispatch_idx" ON "outbox_messages" USING btree ("status","next_attempt_at");--> statement-breakpoint
CREATE INDEX "outbox_tenant_idx" ON "outbox_messages" USING btree ("tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "subscriptions_tenant_idx" ON "subscriptions" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "tenant_migration_jobs_tenant_idx" ON "tenant_migration_jobs" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "usage_events_tenant_idx" ON "usage_events" USING btree ("tenant_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "usage_metrics_unique_idx" ON "usage_metrics" USING btree ("tenant_id","period","metric");--> statement-breakpoint
CREATE INDEX "webhook_deliveries_status_idx" ON "webhook_deliveries" USING btree ("status","next_attempt_at");--> statement-breakpoint
CREATE INDEX "webhook_subs_app_idx" ON "webhook_subscriptions" USING btree ("tenant_id","application_id","environment");