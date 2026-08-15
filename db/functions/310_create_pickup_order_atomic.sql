CREATE OR REPLACE FUNCTION create_pickup_order_atomic(
  p_restaurant  uuid,
  p_items       jsonb,
  p_ready_at    timestamptz,
  p_guest_name  text,
  p_guest_phone text,
  p_language    char(2),
  p_source      text DEFAULT 'phone'
) RETURNS TABLE (pickup_order_id uuid, assigned_order_number text,
                 order_total_cents int, confirmed_ready_at timestamptz)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  r         restaurants%ROWTYPE;
  v_missing int;
  v_bad_qty int;
  v_prep    int;
  v_total   int;
  v_ready   timestamptz;
  v_num     text;
  v_id      uuid;
  v_attempt int := 0;
BEGIN
  -- Сериализация по ресторану: слот самовывоза не имеет собственной строки, которую
  -- можно заблокировать, поэтому очередь выстраивается на строке ресторана.
  -- При ожидаемом объёме (единицы заказов в минуту) конкуренция незаметна.
  SELECT * INTO r FROM restaurants WHERE id = p_restaurant AND is_active FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'restaurant_not_found' USING ERRCODE = '45000'; END IF;

  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'empty_order' USING ERRCODE = '45007';
  END IF;

  -- Validate the JSON shape before casts in pickup_items_expand so callers always
  -- receive a documented application SQLSTATE rather than an internal cast error.
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(p_items) elem
    WHERE jsonb_typeof(elem) <> 'object'
       OR NOT (elem ? 'quantity')
       OR (elem->>'quantity') !~ '^[0-9]+$'
  ) THEN
    RAISE EXCEPTION 'invalid_quantity' USING ERRCODE = '45008';
  END IF;
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(p_items) elem
    WHERE coalesce(elem->>'menu_item_id', '') !~
      '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
  ) THEN
    RAISE EXCEPTION 'item_unavailable' USING ERRCODE = '45003';
  END IF;

  SELECT count(*) FILTER (WHERE i.line_quantity IS NULL
                             OR i.line_quantity < 1 OR i.line_quantity > 50)
    INTO v_bad_qty
  FROM pickup_items_expand(p_items) i;
  IF v_bad_qty > 0 THEN RAISE EXCEPTION 'invalid_quantity' USING ERRCODE = '45008'; END IF;

  -- Позиции обязаны существовать, быть доступными и принадлежать этому ресторану
  SELECT count(*) FILTER (WHERE mi.id IS NULL),
         max(mi.prep_minutes),
         sum(mi.price_cents * i.line_quantity)::int
    INTO v_missing, v_prep, v_total
  FROM pickup_items_expand(p_items) i
  LEFT JOIN menu_items mi
    ON mi.id = i.line_menu_item_id
   AND mi.is_available
   AND mi.category_id IN (SELECT mc.id FROM menu_categories mc WHERE mc.restaurant_id = p_restaurant);
  IF v_missing > 0 THEN RAISE EXCEPTION 'item_unavailable' USING ERRCODE = '45003'; END IF;

  IF p_ready_at IS NULL THEN
    SELECT s.slot_time INTO v_ready
    FROM find_pickup_slots(p_restaurant, NULL, coalesce(v_prep, 0), 1) s;
    IF v_ready IS NULL THEN RAISE EXCEPTION 'no_pickup_slot' USING ERRCODE = '45009'; END IF;
    -- Recheck while the restaurant row remains locked. This protects the automatic
    -- branch from future changes to slot discovery and documents the capacity invariant.
    IF NOT pickup_slot_is_free(p_restaurant, v_ready) THEN
      RAISE EXCEPTION 'slot_full' USING ERRCODE = '45002';
    END IF;
  ELSE
    v_ready := p_ready_at;
    IF v_ready < now() + make_interval(mins => GREATEST(r.pickup_lead_minutes, coalesce(v_prep, 0))) THEN
      RAISE EXCEPTION 'pickup_too_early' USING ERRCODE = '45010';
    END IF;
    IF NOT pickup_slot_is_free(p_restaurant, v_ready) THEN
      RAISE EXCEPTION 'slot_full' USING ERRCODE = '45002';
    END IF;
  END IF;

  -- §6.1: короткий номер, который агент диктует голосом. Уникален среди активных заказов.
  LOOP
    v_attempt := v_attempt + 1;
    IF v_attempt > 50 THEN RAISE EXCEPTION 'order_number_exhausted' USING ERRCODE = '45011'; END IF;
    v_num := lpad((1000 + floor(random() * 9000))::int::text, 4, '0');
    BEGIN
      INSERT INTO pickup_orders (restaurant_id, order_number, guest_name, guest_phone,
                                 ready_at, total_cents, status, source, language)
      VALUES (p_restaurant, v_num, p_guest_name, p_guest_phone,
              v_ready, v_total, 'new', p_source, p_language)
      RETURNING id INTO v_id;
      EXIT;
    EXCEPTION WHEN unique_violation THEN
      NULL;  -- номер занят активным заказом, пробуем следующий
    END;
  END LOOP;

  INSERT INTO pickup_order_items (order_id, menu_item_id, quantity, unit_price_cents, note)
  SELECT v_id, i.line_menu_item_id, i.line_quantity, mi.price_cents, i.line_note
  FROM pickup_items_expand(p_items) i
  JOIN menu_items mi ON mi.id = i.line_menu_item_id;

  pickup_order_id       := v_id;
  assigned_order_number := v_num;
  order_total_cents     := v_total;
  confirmed_ready_at    := v_ready;
  RETURN NEXT;
END $$;
