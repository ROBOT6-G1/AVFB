REVOKE ALL ON FUNCTION public.verify_facebook_webhook_token(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.verify_facebook_webhook_token(TEXT) TO service_role;