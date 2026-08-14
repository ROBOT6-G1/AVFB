
CREATE TYPE public.app_role AS ENUM ('admin', 'user');

CREATE TABLE public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT, display_name TEXT, avatar_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.profiles TO authenticated;
GRANT ALL ON public.profiles TO service_role;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own profile" ON public.profiles FOR ALL USING (auth.uid() = id) WITH CHECK (auth.uid() = id);

CREATE TABLE public.user_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role public.app_role NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, role)
);
GRANT SELECT ON public.user_roles TO authenticated;
GRANT ALL ON public.user_roles TO service_role;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users read own roles" ON public.user_roles FOR SELECT USING (auth.uid() = user_id);

CREATE OR REPLACE FUNCTION public.has_role(_user_id UUID, _role public.app_role)
RETURNS BOOLEAN LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public
AS $$ SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role); $$;

CREATE TABLE public.prompts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL, content TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'global' CHECK (category IN ('global','message','comment','md','tutorial','post')),
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.prompts TO authenticated;
GRANT ALL ON public.prompts TO service_role;
ALTER TABLE public.prompts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own prompts" ON public.prompts FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE TABLE public.gemini_keys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  label TEXT NOT NULL, api_key TEXT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT true,
  last_used_at TIMESTAMPTZ, error_count INT NOT NULL DEFAULT 0, disabled_until TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.gemini_keys TO authenticated;
GRANT ALL ON public.gemini_keys TO service_role;
ALTER TABLE public.gemini_keys ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own gemini keys" ON public.gemini_keys FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE TABLE public.facebook_pages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  page_id TEXT NOT NULL, page_name TEXT NOT NULL,
  page_access_token TEXT NOT NULL, user_access_token TEXT, token_expires_at TIMESTAMPTZ,
  is_connected BOOLEAN NOT NULL DEFAULT true, webhook_subscribed BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, page_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.facebook_pages TO authenticated;
GRANT ALL ON public.facebook_pages TO service_role;
ALTER TABLE public.facebook_pages ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own pages" ON public.facebook_pages FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE TABLE public.messages_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  page_id TEXT NOT NULL, sender_id TEXT NOT NULL, sender_name TEXT,
  direction TEXT NOT NULL CHECK (direction IN ('incoming','outgoing')),
  content TEXT, media_type TEXT, media_url TEXT, ai_response TEXT,
  status TEXT NOT NULL DEFAULT 'ok',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.messages_log TO authenticated;
GRANT ALL ON public.messages_log TO service_role;
ALTER TABLE public.messages_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users read own messages log" ON public.messages_log FOR SELECT USING (auth.uid() = user_id);
CREATE INDEX ON public.messages_log (user_id, created_at DESC);

CREATE TABLE public.comments_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  page_id TEXT NOT NULL, post_id TEXT NOT NULL, comment_id TEXT NOT NULL UNIQUE,
  author_id TEXT, author_name TEXT, content TEXT,
  replied BOOLEAN NOT NULL DEFAULT false, ai_response TEXT, replied_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.comments_log TO authenticated;
GRANT ALL ON public.comments_log TO service_role;
ALTER TABLE public.comments_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users read own comments log" ON public.comments_log FOR SELECT USING (auth.uid() = user_id);
CREATE INDEX ON public.comments_log (user_id, created_at DESC);

CREATE TABLE public.settings (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  auto_reply_messages BOOLEAN NOT NULL DEFAULT true,
  auto_reply_comments BOOLEAN NOT NULL DEFAULT true,
  comment_scan_interval_minutes INT NOT NULL DEFAULT 5,
  use_lovable_ai_fallback BOOLEAN NOT NULL DEFAULT true,
  default_model TEXT NOT NULL DEFAULT 'gemini-2.5-flash',
  private_message_link TEXT,
  facebook_app_id TEXT,
  facebook_app_secret TEXT,
  facebook_verify_token TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.settings TO authenticated;
GRANT ALL ON public.settings TO service_role;
ALTER TABLE public.settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own settings" ON public.settings FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE TABLE public.scheduled_posts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  page_id UUID REFERENCES public.facebook_pages(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  image_path TEXT, image_url TEXT, ai_description TEXT,
  scheduled_at TIMESTAMPTZ NOT NULL,
  frequency TEXT NOT NULL DEFAULT 'once' CHECK (frequency IN ('once','daily')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','processing','published','failed','cancelled')),
  last_published_at TIMESTAMPTZ, last_error TEXT, fb_post_id TEXT,
  enhance_image BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.scheduled_posts TO authenticated;
GRANT ALL ON public.scheduled_posts TO service_role;
ALTER TABLE public.scheduled_posts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own scheduled posts" ON public.scheduled_posts FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE INDEX ON public.scheduled_posts (scheduled_at, status);
CREATE INDEX ON public.scheduled_posts (user_id, created_at DESC);

CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;

CREATE TRIGGER trg_profiles_updated BEFORE UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER trg_prompts_updated BEFORE UPDATE ON public.prompts FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER trg_gemini_keys_updated BEFORE UPDATE ON public.gemini_keys FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER trg_facebook_pages_updated BEFORE UPDATE ON public.facebook_pages FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER trg_settings_updated BEFORE UPDATE ON public.settings FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER trg_scheduled_posts_updated BEFORE UPDATE ON public.scheduled_posts FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.profiles (id, email, display_name, avatar_url)
  VALUES (NEW.id, NEW.email, COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.raw_user_meta_data->>'name', NEW.email), NEW.raw_user_meta_data->>'avatar_url');
  INSERT INTO public.settings (user_id) VALUES (NEW.id) ON CONFLICT DO NOTHING;
  INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'admin') ON CONFLICT DO NOTHING;
  RETURN NEW;
END; $$;

CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users
FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.has_role(UUID, public.app_role) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.has_role(UUID, public.app_role) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.set_updated_at() FROM PUBLIC, anon, authenticated;
