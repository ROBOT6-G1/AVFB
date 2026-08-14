ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS client_address text;
ALTER TABLE public.client_ia_state ADD COLUMN IF NOT EXISTS product_image_offsets jsonb NOT NULL DEFAULT '{}'::jsonb;