
ALTER TABLE public.settings
  ADD COLUMN IF NOT EXISTS assistance_type TEXT NOT NULL DEFAULT 'online_work' CHECK (assistance_type IN ('online_work','training','sales')),
  ADD COLUMN IF NOT EXISTS global_ia_stopped BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS public.payment_methods (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  number TEXT NOT NULL,
  instructions TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.payment_methods TO authenticated;
GRANT ALL ON public.payment_methods TO service_role;
ALTER TABLE public.payment_methods ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own payment_methods" ON public.payment_methods FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE TRIGGER trg_pm_updated BEFORE UPDATE ON public.payment_methods FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE IF NOT EXISTS public.trainings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  pricing_type TEXT NOT NULL CHECK (pricing_type IN ('free','paid')),
  price NUMERIC(12,2),
  payment_flow TEXT CHECK (payment_flow IN ('admin_numbers','client_contact')),
  video_link TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.trainings TO authenticated;
GRANT ALL ON public.trainings TO service_role;
ALTER TABLE public.trainings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own trainings" ON public.trainings FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE TRIGGER trg_tr_updated BEFORE UPDATE ON public.trainings FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE IF NOT EXISTS public.training_files (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  training_id UUID NOT NULL REFERENCES public.trainings(id) ON DELETE CASCADE,
  file_path TEXT,
  file_type TEXT NOT NULL CHECK (file_type IN ('video','pdf','document','link')),
  file_name TEXT NOT NULL,
  size_bytes BIGINT,
  external_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.training_files TO authenticated;
GRANT ALL ON public.training_files TO service_role;
ALTER TABLE public.training_files ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own training_files" ON public.training_files FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE TABLE IF NOT EXISTS public.products (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  price NUMERIC(12,2) NOT NULL DEFAULT 0,
  stock INTEGER NOT NULL DEFAULT 0,
  description TEXT,
  payment_flow TEXT NOT NULL DEFAULT 'admin_numbers' CHECK (payment_flow IN ('admin_numbers','client_contact')),
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.products TO authenticated;
GRANT ALL ON public.products TO service_role;
ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own products" ON public.products FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE TRIGGER trg_pr_updated BEFORE UPDATE ON public.products FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE IF NOT EXISTS public.product_images (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  image_path TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.product_images TO authenticated;
GRANT ALL ON public.product_images TO service_role;
ALTER TABLE public.product_images ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own product_images" ON public.product_images FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE TABLE IF NOT EXISTS public.orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('training','sales')),
  training_id UUID REFERENCES public.trainings(id) ON DELETE SET NULL,
  product_id UUID REFERENCES public.products(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','awaiting_payment','payment_sent','accepted','refused','delivered')),
  client_fb_id TEXT,
  client_fb_name TEXT,
  client_whatsapp TEXT,
  client_phone TEXT,
  payment_reference TEXT,
  quantity INTEGER NOT NULL DEFAULT 1,
  notes TEXT,
  page_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.orders TO authenticated;
GRANT ALL ON public.orders TO service_role;
ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own orders" ON public.orders FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE TRIGGER trg_or_updated BEFORE UPDATE ON public.orders FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE IF NOT EXISTS public.client_ia_state (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  page_id TEXT NOT NULL,
  client_fb_id TEXT NOT NULL,
  client_fb_name TEXT,
  ia_stopped BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(user_id, page_id, client_fb_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.client_ia_state TO authenticated;
GRANT ALL ON public.client_ia_state TO service_role;
ALTER TABLE public.client_ia_state ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own client_ia_state" ON public.client_ia_state FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE TRIGGER trg_cs_updated BEFORE UPDATE ON public.client_ia_state FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Storage policies (buckets created via storage tool)
DROP POLICY IF EXISTS "training own read" ON storage.objects;
CREATE POLICY "training own read" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'training-files' AND (storage.foldername(name))[1] = auth.uid()::text);
DROP POLICY IF EXISTS "training own write" ON storage.objects;
CREATE POLICY "training own write" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'training-files' AND (storage.foldername(name))[1] = auth.uid()::text);
DROP POLICY IF EXISTS "training own delete" ON storage.objects;
CREATE POLICY "training own delete" ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'training-files' AND (storage.foldername(name))[1] = auth.uid()::text);

DROP POLICY IF EXISTS "product img own read" ON storage.objects;
CREATE POLICY "product img own read" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'product-images' AND (storage.foldername(name))[1] = auth.uid()::text);
DROP POLICY IF EXISTS "product img own write" ON storage.objects;
CREATE POLICY "product img own write" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'product-images' AND (storage.foldername(name))[1] = auth.uid()::text);
DROP POLICY IF EXISTS "product img own delete" ON storage.objects;
CREATE POLICY "product img own delete" ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'product-images' AND (storage.foldername(name))[1] = auth.uid()::text);
