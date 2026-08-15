DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='n8n_app') THEN CREATE ROLE n8n_app LOGIN; END IF; IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='portal_app') THEN CREATE ROLE portal_app LOGIN; END IF; END $$;
DO $$ BEGIN EXECUTE format('GRANT CONNECT ON DATABASE %I TO n8n_app, portal_app',current_database()); END $$;
GRANT USAGE ON SCHEMA public TO n8n_app,portal_app; REVOKE CREATE ON SCHEMA public FROM PUBLIC; REVOKE ALL ON ALL TABLES IN SCHEMA public FROM n8n_app;
GRANT SELECT,INSERT,UPDATE ON ALL TABLES IN SCHEMA public TO portal_app; REVOKE ALL ON TABLE schema_migrations FROM portal_app;
ALTER DEFAULT PRIVILEGES FOR ROLE app_owner IN SCHEMA public GRANT SELECT,INSERT,UPDATE ON TABLES TO portal_app;
ALTER DEFAULT PRIVILEGES FOR ROLE app_owner IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC;
GRANT EXECUTE ON FUNCTION find_available_slots(uuid,date,int,time,int),create_reservation_atomic(uuid,timestamptz,int,text,text,char,text),cancel_reservation_by_phone(uuid,text,date),find_menu_items(uuid,text,char,bool,bool,text[],int),find_pickup_slots(uuid,timestamptz,int,int),create_pickup_order_atomic(uuid,jsonb,timestamptz,text,text,char,text),create_callback_request(uuid,text,char,text,text) TO n8n_app,portal_app;
REVOKE EXECUTE ON FUNCTION create_callback_request(uuid,text,char,text,text) FROM portal_app;
