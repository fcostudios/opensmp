-- US-071: exact revisable daily person costs; preserve the existing natural key.
ALTER TABLE cost_record ADD COLUMN source ingestion_source NOT NULL DEFAULT 'api';
GRANT UPDATE (amount_usd, raw_payload, source, synced_at) ON cost_record TO ledger_app;
