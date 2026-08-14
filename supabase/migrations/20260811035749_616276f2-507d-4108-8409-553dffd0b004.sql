ALTER TABLE public.prompts ADD COLUMN IF NOT EXISTS page_ids text[] NOT NULL DEFAULT '{}'::text[];
UPDATE public.prompts SET page_ids = ARRAY[page_id] WHERE page_id IS NOT NULL AND (page_ids IS NULL OR array_length(page_ids,1) IS NULL);
CREATE INDEX IF NOT EXISTS idx_prompts_page_ids ON public.prompts USING gin (page_ids);
ALTER TABLE public.scheduled_posts ADD COLUMN IF NOT EXISTS image_paths text[] NOT NULL DEFAULT '{}'::text[];
UPDATE public.scheduled_posts SET image_paths = ARRAY[image_path] WHERE image_path IS NOT NULL AND (image_paths IS NULL OR array_length(image_paths,1) IS NULL);