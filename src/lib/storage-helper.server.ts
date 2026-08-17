import { supabaseAdmin } from "@/integrations/supabase/client.server";
import fs from "fs";
import path from "path";

const APP_URL =
  process.env.APP_URL ||
  process.env.PUBLIC_URL ||
  "https://ais-dev-i7b5jeeh6qqkeyb3nv4dw4-469517843202.europe-west2.run.app";

export interface UploadOptions {
  userId: string;
  bucket: "product-images" | "training-files" | "post-images" | "media";
  fileName: string;
  contentType: string;
  buffer: Buffer;
  folder?: string;
}

/**
 * Ensures bucket exists in Supabase Storage with public access enabled.
 */
async function ensureSupabaseBucket(supabaseUrl: string, supabaseKey: string, bucketName: string) {
  try {
    const listRes = await fetch(`${supabaseUrl}/storage/v1/bucket`, {
      headers: {
        Authorization: `Bearer ${supabaseKey}`,
        apikey: supabaseKey,
      },
    });
    if (listRes.ok) {
      const buckets = (await listRes.json()) as any[];
      const exists = buckets.some((b) => b.name === bucketName || b.id === bucketName);
      if (!exists) {
        await fetch(`${supabaseUrl}/storage/v1/bucket`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${supabaseKey}`,
            apikey: supabaseKey,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            id: bucketName,
            name: bucketName,
            public: true,
            file_size_limit: 104857600, // 100MB
          }),
        });
      }
    }
  } catch (e) {
    console.warn(`[ensureSupabaseBucket] check/create warning for ${bucketName}:`, e);
  }
}

/**
 * Uploads a file (image, video, PDF) to Supabase Storage and returns the permanent public URL.
 * Falls back to local public disk storage if Supabase is not connected.
 */
export async function uploadMediaFile({
  userId,
  bucket,
  fileName,
  contentType,
  buffer,
  folder,
}: UploadOptions): Promise<string> {
  const safeName = fileName.replace(/[^\w.-]/g, "_");
  const subFolder = folder ? `${folder}/` : "";
  const uniqueKey = `${userId}/${subFolder}${Date.now()}-${crypto.randomUUID().slice(0, 8)}-${safeName}`;

  // 1. Check if user has active Supabase settings or OAuth connection
  let sbUrl: string | null = null;
  let sbKey: string | null = null;

  try {
    const { data: settings } = await supabaseAdmin
      .from("settings")
      .select("supabase_project_url,supabase_anon_key,supabase_connected")
      .eq("user_id", userId)
      .maybeSingle();

    if (settings?.supabase_project_url && settings?.supabase_anon_key) {
      sbUrl = settings.supabase_project_url.replace(/\/$/, "");
      sbKey = settings.supabase_anon_key.trim();
    } else {
      const { data: conn } = await supabaseAdmin
        .from("supabase_oauth_connections")
        .select("selected_project_url,access_token,projects")
        .eq("user_id", userId)
        .maybeSingle();

      if (conn?.selected_project_url) {
        sbUrl = conn.selected_project_url.replace(/\/$/, "");
        const proj = (conn.projects as any[])?.find((p) => p.project_url === conn.selected_project_url);
        sbKey = proj?.anon_key || conn.access_token;
      }
    }
  } catch (e) {
    console.warn("[uploadMediaFile] settings lookup error:", e);
  }

  // 2. Upload to Supabase Storage REST API
  if (sbUrl && sbKey) {
    try {
      await ensureSupabaseBucket(sbUrl, sbKey, bucket);

      const uploadEndpoint = `${sbUrl}/storage/v1/object/${bucket}/${encodeURIComponent(uniqueKey)}`;
      const res = await fetch(uploadEndpoint, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${sbKey}`,
          apikey: sbKey,
          "Content-Type": contentType || "application/octet-stream",
          "x-upsert": "true",
        },
        body: buffer,
      });

      if (res.ok) {
        const publicUrl = `${sbUrl}/storage/v1/object/public/${bucket}/${uniqueKey}`;
        return publicUrl;
      } else {
        const errTxt = await res.text();
        console.warn(`[uploadMediaFile] Supabase Storage upload failed (${res.status}): ${errTxt}`);
      }
    } catch (sbErr) {
      console.warn("[uploadMediaFile] Supabase Storage network error:", sbErr);
    }
  }

  // 3. Fallback: Local public filesystem storage
  try {
    const uploadDir = path.join(process.cwd(), "public", "uploads");
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    const localFileName = `${Date.now()}-${crypto.randomUUID().slice(0, 8)}-${safeName}`;
    const localFilePath = path.join(uploadDir, localFileName);
    fs.writeFileSync(localFilePath, buffer);

    const publicUrl = `${APP_URL}/uploads/${localFileName}`;
    return publicUrl;
  } catch (fsErr) {
    console.error("[uploadMediaFile] Local filesystem write error:", fsErr);
    // Absolute last resort: Data URL
    return `data:${contentType};base64,${buffer.toString("base64")}`;
  }
}
