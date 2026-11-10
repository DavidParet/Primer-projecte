-- ONLY for disposable postgres:17 GitHub Actions service container.
-- Creates ephemeral roles and synthetic data. NEVER run on Neon or production.
\set ON_ERROR_STOP on
CREATE ROLE nexlupa_ci_family_a NOLOGIN NOSUPERUSER NOBYPASSRLS;
CREATE ROLE nexlupa_ci_family_b NOLOGIN NOSUPERUSER NOBYPASSRLS;

CREATE SCHEMA whatsapp_ci;
CREATE TABLE whatsapp_ci.inbound (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  family_id uuid NOT NULL,
  message_body text NOT NULL
);
INSERT INTO whatsapp_ci.inbound (family_id,message_body) VALUES
  ('11111111-1111-4111-8111-111111111111','synthetic-A'),
  ('22222222-2222-4222-8222-222222222222','synthetic-B');

GRANT USAGE ON SCHEMA whatsapp_ci TO nexlupa_ci_family_a, nexlupa_ci_family_b;
GRANT SELECT, UPDATE, INSERT ON whatsapp_ci.inbound TO nexlupa_ci_family_a, nexlupa_ci_family_b;
GRANT USAGE ON SEQUENCE whatsapp_ci.inbound_id_seq TO nexlupa_ci_family_a, nexlupa_ci_family_b;

ALTER TABLE whatsapp_ci.inbound ENABLE ROW LEVEL SECURITY;
ALTER TABLE whatsapp_ci.inbound FORCE ROW LEVEL SECURITY;

CREATE POLICY family_a_read ON whatsapp_ci.inbound
  FOR SELECT TO nexlupa_ci_family_a
  USING (family_id = '11111111-1111-4111-8111-111111111111');
CREATE POLICY family_b_read ON whatsapp_ci.inbound
  FOR SELECT TO nexlupa_ci_family_b
  USING (family_id = '22222222-2222-4222-8222-222222222222');
CREATE POLICY family_a_modify ON whatsapp_ci.inbound
  FOR UPDATE TO nexlupa_ci_family_a
  USING (family_id = '11111111-1111-4111-8111-111111111111')
  WITH CHECK (family_id = '11111111-1111-4111-8111-111111111111');
CREATE POLICY family_b_modify ON whatsapp_ci.inbound
  FOR UPDATE TO nexlupa_ci_family_b
  USING (family_id = '22222222-2222-4222-8222-222222222222')
  WITH CHECK (family_id = '22222222-2222-4222-8222-222222222222');
CREATE POLICY family_a_insert ON whatsapp_ci.inbound
  FOR INSERT TO nexlupa_ci_family_a
  WITH CHECK (family_id = '11111111-1111-4111-8111-111111111111');
CREATE POLICY family_b_insert ON whatsapp_ci.inbound
  FOR INSERT TO nexlupa_ci_family_b
  WITH CHECK (family_id = '22222222-2222-4222-8222-222222222222');

SET ROLE nexlupa_ci_family_a;
DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM whatsapp_ci.inbound;
  IF n <> 1 THEN RAISE EXCEPTION 'Family A must see exactly one row, saw %', n; END IF;
  IF EXISTS(SELECT 1 FROM whatsapp_ci.inbound WHERE family_id='22222222-2222-4222-8222-222222222222')
    THEN RAISE EXCEPTION 'Family A can read B'; END IF;
  UPDATE whatsapp_ci.inbound SET message_body='forbidden' WHERE family_id='22222222-2222-4222-8222-222222222222';
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 0 THEN RAISE EXCEPTION 'Family A modified B'; END IF;
  BEGIN
    INSERT INTO whatsapp_ci.inbound (family_id,message_body)
    VALUES('22222222-2222-4222-8222-222222222222','forbidden');
    RAISE EXCEPTION 'Family A inserted B';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END $$;
RESET ROLE;

SET ROLE nexlupa_ci_family_b;
DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM whatsapp_ci.inbound;
  IF n <> 1 THEN RAISE EXCEPTION 'Family B must see exactly one row, saw %', n; END IF;
  IF EXISTS(SELECT 1 FROM whatsapp_ci.inbound WHERE family_id='11111111-1111-4111-8111-111111111111')
    THEN RAISE EXCEPTION 'Family B can read A'; END IF;
  UPDATE whatsapp_ci.inbound SET message_body='forbidden' WHERE family_id='11111111-1111-4111-8111-111111111111';
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 0 THEN RAISE EXCEPTION 'Family B modified A'; END IF;
  BEGIN
    INSERT INTO whatsapp_ci.inbound (family_id,message_body)
    VALUES('11111111-1111-4111-8111-111111111111','forbidden');
    RAISE EXCEPTION 'Family B inserted A';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END $$;
RESET ROLE;

DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM whatsapp_ci.inbound;
  IF n <> 2 THEN RAISE EXCEPTION 'Synthetic data unexpectedly changed, count %', n; END IF;
END $$;

SELECT 'isolated two-family RLS smoke test passed (disposable CI only)' AS result;
