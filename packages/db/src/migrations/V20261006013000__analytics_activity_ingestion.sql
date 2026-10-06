-- US-070: ingestion is independent of provisioning mode; existing accounts opt in.
CREATE TYPE ingestion_source AS ENUM ('api', 'csv_import', 'manual');
ALTER TABLE vendor_account ADD COLUMN ingestion_mode ingestion_source NOT NULL DEFAULT 'manual';
ALTER TABLE activity_record ADD COLUMN source ingestion_source NOT NULL DEFAULT 'api';
GRANT UPDATE (counters, raw_payload, source, synced_at) ON activity_record TO ledger_app;
