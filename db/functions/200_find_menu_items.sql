CREATE OR REPLACE FUNCTION find_menu_items(
  p_restaurant        uuid,
  p_query             text    DEFAULT NULL,
  p_lang              char(2) DEFAULT 'de',
  p_vegan_only        bool    DEFAULT false,
  p_vegetarian_only   bool    DEFAULT false,
  p_exclude_allergens text[]  DEFAULT NULL,
  p_limit             int     DEFAULT 10
) RETURNS TABLE (item_id uuid, item_name text, item_description text, item_price_cents int,
                 item_allergens text[], item_is_vegetarian bool, item_is_vegan bool,
                 item_prep_minutes int, category_name text, match_score real)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_q text := app_normalize_text(nullif(btrim(coalesce(p_query, '')), ''));
BEGIN
  RETURN QUERY
  SELECT mi.id,
         CASE p_lang WHEN 'ru' THEN mi.name_ru WHEN 'en' THEN mi.name_en ELSE mi.name_de END,
         CASE p_lang WHEN 'ru' THEN mi.description_ru WHEN 'en' THEN mi.description_en
                     ELSE mi.description_de END,
         mi.price_cents, mi.allergens, mi.is_vegetarian, mi.is_vegan, mi.prep_minutes,
         CASE p_lang WHEN 'ru' THEN mc.name_ru WHEN 'en' THEN mc.name_en ELSE mc.name_de END,
         coalesce(m.score, 1.0::real)
  FROM menu_items mi
  JOIN menu_categories mc ON mc.id = mi.category_id
  LEFT JOIN LATERAL (
    -- лучшее совпадение среди трёх названий и всех алиасов:
    -- подстрока даёт 1.0, иначе триграммная близость
    SELECT max(GREATEST(
             CASE WHEN app_normalize_text(cand) LIKE '%' || v_q || '%' THEN 1.0 ELSE 0.0 END,
             similarity(app_normalize_text(cand), v_q)))::real AS score
    FROM unnest(ARRAY[mi.name_de, mi.name_ru, mi.name_en] || mi.aliases) AS cand
  ) m ON v_q IS NOT NULL
  WHERE mc.restaurant_id = p_restaurant
    AND mi.is_available                                    -- §13: агент не выдумывает блюда
    AND (NOT p_vegan_only      OR mi.is_vegan)
    AND (NOT p_vegetarian_only OR mi.is_vegetarian)
    AND (p_exclude_allergens IS NULL OR NOT (mi.allergens && p_exclude_allergens))
    AND (v_q IS NULL OR m.score >= 0.3)
  ORDER BY coalesce(m.score, 0) DESC, mc.sort_order,
           CASE p_lang WHEN 'ru' THEN mi.name_ru WHEN 'en' THEN mi.name_en ELSE mi.name_de END
  LIMIT greatest(coalesce(p_limit, 10), 1);
END $$;
