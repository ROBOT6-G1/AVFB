ALTER TABLE public.settings
  ADD COLUMN IF NOT EXISTS facebook_app_id TEXT,
  ADD COLUMN IF NOT EXISTS facebook_app_secret TEXT,
  ADD COLUMN IF NOT EXISTS facebook_verify_token TEXT;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.settings TO authenticated;
GRANT ALL ON public.settings TO service_role;

CREATE INDEX IF NOT EXISTS idx_settings_facebook_app_id
ON public.settings (facebook_app_id)
WHERE facebook_app_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_settings_facebook_verify_token
ON public.settings (facebook_verify_token)
WHERE facebook_verify_token IS NOT NULL;