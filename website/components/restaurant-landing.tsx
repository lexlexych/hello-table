"use client";

import Image from "next/image";
import { type FormEvent, useEffect, useMemo, useState } from "react";
import { formatPrice, type Language, languages, menu } from "@/lib/menu";
import type { AvailableTable } from "@/lib/schemas";

const copy = {
  de: {
    navStory: "Restaurant",
    navMenu: "Speisekarte",
    navReserve: "Reservieren",
    eyebrow: "Italienische Küche · Berlin",
    heroTitle: "Ein Abend, der nach Italien schmeckt.",
    heroText: "Saisonale Zutaten, handwerkliche Klassiker und die Leichtigkeit eines langen Abends am Mittelmeer.",
    viewMenu: "Speisekarte entdecken",
    bookTable: "Tisch reservieren",
    openDaily: "Täglich geöffnet",
    hours: "12:00 — 23:00",
    storyEyebrow: "Benvenuti",
    storyTitle: "Italienische Seele. Berliner Rhythmus.",
    storyText: "Basilik ist unser Ort für ehrliche Aromen und gutes Zusammensein. Wir kochen vertraute italienische Gerichte mit präzisem Handwerk, besten Produkten und einer modernen, unaufgeregten Handschrift.",
    storyQuote: "Gute Küche beginnt mit Respekt — vor dem Produkt, dem Handwerk und den Menschen am Tisch.",
    menuEyebrow: "Unsere Küche",
    menuTitle: "Die Speisekarte",
    menuText: "Vom ersten Teller bis zum letzten Espresso. Alle Gerichte werden frisch zubereitet.",
    portion: "Portion",
    allergens: "Allergene",
    vegetarian: "Vegetarisch",
    vegan: "Vegan",
    kcal: "kcal",
    protein: "Eiweiß",
    fat: "Fett",
    carbs: "KH",
    reserveEyebrow: "Ihr Tisch wartet",
    reserveTitle: "Einfach reservieren.",
    reserveText: "Wählen Sie Datum, Uhrzeit und Personenzahl. Wir zeigen Ihnen sofort, welche Tische frei sind.",
    date: "Datum",
    time: "Uhrzeit",
    guests: "Personen",
    check: "Verfügbarkeit prüfen",
    checking: "Wir schauen nach …",
    chooseTable: "Wählen Sie Ihren Platz",
    seats: "Plätze",
    mainRoom: "Hauptraum",
    terrace: "Terrasse",
    name: "Name",
    phone: "Telefon",
    privacy: "Ich stimme der Verarbeitung meiner Angaben zur Reservierung zu. Die Daten werden 30 Tage nach dem Besuch gelöscht.",
    confirm: "Reservierung bestätigen",
    confirming: "Wird reserviert …",
    successTitle: "Ihr Tisch ist reserviert.",
    successText: "Wir freuen uns auf Ihren Besuch. Die Reservierung ist verbindlich eingetragen.",
    newReservation: "Weitere Reservierung",
    noTables: "Zu dieser Zeit ist leider kein passender Tisch frei. Versuchen Sie bitte eine andere Uhrzeit.",
    invalid: "Bitte prüfen Sie Ihre Angaben.",
    unavailable: "Der Reservierungsservice ist gerade nicht erreichbar. Bitte rufen Sie uns an.",
    taken: "Dieser Tisch wurde gerade vergeben. Bitte prüfen Sie die Verfügbarkeit erneut.",
    rateLimited: "Zu viele Anfragen. Bitte versuchen Sie es in einigen Minuten erneut.",
    contactEyebrow: "Besuchen Sie uns",
    berlin: "Berlin",
    daily: "Täglich · 12:00 — 23:00",
    footer: "Zeitgenössische italienische Küche in Berlin.",
  },
  ru: {
    navStory: "О ресторане",
    navMenu: "Меню",
    navReserve: "Бронь",
    eyebrow: "Итальянская кухня · Берлин",
    heroTitle: "Вечер со вкусом Италии.",
    heroText: "Сезонные продукты, узнаваемая классика и лёгкость долгого средиземноморского вечера.",
    viewMenu: "Смотреть меню",
    bookTable: "Забронировать столик",
    openDaily: "Открыты ежедневно",
    hours: "12:00 — 23:00",
    storyEyebrow: "Benvenuti",
    storyTitle: "Итальянская душа. Берлинский ритм.",
    storyText: "«Базилик» — место честных вкусов и тёплых встреч. Мы готовим любимые итальянские блюда из лучших продуктов, бережно соединяя традицию и современную лёгкость.",
    storyQuote: "Хорошая кухня начинается с уважения — к продукту, ремеслу и людям за столом.",
    menuEyebrow: "Наша кухня",
    menuTitle: "Меню",
    menuText: "От первой закуски до последнего эспрессо. Каждое блюдо мы готовим на заказ.",
    portion: "Порция",
    allergens: "Аллергены",
    vegetarian: "Вегетарианское",
    vegan: "Веганское",
    kcal: "ккал",
    protein: "Белки",
    fat: "Жиры",
    carbs: "Углеводы",
    reserveEyebrow: "Ваш столик ждёт",
    reserveTitle: "Забронировать — просто.",
    reserveText: "Выберите дату, время и число гостей. Мы сразу покажем свободные столики.",
    date: "Дата",
    time: "Время",
    guests: "Гостей",
    check: "Проверить столики",
    checking: "Проверяем …",
    chooseTable: "Выберите место",
    seats: "мест",
    mainRoom: "Основной зал",
    terrace: "Терраса",
    name: "Имя",
    phone: "Телефон",
    privacy: "Я согласен на обработку данных для бронирования. Они будут удалены через 30 дней после визита.",
    confirm: "Подтвердить бронь",
    confirming: "Бронируем …",
    successTitle: "Столик забронирован.",
    successText: "Будем ждать вас. Бронирование успешно сохранено.",
    newReservation: "Новая бронь",
    noTables: "На это время подходящих столиков нет. Попробуйте выбрать другое время.",
    invalid: "Проверьте введённые данные.",
    unavailable: "Сервис бронирования временно недоступен. Пожалуйста, позвоните нам.",
    taken: "Этот столик только что заняли. Пожалуйста, проверьте доступность ещё раз.",
    rateLimited: "Слишком много запросов. Повторите попытку через несколько минут.",
    contactEyebrow: "Ждём вас",
    berlin: "Берлин",
    daily: "Ежедневно · 12:00 — 23:00",
    footer: "Современная итальянская кухня в Берлине.",
  },
  en: {
    navStory: "Restaurant",
    navMenu: "Menu",
    navReserve: "Reservations",
    eyebrow: "Italian cuisine · Berlin",
    heroTitle: "An evening that tastes of Italy.",
    heroText: "Seasonal ingredients, crafted classics and the ease of a long Mediterranean evening.",
    viewMenu: "Explore the menu",
    bookTable: "Reserve a table",
    openDaily: "Open every day",
    hours: "12:00 — 23:00",
    storyEyebrow: "Benvenuti",
    storyTitle: "Italian soul. Berlin rhythm.",
    storyText: "Basilik is our place for honest flavours and time well spent. We cook familiar Italian dishes with careful technique, beautiful produce and a fresh, understated point of view.",
    storyQuote: "Good cooking begins with respect — for the produce, the craft and the people at the table.",
    menuEyebrow: "Our kitchen",
    menuTitle: "The menu",
    menuText: "From the first plate to the final espresso. Every dish is prepared to order.",
    portion: "Portion",
    allergens: "Allergens",
    vegetarian: "Vegetarian",
    vegan: "Vegan",
    kcal: "kcal",
    protein: "Protein",
    fat: "Fat",
    carbs: "Carbs",
    reserveEyebrow: "Your table awaits",
    reserveTitle: "Simple reservations.",
    reserveText: "Choose a date, time and party size. We will show you the available tables right away.",
    date: "Date",
    time: "Time",
    guests: "Guests",
    check: "Check availability",
    checking: "Checking …",
    chooseTable: "Choose your table",
    seats: "seats",
    mainRoom: "Main dining room",
    terrace: "Terrace",
    name: "Name",
    phone: "Phone",
    privacy: "I agree to the processing of my details for this reservation. They will be deleted 30 days after the visit.",
    confirm: "Confirm reservation",
    confirming: "Reserving …",
    successTitle: "Your table is reserved.",
    successText: "We look forward to welcoming you. Your reservation has been confirmed.",
    newReservation: "Another reservation",
    noTables: "There is no suitable table available at this time. Please try another time.",
    invalid: "Please check your details.",
    unavailable: "The reservation service is currently unavailable. Please call us.",
    taken: "This table has just been taken. Please check availability again.",
    rateLimited: "Too many requests. Please try again in a few minutes.",
    contactEyebrow: "Visit us",
    berlin: "Berlin",
    daily: "Daily · 12:00 — 23:00",
    footer: "Contemporary Italian cooking in Berlin.",
  },
} as const;

type Status = "idle" | "checking" | "ready" | "submitting" | "success";

function LeafMark() {
  return (
    <svg aria-hidden="true" className="leaf-mark" viewBox="0 0 44 44">
      <path d="M35 8C20 9 10 16 9 33c14 2 25-8 26-25Z" />
      <path d="M12 31c6-8 12-13 21-20" />
    </svg>
  );
}

function zoneName(zone: string, language: Language) {
  if (zone === "Terrasse") return copy[language].terrace;
  if (zone === "Hauptraum") return copy[language].mainRoom;
  return zone;
}

function errorMessage(error: string, language: Language) {
  const c = copy[language];
  if (error === "table_already_booked" || error === "table_not_available") return c.taken;
  if (error === "rate_limited") return c.rateLimited;
  if (error === "service_unavailable") return c.unavailable;
  if (error === "no_tables") return c.noTables;
  return c.invalid;
}

export function RestaurantLanding() {
  const [language, setLanguage] = useState<Language>("de");
  const [activeCategory, setActiveCategory] = useState(menu[0]?.id ?? "starters");
  const [date, setDate] = useState("");
  const [time, setTime] = useState("");
  const [partySize, setPartySize] = useState(2);
  const [tables, setTables] = useState<AvailableTable[]>([]);
  const [tableId, setTableId] = useState("");
  const [guestName, setGuestName] = useState("");
  const [guestPhone, setGuestPhone] = useState("");
  const [privacyAccepted, setPrivacyAccepted] = useState(false);
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState("");
  const c = copy[language];
  const category = menu.find((entry) => entry.id === activeCategory) ?? menu[0];
  const minDate = useMemo(
    () => new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Berlin" }).format(new Date()),
    [],
  );

  useEffect(() => {
    document.documentElement.lang = language;
  }, [language]);

  const resetAvailability = () => {
    setTables([]);
    setTableId("");
    setStatus("idle");
    setError("");
  };

  async function checkTables(event: FormEvent) {
    event.preventDefault();
    setStatus("checking");
    setError("");
    setTables([]);
    setTableId("");
    try {
      const response = await fetch("/api/reservations/availability", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ date, time, party_size: partySize }),
      });
      const result = (await response.json()) as { ok: boolean; tables?: AvailableTable[]; error?: string };
      if (!response.ok || !result.ok) throw new Error(result.error ?? "invalid_request");
      if (!result.tables?.length) throw new Error("no_tables");
      setTables(result.tables);
      setStatus("ready");
    } catch (caught) {
      setStatus("idle");
      setError(caught instanceof Error ? caught.message : "service_unavailable");
    }
  }

  async function submitReservation(event: FormEvent) {
    event.preventDefault();
    if (!tableId) {
      setError("invalid_request");
      return;
    }
    setStatus("submitting");
    setError("");
    try {
      const response = await fetch("/api/reservations", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          table_id: tableId,
          date,
          time,
          party_size: partySize,
          guest_name: guestName,
          guest_phone: guestPhone,
          language,
          privacy_accepted: privacyAccepted,
        }),
      });
      const result = (await response.json()) as { ok: boolean; error?: string };
      if (!response.ok || !result.ok) throw new Error(result.error ?? "invalid_request");
      setStatus("success");
    } catch (caught) {
      setStatus("ready");
      setError(caught instanceof Error ? caught.message : "service_unavailable");
    }
  }

  function startAgain() {
    setDate("");
    setTime("");
    setPartySize(2);
    setTables([]);
    setTableId("");
    setGuestName("");
    setGuestPhone("");
    setPrivacyAccepted(false);
    setStatus("idle");
    setError("");
  }

  return (
    <main>
      <header className="site-header">
        <a className="brand" href="#top" aria-label="Basilik home">
          <LeafMark />
          <span>BASILIK</span>
        </a>
        <nav className="desktop-nav" aria-label="Main navigation">
          <a href="#restaurant">{c.navStory}</a>
          <a href="#menu">{c.navMenu}</a>
          <a href="#reservation">{c.navReserve}</a>
        </nav>
        <div className="language-switch" aria-label="Language">
          {languages.map((entry) => (
            <button className={entry === language ? "active" : ""} key={entry} onClick={() => setLanguage(entry)} type="button">
              {entry.toUpperCase()}
            </button>
          ))}
        </div>
      </header>

      <section className="hero" id="top">
        <Image alt="Basilik restaurant at dusk" className="hero-image" fill priority sizes="100vw" src="/images/hero-restaurant.png" />
        <div className="hero-scrim" />
        <div className="hero-content">
          <p className="eyebrow light">{c.eyebrow}</p>
          <h1>{c.heroTitle}</h1>
          <p className="hero-copy">{c.heroText}</p>
          <div className="hero-actions">
            <a className="button button-light" href="#menu">{c.viewMenu}</a>
            <a className="text-link light-link" href="#reservation">{c.bookTable}<span aria-hidden="true">↗</span></a>
          </div>
        </div>
        <div className="hero-hours">
          <span>{c.openDaily}</span>
          <strong>{c.hours}</strong>
        </div>
        <div className="scroll-cue" aria-hidden="true"><span /></div>
      </section>

      <section className="story section" id="restaurant">
        <div className="story-copy">
          <p className="eyebrow">{c.storyEyebrow}</p>
          <h2>{c.storyTitle}</h2>
          <p className="large-copy">{c.storyText}</p>
          <blockquote>{c.storyQuote}</blockquote>
        </div>
        <div className="story-images">
          <div className="image-frame image-frame-tall">
            <Image alt="Warm Basilik restaurant interior" fill sizes="(max-width: 760px) 85vw, 36vw" src="/images/interior.png" />
          </div>
          <div className="image-frame image-frame-small">
            <Image alt="Basilik terrace in the evening" fill sizes="(max-width: 760px) 55vw, 22vw" src="/images/terrace.png" />
          </div>
        </div>
      </section>

      <section className="menu-section section" id="menu">
        <div className="section-heading">
          <div>
            <p className="eyebrow">{c.menuEyebrow}</p>
            <h2>{c.menuTitle}</h2>
          </div>
          <p>{c.menuText}</p>
        </div>
        <div className="category-tabs" role="tablist" aria-label={c.menuTitle}>
          {menu.map((entry) => (
            <button
              aria-selected={entry.id === activeCategory}
              className={entry.id === activeCategory ? "active" : ""}
              key={entry.id}
              onClick={() => setActiveCategory(entry.id)}
              role="tab"
              type="button"
            >
              {entry.name[language]}
              <span>{String(entry.items.length).padStart(2, "0")}</span>
            </button>
          ))}
        </div>
        <div className="menu-grid" role="tabpanel">
          {category?.items.map((item) => (
            <article className="menu-card" key={item.id}>
              <div className="menu-card-heading">
                <h3>{item.name[language]}</h3>
                <strong>{formatPrice(item.priceCents, language)}</strong>
              </div>
              <p className="dish-description">{item.description[language]}</p>
              <div className="dish-details">
                <span><b>{c.portion}</b>{item.portion[language]}</span>
                <span><b>{c.allergens}</b>{item.allergens[language]}</span>
              </div>
              <div className="dish-footer">
                <div className="dietary-tags">
                  {item.vegetarian && <span>{c.vegetarian}</span>}
                  {item.vegan && <span>{c.vegan}</span>}
                </div>
                {item.nutrition && (
                  <div className="nutrition">
                    <strong>{item.nutrition.kcal} {c.kcal}</strong>
                    {item.nutrition.protein !== undefined && <span>{c.protein} {item.nutrition.protein}g</span>}
                    {item.nutrition.fat !== undefined && <span>{c.fat} {item.nutrition.fat}g</span>}
                    {item.nutrition.carbs !== undefined && <span>{c.carbs} {item.nutrition.carbs}g</span>}
                  </div>
                )}
              </div>
            </article>
          ))}
        </div>
      </section>

      <section className="reservation-section" id="reservation">
        <div className="reservation-photo">
          <Image alt="A beautifully set table at Basilik" fill sizes="(max-width: 900px) 100vw, 50vw" src="/images/table-setting.png" />
        </div>
        <div className="reservation-panel">
          <div className="reservation-inner">
            <p className="eyebrow light">{c.reserveEyebrow}</p>
            <h2>{c.reserveTitle}</h2>
            <p className="reservation-intro">{c.reserveText}</p>
            {status === "success" ? (
              <div className="success-card" role="status">
                <div className="success-icon">✓</div>
                <h3>{c.successTitle}</h3>
                <p>{c.successText}</p>
                <button className="button button-light" onClick={startAgain} type="button">{c.newReservation}</button>
              </div>
            ) : (
              <>
                <form className="availability-form" onSubmit={checkTables}>
                  <label><span>{c.date}</span><input min={minDate} onChange={(event) => { setDate(event.target.value); resetAvailability(); }} required type="date" value={date} /></label>
                  <label><span>{c.time}</span><input min="12:00" max="22:00" onChange={(event) => { setTime(event.target.value); resetAvailability(); }} required step="900" type="time" value={time} /></label>
                  <label><span>{c.guests}</span><select onChange={(event) => { setPartySize(Number(event.target.value)); resetAvailability(); }} value={partySize}>{Array.from({ length: 8 }, (_, index) => index + 1).map((count) => <option key={count} value={count}>{count}</option>)}</select></label>
                  <button className="button button-accent" disabled={status === "checking"} type="submit">{status === "checking" ? c.checking : c.check}</button>
                </form>
                {error && <p className="form-error" role="alert">{errorMessage(error, language)}</p>}
                {(status === "ready" || status === "submitting") && (
                  <form className="details-form" onSubmit={submitReservation}>
                    <fieldset>
                      <legend>{c.chooseTable}</legend>
                      <div className="table-options">
                        {tables.map((table) => (
                          <label className={tableId === table.table_id ? "table-option selected" : "table-option"} key={table.table_id}>
                            <input checked={tableId === table.table_id} name="table" onChange={() => setTableId(table.table_id)} required type="radio" value={table.table_id} />
                            <span className="table-label">{zoneName(table.zone, language)}</span>
                            <span>{table.seats} {c.seats}</span>
                          </label>
                        ))}
                      </div>
                    </fieldset>
                    <div className="guest-fields">
                      <label><span>{c.name}</span><input autoComplete="name" maxLength={100} minLength={2} onChange={(event) => setGuestName(event.target.value)} required value={guestName} /></label>
                      <label><span>{c.phone}</span><input autoComplete="tel" maxLength={40} minLength={5} onChange={(event) => setGuestPhone(event.target.value)} required type="tel" value={guestPhone} /></label>
                    </div>
                    <label className="privacy-check"><input checked={privacyAccepted} onChange={(event) => setPrivacyAccepted(event.target.checked)} required type="checkbox" /><span>{c.privacy}</span></label>
                    <button className="button button-light submit-reservation" disabled={status === "submitting"} type="submit">{status === "submitting" ? c.confirming : c.confirm}</button>
                  </form>
                )}
              </>
            )}
          </div>
        </div>
      </section>

      <footer className="footer">
        <div className="footer-brand"><LeafMark /><span>BASILIK</span><p>{c.footer}</p></div>
        <div><p className="eyebrow">{c.contactEyebrow}</p><strong>{c.berlin}</strong><span>{c.daily}</span></div>
        <div><p className="eyebrow">Contact</p><a href="tel:+49304421788">+49 30 442 17 88</a></div>
        <p className="copyright">© 2026 Basilik</p>
      </footer>
    </main>
  );
}
