ALTER TABLE public.license_request
ADD COLUMN client_request_id uuid;

UPDATE public.license_request
SET client_request_id = id
WHERE client_request_id IS NULL;

ALTER TABLE public.license_request
ALTER COLUMN client_request_id SET NOT NULL;

ALTER TABLE public.license_request
ALTER COLUMN client_request_id SET DEFAULT gen_random_uuid();

ALTER TABLE public.license_request
ADD CONSTRAINT uq_license_request_requester_client_request
UNIQUE (requested_by, client_request_id);
