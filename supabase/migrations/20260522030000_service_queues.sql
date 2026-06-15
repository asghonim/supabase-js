-- ================================================================
-- SERVICE QUEUES
--
-- Multi-tenant FIFO queue system. Organizations own queues.
-- Developers can create queues, push items, pop from the front,
-- and remove items from the middle.
--
-- Core design principles:
--   * Each queue belongs to an organization (multi-tenant).
--   * Items are ordered by position (monotonically increasing per queue).
--   * Push appends to the end; pop removes from the front (FIFO).
--   * RLS restricts access to members of the owning organization.
-- ================================================================

CREATE TABLE public.service_queues (
    id              BIGINT       GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    org_id          BIGINT       NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    name            TEXT         NOT NULL CHECK (char_length(name) BETWEEN 1 AND 255),
    metadata        JSONB        NOT NULL DEFAULT '{}',
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    UNIQUE (org_id, name)
);

CREATE INDEX idx_service_queues_org ON public.service_queues(org_id);

ALTER TABLE public.service_queues ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION private.on_insert_service_queues() RETURNS TRIGGER AS $$ BEGIN NEW.created_at = NOW(); NEW.updated_at = NOW(); RETURN NEW; END; $$ LANGUAGE plpgsql SET search_path = public, private;
CREATE TRIGGER on_service_queues_inserted BEFORE INSERT ON public.service_queues FOR EACH ROW EXECUTE FUNCTION private.on_insert_service_queues();

CREATE OR REPLACE FUNCTION private.on_update_service_queues() RETURNS TRIGGER AS $$ BEGIN NEW.updated_at = NOW(); RETURN NEW; END; $$ LANGUAGE plpgsql SET search_path = public, private;
CREATE TRIGGER on_update_service_queues BEFORE UPDATE ON public.service_queues FOR EACH ROW EXECUTE FUNCTION private.on_update_service_queues();

CREATE POLICY "Org members can view service queues"
    ON public.service_queues FOR SELECT TO authenticated
    USING (private.is_org_member(org_id));

CREATE POLICY "Org members can create service queues"
    ON public.service_queues FOR INSERT TO authenticated
    WITH CHECK (private.is_org_member(org_id));

CREATE POLICY "Org members can update service queues"
    ON public.service_queues FOR UPDATE TO authenticated
    USING (private.is_org_member(org_id));

CREATE POLICY "Org members can delete service queues"
    ON public.service_queues FOR DELETE TO authenticated
    USING (private.is_org_member(org_id));

-- ================================================================
-- QUEUE ITEMS
-- ================================================================

CREATE TABLE public.service_queue_items (
    id              BIGINT       GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    queue_id        BIGINT       NOT NULL REFERENCES public.service_queues(id) ON DELETE CASCADE,
    position        BIGINT       NOT NULL,
    payload         JSONB        NOT NULL DEFAULT '{}',
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    UNIQUE (queue_id, position)
);

CREATE INDEX idx_service_queue_items_queue ON public.service_queue_items(queue_id);
CREATE INDEX idx_service_queue_items_fifo  ON public.service_queue_items(queue_id, position ASC);

ALTER TABLE public.service_queue_items ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION private.on_insert_service_queue_items() RETURNS TRIGGER AS $$ BEGIN NEW.created_at = NOW(); RETURN NEW; END; $$ LANGUAGE plpgsql SET search_path = public, private;
CREATE TRIGGER on_service_queue_items_inserted BEFORE INSERT ON public.service_queue_items FOR EACH ROW EXECUTE FUNCTION private.on_insert_service_queue_items();

CREATE POLICY "Org members can view queue items"
    ON public.service_queue_items FOR SELECT TO authenticated
    USING (EXISTS (
        SELECT 1 FROM public.service_queues sq
        WHERE sq.id = queue_id AND private.is_org_member(sq.org_id)
    ));

CREATE POLICY "Org members can insert queue items"
    ON public.service_queue_items FOR INSERT TO authenticated
    WITH CHECK (EXISTS (
        SELECT 1 FROM public.service_queues sq
        WHERE sq.id = queue_id AND private.is_org_member(sq.org_id)
    ));

CREATE POLICY "Org members can delete queue items"
    ON public.service_queue_items FOR DELETE TO authenticated
    USING (EXISTS (
        SELECT 1 FROM public.service_queues sq
        WHERE sq.id = queue_id AND private.is_org_member(sq.org_id)
    ));

-- ================================================================
-- HELPER FUNCTIONS
-- ================================================================

-- Push: append an item to the end of a queue (FIFO enqueue).
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

    -- Lock the queue's items to prevent concurrent position collisions
    PERFORM 1 FROM public.service_queue_items WHERE queue_id = p_queue_id FOR UPDATE;

    SELECT COALESCE(MAX(position), 0) + 1
      INTO v_next_position
      FROM public.service_queue_items
     WHERE queue_id = p_queue_id;

    INSERT INTO public.service_queue_items (queue_id, position, payload)
    VALUES (p_queue_id, v_next_position, p_payload)
    RETURNING * INTO v_item;

    RETURN v_item;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, private;

-- Pop: remove and return the item at the front of the queue (FIFO dequeue).
CREATE OR REPLACE FUNCTION public.service_queue_pop(
    p_queue_id BIGINT
)
RETURNS public.service_queue_items AS $$
DECLARE
    v_org_id BIGINT;
    v_item   public.service_queue_items;
BEGIN
    -- Authorize: caller must be a member of the queue's organization
    SELECT org_id INTO v_org_id FROM public.service_queues WHERE id = p_queue_id;
    IF v_org_id IS NULL OR NOT private.is_org_member(v_org_id) THEN
        RAISE EXCEPTION 'unauthorized';
    END IF;

    DELETE FROM public.service_queue_items
     WHERE id = (
         SELECT id FROM public.service_queue_items
          WHERE queue_id = p_queue_id
          ORDER BY position ASC
          LIMIT 1
          FOR UPDATE SKIP LOCKED
     )
    RETURNING * INTO v_item;

    RETURN v_item;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, private;

-- Remove: remove a specific item from anywhere in the queue by its id.
CREATE OR REPLACE FUNCTION public.service_queue_remove(
    p_item_id BIGINT
)
RETURNS public.service_queue_items AS $$
DECLARE
    v_org_id BIGINT;
    v_item   public.service_queue_items;
BEGIN
    -- Authorize: caller must be a member of the queue's organization
    SELECT sq.org_id INTO v_org_id
      FROM public.service_queue_items sqi
      JOIN public.service_queues sq ON sq.id = sqi.queue_id
     WHERE sqi.id = p_item_id;
    IF v_org_id IS NULL OR NOT private.is_org_member(v_org_id) THEN
        RAISE EXCEPTION 'unauthorized';
    END IF;

    DELETE FROM public.service_queue_items
     WHERE id = p_item_id
    RETURNING * INTO v_item;

    RETURN v_item;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, private;

-- Peek: view the item at the front of the queue without removing it.
CREATE OR REPLACE FUNCTION public.service_queue_peek(
    p_queue_id BIGINT
)
RETURNS public.service_queue_items AS $$
DECLARE
    v_org_id BIGINT;
    v_item   public.service_queue_items;
BEGIN
    -- Authorize: caller must be a member of the queue's organization
    SELECT org_id INTO v_org_id FROM public.service_queues WHERE id = p_queue_id;
    IF v_org_id IS NULL OR NOT private.is_org_member(v_org_id) THEN
        RAISE EXCEPTION 'unauthorized';
    END IF;

    SELECT * INTO v_item
      FROM public.service_queue_items
     WHERE queue_id = p_queue_id
     ORDER BY position ASC
     LIMIT 1;

    RETURN v_item;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path = public, private;
