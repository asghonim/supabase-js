-- ================================================================
-- QUEUE COUNTERS
--
-- Replace MAX(position)+1 with an atomic counter table to avoid
-- race conditions and eliminate the need for row-level locks on
-- service_queue_items during push operations.
-- ================================================================

-- Counter table: one row per queue, tracks the next position to allocate.
CREATE TABLE public.service_queue_counters (
    queue_id    BIGINT PRIMARY KEY
        REFERENCES public.service_queues(id)
        ON DELETE CASCADE,
    next_position BIGINT NOT NULL DEFAULT 1
);

ALTER TABLE public.service_queue_counters ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Org members can view queue counters"
    ON public.service_queue_counters FOR SELECT TO authenticated
    USING (EXISTS (
        SELECT 1 FROM public.service_queues sq
        WHERE sq.id = queue_id AND private.is_org_member(sq.org_id)
    ));

-- Auto-create a counter row when a new queue is created.
CREATE OR REPLACE FUNCTION private.on_insert_service_queue_counter()
RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO public.service_queue_counters (queue_id) VALUES (NEW.id);
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public, private;

CREATE TRIGGER on_service_queue_created_counter
    AFTER INSERT ON public.service_queues
    FOR EACH ROW
    EXECUTE FUNCTION private.on_insert_service_queue_counter();

-- Backfill counters for any existing queues.
INSERT INTO public.service_queue_counters (queue_id, next_position)
SELECT sq.id, COALESCE(MAX(sqi.position), 0) + 1
  FROM public.service_queues sq
  LEFT JOIN public.service_queue_items sqi ON sqi.queue_id = sq.id
 GROUP BY sq.id
ON CONFLICT (queue_id) DO NOTHING;

-- Atomic sequence allocator: increments counter and returns the current value.
CREATE OR REPLACE FUNCTION public.allocate_queue_position(
    p_queue_id BIGINT
)
RETURNS BIGINT
LANGUAGE plpgsql
SET search_path = public, private
AS $$
DECLARE
    v_position BIGINT;
BEGIN
    UPDATE public.service_queue_counters
       SET next_position = next_position + 1
     WHERE queue_id = p_queue_id
    RETURNING next_position - 1
    INTO v_position;

    IF v_position IS NULL THEN
        RAISE EXCEPTION 'queue counter not found for queue_id %', p_queue_id;
    END IF;

    RETURN v_position;
END;
$$;

-- Replace service_queue_push to use the new atomic allocator.
CREATE OR REPLACE FUNCTION public.service_queue_push(
    p_queue_id BIGINT,
    p_payload  JSONB DEFAULT '{}'
)
RETURNS public.service_queue_items AS $$
DECLARE
    v_org_id        BIGINT;
    v_next_position BIGINT;
    v_item          public.service_queue_items;
BEGIN
    -- Authorize: caller must be a member of the queue's organization
    SELECT org_id INTO v_org_id FROM public.service_queues WHERE id = p_queue_id;
    IF v_org_id IS NULL OR NOT private.is_org_member(v_org_id) THEN
        RAISE EXCEPTION 'unauthorized';
    END IF;

    -- Atomically allocate the next position (no table scan, no row locks on items)
    v_next_position := public.allocate_queue_position(p_queue_id);

    INSERT INTO public.service_queue_items (queue_id, position, payload)
    VALUES (p_queue_id, v_next_position, p_payload)
    RETURNING * INTO v_item;

    RETURN v_item;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, private;
