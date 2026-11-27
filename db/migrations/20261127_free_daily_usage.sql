-- Apply to the isolated quota pilot database first.
-- The application's restricted role needs USAGE on the schema and
-- SELECT, INSERT, UPDATE on this table. Grant these to the pilot role only.
CREATE SCHEMA IF NOT EXISTS nexlupa_quota;

CREATE TABLE IF NOT EXISTS nexlupa_quota.daily_text_usage (
  issuer text NOT NULL,
  subject text NOT NULL,
  usage_date date NOT NULL,
  used integer NOT NULL CHECK (used BETWEEN 1 AND 3),
  PRIMARY KEY (issuer, subject, usage_date)
);

REVOKE ALL ON SCHEMA nexlupa_quota FROM PUBLIC;
REVOKE ALL ON TABLE nexlupa_quota.daily_text_usage FROM PUBLIC;
