CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE SCHEMA IF NOT EXISTS private;

GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;

-- UUID v7: time-ordered, sortable, suitable as a secondary unique identifier
CREATE OR REPLACE FUNCTION private.gen_uuid_v7()
RETURNS uuid AS $$
DECLARE
    unix_ts_ms bigint;
    uuid_bytes bytea;
BEGIN
    unix_ts_ms := (extract(epoch from clock_timestamp()) * 1000)::bigint;
    uuid_bytes := decode(lpad(to_hex(unix_ts_ms), 12, '0'), 'hex') ||
                  extensions.gen_random_bytes(10);
    uuid_bytes := set_byte(uuid_bytes, 6, (get_byte(uuid_bytes, 6) & 0x0f) | 0x70);
    uuid_bytes := set_byte(uuid_bytes, 8, (get_byte(uuid_bytes, 8) & 0x3f) | 0x80);
    RETURN encode(uuid_bytes, 'hex')::uuid;
END;
$$ LANGUAGE plpgsql VOLATILE SET search_path = '';
