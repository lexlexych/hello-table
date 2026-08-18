export const languages = ["de", "ru", "en"] as const;
export type Language = (typeof languages)[number];

export type LocalizedText = Readonly<Record<Language, string>>;

export type MenuItem = Readonly<{
  id: string;
  name: LocalizedText;
  description: LocalizedText;
  priceCents: number;
  portion: LocalizedText;
  allergens: LocalizedText;
  vegetarian: boolean;
  vegan: boolean;
  nutrition?: Readonly<{
    kcal: number;
    protein?: number;
    fat?: number;
    carbs?: number;
  }>;
}>;

export type MenuCategory = Readonly<{
  id: string;
  name: LocalizedText;
  items: readonly MenuItem[];
}>;

const text = (de: string, ru: string, en: string): LocalizedText => ({ de, ru, en });

export const menu: readonly MenuCategory[] = [
  {
    id: "starters",
    name: text("Vorspeisen", "Закуски", "Starters"),
    items: [
      {
        id: "bruschetta",
        name: text("Bruschetta mit Tomaten und Basilikum", "Брускетта с томатами и базиликом", "Bruschetta with tomato and basil"),
        description: text("Ciabatta, Kirschtomaten, Basilikum, Knoblauch, Olivenöl. Vegan ohne Käse.", "Чиабатта, томаты черри, базилик, чеснок, оливковое масло. Веганская подача — без сыра.", "Ciabatta, cherry tomatoes, basil, garlic and olive oil. Vegan when served without cheese."),
        priceCents: 900,
        portion: text("150 g", "150 г", "150 g"),
        allergens: text("Gluten", "Глютен", "Gluten"),
        vegetarian: true,
        vegan: true,
        nutrition: { kcal: 220, protein: 5, fat: 9, carbs: 30 },
      },
      {
        id: "carpaccio",
        name: text("Rinder-Carpaccio", "Карпаччо из говядины", "Beef carpaccio"),
        description: text("Dünn geschnittenes Rindfleisch, Rucola, Parmesan, Zitrone und Olivenöl.", "Тонко нарезанная говядина, руккола, пармезан, лимон, оливковое масло.", "Thinly sliced beef, rocket, parmesan, lemon and olive oil."),
        priceCents: 1600,
        portion: text("120 g", "120 г", "120 g"),
        allergens: text("Milch", "Молоко", "Milk"),
        vegetarian: false,
        vegan: false,
        nutrition: { kcal: 240, protein: 21, fat: 16, carbs: 2 },
      },
      {
        id: "antipasti-platter",
        name: text("Käse- und Aufschnittplatte", "Ассорти сыров и вяленого мяса", "Cheese and cured meat platter"),
        description: text("Drei Käsesorten, Prosciutto, Salami, Nüsse, Honig und Cracker.", "Три вида сыра, прошутто, салями, орехи, мёд, крекеры.", "Three cheeses, prosciutto, salami, nuts, honey and crackers."),
        priceCents: 2200,
        portion: text("250 g", "250 г", "250 g"),
        allergens: text("Milch, Gluten, Nüsse", "Молоко, глютен, орехи", "Milk, gluten, nuts"),
        vegetarian: false,
        vegan: false,
        nutrition: { kcal: 620 },
      },
      {
        id: "caprese",
        name: text("Caprese", "Капрезе", "Caprese"),
        description: text("Büffelmozzarella, Tomaten, Basilikum und Olivenöl.", "Моцарелла буффало, томаты, базилик, оливковое масло.", "Buffalo mozzarella, tomatoes, basil and olive oil."),
        priceCents: 1200,
        portion: text("200 g", "200 г", "200 g"),
        allergens: text("Milch", "Молоко", "Milk"),
        vegetarian: true,
        vegan: false,
        nutrition: { kcal: 280, protein: 15, fat: 22, carbs: 6 },
      },
    ],
  },
  {
    id: "soups",
    name: text("Suppen", "Супы", "Soups"),
    items: [
      {
        id: "pumpkin-soup",
        name: text("Kürbiscremesuppe", "Крем-суп из тыквы", "Pumpkin cream soup"),
        description: text("Kürbis, Kokoscreme, Ingwer, Zwiebeln, Knoblauch, Gewürze und Kürbiskerne.", "Тыква, кокосовые сливки, имбирь, лук, чеснок, специи, тыквенные семечки.", "Pumpkin, coconut cream, ginger, onion, garlic, spices and pumpkin seeds."),
        priceCents: 2500,
        portion: text("300 g", "300 г", "300 g"),
        allergens: text("Spuren von Nüssen", "Орехи (следы)", "Traces of nuts"),
        vegetarian: true,
        vegan: true,
        nutrition: { kcal: 210 },
      },
      {
        id: "minestrone",
        name: text("Minestrone", "Минестроне", "Minestrone"),
        description: text("Gemüsesuppe mit Nudeln, Bohnen, Tomaten und Sellerie.", "Овощной суп с пастой, фасолью, томатами, сельдереем.", "Vegetable soup with pasta, beans, tomatoes and celery."),
        priceCents: 1400,
        portion: text("320 g", "320 г", "320 g"),
        allergens: text("Gluten, Sellerie", "Глютен, сельдерей", "Gluten, celery"),
        vegetarian: true,
        vegan: true,
        nutrition: { kcal: 180 },
      },
      {
        id: "bouillabaisse",
        name: text("Bouillabaisse", "Буйабес", "Bouillabaisse"),
        description: text("Meeresfrüchte, Tomaten, Safran, Weißwein und Knoblauch.", "Морепродукты, томаты, шафран, белое вино, чеснок.", "Seafood, tomatoes, saffron, white wine and garlic."),
        priceCents: 1900,
        portion: text("350 g", "350 г", "350 g"),
        allergens: text("Fisch, Weichtiere, Krebstiere, Sulfite", "Рыба, моллюски, ракообразные, сульфиты", "Fish, molluscs, crustaceans, sulphites"),
        vegetarian: false,
        vegan: false,
        nutrition: { kcal: 290 },
      },
    ],
  },
  {
    id: "pasta-risotto",
    name: text("Pasta und Risotto", "Паста и ризотто", "Pasta and risotto"),
    items: [
      {
        id: "carbonara",
        name: text("Pasta Carbonara", "Паста Карбонара", "Pasta carbonara"),
        description: text("Spaghetti, Guanciale, Eigelb, Pecorino Romano und schwarzer Pfeffer.", "Паста спагетти, гуанчале (свиная щековина), яичный желток, сыр Пекорино Романо, чёрный перец.", "Spaghetti, guanciale, egg yolk, Pecorino Romano and black pepper."),
        priceCents: 3000,
        portion: text("280 g", "280 г", "280 g"),
        allergens: text("Gluten, Eier, Milch", "Глютен, яйца, молоко", "Gluten, eggs, milk"),
        vegetarian: false,
        vegan: false,
        nutrition: { kcal: 520, protein: 22, fat: 24, carbs: 55 },
      },
      {
        id: "mushroom-risotto",
        name: text("Pilzrisotto", "Ризотто с грибами", "Mushroom risotto"),
        description: text("Arborio-Reis, Steinpilze, Parmesan, Weißwein, Butter, Zwiebeln, Knoblauch und Trüffelöl.", "Рис Арборио, белые грибы, пармезан, белое вино, масло, лук, чеснок, трюфельное масло.", "Arborio rice, porcini, parmesan, white wine, butter, onion, garlic and truffle oil."),
        priceCents: 3200,
        portion: text("320 g", "320 г", "320 g"),
        allergens: text("Milch", "Молоко", "Milk"),
        vegetarian: true,
        vegan: false,
        nutrition: { kcal: 480, protein: 14, fat: 18, carbs: 62 },
      },
      {
        id: "bolognese",
        name: text("Pasta Bolognese", "Паста Болоньезе", "Pasta bolognese"),
        description: text("Tagliatelle, Rinderragout, Tomaten und Parmesan.", "Тальятелле, говяжий рагу, томаты, пармезан.", "Tagliatelle, beef ragout, tomatoes and parmesan."),
        priceCents: 2600,
        portion: text("300 g", "300 г", "300 g"),
        allergens: text("Gluten, Milch, Sellerie", "Глютен, молоко, сельдерей", "Gluten, milk, celery"),
        vegetarian: false,
        vegan: false,
        nutrition: { kcal: 560 },
      },
      {
        id: "gnocchi-gorgonzola",
        name: text("Gnocchi mit Gorgonzola", "Ньокки с горгонзолой", "Gnocchi with gorgonzola"),
        description: text("Kartoffelgnocchi, Gorgonzolasauce und Walnuss.", "Картофельные ньокки, соус горгонзола, грецкий орех.", "Potato gnocchi, gorgonzola sauce and walnut."),
        priceCents: 2400,
        portion: text("280 g", "280 г", "280 g"),
        allergens: text("Gluten, Milch, Nüsse", "Глютен, молоко, орехи", "Gluten, milk, nuts"),
        vegetarian: true,
        vegan: false,
        nutrition: { kcal: 510 },
      },
      {
        id: "seafood-risotto",
        name: text("Meeresfrüchte-Risotto", "Ризотто с морепродуктами", "Seafood risotto"),
        description: text("Carnaroli-Reis, Garnelen, Miesmuscheln, Tintenfisch, Weißwein und Petersilie.", "Рис Карнароли, креветки, мидии, кальмары, белое вино, петрушка.", "Carnaroli rice, prawns, mussels, squid, white wine and parsley."),
        priceCents: 3400,
        portion: text("320 g", "320 г", "320 g"),
        allergens: text("Weichtiere, Krebstiere, Sulfite", "Моллюски, ракообразные, сульфиты", "Molluscs, crustaceans, sulphites"),
        vegetarian: false,
        vegan: false,
        nutrition: { kcal: 470 },
      },
    ],
  },
  {
    id: "mains",
    name: text("Hauptgerichte", "Горячее", "Main courses"),
    items: [
      {
        id: "ribeye",
        name: text("Ribeye-Steak (200 g)", "Стейк Рибай (200 г)", "Ribeye steak (200 g)"),
        description: text("Rindersteak, Kartoffelgratin und Saisongemüse. Garstufen: rare, medium rare, medium, well done. Sauce separat nach Wahl.", "Говяжий стейк, картофель гратен, сезонные овощи. Степени прожарки: rare, medium rare, medium, well done. Соус выбирается отдельно.", "Beef steak, potato gratin and seasonal vegetables. Doneness: rare, medium rare, medium or well done. Sauce chosen separately."),
        priceCents: 6500,
        portion: text("200 g + 50 g Sauce", "200 г + соус 50 г", "200 g + 50 g sauce"),
        allergens: text("Abhängig von der Sauce — bitte nachfragen", "Зависит от соуса — уточняйте при заказе", "Depends on the sauce — please ask when ordering"),
        vegetarian: false,
        vegan: false,
      },
      {
        id: "ossobuco",
        name: text("Ossobuco", "Оссобуко", "Ossobuco"),
        description: text("Geschmorte Kalbshaxe, Gremolata und Risotto milanese.", "Тушёная телячья голень, гремолата, ризотто миланезе.", "Braised veal shank, gremolata and risotto milanese."),
        priceCents: 3600,
        portion: text("400 g", "400 г", "400 g"),
        allergens: text("Sellerie", "Сельдерей", "Celery"),
        vegetarian: false,
        vegan: false,
        nutrition: { kcal: 540 },
      },
      {
        id: "sea-bass",
        name: text("Wolfsbarschfilet", "Филе сибаса", "Sea bass fillet"),
        description: text("Mittelmeerfisch, Kirschtomaten, Oliven, Kapern und Weißwein.", "Средиземноморская рыба, томаты черри, оливки, каперсы, белое вино.", "Mediterranean fish, cherry tomatoes, olives, capers and white wine."),
        priceCents: 2900,
        portion: text("220 g", "220 г", "220 g"),
        allergens: text("Fisch", "Рыба", "Fish"),
        vegetarian: false,
        vegan: false,
        nutrition: { kcal: 310 },
      },
      {
        id: "milanese",
        name: text("Mailänder Kalbsschnitzel", "Котлета из телятины по-милански", "Milanese veal cutlet"),
        description: text("Paniertes Kalbskotelett, Rucola, Parmesan und Kirschtomaten.", "Панированная телячья котлета, руккола, пармезан, томаты черри.", "Breaded veal cutlet, rocket, parmesan and cherry tomatoes."),
        priceCents: 2700,
        portion: text("250 g", "250 г", "250 g"),
        allergens: text("Gluten, Milch, Eier", "Глютен, молоко, яйца", "Gluten, milk, eggs"),
        vegetarian: false,
        vegan: false,
        nutrition: { kcal: 480 },
      },
    ],
  },
  {
    id: "pizza",
    name: text("Pizza", "Пицца", "Pizza"),
    items: [
      {
        id: "margherita",
        name: text("Margherita", "Маргарита", "Margherita"),
        description: text("Tomatensauce, Mozzarella und Basilikum.", "Томатный соус, моцарелла, базилик.", "Tomato sauce, mozzarella and basil."),
        priceCents: 1400,
        portion: text("300 g", "300 г", "300 g"),
        allergens: text("Gluten, Milch", "Глютен, молоко", "Gluten, milk"),
        vegetarian: true,
        vegan: false,
      },
      {
        id: "diavolo",
        name: text("Diavolo", "Дьяволо", "Diavolo"),
        description: text("Scharfe Salami, Chili, Mozzarella und Tomatensauce.", "Острая салями, чили, моцарелла, томатный соус.", "Spicy salami, chilli, mozzarella and tomato sauce."),
        priceCents: 1700,
        portion: text("320 g", "320 г", "320 g"),
        allergens: text("Gluten, Milch", "Глютен, молоко", "Gluten, milk"),
        vegetarian: false,
        vegan: false,
      },
      {
        id: "quattro-formaggi",
        name: text("Quattro Formaggi", "Кватро Формаджи", "Quattro formaggi"),
        description: text("Mozzarella, Gorgonzola, Parmesan und Caciotta.", "Моцарелла, горгонзола, пармезан, качотта.", "Mozzarella, gorgonzola, parmesan and caciotta."),
        priceCents: 1800,
        portion: text("300 g", "300 г", "300 g"),
        allergens: text("Gluten, Milch", "Глютен, молоко", "Gluten, milk"),
        vegetarian: true,
        vegan: false,
      },
      {
        id: "prosciutto-funghi",
        name: text("Prosciutto e Funghi", "Прошутто э Фунги", "Prosciutto e funghi"),
        description: text("Schinken, Champignons, Mozzarella und Tomatensauce.", "Ветчина, шампиньоны, моцарелла, томатный соус.", "Ham, mushrooms, mozzarella and tomato sauce."),
        priceCents: 1800,
        portion: text("330 g", "330 г", "330 g"),
        allergens: text("Gluten, Milch", "Глютен, молоко", "Gluten, milk"),
        vegetarian: false,
        vegan: false,
      },
    ],
  },
  {
    id: "desserts",
    name: text("Desserts", "Десерты", "Desserts"),
    items: [
      {
        id: "tiramisu",
        name: text("Tiramisu", "Тирамису", "Tiramisu"),
        description: text("Mascarpone, Kaffee, Löffelbiskuits und Kakao.", "Маскарпоне, кофе, савоярди, какао.", "Mascarpone, coffee, ladyfingers and cocoa."),
        priceCents: 900,
        portion: text("150 g", "150 г", "150 g"),
        allergens: text("Gluten, Milch, Eier", "Глютен, молоко, яйца", "Gluten, milk, eggs"),
        vegetarian: true,
        vegan: false,
      },
      {
        id: "panna-cotta",
        name: text("Panna cotta mit Beeren", "Панна-котта с ягодами", "Panna cotta with berries"),
        description: text("Sahne, Vanille und Beerensauce.", "Сливки, ваниль, ягодный соус.", "Cream, vanilla and berry sauce."),
        priceCents: 800,
        portion: text("130 g", "130 г", "130 g"),
        allergens: text("Milch", "Молоко", "Milk"),
        vegetarian: true,
        vegan: false,
      },
      {
        id: "chocolate-fondant",
        name: text("Schokoladenfondant", "Шоколадный фондан", "Chocolate fondant"),
        description: text("Schokolade mit warmem flüssigem Kern und Vanilleeis.", "Шоколад с тёплым жидким центром, ванильное мороженое.", "Chocolate with a warm liquid centre and vanilla ice cream."),
        priceCents: 1000,
        portion: text("140 g", "140 г", "140 g"),
        allergens: text("Gluten, Milch, Eier, Spuren von Nüssen", "Глютен, молоко, яйца, орехи (следы)", "Gluten, milk, eggs, traces of nuts"),
        vegetarian: true,
        vegan: false,
      },
    ],
  },
  {
    id: "drinks",
    name: text("Getränke", "Напитки", "Drinks"),
    items: [
      {
        id: "lemonade",
        name: text("Hausgemachte Limonade", "Домашний лимонад", "Homemade lemonade"),
        description: text("Zitrone, Minze und Sodawasser.", "Лимон, мята, содовая.", "Lemon, mint and soda water."),
        priceCents: 600,
        portion: text("300 ml", "300 мл", "300 ml"),
        allergens: text("Keine", "Нет", "None"),
        vegetarian: true,
        vegan: true,
      },
      {
        id: "prosecco",
        name: text("Prosecco (Glas)", "Просекко (бокал)", "Prosecco (glass)"),
        description: text("Schaumwein.", "Игристое вино.", "Sparkling wine."),
        priceCents: 800,
        portion: text("150 ml", "150 мл", "150 ml"),
        allergens: text("Sulfite", "Сульфиты", "Sulphites"),
        vegetarian: true,
        vegan: false,
      },
      {
        id: "espresso",
        name: text("Espresso", "Эспрессо", "Espresso"),
        description: text("Espresso.", "Эспрессо.", "Espresso."),
        priceCents: 300,
        portion: text("30 ml", "30 мл", "30 ml"),
        allergens: text("Keine", "Нет", "None"),
        vegetarian: true,
        vegan: true,
      },
      {
        id: "cappuccino",
        name: text("Cappuccino", "Капучино", "Cappuccino"),
        description: text("Espresso mit Milch.", "Эспрессо с молоком.", "Espresso with milk."),
        priceCents: 400,
        portion: text("180 ml", "180 мл", "180 ml"),
        allergens: text("Milch", "Молоко", "Milk"),
        vegetarian: true,
        vegan: false,
      },
    ],
  },
  {
    id: "kids",
    name: text("Kindermenü", "Детское меню", "Kids menu"),
    items: [
      {
        id: "kids-pasta",
        name: text("Nudeln mit Tomatensauce", "Паста с томатным соусом", "Pasta with tomato sauce"),
        description: text("Nudeln, Tomatensauce und Parmesan.", "Паста, томатный соус, пармезан.", "Pasta, tomato sauce and parmesan."),
        priceCents: 1100,
        portion: text("180 g", "180 г", "180 g"),
        allergens: text("Gluten, Milch", "Глютен, молоко", "Gluten, milk"),
        vegetarian: true,
        vegan: false,
      },
      {
        id: "mini-margherita",
        name: text("Mini-Pizza Margherita", "Мини-пицца Маргарита", "Mini margherita pizza"),
        description: text("Tomatensauce und Mozzarella.", "Томатный соус, моцарелла.", "Tomato sauce and mozzarella."),
        priceCents: 1300,
        portion: text("200 g", "200 г", "200 g"),
        allergens: text("Gluten, Milch", "Глютен, молоко", "Gluten, milk"),
        vegetarian: true,
        vegan: false,
      },
      {
        id: "chicken-nuggets",
        name: text("Chicken Nuggets", "Куриные наггетсы", "Chicken nuggets"),
        description: text("Panierte Hähnchenbrust und Pommes frites.", "Куриное филе в панировке, картофель фри.", "Breaded chicken breast and french fries."),
        priceCents: 1600,
        portion: text("150 g", "150 г", "150 g"),
        allergens: text("Gluten, Eier", "Глютен, яйца", "Gluten, eggs"),
        vegetarian: false,
        vegan: false,
      },
    ],
  },
];

export const menuItemCount = menu.reduce((total, category) => total + category.items.length, 0);

export function formatPrice(priceCents: number, language: Language): string {
  const locale = language === "de" ? "de-DE" : language === "ru" ? "ru-RU" : "en-GB";
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency: "EUR",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(priceCents / 100);
}
