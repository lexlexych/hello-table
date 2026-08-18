-- Пищевая ценность и порция блюда: данные из карточек меню демо-ресторана.
-- Все колонки nullable: у напитков нет веса, у части позиций в меню нет КБЖУ,
-- и выдумывать эти значения нельзя — гость спрашивает их из-за аллергий и диет.
-- migrate:up
ALTER TABLE menu_items
  ADD COLUMN weight_g  int CHECK (weight_g  > 0),
  ADD COLUMN volume_ml int CHECK (volume_ml > 0),
  ADD COLUMN kcal      int CHECK (kcal      >= 0),
  ADD COLUMN protein_g int CHECK (protein_g >= 0),
  ADD COLUMN fat_g     int CHECK (fat_g     >= 0),
  ADD COLUMN carbs_g   int CHECK (carbs_g   >= 0);
-- migrate:down
ALTER TABLE menu_items
  DROP COLUMN weight_g, DROP COLUMN volume_ml, DROP COLUMN kcal,
  DROP COLUMN protein_g, DROP COLUMN fat_g, DROP COLUMN carbs_g;
