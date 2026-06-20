CREATE TABLE public.idempotency_keys (
    id              BIGINT      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    uid             UUID        NOT NULL UNIQUE DEFAULT private.gen_uuid_v7(),
    key             TEXT        NOT NULL UNIQUE CHECK (char_length(key) BETWEEN 1 AND 255),
    request_path    TEXT        NOT NULL CHECK (char_length(request_path) BETWEEN 1 AND 1000),
    request_hash    TEXT        NOT NULL,
    response_status INTEGER,
    response_body   JSONB,
    locked_at       TIMESTAMPTZ,
    expires_at      TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '24 hours'),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
CREATE INDEX idx_idempotency_keys_expires ON public.idempotency_keys(expires_at);
ALTER TABLE public.idempotency_keys ENABLE ROW LEVEL SECURITY;
GRANT ALL ON TABLE public.idempotency_keys TO service_role;
