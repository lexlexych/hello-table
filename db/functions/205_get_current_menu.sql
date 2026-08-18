-- Полный актуальный каталог для голосового инструмента search_menu.
--
-- Функция намеренно возвращает все доступные позиции, а не принимает строку поиска:
-- модель получает один согласованный срез меню и сама отвечает на вопрос гостя о
-- категории, составе, аллергенах, цене или диетических свойствах. Внутренние
-- aliases и prep_minutes не выдаются: они нужны только будущему приёму самовывоза.
CREATE OR REPLACE FUNCTION get_current_menu(
  p_restaurant uuid,
  p_lang       char(2)
) RETURNS TABLE (
  category_id          uuid,
  category_name        text,
  category_sort_order  int,
  item_id              uuid,
  item_name            text,
  item_description     text,
  item_price_cents     int,
  item_allergens       text[],
  item_is_vegetarian   bool,
  item_is_vegan        bool,
  item_weight_g        int,
  item_volume_ml       int,
  item_kcal            int,
  item_protein_g       int,
  item_fat_g           int,
  item_carbs_g         int
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  r restaurants%ROWTYPE;
BEGIN
  SELECT * INTO r FROM restaurants WHERE id = p_restaurant AND is_active;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'restaurant_not_found' USING ERRCODE = '45000';
  END IF;

  RETURN QUERY
  SELECT mc.id,
         CASE p_lang WHEN 'ru' THEN mc.name_ru WHEN 'en' THEN mc.name_en ELSE mc.name_de END,
         mc.sort_order,
         mi.id,
         CASE p_lang WHEN 'ru' THEN mi.name_ru WHEN 'en' THEN mi.name_en ELSE mi.name_de END,
         CASE p_lang WHEN 'ru' THEN mi.description_ru WHEN 'en' THEN mi.description_en
                     ELSE mi.description_de END,
         mi.price_cents,
         mi.allergens,
         mi.is_vegetarian,
         mi.is_vegan,
         mi.weight_g,
         mi.volume_ml,
         mi.kcal,
         mi.protein_g,
         mi.fat_g,
         mi.carbs_g
  FROM menu_categories mc
  JOIN menu_items mi ON mi.category_id = mc.id
  WHERE mc.restaurant_id = p_restaurant
    AND mi.is_available
  ORDER BY mc.sort_order,
           CASE p_lang WHEN 'ru' THEN mc.name_ru WHEN 'en' THEN mc.name_en ELSE mc.name_de END,
           CASE p_lang WHEN 'ru' THEN mi.name_ru WHEN 'en' THEN mi.name_en ELSE mi.name_de END;
END $$;
