// Server-only helpers for the auto-post feature.
// - AI description generation (Lovable AI + Gemini fallback via ai-engine.server)
// - Image enhancement using Lovable AI Gemini image model (Nano Banana)
// - Facebook page publishing (photo + caption or plain text)
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { generateAiReply, sanitizeReply, sanitizeAiResponse } from "@/lib/ai-engine.server";

const IMAGE_ENHANCE_MODEL = "google/gemini-2.5-flash-image";

// Creative variations: each publication gets a different treatment so the same
// source image never appears identically twice. The AI may add contextual people
// using the product, combine scenes, restage lighting, etc. — while keeping the
// original subject / faces / logos / text intact.
const IMAGE_VARIATION_PROMPTS: string[] = [
  "Recreate this image as a professional Facebook advertisement. Add one or two realistic people using or enjoying the product in a natural way. Keep the original product, logos, text and colours exactly as they are. Improve lighting, sharpness and contrast. Do not change the aspect ratio.",
  "Turn this image into a lifestyle marketing shot: place the exact same subject in a warm, natural real-world scene with soft daylight. Preserve the original product, faces, text and logos untouched. Cinematic colour grading, high sharpness. Keep the aspect ratio.",
  "Compose a new professional Facebook post visual from this image. Add a subtle contextual background (workspace, home, outdoor) that matches the product. Keep the exact original subject, faces, logos and text unchanged. Boost lighting and clarity. Keep the aspect ratio.",
  "Restage this image as a premium studio product shot with tasteful shadows and reflections. Preserve the exact product, text and logos. Slight depth-of-field, vivid but realistic colours. Keep the aspect ratio.",
  "Blend this image with a matching lifestyle scene showing a happy customer interacting with the product. Do not alter the product itself, its logos or any visible text. Professional, editorial-magazine look. Keep the aspect ratio.",
  "Enhance and re-light this image for a Facebook ad: golden-hour lighting, rich contrast, gently vignetted, crisp details. Do NOT invent new elements and do NOT change the aspect ratio. Preserve original subject, faces, logos and text.",
];

function pickVariationPrompt(): string {
  return IMAGE_VARIATION_PROMPTS[Math.floor(Math.random() * IMAGE_VARIATION_PROMPTS.length)];
}

function stripDataUrl(dataUrl: string): { mime: string; base64: string } | null {
  const m = /^data:([^;]+);base64,(.+)$/.exec(dataUrl);
  if (!m) return null;
  return { mime: m[1], base64: m[2] };
}

async function downloadStorageImage(
  path: string,
): Promise<{ mime: string; base64: string; bytes: Uint8Array }> {
  if (path.startsWith("data:image/")) {
    const parsed = stripDataUrl(path);
    if (parsed) {
      const bytes = Uint8Array.from(atob(parsed.base64), (c) => c.charCodeAt(0));
      return { mime: parsed.mime, base64: parsed.base64, bytes };
    }
  }
  const { data, error } = await supabaseAdmin.storage.from("post-images").download(path);
  if (error || !data) throw new Error(`Sary tsy azo alaina: ${error?.message ?? "unknown"}`);
  const buf = new Uint8Array(await data.arrayBuffer());
  const mime = data.type || "image/jpeg";
  const base64 = btoa(Array.from(buf, (b) => String.fromCharCode(b)).join(""));
  return { mime, base64, bytes: buf };
}

/** Enhance an image via Lovable AI Gemini image model. Returns null on failure. */
export async function enhanceImage(
  mime: string,
  base64: string,
): Promise<{ mime: string; base64: string } | null> {
  const key = process.env.LOVABLE_API_KEY;
  if (!key) return null;
  try {
    const prompt = pickVariationPrompt();
    const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { "content-type": "application/json", "Lovable-API-Key": key },
      body: JSON.stringify({
        model: IMAGE_ENHANCE_MODEL,
        modalities: ["image", "text"],
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: prompt },
              { type: "image_url", image_url: { url: `data:${mime};base64,${base64}` } },
            ],
          },
        ],
      }),
    });
    if (!res.ok) {
      console.warn("[enhanceImage] gateway error", res.status, (await res.text()).slice(0, 200));
      return null;
    }
    const json: any = await res.json();
    const images = json?.choices?.[0]?.message?.images;
    const url: string | undefined = images?.[0]?.image_url?.url;
    if (!url) return null;
    const parsed = stripDataUrl(url);
    return parsed;
  } catch (e) {
    console.warn("[enhanceImage] exception", e);
    return null;
  }
}

/** Generate a persuasive Facebook post description from a title + optional image. */
export async function generatePostDescription(opts: {
  userId: string;
  title: string;
  userHint?: string | null;
  image?: { mime: string; base64: string } | null;
}): Promise<{ text: string; provider: string }> {
  const { data: customPrompt } = await supabaseAdmin
    .from("prompts")
    .select("content")
    .eq("user_id", opts.userId)
    .eq("category", "post")
    .eq("is_active", true)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const systemPrompt =
    customPrompt?.content?.trim() ||
    "Ianao dia mpanao publicité manam-pahaizana amin'ny Facebook. " +
      "Mamoaka description manintona, professionnel, mahatoky sy tena mandresy lahatra ny olona hametraka commentaire, J'aime sy handefa message privée. " +
      "Manoratra amin'ny fiteny mifanaraka amin'ny lohateny (malagasy/frantsay/anglisy). " +
      "Ampiasao emoji mifanaraka fa aza be loatra. Ampio call-to-action mazava amin'ny farany (ohatra: Commentez, Likez, Envoyez un message). " +
      "Aza mampiasa markdown *, #, ** — soraty mivantana ny lahatsoratra. " +
      "Aza mametraka lien externe. " +
      "ZAVATRA TSY MAINTSY TANDREMINA: TSY MAMETRAKA MIHITSY resaka fandinihana (thinking), drafitra, na teny Anglisy fanazavana (toy ny Hook, Value Proposition, Check, Self-Correction). Manomboka mivantana amin'ny lahatsoratra tokony havoaka izy io, tsy misy drafi-panoratana akory. " +
      "Halavany: 4 ka hatramin'ny 8 andalana, misy fiatoana mahafinaritra.";

  const hint = opts.userHint?.trim();
  const userText =
    `Lohatenin'ny publication: "${opts.title}"\n\n` +
    (hint ? `Toromarika manokana avy amin'ny tompon'ny page (arahina tsara): ${hint}\n\n` : "") +
    `Amoahy description tsara sy manintona ho amin'ity publication ity.`;

  const parts: any[] = [{ text: userText }];
  if (opts.image) {
    parts.push({ inline_data: { mime_type: opts.image.mime, data: opts.image.base64 } });
  }

  const result = await generateAiReply({
    userId: opts.userId,
    systemPrompt,
    parts,
    allowLinks: false,
    minChars: 350,
  });
  const cleaned = sanitizeAiResponse(result.text);
  return { text: sanitizeReply(cleaned, false), provider: result.provider };
}

/** Publish a post to a Facebook page. Supports 0, 1 or many images (multi-photo album post). */
export async function publishToFacebook(opts: {
  pageAccessToken: string;
  pageFbId: string;
  message: string;
  imageUrl?: string;
  imageUrls?: string[];
}): Promise<{ post_id: string }> {
  const urls = (
    opts.imageUrls?.length ? opts.imageUrls : opts.imageUrl ? [opts.imageUrl] : []
  ).filter(Boolean);

  if (urls.length === 1) {
    const body = new URLSearchParams();
    body.set("caption", opts.message);
    body.set("access_token", opts.pageAccessToken);
    body.set("url", urls[0]!);
    const res = await fetch(`https://graph.facebook.com/v21.0/${opts.pageFbId}/photos`, {
      method: "POST",
      body,
    });
    const json: any = await res.json();
    if (!res.ok || !json.id) {
      throw new Error(`Facebook photo POST échoué: ${json?.error?.message ?? res.status}`);
    }
    return { post_id: json.post_id ?? json.id };
  }

  if (urls.length > 1) {
    // Upload each photo unpublished, then attach them all to a single feed post.
    const mediaIds: string[] = [];
    for (const url of urls) {
      const body = new URLSearchParams();
      body.set("access_token", opts.pageAccessToken);
      body.set("url", url);
      body.set("published", "false");
      const res = await fetch(`https://graph.facebook.com/v21.0/${opts.pageFbId}/photos`, {
        method: "POST",
        body,
      });
      const json: any = await res.json();
      if (!res.ok || !json.id) {
        throw new Error(`Facebook photo POST échoué: ${json?.error?.message ?? res.status}`);
      }
      mediaIds.push(json.id);
    }
    const res = await fetch(`https://graph.facebook.com/v21.0/${opts.pageFbId}/feed`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        message: opts.message,
        access_token: opts.pageAccessToken,
        attached_media: mediaIds.map((id) => ({ media_fbid: id })),
      }),
    });
    const json: any = await res.json();
    if (!res.ok || !json.id) {
      throw new Error(`Facebook album POST échoué: ${json?.error?.message ?? res.status}`);
    }
    return { post_id: json.id };
  }

  const res = await fetch(`https://graph.facebook.com/v21.0/${opts.pageFbId}/feed`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ message: opts.message, access_token: opts.pageAccessToken }),
  });
  const json: any = await res.json();
  if (!res.ok || !json.id) {
    throw new Error(`Facebook feed POST échoué: ${json?.error?.message ?? res.status}`);
  }
  return { post_id: json.id };
}

/** Publish a video to a Facebook page using file_url (Facebook fetches the video itself). */
export async function publishVideoToFacebook(opts: {
  pageAccessToken: string;
  pageFbId: string;
  description: string;
  fileUrl: string;
  title?: string;
}): Promise<{ post_id: string }> {
  const body = new URLSearchParams();
  body.set("access_token", opts.pageAccessToken);
  body.set("file_url", opts.fileUrl);
  body.set("description", opts.description);
  if (opts.title) body.set("title", opts.title.slice(0, 250));
  const res = await fetch(`https://graph.facebook.com/v21.0/${opts.pageFbId}/videos`, {
    method: "POST",
    body,
  });
  const json: any = await res.json();
  if (!res.ok || !(json.id || json.post_id)) {
    throw new Error(`Facebook video POST échoué: ${json?.error?.message ?? res.status}`);
  }
  return { post_id: json.post_id ?? json.id };
}

/** Run the full publish pipeline for one scheduled post row. */
export async function runScheduledPost(
  postId: string,
): Promise<{ ok: boolean; fb_post_id?: string; error?: string }> {
  const { data: post, error } = await supabaseAdmin
    .from("scheduled_posts")
    .select("*")
    .eq("id", postId)
    .maybeSingle();
  if (error || !post) return { ok: false, error: error?.message ?? "Publication tsy hita" };

  // Mark processing
  await supabaseAdmin
    .from("scheduled_posts")
    .update({ status: "processing", last_error: null })
    .eq("id", postId);

  try {
    // Resolve target Facebook page: chosen page_id (uuid) or first connected page of the user
    let pageRow: any = null;
    if (post.page_id) {
      const { data } = await supabaseAdmin
        .from("facebook_pages")
        .select("*")
        .eq("id", post.page_id)
        .maybeSingle();
      pageRow = data;
    }
    if (!pageRow) {
      const { data } = await supabaseAdmin
        .from("facebook_pages")
        .select("*")
        .eq("user_id", post.user_id)
        .eq("is_connected", true)
        .order("created_at", { ascending: true })
        .limit(1)
        .maybeSingle();
      pageRow = data;
    }
    if (!pageRow)
      throw new Error(
        "Tsy misy pejy Facebook mifandray. Ampifandraiso aloha ao amin'ny pejy Facebook.",
      );

    // Load + optionally enhance images (only when no video attached)
    const rawPaths: string[] = (() => {
      const many = ((post as any).image_paths as string[] | null) ?? [];
      if (many.length) return many;
      return post.image_path ? [post.image_path] : [];
    })();

    let firstImage: { mime: string; base64: string } | null = null;
    const publishPaths: string[] = [];
    if (!post.video_path && rawPaths.length) {
      for (const p of rawPaths) {
        let usePath = p;
        try {
          const img = await downloadStorageImage(p);
          let current = img;
          if (post.enhance_image) {
            const enhanced = await enhanceImage(img.mime, img.base64);
            if (enhanced) {
              const bin = Uint8Array.from(atob(enhanced.base64), (c) => c.charCodeAt(0));
              current = { mime: enhanced.mime, base64: enhanced.base64, bytes: bin };
              // Upload enhanced variant so we can serve Facebook a URL (avoids huge multipart uploads).
              const outPath = `${post.user_id}/enhanced/${postId}-${Date.now()}-${publishPaths.length}.jpg`;
              const { error: upErr } = await supabaseAdmin.storage
                .from("post-images")
                .upload(outPath, bin, { contentType: enhanced.mime, upsert: true });
              if (upErr) console.warn("[runScheduledPost] enhanced upload failed", upErr.message);
              else usePath = outPath;
            }
          }
          if (!firstImage) firstImage = { mime: current.mime, base64: current.base64 };
        } catch (e) {
          console.warn("[runScheduledPost] image load failed", p, e);
        }
        publishPaths.push(usePath);
      }
    }

    // Generate description
    const { text: description } = await generatePostDescription({
      userId: post.user_id,
      title: post.title,
      userHint: (post as any).ai_prompt ?? null,
      image: firstImage,
    });

    const caption = `${post.title}\n\n${description}`.trim();

    // Publish
    let fbPostId: string;
    if (post.video_path) {
      // Get a signed URL Facebook can fetch directly (avoids streaming 1 GB from the Worker).
      const { data: signed, error: sErr } = await supabaseAdmin.storage
        .from("post-videos")
        .createSignedUrl(post.video_path, 60 * 60 * 6);
      if (sErr || !signed?.signedUrl)
        throw new Error(`Video URL indisponible: ${sErr?.message ?? "unknown"}`);
      const r = await publishVideoToFacebook({
        pageAccessToken: pageRow.page_access_token,
        pageFbId: pageRow.page_id,
        description: caption,
        fileUrl: signed.signedUrl,
        title: post.title,
      });
      fbPostId = r.post_id;
    } else {
      const imageUrls: string[] = [];
      for (const p of publishPaths) {
        if (p.startsWith("data:image/")) {
          const parsed = stripDataUrl(p);
          if (parsed) {
            const bin = Uint8Array.from(atob(parsed.base64), (c) => c.charCodeAt(0));
            const outPath = `${post.user_id}/${Date.now()}-${crypto.randomUUID()}.jpg`;
            await supabaseAdmin.storage.from("post-images").upload(outPath, bin, { contentType: parsed.mime, upsert: true });
            const { data: s } = await supabaseAdmin.storage.from("post-images").createSignedUrl(outPath, 60 * 60);
            if (s?.signedUrl) imageUrls.push(s.signedUrl);
          }
        } else {
          const { data: signed, error: sErr } = await supabaseAdmin.storage
            .from("post-images")
            .createSignedUrl(p, 60 * 60);
          if (sErr || !signed?.signedUrl) {
            throw new Error(`Image URL indisponible: ${sErr?.message ?? "unknown"}`);
          }
          imageUrls.push(signed.signedUrl);
        }
      }
      const r = await publishToFacebook({
        pageAccessToken: pageRow.page_access_token,
        pageFbId: pageRow.page_id,
        message: caption,
        imageUrls,
      });
      fbPostId = r.post_id;
    }

    // Compute next run based on frequency
    const now = new Date();
    let nextScheduled: string | null = null;
    let nextStatus = "published";
    if (post.frequency === "daily") {
      const next = new Date(post.scheduled_at);
      // Advance to the next occurrence strictly in the future
      while (next.getTime() <= now.getTime()) {
        next.setDate(next.getDate() + 1);
      }
      nextScheduled = next.toISOString();
      nextStatus = "pending";
    }

    await supabaseAdmin
      .from("scheduled_posts")
      .update({
        status: nextStatus,
        last_published_at: now.toISOString(),
        fb_post_id: fbPostId,
        ai_description: description,
        last_error: null,
        ...(nextScheduled ? { scheduled_at: nextScheduled } : {}),
      })
      .eq("id", postId);

    return { ok: true, fb_post_id: fbPostId };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    await supabaseAdmin
      .from("scheduled_posts")
      .update({ status: "failed", last_error: message.slice(0, 500) })
      .eq("id", postId);
    return { ok: false, error: message };
  }
}
