DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='agent_app') THEN CREATE ROLE agent_app LOGIN; END IF; IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='n8n_app') THEN CREATE ROLE n8n_app LOGIN; END IF; IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='portal_app') THEN CREATE ROLE portal_app LOGIN; END IF; IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='website_app') THEN CREATE ROLE website_app LOGIN; END IF; END $$;
DO $$ BEGIN EXECUTE format('GRANT CONNECT ON DATABASE %I TO agent_app, n8n_app, portal_app, website_app',current_database()); END $$;
GRANT USAGE ON SCHEMA public TO agent_app,n8n_app,portal_app,website_app; REVOKE CREATE ON SCHEMA public FROM PUBLIC; REVOKE ALL ON ALL TABLES IN SCHEMA public FROM agent_app,n8n_app,website_app;
GRANT SELECT,INSERT,UPDATE ON ALL TABLES IN SCHEMA public TO portal_app; REVOKE ALL ON TABLE schema_migrations FROM portal_app;
-- DELETE выдаётся точечно и только на справочники, которыми администратор управляет из портала.
-- Операционные таблицы (брони, заказы, обратные звонки, журнал звонков) содержат персональные
-- данные: они удаляются только purge_expired_personal_data(), поэтому DELETE на них нет ни у кого,
-- кроме владельца схемы. По той же причине право не попадает в ALTER DEFAULT PRIVILEGES ниже —
-- иначе будущая таблица с персональными данными получила бы его молча.
GRANT DELETE ON TABLE restaurant_tables, menu_categories, menu_items TO portal_app;
ALTER DEFAULT PRIVILEGES FOR ROLE app_owner IN SCHEMA public GRANT SELECT,INSERT,UPDATE ON TABLES TO portal_app;
ALTER DEFAULT PRIVILEGES FOR ROLE app_owner IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC;
-- Переприменение файла всегда возвращает agent_app к точному белому списку ниже.
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM agent_app;
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM website_app;
GRANT EXECUTE ON FUNCTION find_available_slots(uuid,date,int,time,int),create_reservation_atomic(uuid,timestamptz,int,text,text,char,text),cancel_reservation_by_phone(uuid,text,date),find_menu_items(uuid,text,char,bool,bool,text[],int),find_pickup_slots(uuid,timestamptz,int,int),create_pickup_order_atomic(uuid,jsonb,timestamptz,text,text,char,text),create_callback_request(uuid,text,char,text,text) TO n8n_app,portal_app;
-- Голосовой агент вызывает эти две RPC напрямую. Portal API вызывает их от имени
-- облачного n8n, чтобы строка подключения к базе не покидала сервер приложения.
GRANT EXECUTE ON FUNCTION find_available_tables(uuid,date,time,int),create_reservation_for_table(uuid,uuid,date,time,int,text,text,char,text) TO agent_app,n8n_app,portal_app;
-- Публичный сайт вызывает только поиск и атомарную бронь из серверных route handlers.
-- Роль не читает таблицы и не может выполнять другие функции.
GRANT EXECUTE ON FUNCTION find_available_tables(uuid,date,time,int),create_reservation_for_table(uuid,uuid,date,time,int,text,text,char,text) TO website_app;
-- Актуальное меню голосовой агент читает напрямую, а облачный n8n — через Portal API.
GRANT EXECUTE ON FUNCTION get_current_menu(uuid,char) TO agent_app,portal_app;
-- Самовывоз: агент вызывает только местные обёртки. Часовой пояс ресторана известен
-- одной базе, поэтому вход и выход у них в местных дате и времени (db/README.md).
GRANT EXECUTE ON FUNCTION find_pickup_slots_local(uuid,jsonb,date,time,int),create_pickup_order_local(uuid,jsonb,date,time,text,text,char,text) TO agent_app;
-- До создания голосовой сессии агент читает только выбранный для ресторана движок.
GRANT EXECUTE ON FUNCTION get_agent_runtime_settings(uuid) TO agent_app;
REVOKE EXECUTE ON FUNCTION create_callback_request(uuid,text,char,text,text) FROM portal_app;
GRANT EXECUTE ON FUNCTION create_callback_request(uuid,text,char,text,text) TO agent_app;
-- Ручное удаление одной карточки сообщения: общего DELETE на callback_requests нет.
GRANT EXECUTE ON FUNCTION delete_callback_request(uuid,uuid) TO portal_app;
-- Дневная бронь столика из портала (PROJECT.md §7.3): право только у portal_app.
-- n8n_app получит его вместе с workflow бронирования — заглушек не заводим.
GRANT EXECUTE ON FUNCTION book_table_for_day(uuid,uuid,date,time,int,text,text),cancel_table_booking(uuid,uuid,date) TO portal_app;
