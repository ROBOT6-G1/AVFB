CREATE INDEX IF NOT EXISTS idx_settings_facebook_verify_token
ON public.settings (facebook_verify_token)
WHERE facebook_verify_token IS NOT NULL;

CREATE OR REPLACE FUNCTION public.verify_facebook_webhook_token(_token TEXT)
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.settings
    WHERE facebook_verify_token = btrim(_token)
      AND facebook_verify_token IS NOT NULL
      AND btrim(facebook_verify_token) <> ''
  );
$$;

GRANT EXECUTE ON FUNCTION public.verify_facebook_webhook_token(TEXT) TO anon;
GRANT EXECUTE ON FUNCTION public.verify_facebook_webhook_token(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.verify_facebook_webhook_token(TEXT) TO service_role;