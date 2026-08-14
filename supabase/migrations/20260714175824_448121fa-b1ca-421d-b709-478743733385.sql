ALTER TABLE public.prompts
  ADD COLUMN IF NOT EXISTS page_id text,
  ADD COLUMN IF NOT EXISTS assistance_type text;

CREATE INDEX IF NOT EXISTS prompts_user_page_idx ON public.prompts(user_id, page_id);
CREATE INDEX IF NOT EXISTS prompts_user_type_idx ON public.prompts(user_id, assistance_type);