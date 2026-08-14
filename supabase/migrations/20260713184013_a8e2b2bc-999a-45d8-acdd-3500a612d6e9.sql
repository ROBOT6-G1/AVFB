REVOKE EXECUTE ON FUNCTION public.verify_facebook_webhook_token(TEXT) FROM anon;
REVOKE EXECUTE ON FUNCTION public.verify_facebook_webhook_token(TEXT) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.verify_facebook_webhook_token(TEXT) TO service_role;