-- US-095: preserve distinct provenance for audited manual register entry.
ALTER TYPE public.license_assignment_source_kind_enum ADD VALUE IF NOT EXISTS 'manual';
