CREATE SCHEMA IF NOT EXISTS private;
-- ── Transactional outbox for async event processing ───────────────────────────

CREATE TABLE private.outbox_events (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    aggregate_type  TEXT NOT NULL,
    aggregate_id    UUID NOT NULL,
    event_type      TEXT NOT NULL,
    payload         JSONB NOT NULL,
    processed_at    TIMESTAMPTZ,
    error           TEXT
);
ALTER TABLE private.outbox_events ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION private.on_insert_outbox_events() RETURNS TRIGGER AS $$ BEGIN NEW.created_at = NOW(); RETURN NEW; END; $$ LANGUAGE plpgsql SET search_path = public, private;
CREATE TRIGGER on_outbox_events_inserted BEFORE INSERT ON private.outbox_events FOR EACH ROW EXECUTE FUNCTION private.on_insert_outbox_events();

CREATE INDEX idx_outbox_unprocessed ON private.outbox_events(created_at) WHERE processed_at IS NULL;