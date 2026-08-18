-- Демо-ресторан «Ristorante Basilik»: данные из demo/Basilik_Menu.pdf и demo/Basilik_Policy.pdf.
--
-- Идемпотентность — фиксированные UUID + ON CONFLICT (id) DO UPDATE. Идентификаторы и slug
-- сохранены от прежнего демо-ресторана: на них завязаны портал и ручные проверки.
-- Правила ресторана (отмена, банкеты, оплата) лежат не здесь, а в agent/src/prompts/basilik.*.md —
-- это контекст для разговора, а не данные, по которым считается бронь.

INSERT INTO restaurants(id,name,slug,timezone,phone_e164,address,
  ai_disclosure_de,ai_disclosure_ru,ai_disclosure_en,greeting_de,greeting_ru,greeting_en)
VALUES('10000000-0000-0000-0000-000000000001','Ristorante Basilik','demo','Europe/Berlin',
  '+49304421788','Berlin',
  'Hinweis: Sie sprechen mit einem KI-gestützten Sprachassistenten.',
  'Обратите внимание: вы говорите с голосовым ИИ-ассистентом.',
  'Please note: you are speaking with an AI voice assistant.',
  'Guten Tag, hier ist das Ristorante Basilik. Wie kann ich Ihnen helfen?',
  'Здравствуйте, это ресторан «Базилик». Чем могу помочь?',
  'Hello, this is Ristorante Basilik. How can I help you?')
ON CONFLICT(id) DO UPDATE SET name=excluded.name,phone_e164=excluded.phone_e164,
  address=excluded.address,greeting_de=excluded.greeting_de,greeting_ru=excluded.greeting_ru,
  greeting_en=excluded.greeting_en;

-- Две зоны с запасом свободных столиков в каждой: без этого не проверить сценарий,
-- ради которого зона вообще попала в ответ инструмента — «зал или терраса».
INSERT INTO restaurant_tables(id,restaurant_id,label,seats,zone) VALUES
('11000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','T1',2,'Hauptraum'),
('11000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000001','T2',2,'Hauptraum'),
('11000000-0000-0000-0000-000000000003','10000000-0000-0000-0000-000000000001','T3',4,'Hauptraum'),
('11000000-0000-0000-0000-000000000004','10000000-0000-0000-0000-000000000001','T4',4,'Hauptraum'),
('11000000-0000-0000-0000-000000000005','10000000-0000-0000-0000-000000000001','T5',4,'Hauptraum'),
('11000000-0000-0000-0000-000000000006','10000000-0000-0000-0000-000000000001','T6',6,'Hauptraum'),
('11000000-0000-0000-0000-000000000007','10000000-0000-0000-0000-000000000001','T7',2,'Terrasse'),
('11000000-0000-0000-0000-000000000008','10000000-0000-0000-0000-000000000001','T8',4,'Terrasse'),
('11000000-0000-0000-0000-000000000009','10000000-0000-0000-0000-000000000001','T9',4,'Terrasse'),
('11000000-0000-0000-0000-000000000010','10000000-0000-0000-0000-000000000001','T10',6,'Terrasse')
-- Конфликт разрешается по метке, а не по id: столик мог быть заведён руками из портала
-- и получить случайный UUID. Тогда обновляется существующая строка, а не создаётся вторая
-- с той же меткой — уникальность (restaurant_id, label) этого всё равно не позволила бы.
ON CONFLICT(restaurant_id,label) DO UPDATE SET seats=excluded.seats,zone=excluded.zone,
  is_active=true;

-- Прежний график (обед + ужин, понедельник закрыт) заменён на «ежедневно 12:00–23:00».
-- Лишние строки удаляются: ON CONFLICT их не убрал бы, и в базе остались бы окна,
-- которых у ресторана больше нет — агент выдавал бы слоты на 11:30.
DELETE FROM opening_hours WHERE restaurant_id='10000000-0000-0000-0000-000000000001';
INSERT INTO opening_hours(id,restaurant_id,weekday,opens,closes,is_closed) VALUES
('12000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001',0,'12:00','23:00',false),
('12000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000001',1,'12:00','23:00',false),
('12000000-0000-0000-0000-000000000003','10000000-0000-0000-0000-000000000001',2,'12:00','23:00',false),
('12000000-0000-0000-0000-000000000004','10000000-0000-0000-0000-000000000001',3,'12:00','23:00',false),
('12000000-0000-0000-0000-000000000005','10000000-0000-0000-0000-000000000001',4,'12:00','23:00',false),
('12000000-0000-0000-0000-000000000006','10000000-0000-0000-0000-000000000001',5,'12:00','23:00',false),
('12000000-0000-0000-0000-000000000007','10000000-0000-0000-0000-000000000001',6,'12:00','23:00',false)
ON CONFLICT(id) DO UPDATE SET opens=excluded.opens,closes=excluded.closes,
  is_closed=excluded.is_closed;

INSERT INTO special_closures(id,restaurant_id,date,reason)
VALUES('13000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','2026-12-24','Heiligabend')
ON CONFLICT(id) DO UPDATE SET reason=excluded.reason;

INSERT INTO menu_categories(id,restaurant_id,name_de,name_ru,name_en,sort_order) VALUES
('20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','Vorspeisen','Закуски','Starters',1),
('20000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000001','Suppen','Супы','Soups',2),
('20000000-0000-0000-0000-000000000003','10000000-0000-0000-0000-000000000001','Pasta und Risotto','Паста и ризотто','Pasta and Risotto',3),
('20000000-0000-0000-0000-000000000004','10000000-0000-0000-0000-000000000001','Hauptgerichte','Горячее','Main Courses',4),
('20000000-0000-0000-0000-000000000005','10000000-0000-0000-0000-000000000001','Pizza','Пицца','Pizza',5),
('20000000-0000-0000-0000-000000000006','10000000-0000-0000-0000-000000000001','Desserts','Десерты','Desserts',6),
('20000000-0000-0000-0000-000000000007','10000000-0000-0000-0000-000000000001','Getränke','Напитки','Drinks',7),
('20000000-0000-0000-0000-000000000008','10000000-0000-0000-0000-000000000001','Kindermenü','Детское меню','Kids Menu',8)
ON CONFLICT(id) DO UPDATE SET name_de=excluded.name_de,name_ru=excluded.name_ru,
  name_en=excluded.name_en,sort_order=excluded.sort_order;

-- 30 позиций из demo/Basilik_Menu.pdf. Состав блюда идёт в description_*, порция и КБЖУ —
-- в отдельные колонки (миграция 005). Где в карточке PDF нет КБЖУ, поля остаются пустыми:
-- гость спрашивает эти цифры из-за аллергий и диет, выдумывать их нельзя.
-- prep_minutes в меню нет — проставлено по типу блюда, это оценка для расчёта самовывоза.
INSERT INTO menu_items(id,category_id,name_de,name_ru,name_en,
  description_de,description_ru,description_en,price_cents,allergens,
  is_vegetarian,is_vegan,is_available,aliases,prep_minutes,
  weight_g,volume_ml,kcal,protein_g,fat_g,carbs_g) VALUES

-- Закуски
('21000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001',
 'Bruschetta mit Tomaten und Basilikum','Брускетта с томатами и базиликом','Bruschetta with tomato and basil',
 'Ciabatta, Kirschtomaten, Basilikum, Knoblauch, Olivenöl. Vegane Variante ohne Käse.',
 'Чиабатта, томаты черри, базилик, чеснок, оливковое масло. Веганская подача — без сыра.',
 'Ciabatta, cherry tomatoes, basil, garlic, olive oil. Vegan option served without cheese.',
 900,'{gluten}',true,true,true,'{брускетта,bruschetta,брускета}',10,150,NULL,220,5,9,30),
('21000000-0000-0000-0000-000000000002','20000000-0000-0000-0000-000000000001',
 'Rinder-Carpaccio','Карпаччо из говядины','Beef carpaccio',
 'Dünn geschnittenes Rindfleisch, Rucola, Parmesan, Zitrone, Olivenöl.',
 'Тонко нарезанная говядина, руккола, пармезан, лимон, оливковое масло.',
 'Thinly sliced beef, rocket, parmesan, lemon, olive oil.',
 1600,'{milk}',false,false,true,'{карпаччо,carpaccio,карпачо}',10,120,NULL,240,21,16,2),
('21000000-0000-0000-0000-000000000003','20000000-0000-0000-0000-000000000001',
 'Käse- und Aufschnittplatte','Ассорти сыров и вяленого мяса','Cheese and cured meat platter',
 'Drei Käsesorten, Prosciutto, Salami, Nüsse, Honig, Cracker.',
 'Три вида сыра, прошутто, салями, орехи, мёд, крекеры.',
 'Three kinds of cheese, prosciutto, salami, nuts, honey, crackers.',
 2200,'{milk,gluten,nuts}',false,false,true,'{ассорти,сырная тарелка,antipasti,käseplatte}',10,250,NULL,620,NULL,NULL,NULL),
('21000000-0000-0000-0000-000000000004','20000000-0000-0000-0000-000000000001',
 'Caprese','Капрезе','Caprese',
 'Büffelmozzarella, Tomaten, Basilikum, Olivenöl.',
 'Моцарелла буффало, томаты, базилик, оливковое масло.',
 'Buffalo mozzarella, tomatoes, basil, olive oil.',
 1200,'{milk}',true,false,true,'{капрезе,caprese}',10,200,NULL,280,15,22,6),

-- Супы
('21000000-0000-0000-0000-000000000005','20000000-0000-0000-0000-000000000002',
 'Kürbiscremesuppe','Крем-суп из тыквы','Pumpkin cream soup',
 'Kürbis, Kokoscreme, Ingwer, Zwiebeln, Knoblauch, Gewürze, Kürbiskerne. Kann Spuren von Nüssen enthalten.',
 'Тыква, кокосовые сливки, имбирь, лук, чеснок, специи, тыквенные семечки. Возможны следы орехов.',
 'Pumpkin, coconut cream, ginger, onion, garlic, spices, pumpkin seeds. May contain traces of nuts.',
 2500,'{nuts}',true,true,true,'{тыквенный суп,крем-суп,kürbissuppe,pumpkin soup}',15,300,NULL,210,NULL,NULL,NULL),
('21000000-0000-0000-0000-000000000006','20000000-0000-0000-0000-000000000002',
 'Minestrone','Минестроне','Minestrone',
 'Gemüsesuppe mit Nudeln, Bohnen, Tomaten und Sellerie.',
 'Овощной суп с пастой, фасолью, томатами, сельдереем.',
 'Vegetable soup with pasta, beans, tomatoes and celery.',
 1400,'{gluten,celery}',true,true,true,'{минестроне,minestrone,овощной суп}',15,320,NULL,180,NULL,NULL,NULL),
('21000000-0000-0000-0000-000000000007','20000000-0000-0000-0000-000000000002',
 'Bouillabaisse','Буйабес','Bouillabaisse',
 'Meeresfrüchte, Tomaten, Safran, Weißwein, Knoblauch.',
 'Морепродукты, томаты, шафран, белое вино, чеснок.',
 'Seafood, tomatoes, saffron, white wine, garlic.',
 1900,'{fish,molluscs,crustaceans,sulphites}',false,false,true,'{буйабес,bouillabaisse,рыбный суп}',20,350,NULL,290,NULL,NULL,NULL),

-- Паста и ризотто
('21000000-0000-0000-0000-000000000008','20000000-0000-0000-0000-000000000003',
 'Pasta Carbonara','Паста Карбонара','Pasta carbonara',
 'Spaghetti, Guanciale (Schweinebacke), Eigelb, Pecorino Romano, schwarzer Pfeffer.',
 'Паста спагетти, гуанчале (свиная щековина), яичный желток, сыр Пекорино Романо, чёрный перец.',
 'Spaghetti, guanciale (pork cheek), egg yolk, Pecorino Romano, black pepper.',
 3000,'{gluten,eggs,milk}',false,false,true,'{карбонара,carbonara,паста карбонара}',20,280,NULL,520,22,24,55),
('21000000-0000-0000-0000-000000000009','20000000-0000-0000-0000-000000000003',
 'Pilzrisotto','Ризотто с грибами','Mushroom risotto',
 'Arborio-Reis, Steinpilze, Parmesan, Weißwein, Butter, Zwiebeln, Knoblauch, Trüffelöl.',
 'Рис Арборио, белые грибы, пармезан, белое вино, масло, лук, чеснок, трюфельное масло.',
 'Arborio rice, porcini, parmesan, white wine, butter, onion, garlic, truffle oil.',
 3200,'{milk}',true,false,true,'{ризотто с грибами,грибное ризотто,risotto funghi,pilzrisotto}',25,320,NULL,480,14,18,62),
('21000000-0000-0000-0000-000000000010','20000000-0000-0000-0000-000000000003',
 'Pasta Bolognese','Паста Болоньезе','Pasta bolognese',
 'Tagliatelle, Rinderragout, Tomaten, Parmesan.',
 'Тальятелле, говяжий рагу, томаты, пармезан.',
 'Tagliatelle, beef ragout, tomatoes, parmesan.',
 2600,'{gluten,milk,celery}',false,false,true,'{болоньезе,bolognese,паста болоньезе}',20,300,NULL,560,NULL,NULL,NULL),
('21000000-0000-0000-0000-000000000011','20000000-0000-0000-0000-000000000003',
 'Gnocchi mit Gorgonzola','Ньокки с горгонзолой','Gnocchi with gorgonzola',
 'Kartoffelgnocchi, Gorgonzolasauce, Walnuss.',
 'Картофельные ньокки, соус горгонзола, грецкий орех.',
 'Potato gnocchi, gorgonzola sauce, walnut.',
 2400,'{gluten,milk,nuts}',true,false,true,'{ньокки,gnocchi,горгонзола}',20,280,NULL,510,NULL,NULL,NULL),
('21000000-0000-0000-0000-000000000012','20000000-0000-0000-0000-000000000003',
 'Meeresfrüchte-Risotto','Ризотто с морепродуктами','Seafood risotto',
 'Carnaroli-Reis, Garnelen, Miesmuscheln, Tintenfisch, Weißwein, Petersilie.',
 'Рис Карнароли, креветки, мидии, кальмары, белое вино, петрушка.',
 'Carnaroli rice, prawns, mussels, squid, white wine, parsley.',
 3400,'{molluscs,crustaceans,sulphites}',false,false,true,'{ризотто с морепродуктами,risotto frutti di mare,морепродукты}',25,320,NULL,470,NULL,NULL,NULL),

-- Горячее
('21000000-0000-0000-0000-000000000013','20000000-0000-0000-0000-000000000004',
 'Ribeye-Steak (200 g)','Стейк Рибай (200 г)','Ribeye steak (200 g)',
 'Rindersteak, Kartoffelgratin, Saisongemüse. Garstufen: rare, medium rare, medium, well done. Die Sauce wird separat gewählt: Zutaten und Allergene hängen von der Sauce ab, eine einheitliche Liste gibt es nicht. Sauce 50 g.',
 'Говяжий стейк, картофель гратен, сезонные овощи. Степени прожарки: rare, medium rare, medium, well done. Соус выбирается отдельно: состав и аллергены зависят от выбранного соуса, единого списка нет. Соус 50 г.',
 'Beef steak, potato gratin, seasonal vegetables. Doneness: rare, medium rare, medium, well done. The sauce is chosen separately: ingredients and allergens depend on the sauce, there is no single list. Sauce 50 g.',
 6500,'{}',false,false,true,'{рибай,стейк,ribeye,steak}',30,200,NULL,NULL,NULL,NULL,NULL),
('21000000-0000-0000-0000-000000000014','20000000-0000-0000-0000-000000000004',
 'Ossobuco','Оссобуко','Ossobuco',
 'Geschmorte Kalbshaxe, Gremolata, Risotto milanese.',
 'Тушёная телячья голень, гремолата, ризотто миланезе.',
 'Braised veal shank, gremolata, risotto milanese.',
 3600,'{celery}',false,false,true,'{оссобуко,ossobuco,телятина}',30,400,NULL,540,NULL,NULL,NULL),
('21000000-0000-0000-0000-000000000015','20000000-0000-0000-0000-000000000004',
 'Wolfsbarschfilet','Филе сибаса','Sea bass fillet',
 'Mittelmeerfisch, Kirschtomaten, Oliven, Kapern, Weißwein.',
 'Средиземноморская рыба, томаты черри, оливки, каперсы, белое вино.',
 'Mediterranean fish, cherry tomatoes, olives, capers, white wine.',
 2900,'{fish}',false,false,true,'{сибас,рыба,sea bass,wolfsbarsch}',25,220,NULL,310,NULL,NULL,NULL),
('21000000-0000-0000-0000-000000000016','20000000-0000-0000-0000-000000000004',
 'Mailänder Kalbsschnitzel','Котлета из телятины по-милански','Milanese veal cutlet',
 'Paniertes Kalbskotelett, Rucola, Parmesan, Kirschtomaten.',
 'Панированная телячья котлета, руккола, пармезан, томаты черри.',
 'Breaded veal cutlet, rocket, parmesan, cherry tomatoes.',
 2700,'{gluten,milk,eggs}',false,false,true,'{котлета по-милански,шницель,cotoletta,schnitzel}',25,250,NULL,480,NULL,NULL,NULL),

-- Пицца
('21000000-0000-0000-0000-000000000017','20000000-0000-0000-0000-000000000005',
 'Pizza Margherita','Пицца Маргарита','Pizza margherita',
 'Tomatensauce, Mozzarella, Basilikum.',
 'Томатный соус, моцарелла, базилик.',
 'Tomato sauce, mozzarella, basil.',
 1400,'{gluten,milk}',true,false,true,'{маргарита,margarita,margherita,пицца маргарита}',20,300,NULL,NULL,NULL,NULL,NULL),
('21000000-0000-0000-0000-000000000018','20000000-0000-0000-0000-000000000005',
 'Pizza Diavolo','Пицца Дьяволо','Pizza diavolo',
 'Scharfe Salami, Chili, Mozzarella, Tomatensauce.',
 'Острая салями, чили, моцарелла, томатный соус.',
 'Spicy salami, chilli, mozzarella, tomato sauce.',
 1700,'{gluten,milk}',false,false,true,'{дьяволо,diavolo,острая пицца}',20,320,NULL,NULL,NULL,NULL,NULL),
('21000000-0000-0000-0000-000000000019','20000000-0000-0000-0000-000000000005',
 'Pizza Quattro Formaggi','Пицца Кватро Формаджи','Pizza quattro formaggi',
 'Mozzarella, Gorgonzola, Parmesan, Caciotta.',
 'Моцарелла, горгонзола, пармезан, качотта.',
 'Mozzarella, gorgonzola, parmesan, caciotta.',
 1800,'{gluten,milk}',true,false,true,'{кватро формаджи,quattro formaggi,четыре сыра,vier käse}',20,300,NULL,NULL,NULL,NULL,NULL),
('21000000-0000-0000-0000-000000000020','20000000-0000-0000-0000-000000000005',
 'Pizza Prosciutto e Funghi','Пицца Прошутто э Фунги','Pizza prosciutto e funghi',
 'Schinken, Champignons, Mozzarella, Tomatensauce.',
 'Ветчина, шампиньоны, моцарелла, томатный соус.',
 'Ham, mushrooms, mozzarella, tomato sauce.',
 1800,'{gluten,milk}',false,false,true,'{прошутто фунги,prosciutto funghi,ветчина и грибы}',20,330,NULL,NULL,NULL,NULL,NULL),

-- Десерты
('21000000-0000-0000-0000-000000000021','20000000-0000-0000-0000-000000000006',
 'Tiramisu','Тирамису','Tiramisu',
 'Mascarpone, Kaffee, Löffelbiskuits, Kakao.',
 'Маскарпоне, кофе, савоярди, какао.',
 'Mascarpone, coffee, ladyfingers, cocoa.',
 900,'{gluten,milk,eggs}',true,false,true,'{тирамису,tiramisu}',5,150,NULL,NULL,NULL,NULL,NULL),
('21000000-0000-0000-0000-000000000022','20000000-0000-0000-0000-000000000006',
 'Panna cotta mit Beeren','Панна-котта с ягодами','Panna cotta with berries',
 'Sahne, Vanille, Beerensauce.',
 'Сливки, ваниль, ягодный соус.',
 'Cream, vanilla, berry sauce.',
 800,'{milk}',true,false,true,'{панна котта,panna cotta,паннакотта}',5,130,NULL,NULL,NULL,NULL,NULL),
('21000000-0000-0000-0000-000000000023','20000000-0000-0000-0000-000000000006',
 'Schokoladenfondant','Шоколадный фондан','Chocolate fondant',
 'Schokolade mit warmem flüssigem Kern, Vanilleeis. Kann Spuren von Nüssen enthalten.',
 'Шоколад с тёплым жидким центром, ванильное мороженое. Возможны следы орехов.',
 'Chocolate with a warm liquid centre, vanilla ice cream. May contain traces of nuts.',
 1000,'{gluten,milk,eggs,nuts}',true,false,true,'{фондан,фондант,fondant,шоколадный десерт}',15,140,NULL,NULL,NULL,NULL,NULL),

-- Напитки
('21000000-0000-0000-0000-000000000024','20000000-0000-0000-0000-000000000007',
 'Hausgemachte Limonade','Домашний лимонад','Homemade lemonade',
 'Zitrone, Minze, Sodawasser.','Лимон, мята, содовая.','Lemon, mint, soda water.',
 600,'{}',true,true,true,'{лимонад,lemonade,limonade}',3,NULL,300,NULL,NULL,NULL,NULL),
('21000000-0000-0000-0000-000000000025','20000000-0000-0000-0000-000000000007',
 'Prosecco (Glas)','Просекко (бокал)','Prosecco (glass)',
 'Schaumwein.','Игристое вино.','Sparkling wine.',
 800,'{sulphites}',true,false,true,'{просекко,prosecco,игристое,шампанское}',2,NULL,150,NULL,NULL,NULL,NULL),
('21000000-0000-0000-0000-000000000026','20000000-0000-0000-0000-000000000007',
 'Espresso','Эспрессо','Espresso',
 'Espresso.','Эспрессо.','Espresso.',
 300,'{}',true,true,true,'{эспрессо,espresso,кофе}',2,NULL,30,NULL,NULL,NULL,NULL),
('21000000-0000-0000-0000-000000000027','20000000-0000-0000-0000-000000000007',
 'Cappuccino','Капучино','Cappuccino',
 'Espresso mit Milch.','Эспрессо с молоком.','Espresso with milk.',
 400,'{milk}',true,false,true,'{капучино,cappuccino,кофе с молоком}',3,NULL,180,NULL,NULL,NULL,NULL),

-- Детское меню
('21000000-0000-0000-0000-000000000028','20000000-0000-0000-0000-000000000008',
 'Nudeln mit Tomatensauce','Паста с томатным соусом','Pasta with tomato sauce',
 'Nudeln, Tomatensauce, Parmesan.','Паста, томатный соус, пармезан.','Pasta, tomato sauce, parmesan.',
 1100,'{gluten,milk}',true,false,true,'{детская паста,паста с томатным соусом,kindernudeln}',15,180,NULL,NULL,NULL,NULL,NULL),
('21000000-0000-0000-0000-000000000029','20000000-0000-0000-0000-000000000008',
 'Mini-Pizza Margherita','Мини-пицца Маргарита','Mini margherita pizza',
 'Tomatensauce, Mozzarella.','Томатный соус, моцарелла.','Tomato sauce, mozzarella.',
 1300,'{gluten,milk}',true,false,true,'{мини пицца,детская пицца,mini pizza}',15,200,NULL,NULL,NULL,NULL,NULL),
('21000000-0000-0000-0000-000000000030','20000000-0000-0000-0000-000000000008',
 'Chicken Nuggets','Куриные наггетсы','Chicken nuggets',
 'Panierte Hähnchenbrust, Pommes frites.','Куриное филе в панировке, картофель фри.','Breaded chicken breast, french fries.',
 1600,'{gluten,eggs}',false,false,true,'{наггетсы,nuggets,курица,детская курица}',15,150,NULL,NULL,NULL,NULL,NULL)

ON CONFLICT(id) DO UPDATE SET category_id=excluded.category_id,name_de=excluded.name_de,
  name_ru=excluded.name_ru,name_en=excluded.name_en,description_de=excluded.description_de,
  description_ru=excluded.description_ru,description_en=excluded.description_en,
  price_cents=excluded.price_cents,allergens=excluded.allergens,
  is_vegetarian=excluded.is_vegetarian,is_vegan=excluded.is_vegan,
  is_available=excluded.is_available,aliases=excluded.aliases,prep_minutes=excluded.prep_minutes,
  weight_g=excluded.weight_g,volume_ml=excluded.volume_ml,kcal=excluded.kcal,
  protein_g=excluded.protein_g,fat_g=excluded.fat_g,carbs_g=excluded.carbs_g;
