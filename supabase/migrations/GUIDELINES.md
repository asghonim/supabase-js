# SQL Migration Guidelines

These guidelines are derived from the patterns established in this project's existing migrations. Follow them when writing new migrations to maintain consistency.

---

## File Naming

- Use the format `YYYYMMDDHHMMSS_description.sql`
- Use a descriptive snake_case suffix (e.g., `_accounts`, `_rbac`, `_notifications`)
- Timestamps determine execution order — choose timestamps that place your migration after its dependencies

---

## File Structure

Organize each migration file in this order:

1. **Header comment** — module name, purpose, and design principles
2. **Extensions** — `CREATE EXTENSION IF NOT EXISTS ...`
3. **Enums** — `CREATE TYPE ... AS ENUM (...)`
4. **Tables** — core tables first, then supporting/join tables
5. **Triggers** — timestamp management triggers immediately after each table
6. **Indexes** — after all tables are defined
7. **Row Level Security** — `ENABLE ROW LEVEL SECURITY` + policies
8. **Helper functions** — permission-checking and convenience functions
9. **Seed data** — `INSERT INTO` for reference/lookup data

Use section-separator comments for readability:

```sql
-- ================================================================
-- SECTION NAME
-- ================================================================
```

---

## Tables

### Primary Keys

- Use `BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY` for internal tables
- Use `UUID PRIMARY KEY DEFAULT gen_random_uuid()` for externally-referenced or event-sourced tables (e.g., outbox, contact submissions)

### Timestamps

Every table must include:

```sql
created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
```

- Append-only/immutable tables may omit `updated_at`
- Historical/log tables (e.g., `account_names`) may use only `created_at` (no default — set via trigger)

### Foreign Keys

- Always specify `ON DELETE` behavior explicitly:
  - `CASCADE` — child data has no meaning without parent (members, names, messages)
  - `SET NULL` — reference is informational (invited_by, assigned_to, actor)
  - `RESTRICT` — deletion must be prevented (owner references, active role assignments)
- Reference `auth.users(id)` with `ON DELETE CASCADE` for user_id columns
- Reference internal tables by `BIGINT` ID, not UUID

### Constraints

- Use `CHECK` constraints for text length bounds: `CHECK (char_length(name) BETWEEN 1 AND 255)`
- Use `CHECK` constraints for enum-like text columns: `CHECK (scope IN ('platform', 'organization', 'project'))`
- Use `UNIQUE` constraints on natural keys (e.g., slug, email, key_hash)
- Use composite `UNIQUE` for membership tables: `UNIQUE (organization_id, account_id)`

### Column Conventions

- Use `TEXT` for strings (not `VARCHAR`)
- Use `BIGINT` for internal IDs and foreign keys
- Use `TIMESTAMPTZ` for all timestamps (never `TIMESTAMP`)
- Use `JSONB` with `NOT NULL DEFAULT '{}'` for metadata/payload columns
- Use `BOOLEAN NOT NULL DEFAULT FALSE` for flag columns
- Use `NUMERIC(precision, scale)` for non-monetary scores and percentages (e.g., `spam_score NUMERIC(5,2)`)
- Store monetary amounts as `BIGINT` in the smallest currency unit (e.g., cents) — never use decimals for money

---

## Triggers

### Timestamp Triggers

Every table needs a `BEFORE INSERT` trigger to set `created_at` (and `updated_at` if present):

```sql
CREATE OR REPLACE FUNCTION private.on_insert_<table_name>()
RETURNS TRIGGER AS $$
BEGIN
    NEW.created_at = NOW();
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public, private;

CREATE TRIGGER on_<table_name>_inserted
    BEFORE INSERT ON public.<table_name>
    FOR EACH ROW EXECUTE FUNCTION private.on_insert_<table_name>();
```

Tables that allow updates also need a `BEFORE UPDATE` trigger:

```sql
CREATE OR REPLACE FUNCTION private.on_update_<table_name>()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public, private;

CREATE TRIGGER on_update_<table_name>
    BEFORE UPDATE ON public.<table_name>
    FOR EACH ROW EXECUTE FUNCTION private.on_update_<table_name>();
```

### Trigger Naming

- Insert triggers: `on_<table_name>_inserted`
- Insert functions: `private.on_insert_<table_name>()`
- Update triggers: `on_update_<table_name>`
- Update functions: `private.on_update_<table_name>()`

---

## Functions

### Schema Placement

- **`private.*`** — internal helper functions (permission checks, triggers, computed defaults)
- **`public.*`** — user-facing functions callable via PostgREST RPC

### Function Conventions

```sql
CREATE OR REPLACE FUNCTION private.function_name(p_param_name TYPE)
RETURNS RETURN_TYPE AS $$
    -- body
$$ LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public, private;
```

- Prefix parameters with `p_` to avoid column name conflicts
- Use `LANGUAGE sql` for simple queries, `LANGUAGE plpgsql` for procedural logic
- Always set `search_path = public, private` to avoid search_path attacks
- Use `SECURITY DEFINER` for functions that need to bypass RLS
- Mark read-only functions as `STABLE`

### Permission-Checking Functions

Follow the established pattern for access control helpers:

```sql
-- Ownership check
CREATE OR REPLACE FUNCTION private.owns_account(p_account_id BIGINT)
RETURNS BOOLEAN AS $$
    SELECT EXISTS (
        SELECT 1 FROM public.accounts a
        WHERE a.id = p_account_id
          AND a.user_id = auth.uid()
    );
$$ LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public, private;

-- Membership check
CREATE OR REPLACE FUNCTION private.is_org_member(p_org_id BIGINT)
RETURNS BOOLEAN AS $$ ... $$ ;

-- Permission check (RBAC)
CREATE OR REPLACE FUNCTION private.has_org_permission(p_org_id BIGINT, p_permission_key TEXT)
RETURNS BOOLEAN AS $$ ... $$ ;
```

---

## Indexes

### Naming

- Use `idx_<table>_<column(s)>` format: `idx_api_keys_org`, `idx_org_members_account`
- Anonymous indexes (no explicit name) are acceptable for simple single-column lookups

### What to Index

- Foreign key columns (always)
- Columns used in RLS policies and permission functions
- Columns used in WHERE clauses for common queries
- Composite indexes for (parent_id, created_at DESC) on historical tables
- Partial indexes for active/unprocessed records: `WHERE revoked_at IS NULL`, `WHERE processed_at IS NULL`
- GIN indexes with `pg_trgm` for full-text search on text columns

---

## Row Level Security (RLS)

### Enable RLS on Every Table

```sql
ALTER TABLE public.<table_name> ENABLE ROW LEVEL SECURITY;
```

Place this immediately after the table definition or in a dedicated RLS section.

### Policy Naming

Use descriptive English sentences:

```sql
CREATE POLICY "Account owners can view their own accounts"
CREATE POLICY "Org members can view api keys"
CREATE POLICY "Allow admins to manage org membership"
```

### Policy Patterns

1. **Owner-based access** — use `auth.uid()` comparison or ownership helper:
   ```sql
   USING (user_id = auth.uid())
   USING (private.owns_account(account_id))
   ```

2. **Membership-based access** — use membership helper:
   ```sql
   USING (private.is_org_member(org_id))
   ```

3. **Permission-based access** — use RBAC helper:
   ```sql
   USING (private.has_org_permission(organization_id, 'billing.manage'))
   USING (private.is_org_admin(organization_id))
   ```

4. **Public read for reference data**:
   ```sql
   TO authenticated USING (TRUE)
   ```

### Policy Guidelines

- Always scope policies to `TO authenticated` (not public/anon) unless explicitly needed
- Separate SELECT from INSERT/UPDATE/DELETE policies for clarity
- Use `WITH CHECK (...)` for INSERT and UPDATE policies
- Platform admins should bypass org-level checks via `private.is_platform_admin()`
- Combine platform admin fallback with org-level checks using `OR`:
  ```sql
  USING (private.is_platform_admin() OR private.is_org_member(org_id))
  ```

---

## Enums

- Define enums at the top of the migration, before tables
- Use `public` schema: `CREATE TYPE public.enum_name AS ENUM (...)`
- Use lowercase snake_case values
- Include comments for non-obvious states (especially in state machines)

---

## Seed Data

- Use multi-row `INSERT INTO ... VALUES` for reference data
- Seed system roles with `is_system = TRUE` to distinguish from user-created entries
- Use `NULL` for `organization_id` to indicate system-wide (global) roles
- Seed permissions with structured keys using dot/colon notation:
  - Dot notation for UI permissions: `organization.manage`, `billing.manage`
  - Colon notation for API scopes: `api:read`, `qr:write`

---

## Design Patterns

### Event Sourcing / Append-Only Tables

For audit-critical data (notifications, billing events):
- Mark tables as immutable in comments — never UPDATE
- Use separate projection tables for read-optimized views
- Track state transitions via state machine enums

### Transactional Outbox

For async event processing:

```sql
CREATE TABLE public.outbox_events (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    aggregate_type  TEXT NOT NULL,
    aggregate_id    UUID NOT NULL,
    event_type      TEXT NOT NULL,
    payload         JSONB NOT NULL,
    processed_at    TIMESTAMPTZ,
    error           TEXT
);
```

- Use partial index on `created_at WHERE processed_at IS NULL` for polling
- Never delete outbox rows — mark as processed

### Historical Name/Value Tracking

For fields that need audit history (names, avatars, emails):

```sql
CREATE TABLE public.<entity>_names (
    id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    <entity>_id BIGINT NOT NULL REFERENCES public.<entities>(id) ON DELETE CASCADE,
    name        TEXT   NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL
);
CREATE INDEX ON public.<entity>_names(<entity>_id, created_at DESC);
```

- The latest row (by `created_at DESC`) is the current value
- Never update or delete — only append

### Idempotency

For operations that touch money or external systems:

```sql
CREATE TABLE private.idempotency_keys (
    key         TEXT PRIMARY KEY,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    response    JSONB
);
```

---

## Security Checklist

- [ ] RLS enabled on every new table
- [ ] At least one policy defined per table (even if restrictive deny-all)
- [ ] Functions that bypass RLS use `SECURITY DEFINER`
- [ ] All functions set `search_path = public, private`
- [ ] Sensitive data (key hashes, tokens) never returned in SELECT policies to unauthorized users
- [ ] Partial indexes used to exclude soft-deleted/revoked records from lookups
- [ ] `ON DELETE` behavior explicitly defined on all foreign keys
