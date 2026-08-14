
ALTER TABLE public.scheduled_posts ADD COLUMN IF NOT EXISTS video_path text;

CREATE POLICY "post-videos owner select" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'post-videos' AND (storage.foldername(name))[1] = auth.uid()::text);
CREATE POLICY "post-videos owner insert" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'post-videos' AND (storage.foldername(name))[1] = auth.uid()::text);
CREATE POLICY "post-videos owner update" ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'post-videos' AND (storage.foldername(name))[1] = auth.uid()::text);
CREATE POLICY "post-videos owner delete" ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'post-videos' AND (storage.foldername(name))[1] = auth.uid()::text);
