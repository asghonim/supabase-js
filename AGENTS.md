# Agents Instructions

## Database Migration Instructions

- Always prefer `SECURITY INVOKER` unless absolutely necessary
- Each table must have `created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`.
- Always set search_path
- Enable row level security immediately after each table creation
- Use the following naming convention for RLS policies
  - CREATE POLICY "Account owners can view their own accounts”
  - CREATE POLICY "Org members can view api keys”
- Always scope policies to `TO authenticated` (not public/anon) unless explicitly needed
- Define indexes immediately after each table creation. Use `idx_<table>_<column(s)>` format: `idx_api_keys_org`, `idx_org_members_account`
- Index the following
  - Foreign key columns (always)
  - Columns used in RLS policies and permission functions
  - Columns used in WHERE clauses for common queries
  - Composite indexes for (parent_id, created_at DESC) on historical tables
  - Partial indexes for active/unprocessed records: `WHERE revoked_at IS NULL`, `WHERE processed_at IS NULL`
  - GIN indexes with `pg_trgm` for full-text search on text columns
  - Composite indexes for (*, created_at DESC) on event sourced tables to optimize queries for the latest events
- Reference tables using a bigint primary auto increment primary key. Add a unique uuid with default v7 after every bigint primary id.
- Use event sourcing when possible. Tables are read only. To update data, we insert a new row with a newer created_at. For fields that need audit history (names, avatars, emails), create a separate read-only table: account_names, account_avatars, etc. Try to avoid GRANT UPDATE on tables unless absolutely necessary.
- Do not use updated_at columns. Use created_at and insert a new row for updates.
- Never allow users to update or delete records directly. Never GRANT UPDATE or DELETE on tables unless absolutely necessary.
  - When the user must update a record like name or title, create an event sourced table for that record and insert a new row with the updated value. For example, `account_names`, `account_avatars`, `billing_email`, `conversation_titles` or `content_versions`.
  - When the user MUST update a column on the same row, like published_at, and deleted_at, create a function that checks permissions and validates inputs before updating the record. For example, `public.publish_content(content_id, version_id)` and `public.delete_content(content_id)`.
- Always specify `ON DELETE` behavior explicitly. Use `RESTRICT` unless absolutely necessary.
- Use `CHECK` constraints for text length bounds: `CHECK (char_length(name) BETWEEN 1 AND 255)`
- Use `UNIQUE` constraints on natural keys (e.g., slug, email, key_hash)
- Place all internal helper functions (permission checks, triggers, computation) in the `private` schema
- Prefix all table and function references with the schema name, e.g., `public.accounts`, `private.check_org_membership()`
- Always prefer to implement logic in SQL functions and triggers rather than application code to ensure data integrity regardless of how the database is accessed.
- Never include GRANT statements in tables unless absolutely necessary. If you must include GRANT statements, ensure they are scoped to the minimum required permissions and roles.
- GRANT INSERT statements should specify columns explicitly to prevent privilege escalation. Always exclude id, account_id, created_at from insert permissions unless absolutely necessary. For example: `GRANT INSERT (notification_type, channel, is_enabled) ON TABLE public.notification_preferences TO authenticated;`
- Any GRANT INSERT should exclude columns that reference the current `account_id` and use `public.my_account_id()` as default
- Any GRANT INSERT should exclude created_at column and use `DEFAULT now()` as default
- The closing bracket of a table definition should be on its own line, and should be indented same level as columns to allow the statement to collapse nicely in code editors.
- Indexes should be created immediately after the table definition to ensure they are not forgotten.
- Always include `IF NOT EXISTS` in index creation to prevent errors during deployments: `CREATE INDEX IF NOT EXISTS idx_api_keys_org ON public.api_keys (org_id);`
- Indexes should always be one per line
- Example:
```sql
  CREATE TABLE public.api_keys (
  	id bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  	uuid uuid NOT NULL DEFAULT gen_random_uuid(),
  	org_id bigint NOT NULL,
  	name text NOT NULL,
  	key_hash text NOT NULL,
  	revoked_at timestamptz,
  	created_at timestamptz NOT NULL DEFAULT now(),
  	CONSTRAINT fk_api_keys_org FOREIGN KEY (org_id) REFERENCES public.orgs (id) ON DELETE RESTRICT,
  	CONSTRAINT unique_key_hash UNIQUE (key_hash),
  	CONSTRAINT check_name_length CHECK (char_length(name) BETWEEN 1 AND 255)
    );
  CREATE INDEX idx_api_keys_org     ON public.api_keys(org_id);
  CREATE INDEX idx_api_keys_account ON public.api_keys(account_id);
  CREATE INDEX idx_api_keys_hash    ON public.api_keys(key_hash);
  CREATE INDEX idx_api_keys_active  ON public.api_keys(key_hash) WHERE revoked_at IS NULL;
  ALTER TABLE public.api_keys ENABLE ROW LEVEL SECURITY;
  GRANT ALL ON TABLE public.api_keys TO service_role;
  ```
- For tables that will have a large number of rows, consider partitioning by organization or by time (e.g., monthly partitions) to improve query performance and manageability.
- When creating functions, always specify the language (e.g., `LANGUAGE plpgsql`).
- Indent function bodies with tabs so they collapse nicely in code editors. For example:
  ```sql
  CREATE FUNCTION private.check_org_membership() RETURNS boolean AS $$
  	BEGIN
  		RETURN EXISTS (
  			SELECT 1 FROM public.org_members
  			WHERE org_members.account_id = public.my_account_id()
  			AND org_members.org_id = current_setting('app.current_org_id')::bigint
  		);
  	END;
    $$ LANGUAGE plpgsql;
  ``` 
- Explicitly revoke execute permissions for all functions and grant the minimum execute permissions
- Trigger definitions should be placed immediately after the function they reference to ensure they are not forgotten, and they should be a single like statement. For example:
```sql
  CREATE OR REPLACE FUNCTION private.on_account_inserted() RETURNS trigger AS $$
  	BEGIN
  		INSERT INTO public.principals (principal_type, account_id, name)
  		VALUES ('user', NEW.id, NEW.name);
  		RETURN NEW;
  	END;
    $$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, private;
  CREATE OR REPLACE TRIGGER on_account_inserted AFTER INSERT ON public.accounts FOR EACH ROW EXECUTE FUNCTION private.on_account_inserted();
```
- Always indent seeding statements with tabs so they collapse nicely in code editors. For example:
```sql
  INSERT INTO public.organization_role_permissions (organization_role_id, permission_id)
    SELECT r.id, p.id
    FROM public.organization_roles r
    JOIN public.permissions p ON p.key IN (
        'content.view', 'content.create', 'content.edit', 'media.upload'
    )
    WHERE r.key = 'member' AND r.organization_id IS NULL;
```

## Testing Instructions
- In negative security tests, wrapping assertions in an if (!error) block is an anti-pattern. If the deletion is correctly blocked and returns an error, the if block is skipped, and the test passes without executing any assertions. This can lead to false positives where the test passes even if the underlying behavior is incorrect or if an unrelated error occurs. Instead, explicitly assert that an error is returned (expect(error).not.toBeNull()).
- When testing for insertions, test can produce false positives because it doesn’t read back the specific row it just attempted to insert. Prefer selecting the inserted row and asserting its properties to ensure the insertion was successful and the data is correct. For example, after inserting a new user, select that user by their unique identifier and assert that their properties match the expected values. You can then use that uuid of the inserted record to query for it using other supabase clients.
- When asserting for errors, always assert the error message to ensure that the correct error is being thrown. This helps to avoid false positives where a different error might be thrown, leading to incorrect test results. For example, if you expect a "permission denied" error, assert that the error message contains "permission denied" to confirm that the correct error is being returned.