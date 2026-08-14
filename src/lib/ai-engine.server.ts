// Server-only AI engine: Lovable AI par défaut + rotation Gemini en fallback.
import { supabaseAdmin } from "@/integrations/supabase/client.server";

const GEMINI_MODEL = "gemini-2.5-flash";
const LOVABLE_MODEL = "google/gemini-2.5-flash";
const INCOMING_DIRECTION = "incoming";
const OUTGOING_DIRECTION = "outgoing";
const MESSENGER_TEXT_LIMIT = 1800;

export type AiPart = { text: string } | { inline_data: { mime_type: string; data: string } };

export type ChatTurn = { role: "user" | "assistant"; text: string };

function directionToRole(direction: string): ChatTurn["role"] {
  return direction === OUTGOING_DIRECTION || direction === "out" ? "assistant" : "user";
}

async function insertMessageLog(payload: any, label: string) {
  const { error } = await supabaseAdmin.from("messages_log").insert(payload);
  if (error) {
    console.error(`[messages_log:${label}]`, error.message);
  }
}

/** Sanitize response: strip markdown but PRESERVE URLs exactly (including _ - . chars). */
export function sanitizeReply(text: string, allowLinks = false): string {
  // 1. Extract URLs first so replacements below never touch them.
  const urlRegex = /(https?:\/\/[^\s<>()"']+|www\.[^\s<>()"']+)/gi;
  const urls: string[] = [];
  let t = text.replace(urlRegex, (m) => {
    urls.push(m);
    return `\u0000URL${urls.length - 1}\u0000`;
  });

  t = t
    .replace(/[*#`_>]+/g, "")
    .replace(/\r/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  if (allowLinks) {
    // Restore URLs exactly as the AI produced them.
    t = t.replace(/\u0000URL(\d+)\u0000/g, (_, i) => urls[Number(i)] ?? "");
  } else {
    t = t.replace(/\u0000URL\d+\u0000/g, "");
    t = t.replace(/[ \t]{2,}/g, " ").trim();
  }
  return t;
}

export function containsLink(text: string): boolean {
  return /(https?:\/\/|www\.)/i.test(text);
}

function getTextFromParts(parts: AiPart[]): string {
  return parts
    .map((p) => ("text" in p ? p.text : "[sary]"))
    .join("\n")
    .trim();
}

function appendClarityInstructions(systemPrompt: string): string {
  return `${systemPrompt}\n\nDIRECTIVES DE PERTINENCE ET CLARTÉ :\n- Réponds DIRECTEMENT et PRÉCISÉMENT à la question du client sans verbiage inutile.\n- Reste concis, clair, naturel et chaleureux.\n- Interdiction absolue d'afficher des réflexions, analyses, brouillons ou balises 'Thinking'.`;
}

function looksTruncated(text: string): boolean {
  const cleaned = text.trim();
  if (!cleaned) return true;
  if (/[.!?…:)]$/.test(cleaned)) return false;
  return /\b(ary|fa|ka|dia|satria|raha|avec|de|du|des|et|ou|pour|par|sur|amin'ny|momba ny)$/i.test(
    cleaned,
  );
}

async function retryTruncatedReply(opts: {
  userId: string;
  systemPrompt: string;
  history: ChatTurn[];
  parts: AiPart[];
  currentReply: string;
  allowLinks?: boolean;
}): Promise<{ raw: string; provider: string } | null> {
  const retryPrompt =
    "Tohizo na avereno feno amin'ny fomba mazava sy fohy ny valiny teo aloha izay toa tapaka. Aza mampiasa teny fampidirana na fandinihana (thinking).\n\n" +
    `Valiny tapaka:\n"""${opts.currentReply}"""`;
  const retryParts: AiPart[] = [...opts.parts, { text: retryPrompt }];
  const strictPrompt = appendClarityInstructions(opts.systemPrompt);

  const { data: settings } = await supabaseAdmin
    .from("settings")
    .select("use_lovable_ai_fallback,default_model")
    .eq("user_id", opts.userId)
    .maybeSingle();
  const lovableEnabled = settings?.use_lovable_ai_fallback ?? true;
  const modelToUse = settings?.default_model || "gemini-2.5-flash";

  if (lovableEnabled) {
    try {
      return {
        raw: await callLovableAi(strictPrompt, opts.history, retryParts),
        provider: "lovable-ai:completed",
      };
    } catch (e) {
      console.warn(
        "[Lovable AI retry] fallback vers Gemini:",
        e instanceof Error ? e.message : e,
      );
    }
  }

  for (let attempt = 0; attempt < 3; attempt++) {
    const key = await pickGeminiKey(opts.userId);
    if (!key) break;
    try {
      const raw = await callGemini(key.api_key, strictPrompt, opts.history, retryParts, modelToUse);
      await markKeyUsed(key.id);
      return { raw, provider: `gemini:${key.label}:completed` };
    } catch (e) {
      console.error("[Gemini retry] error", key.label, e);
      await markKeyError(key.id, key.error_count ?? 0);
    }
  }

  return null;
}

export function splitMessengerText(text: string, maxLength = MESSENGER_TEXT_LIMIT): string[] {
  const normalized = text.replace(/\r/g, "").trim();
  if (!normalized) return [];
  if (normalized.length <= maxLength) return [normalized];

  const chunks: string[] = [];
  let remaining = normalized;
  while (remaining.length > maxLength) {
    const window = remaining.slice(0, maxLength + 1);
    const breakpoints = ["\n\n", "\n", ". ", "! ", "? ", "; ", ", ", " "];
    let splitAt = -1;
    for (const bp of breakpoints) {
      const idx = window.lastIndexOf(bp);
      if (idx >= Math.floor(maxLength * 0.55)) {
        splitAt = idx + bp.length;
        break;
      }
    }
    if (splitAt <= 0) splitAt = maxLength;
    chunks.push(remaining.slice(0, splitAt).trim());
    remaining = remaining.slice(splitAt).trim();
  }
  if (remaining) chunks.push(remaining);
  return chunks.filter(Boolean);
}

async function pickGeminiKey(userId: string) {
  const { data: keys } = await supabaseAdmin
    .from("gemini_keys")
    .select("*")
    .eq("user_id", userId)
    .eq("is_active", true);

  if (!keys || keys.length === 0) return null;

  const now = Date.now();
  // Filter out keys disabled_until in the future
  const available = keys.filter((k: any) => {
    if (!k.disabled_until) return true;
    return new Date(k.disabled_until).getTime() <= now;
  });

  const listToUse = available.length > 0 ? available : keys;

  // Sort by last_used_at ascending (nulls / oldest first)
  listToUse.sort((a: any, b: any) => {
    if (!a.last_used_at && !b.last_used_at) return 0;
    if (!a.last_used_at) return -1;
    if (!b.last_used_at) return 1;
    return new Date(a.last_used_at).getTime() - new Date(b.last_used_at).getTime();
  });

  return listToUse[0] ?? null;
}

async function markKeyUsed(id: string) {
  await supabaseAdmin
    .from("gemini_keys")
    .update({ last_used_at: new Date().toISOString(), error_count: 0, disabled_until: null })
    .eq("id", id);
}

async function markKeyError(id: string, currentErrors: number) {
  const next = currentErrors + 1;
  const disabled = next >= 5 ? new Date(Date.now() + 10 * 60 * 1000).toISOString() : null;
  await supabaseAdmin
    .from("gemini_keys")
    .update({ error_count: next, disabled_until: disabled })
    .eq("id", id);
}

/** Auto-detect available Gemini models dynamically from the Google Gemini API key */
export async function fetchAvailableGeminiModels(apiKey: string): Promise<{ ok: boolean; models: string[]; error?: string }> {
  try {
    const cleanKey = (apiKey || "").trim();
    if (!cleanKey) {
      return { ok: false, models: [], error: "Clé API vide" };
    }
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${cleanKey}`);
    if (!res.ok) {
      const t = await res.text();
      return { ok: false, models: [], error: `Google API (${res.status}): ${t.slice(0, 180)}` };
    }
    const json: any = await res.json();
    const list: any[] = json.models ?? [];
    const models = list
      .filter((m) => Array.isArray(m.supportedGenerationMethods) && m.supportedGenerationMethods.includes("generateContent"))
      .map((m) => (typeof m.name === "string" ? m.name.replace(/^models\//, "") : ""))
      .filter(Boolean);
    return { ok: true, models };
  } catch (err: any) {
    return { ok: false, models: [], error: err.message || String(err) };
  }
}

/** Safely merge conversation history into strictly alternating user/model turns for Gemini API */
function normalizeContentsForGemini(history: ChatTurn[], parts: AiPart[]) {
  const rawItems = [
    ...history.map((t) => ({
      role: t.role === "assistant" ? "model" : "user",
      parts: [{ text: t.text || "" }],
    })),
    { role: "user", parts },
  ];

  // Filter out items with no valid text or inline_data
  const validItems = rawItems.filter((item) => {
    if (!item.parts || item.parts.length === 0) return false;
    return item.parts.some((p: any) => {
      if ("text" in p && typeof p.text === "string" && p.text.trim().length > 0) return true;
      if ("inline_data" in p && p.inline_data) return true;
      return false;
    });
  });

  if (validItems.length === 0) {
    return [{ role: "user", parts: [{ text: "(message)" }] }];
  }

  // Merge consecutive turns with the same role
  const merged: typeof validItems = [];
  for (const item of validItems) {
    if (merged.length > 0 && merged[merged.length - 1].role === item.role) {
      merged[merged.length - 1].parts.push(...item.parts);
    } else {
      merged.push({ role: item.role, parts: [...item.parts] });
    }
  }

  // Ensure first turn starts with 'user'
  if (merged.length > 0 && merged[0].role === "model") {
    merged.shift();
  }

  if (merged.length === 0) {
    return [{ role: "user", parts: [{ text: "(message)" }] }];
  }

  return merged;
}

export function sanitizeAiResponse(text: string): string {
  if (!text) return "";
  let cleaned = text;

  // 1. Remove XML/markdown thinking tags
  cleaned = cleaned.replace(/<think>[\s\S]*?<\/think>/gi, "");
  cleaned = cleaned.replace(/<thought>[\s\S]*?<\/thought>/gi, "");
  cleaned = cleaned.replace(/<reasoning>[\s\S]*?<\/reasoning>/gi, "");
  cleaned = cleaned.replace(/```(?:thinking|thought|reasoning)[\s\S]*?```/gi, "");

  // 2. If the text has an explicit "Final response:" / "Réponse finale:" marker after thoughts, extract from there
  const finalMarkers = [
    /(?:^|\n)(?:final response|reponse finale|réponse finale|valiny mivantana|final answer)\s*:\s*\n?/i,
  ];
  for (const marker of finalMarkers) {
    const parts = cleaned.split(marker);
    if (parts.length > 1 && parts[parts.length - 1].trim().length > 5) {
      cleaned = parts[parts.length - 1].trim();
      break;
    }
  }

  // 3. Remove paragraphs and lines containing internal reasoning, planning, or rules check
  const paragraphs = cleaned.split(/\n\s*\n/);
  const cleanParagraphs = paragraphs.filter((p) => {
    const lower = p.trim().toLowerCase();
    if (
      lower.startsWith("thinking:") ||
      lower.startsWith("thought:") ||
      lower.startsWith("thoughts:") ||
      lower.startsWith("analyse:") ||
      lower.startsWith("analysis:") ||
      lower.startsWith("reasoning:") ||
      lower.startsWith("penser:") ||
      lower.startsWith("réflexion:") ||
      lower.startsWith("reflexion:") ||
      lower.startsWith("internal notes:") ||
      lower.startsWith("draft:") ||
      lower.startsWith("plan:") ||
      lower.startsWith("let's think") ||
      lower.startsWith("let me think") ||
      lower.startsWith("let me analyze") ||
      lower.startsWith("let me see") ||
      lower.startsWith("hook:") ||
      lower.startsWith("value proposition:") ||
      lower.startsWith("trust/ease:") ||
      lower.startsWith("urgency/engagement:") ||
      lower.startsWith("final cta:") ||
      lower.startsWith("description:") ||
      lower.startsWith("benefit:") ||
      lower.startsWith("trust:") ||
      lower.startsWith("check:") ||
      lower === "check." ||
      lower === "check" ||
      lower === "ready." ||
      lower.includes("the user's question") ||
      lower.includes("the user is asking") ||
      lower.includes("the customer is asking") ||
      lower.includes("let's verify") ||
      lower.includes("catalog rule") ||
      lower.includes("final check") ||
      lower.includes("total length is sufficient") ||
      lower.includes("i will ensure") ||
      lower.includes("self-correction") ||
      lower.includes("facebook advertising expert") ||
      lower.includes("attractive, professional") ||
      lower.includes("no markdown") ||
      lower.includes("character count") ||
      lower.includes("(text looks good")
    ) {
      return false;
    }
    return true;
  });

  cleaned = cleanParagraphs.join("\n\n").trim();

  // 4. Line-by-line cleanup of residual meta lines
  const lines = cleaned.split("\n");
  const actualLines: string[] = [];
  let inThoughtBlock = false;

  for (const line of lines) {
    const l = line.trim();
    const low = l.toLowerCase();

    if (
      /^(?:thinking|thought|thoughts|reasoning|analyse|analysis|penser|réflexion|reflexion)\s*:/i.test(low) ||
      low.startsWith("let me analyze") ||
      low.startsWith("let's analyze")
    ) {
      inThoughtBlock = true;
      continue;
    }

    if (inThoughtBlock) {
      if (!l) continue;
      // Stop skipping if we hit a genuine Malagasy / French customer response opening
      if (/^(salama|misaotra|bonjour|bonsoir|bjr|cc|coucou|hello|hi|manao ahoana|eny|tsia|oui|non|raha|ny|momba|mikasika|ireto|ity|io|izahay|afaka)\b/i.test(l)) {
        inThoughtBlock = false;
      } else {
        continue;
      }
    }

    if (
      low.startsWith("hook:") ||
      low.startsWith("value proposition:") ||
      low.startsWith("trust/ease:") ||
      low.startsWith("urgency/engagement:") ||
      low.startsWith("final cta:") ||
      low.startsWith("description:") ||
      low.startsWith("benefit:") ||
      low.startsWith("trust:") ||
      low.startsWith("check:") ||
      low.includes("self-correction") ||
      low.includes("(text looks good") ||
      low === "check." ||
      low === "check" ||
      low === "ready."
    ) {
      continue;
    }
    actualLines.push(line);
  }

  if (actualLines.length > 0) {
    cleaned = actualLines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
  }

  return cleaned;
}

async function callGemini(
  apiKey: string,
  systemPrompt: string,
  history: ChatTurn[],
  parts: AiPart[],
  modelName: string = GEMINI_MODEL,
): Promise<string> {
  const cleanKey = (apiKey || "").trim();
  if (!cleanKey) throw new Error("Clé API Gemini vide");

  const contents = normalizeContentsForGemini(history, parts);

  // 1. Auto-discover available models from API key dynamically
  const discovery = await fetchAvailableGeminiModels(cleanKey);

  const standardCandidates = [
    "gemini-2.5-flash",
    "gemini-2.0-flash",
    "gemini-1.5-flash",
    "gemini-2.5-pro",
    "gemini-1.5-pro",
    "gemini-2.5-flash-lite",
    "gemini-1.5-flash-8b",
  ];

  const candidateList = [
    modelName,
    ...(discovery.models ?? []),
    ...standardCandidates,
  ].filter(Boolean);

  const uniqueModels = [...new Set(candidateList)];

  let lastError = "";
  for (const m of uniqueModels) {
    // Attempt with thinking disabled first, then without if not supported
    for (const disableThinking of [true, false]) {
      try {
        const genConfig: Record<string, any> = { temperature: 0.35, maxOutputTokens: 2000 };
        if (disableThinking) {
          genConfig.thinkingConfig = { thinkingBudget: 0 };
        }
        const body = {
          system_instruction: { parts: [{ text: systemPrompt }] },
          contents,
          generationConfig: genConfig,
        };

        const res = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent?key=${cleanKey}`,
          { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) },
        );

        if (!res.ok) {
          const t = await res.text();
          // If thinkingConfig is unsupported on this model, retry next loop without thinkingConfig
          if (disableThinking && (t.includes("thinkingConfig") || t.includes("INVALID_ARGUMENT") || t.includes("Unknown name"))) {
            continue;
          }
          lastError = `Gemini (${m}): ${t.slice(0, 180)}`;
          console.warn(`[gemini] model ${m} failed:`, lastError);
          break; // move to next model
        }

        const json: any = await res.json();
        const candidate = json?.candidates?.[0];
        const finish = candidate?.finishReason;
        const candidateParts = candidate?.content?.parts ?? [];
        // Filter out thought parts
        const nonThoughtParts = candidateParts.filter(
          (p: any) => !p.thought && !p.thought_process && p.type !== "thought",
        );
        const effectiveParts = nonThoughtParts.length > 0 ? nonThoughtParts : candidateParts;
        const text = effectiveParts.map((p: any) => p.text ?? "").join("").trim();

        if (finish && finish !== "STOP" && finish !== "MAX_TOKENS") {
          console.warn("[gemini] finishReason non-STOP:", finish);
        }
        if (finish === "MAX_TOKENS") {
          console.warn("[gemini] réponse tronquée par MAX_TOKENS, longueur:", text.length);
        }
        if (!text) throw new Error(`Réponse vide du modèle ${m} (finishReason=${finish ?? "unknown"})`);
        return sanitizeAiResponse(text);
      } catch (err: any) {
        lastError = err.message || String(err);
      }
    }
  }

  if (!discovery.ok && discovery.error) {
    throw new Error(discovery.error);
  }

  throw new Error(lastError || "Toutes les tentatives de modèles Gemini ont échoué");
}

async function callLovableAi(
  systemPrompt: string,
  history: ChatTurn[],
  parts: AiPart[],
): Promise<string> {
  const key = process.env.LOVABLE_API_KEY;
  if (!key) throw new Error("LOVABLE_API_KEY missing");
  const content: any[] = parts.map((p) =>
    "text" in p
      ? { type: "text", text: p.text }
      : {
          type: "image_url",
          image_url: { url: `data:${p.inline_data.mime_type};base64,${p.inline_data.data}` },
        },
  );
  const messages: any[] = [
    { role: "system", content: systemPrompt },
    ...history.map((t) => ({ role: t.role, content: t.text })),
    { role: "user", content },
  ];
  const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: { "content-type": "application/json", "Lovable-API-Key": key },
    body: JSON.stringify({ model: LOVABLE_MODEL, messages, temperature: 0.35, max_tokens: 2000 }),
  });
  if (!res.ok) throw new Error(`Lovable AI ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const json: any = await res.json();
  const text = json?.choices?.[0]?.message?.content ?? "";
  if (!text) throw new Error("Empty Lovable AI response");
  return sanitizeAiResponse(text);
}

/** Generate a reply. Lovable AI first (default), Gemini rotation as fallback. */
export async function generateAiReply(opts: {
  userId: string;
  systemPrompt: string;
  history?: ChatTurn[];
  parts: AiPart[];
  allowLinks?: boolean;
}): Promise<{ text: string; provider: string }> {
  const { userId, systemPrompt, parts, allowLinks } = opts;
  const history = opts.history ?? [];
  const strictSystemPrompt = appendClarityInstructions(systemPrompt);

  const { data: settings } = await supabaseAdmin
    .from("settings")
    .select("use_lovable_ai_fallback,default_model")
    .eq("user_id", userId)
    .maybeSingle();
  const lovableEnabled = settings?.use_lovable_ai_fallback ?? true;
  const modelToUse = settings?.default_model || "gemini-2.5-flash";

  if (lovableEnabled) {
    try {
      const raw = await callLovableAi(strictSystemPrompt, history, parts);
      const cleaned = sanitizeReply(raw, allowLinks);
      if (looksTruncated(cleaned)) {
        const completed = await retryTruncatedReply({
          userId,
          systemPrompt,
          history,
          parts,
          currentReply: cleaned,
          allowLinks,
        });
        if (completed)
          return { text: sanitizeReply(completed.raw, allowLinks), provider: completed.provider };
      }
      return { text: cleaned, provider: "lovable-ai" };
    } catch (e) {
      console.warn("[Lovable AI] fallback vers Gemini:", e instanceof Error ? e.message : e);
    }
  }

  const { data: allKeys } = await supabaseAdmin
    .from("gemini_keys")
    .select("id,is_active,disabled_until")
    .eq("user_id", userId);

  if (!allKeys || allKeys.length === 0) {
    throw new Error(
      "Aucune clé API Gemini configurée. Veuillez ajouter votre clé API Gemini dans le menu 'Clés Gemini'.",
    );
  }

  const keyErrors: string[] = [];

  for (let attempt = 0; attempt < 3; attempt++) {
    const key = await pickGeminiKey(userId);
    if (!key) break;
    try {
      const cleanKey = (key.api_key || "").trim();
      if (!cleanKey) throw new Error(`Clé '${key.label}' vide`);
      const raw = await callGemini(cleanKey, strictSystemPrompt, history, parts, modelToUse);
      await markKeyUsed(key.id);
      const cleaned = sanitizeReply(raw, allowLinks);
      if (looksTruncated(cleaned)) {
        const completed = await retryTruncatedReply({
          userId,
          systemPrompt,
          history,
          parts,
          currentReply: cleaned,
          allowLinks,
        });
        if (completed)
          return { text: sanitizeReply(completed.raw, allowLinks), provider: completed.provider };
      }
      return { text: cleaned, provider: `gemini:${key.label}` };
    } catch (e) {
      const errMsg = e instanceof Error ? e.message : String(e);
      console.error("[Gemini] error", key.label, errMsg);
      keyErrors.push(`${key.label}: ${errMsg}`);
      await markKeyError(key.id, key.error_count ?? 0);
    }
  }

  throw new Error(
    keyErrors.length
      ? `Erreur Clé Gemini [${keyErrors.join(" | ")}]. Vérifiez vos clés dans le menu 'Clés Gemini'.`
      : "Clés API Gemini invalides ou temporairement désactivées. Vérifiez vos clés dans le menu 'Clés Gemini'.",
  );
}

/** Fetch dynamic catalog context (formations / produits / paiements) selon assistance_type. */
async function buildCatalogContext(userId: string): Promise<string> {
  const { data: settings } = await supabaseAdmin
    .from("settings")
    .select("assistance_type")
    .eq("user_id", userId)
    .maybeSingle();
  const type = (settings as any)?.assistance_type ?? "online_work";

  const linkRule =
    "RÈGLE ABSOLUE POUR LES LIENS :\n" +
    "- Si tu envoies un lien (Google Drive, YouTube, etc.), recopie-le EXACTEMENT caractère par caractère.\n" +
    "- Garde tous les tirets bas (_), tirets (-), points (.), slashs (/), chiffres et majuscules.\n" +
    "- Ne jamais réécrire, raccourcir, embellir ou traduire un lien.\n" +
    "- Colle le lien sur une ligne seule pour qu'il reste cliquable.";

  if (type === "training") {
    const { data: trainings } = await supabaseAdmin
      .from("trainings")
      .select("name,description,pricing_type,price,payment_flow,video_link")
      .eq("user_id", userId)
      .eq("is_active", true);
    const { data: pmethods } = await supabaseAdmin
      .from("payment_methods")
      .select("label,number,instructions")
      .eq("user_id", userId)
      .eq("is_active", true);
    if (!trainings || trainings.length === 0) return "";
    const list = trainings
      .map((t: any) => {
        const priceInfo =
          t.pricing_type === "free"
            ? "Gratuit"
            : `Payante : ${Number(t.price ?? 0).toLocaleString()} Ar`;
        const flow =
          t.pricing_type === "paid"
            ? t.payment_flow === "admin_numbers"
              ? " — Paiement via nos numéros ci-dessous, envoyer preuve avant réception."
              : " — Prendre nom Facebook + WhatsApp/téléphone du client avant confirmation."
            : "";
        return `• ${t.name} — ${priceInfo}${flow}\n   ${t.description ?? ""}${t.video_link ? `\n   Aperçu vidéo : ${t.video_link}` : ""}`;
      })
      .join("\n");
    const pm = (pmethods ?? [])
      .map((p: any) => `- ${p.label} : ${p.number}${p.instructions ? ` (${p.instructions})` : ""}`)
      .join("\n");

    const orderProtocol =
      "PROTOCOLE COMMANDE (OBLIGATOIRE) :\n" +
      "Dès qu'un client confirme vouloir une formation ET que tu as collecté les informations nécessaires " +
      "(nom Facebook, WhatsApp/téléphone, et pour les payantes la référence de paiement si envoyé), " +
      "ajoute À LA TOUTE FIN de ta réponse (sur une ligne séparée) un bloc technique EXACTEMENT au format :\n" +
      `[[ORDER:{"type":"training","training":"NOM EXACT DE LA FORMATION","client_fb_name":"...","client_whatsapp":"...","payment_reference":"...","notes":"..."}]]\n` +
      '- Remplis uniquement les champs que tu connais, laisse les autres vides ("").\n' +
      "- Ce bloc est invisible pour le client, ne le commente jamais.\n" +
      "- Un seul bloc ORDER par réponse, uniquement quand la commande est réellement confirmée.";

    return `CATALOGUE FORMATIONS :\n${list}\n\n${pm ? `NUMÉROS DE PAIEMENT :\n${pm}\n\n` : ""}RÈGLES IMPORTANTES :\n- Ne JAMAIS envoyer les fichiers d'une formation payante tant que le paiement n'est pas confirmé.\n- Pour une formation gratuite, propose immédiatement le contenu quand le client le demande.\n- Quand un client accepte une formation payante avec paiement par numéros, envoie les numéros ci-dessus et demande la référence + nom d'envoi.\n- Quand la méthode est "contact client", demande simplement le nom Facebook et un numéro WhatsApp/téléphone joignable.\n- Répète le nom de la formation choisie et le montant pour confirmer.\n\n${linkRule}\n\n${orderProtocol}`;
  }

  if (type === "sales") {
    const { data: products } = await supabaseAdmin
      .from("products")
      .select("name,price,stock,description,payment_flow")
      .eq("user_id", userId)
      .eq("is_active", true);
    const { data: pmethods } = await supabaseAdmin
      .from("payment_methods")
      .select("label,number,instructions")
      .eq("user_id", userId)
      .eq("is_active", true);
    if (!products || products.length === 0) return "";
    const list = products
      .map(
        (p: any) =>
          `• ${p.name} — ${Number(p.price).toLocaleString()} Ar (stock : ${p.stock})\n   ${p.description ?? ""}`,
      )
      .join("\n");
    const pm = (pmethods ?? [])
      .map((p: any) => `- ${p.label} : ${p.number}${p.instructions ? ` (${p.instructions})` : ""}`)
      .join("\n");

    const imageProtocol =
      "PROTOCOLE PHOTOS PRODUIT (OBLIGATOIRE) :\n" +
      "Quand le client demande à voir un produit (photos, sary, image, voir, aperçu), " +
      "ajoute À LA FIN de ta réponse (ligne séparée) le bloc technique :\n" +
      "[[SEND_IMAGES:NOM EXACT DU PRODUIT]]\n" +
      "- Le système enverra automatiquement 4 photos du produit au client.\n" +
      "- Si le client redemande d'autres photos du même produit, remets le même bloc : les 4 suivantes seront envoyées.\n" +
      "- Ne décris pas ce bloc au client, il est technique et invisible.\n" +
      "- Un seul bloc SEND_IMAGES par réponse.";

    const orderProtocol =
      "PROTOCOLE COMMANDE VENTE (OBLIGATOIRE) :\n" +
      "Avant de conclure une vente, tu DOIS demander au client :\n" +
      "1) Son nom Facebook complet.\n" +
      "2) Un numéro WhatsApp ou téléphone où on peut le joindre.\n" +
      "3) SON ADRESSE COMPLÈTE de livraison (quartier, ville, points de repère).\n" +
      "Une fois ces informations obtenues ET la commande confirmée, ajoute à la fin de ta réponse (ligne séparée) :\n" +
      `[[ORDER:{"type":"sales","product":"NOM EXACT DU PRODUIT","quantity":1,"client_fb_name":"...","client_whatsapp":"...","client_address":"...","payment_reference":"...","notes":"..."}]]\n` +
      '- Remplis les champs connus, laisse les autres à "".\n' +
      "- Ce bloc est invisible pour le client.\n" +
      "- Un seul bloc ORDER par réponse, uniquement quand la commande est réellement confirmée.";

    return `CATALOGUE PRODUITS :\n${list}\n\n${pm ? `NUMÉROS DE PAIEMENT :\n${pm}\n\n` : ""}RÈGLES IMPORTANTES :\n- Vérifie toujours le stock disponible avant de confirmer.\n- Pour un paiement "numéros", donne les numéros et demande référence + nom d'envoi.\n- Pour "contact client", demande nom Facebook + WhatsApp/téléphone + adresse complète.\n- Confirme toujours nom du produit, prix, quantité ET adresse.\n\n${linkRule}\n\n${imageProtocol}\n\n${orderProtocol}`;
  }

  return linkRule;
}

/** Build system prompt from active prompts, avec directives strictes.
 *  Retourne null si aucune prompt active n'est configurée pour cette page :
 *  dans ce cas l'IA ne doit PAS répondre. */
export async function buildSystemPrompt(
  userId: string,
  category: "message" | "comment",
  pageId?: string | null,
): Promise<string | null> {
  const { data: settings } = await supabaseAdmin
    .from("settings")
    .select("assistance_type")
    .eq("user_id", userId)
    .maybeSingle();
  const assistanceType = (settings as any)?.assistance_type ?? "online_work";

  let query = supabaseAdmin
    .from("prompts")
    .select("content,category,page_id,page_ids,assistance_type")
    .eq("user_id", userId)
    .eq("is_active", true)
    .in("category", ["global", category]);

  const { data } = await query;

  let matchedRows = (data ?? []).filter((p: any) => {
    const ids: string[] =
      Array.isArray(p.page_ids) && p.page_ids.length ? p.page_ids : p.page_id ? [p.page_id] : [];
    const pageOk = ids.length === 0 || (pageId ? ids.includes(pageId) : false);
    const typeOk =
      !p.assistance_type || p.assistance_type === "all" || p.assistance_type === assistanceType;
    return pageOk && typeOk;
  });

  // Fallback 1: if no prompt matched both page and assistance type, ignore assistance_type filter
  if (matchedRows.length === 0) {
    matchedRows = (data ?? []).filter((p: any) => {
      const ids: string[] =
        Array.isArray(p.page_ids) && p.page_ids.length ? p.page_ids : p.page_id ? [p.page_id] : [];
      return ids.length === 0 || (pageId ? ids.includes(pageId) : false);
    });
  }

  // Fallback 2: if no prompt matched pageId specifically, use any active prompts of the user
  if (matchedRows.length === 0) {
    matchedRows = data ?? [];
  }

  let extras = matchedRows
    .sort((a: any, b: any) => (a.category === "global" ? -1 : 1))
    .map((p: any) => (p.content ?? "").trim())
    .filter(Boolean)
    .join("\n\n");

  // Fallback 3: if still no prompts configured at all, use default professional assistant prompt
  if (!extras) {
    extras =
      "Vous êtes l'assistant virtuel IA professionnel de notre page Facebook. Répondez de manière chaleureuse, amicale, claire et professionnelle aux questions des clients en les orientant efficacement.";
  }

  const styleRules =
    "RÈGLES ABSOLUES ET STRICTES DE RÉPONSE (PRIORITÉ MAXIMALE) :\n" +
    "1. RÉPONSE DIRECTE ET PRÉCISE : Réponds DIRECTEMENT à la question du client sans détour, sans préambule inutile et sans répéter la question du client.\n" +
    "2. AUCUNE PENSÉE NI ANALYSE VISIBLE : INTERDICTION FORMELLE d'inclure ton processus de réflexion, brouillon, 'Thinking:', 'Thought:', 'Hook:', 'Check', 'Let me check', 'Analyse:' ou du texte en anglais. Donne UNIQUEMENT la réponse finale pour le client.\n" +
    "3. LANGUE EXACTE DU CLIENT : Réponds STRICTEMENT dans la même langue que le client (en malgache si le client écrit en malgache, en français s'il écrit en français). N'utilise JAMAIS l'anglais.\n" +
    "4. CONCIS ET PERTINENT : Si le client demande un prix, une modalité ou un renseignement précis, réponds UNIQUEMENT sur cet élément précis sans étaler tout le catalogue ni ajouter de longs textes hors-sujet.\n" +
    "5. TON NATUREL ET CHALEUREUX : Ton poli, accueillant, bienveillant et professionnel comme un vrai conseiller humain.\n" +
    "6. FORMAT PROPRE : Phrases courtes, saut de ligne entre les idées pour un texte facile à lire. N'utilise JAMAIS de markdown (* ou #).\n" +
    "7. LISTES NUMÉROTÉES : Si tu dois énumérer des étapes, utilise des chiffres normaux (1., 2., 3.).\n" +
    "8. HISTORIQUE : Tiens compte des échanges précédents dans la conversation pour ne pas reposer les mêmes questions.";

  const catalog = await buildCatalogContext(userId);

  const userInstructions = `INSTRUCTIONS DE L'ADMINISTRATEUR (à respecter STRICTEMENT, elles priment sur tout comportement par défaut) :\n\n${extras}`;

  const header =
    "Tu es une assistante virtuelle professionnelle. Tu dois suivre à la lettre les instructions de l'administrateur ci-dessous. Si aucune instruction ne couvre un cas, reste polie et propose de transmettre la demande.";

  return [header, userInstructions, catalog, styleRules].filter(Boolean).join("\n\n");
}

/** Fetch image from URL and encode to base64 for AI multimodal input. */
export async function fetchAsInlinePart(url: string): Promise<AiPart | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const mime = res.headers.get("content-type") ?? "image/jpeg";
    if (!mime.startsWith("image/")) return null;
    const buf = new Uint8Array(await res.arrayBuffer());
    let bin = "";
    for (let i = 0; i < buf.length; i++) bin += String.fromCharCode(buf[i]);
    return { inline_data: { mime_type: mime.split(";")[0], data: btoa(bin) } };
  } catch (e) {
    console.error("[fetchAsInlinePart]", e);
    return null;
  }
}

/** Fetch the parent post text of a comment for context. */
export async function fetchPostContext(postId: string, pageToken: string): Promise<string> {
  try {
    const res = await fetch(
      `https://graph.facebook.com/v21.0/${postId}?fields=message,story&access_token=${pageToken}`,
    );
    const j: any = await res.json();
    return j.message ?? j.story ?? "";
  } catch {
    return "";
  }
}

/** Historique de conversation Messenger pour un expéditeur donné (mémoire). */
export async function fetchMessengerHistory(
  userId: string,
  pageId: string,
  senderId: string,
  limit = 20,
): Promise<ChatTurn[]> {
  const { data, error } = await supabaseAdmin
    .from("messages_log")
    .select("content,ai_response,direction,created_at")
    .eq("user_id", userId)
    .eq("page_id", pageId)
    .eq("sender_id", senderId)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) {
    console.error("[fetchMessengerHistory]", error);
    return [];
  }
  const rows = (data ?? []).reverse();
  const turns: ChatTurn[] = [];
  for (const r of rows) {
    const text = (r.content ?? r.ai_response ?? "").toString().trim();
    if (!text) continue;
    turns.push({ role: directionToRole(r.direction), text });
  }
  console.log(`[memory] messenger history ${userId}/${pageId}/${senderId}: ${turns.length} turns`);
  return turns;
}

async function fetchGraphMessengerHistory(
  page: any,
  senderId: string,
  limit = 24,
): Promise<ChatTurn[]> {
  try {
    const url =
      `https://graph.facebook.com/v21.0/${page.page_id}/conversations` +
      `?platform=messenger&user_id=${encodeURIComponent(senderId)}` +
      `&fields=messages.limit(${Math.min(limit, 50)}){message,from,created_time}` +
      `&access_token=${page.page_access_token}`;
    const res = await fetch(url);
    if (!res.ok) {
      console.warn(`[memory] graph history ${res.status}: ${(await res.text()).slice(0, 180)}`);
      return [];
    }
    const json: any = await res.json();
    const messages: any[] = json?.data?.[0]?.messages?.data ?? [];
    const turns = messages
      .slice()
      .reverse()
      .map((m) => ({
        role: m.from?.id === page.page_id ? "assistant" : "user",
        text: String(m.message ?? "").trim(),
      }))
      .filter((t) => t.text) as ChatTurn[];
    console.log(`[memory] graph history ${page.page_id}/${senderId}: ${turns.length} turns`);
    return turns;
  } catch (e) {
    console.warn("[memory] graph history failed", e instanceof Error ? e.message : e);
    return [];
  }
}

async function fetchMessengerHistoryForReply(
  page: any,
  senderId: string,
  currentText: string,
  limit = 24,
): Promise<ChatTurn[]> {
  const dbHistory = await fetchMessengerHistory(page.user_id, page.page_id, senderId, limit);
  const graphHistory = await fetchGraphMessengerHistory(page, senderId, limit + 1);
  const current = currentText.trim();
  const graphWithoutCurrent =
    current && graphHistory.at(-1)?.role === "user" && graphHistory.at(-1)?.text.trim() === current
      ? graphHistory.slice(0, -1)
      : graphHistory;

  const bestHistory =
    graphWithoutCurrent.length > dbHistory.length ? graphWithoutCurrent : dbHistory;
  return bestHistory.slice(-limit);
}

/** Send a Messenger reply. */
export async function sendMessengerReply(pageToken: string, recipientId: string, text: string) {
  const chunks = splitMessengerText(text);
  if (chunks.length === 0) return;
  for (let i = 0; i < chunks.length; i++) {
    const res = await fetch(
      `https://graph.facebook.com/v21.0/me/messages?access_token=${pageToken}`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          recipient: { id: recipientId },
          message: { text: chunks[i] },
          messaging_type: "RESPONSE",
        }),
      },
    );
    if (!res.ok)
      throw new Error(
        `Messenger send part ${i + 1}/${chunks.length} ${res.status}: ${(await res.text()).slice(0, 200)}`,
      );
  }
}

/** Send a single image attachment via Messenger. Supports both URL and data URLs. */
async function sendMessengerImage(pageToken: string, recipientId: string, url: string) {
  if (url.startsWith("data:image/")) {
    const parsed = stripDataUrl(url);
    if (parsed) {
      const bytes = Uint8Array.from(atob(parsed.base64), (c) => c.charCodeAt(0));
      const blob = new Blob([bytes], { type: parsed.mime });
      const form = new FormData();
      form.append("recipient", JSON.stringify({ id: recipientId }));
      form.append("message", JSON.stringify({ attachment: { type: "image", payload: {} } }));
      form.append("filedata", blob, "image.jpg");
      form.append("messaging_type", "RESPONSE");

      const res = await fetch(
        `https://graph.facebook.com/v21.0/me/messages?access_token=${pageToken}`,
        {
          method: "POST",
          body: form,
        },
      );
      if (!res.ok)
        throw new Error(
          `Messenger image upload ${res.status}: ${(await res.text()).slice(0, 200)}`,
        );
      return;
    }
  }

  const res = await fetch(
    `https://graph.facebook.com/v21.0/me/messages?access_token=${pageToken}`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        recipient: { id: recipientId },
        message: { attachment: { type: "image", payload: { url, is_reusable: false } } },
        messaging_type: "RESPONSE",
      }),
    },
  );
  if (!res.ok)
    throw new Error(`Messenger image ${res.status}: ${(await res.text()).slice(0, 200)}`);
}

function normalizeName(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "");
}

/** Parse and strip [[ORDER:{...}]] and [[SEND_IMAGES:name]] markers.
 *  Returns cleaned text plus the actions to execute. */
export function extractAiActions(text: string): {
  cleanText: string;
  orders: any[];
  imageRequests: string[];
} {
  const orders: any[] = [];
  const imageRequests: string[] = [];
  let cleaned = text;

  cleaned = cleaned.replace(/\[\[ORDER:\s*(\{[\s\S]*?\})\s*\]\]/gi, (_, json) => {
    try {
      orders.push(JSON.parse(json));
    } catch (e) {
      console.warn("[extractAiActions] bad ORDER json:", json.slice(0, 200));
    }
    return "";
  });

  cleaned = cleaned.replace(/\[\[SEND_IMAGES:\s*([^\]\n]+?)\s*\]\]/gi, (_, name) => {
    imageRequests.push(String(name).trim());
    return "";
  });

  cleaned = cleaned.replace(/\n{3,}/g, "\n\n").trim();
  return { cleanText: cleaned, orders, imageRequests };
}

/** Persist an AI-emitted order into the orders table. */
async function persistAiOrder(
  userId: string,
  pageId: string,
  senderId: string,
  senderName: string | null,
  order: any,
) {
  try {
    const type = order.type === "sales" ? "sales" : "training";
    let productId: string | null = null;
    let trainingId: string | null = null;

    if (type === "sales" && order.product) {
      const { data: prods } = await supabaseAdmin
        .from("products")
        .select("id,name")
        .eq("user_id", userId);
      const target = normalizeName(String(order.product));
      const match =
        (prods ?? []).find((p: any) => normalizeName(p.name) === target) ??
        (prods ?? []).find(
          (p: any) =>
            normalizeName(p.name).includes(target) || target.includes(normalizeName(p.name)),
        );
      productId = match?.id ?? null;
    }
    if (type === "training" && order.training) {
      const { data: trs } = await supabaseAdmin
        .from("trainings")
        .select("id,name")
        .eq("user_id", userId);
      const target = normalizeName(String(order.training));
      const match =
        (trs ?? []).find((t: any) => normalizeName(t.name) === target) ??
        (trs ?? []).find(
          (t: any) =>
            normalizeName(t.name).includes(target) || target.includes(normalizeName(t.name)),
        );
      trainingId = match?.id ?? null;
    }

    await supabaseAdmin.from("orders").insert({
      user_id: userId,
      page_id: pageId,
      type,
      product_id: productId,
      training_id: trainingId,
      client_fb_id: senderId,
      client_fb_name: order.client_fb_name || senderName || null,
      client_whatsapp: order.client_whatsapp || null,
      client_phone: order.client_phone || null,
      client_address: order.client_address || null,
      payment_reference: order.payment_reference || null,
      quantity: Number(order.quantity) > 0 ? Number(order.quantity) : 1,
      notes:
        order.notes ||
        (!productId && !trainingId ? `Article: ${order.product ?? order.training ?? "?"}` : null),
      status: "pending",
    });
  } catch (e) {
    console.error("[persistAiOrder]", e);
  }
}

/** Send the next batch of 4 product photos for a client. */
async function sendProductImagesForClient(
  userId: string,
  pageId: string,
  pageToken: string,
  senderId: string,
  productNameFromAi: string,
): Promise<{ sent: number; note: string }> {
  const { data: prods } = await supabaseAdmin
    .from("products")
    .select("id,name")
    .eq("user_id", userId)
    .eq("is_active", true);
  const target = normalizeName(productNameFromAi);
  const product =
    (prods ?? []).find((p: any) => normalizeName(p.name) === target) ??
    (prods ?? []).find(
      (p: any) => normalizeName(p.name).includes(target) || target.includes(normalizeName(p.name)),
    );
  if (!product) return { sent: 0, note: `product-not-found:${productNameFromAi}` };

  const { data: images } = await supabaseAdmin
    .from("product_images")
    .select("id,image_path")
    .eq("product_id", product.id)
    .order("sort_order", { ascending: true });
  if (!images || images.length === 0) return { sent: 0, note: "no-images" };

  // Read offset from client_ia_state
  const { data: state } = await supabaseAdmin
    .from("client_ia_state")
    .select("product_image_offsets")
    .eq("user_id", userId)
    .eq("page_id", pageId)
    .eq("client_fb_id", senderId)
    .maybeSingle();
  const offsets = ((state as any)?.product_image_offsets ?? {}) as Record<string, number>;
  const offset = offsets[product.id] ?? 0;
  const batch = images.slice(offset, offset + 4);
  if (batch.length === 0) return { sent: 0, note: "already-sent-all" };

  let sent = 0;
  for (const img of batch) {
    let urlToSend = img.image_path;
    if (
      !img.image_path.startsWith("data:") &&
      !img.image_path.startsWith("http://") &&
      !img.image_path.startsWith("https://")
    ) {
      const { data: signed } = await supabaseAdmin.storage
        .from("product-images")
        .createSignedUrl(img.image_path, 3600);
      if (signed?.signedUrl) {
        urlToSend = signed.signedUrl;
      }
    }
    if (!urlToSend) continue;
    try {
      await sendMessengerImage(pageToken, senderId, urlToSend);
      sent++;
    } catch (e) {
      console.error("[sendProductImagesForClient]", e);
    }
  }

  const newOffsets = { ...offsets, [product.id]: offset + sent };
  await supabaseAdmin.from("client_ia_state").upsert(
    {
      user_id: userId,
      page_id: pageId,
      client_fb_id: senderId,
      product_image_offsets: newOffsets,
    },
    { onConflict: "user_id,page_id,client_fb_id" },
  );

  return { sent, note: `batch:${sent}/${images.length - offset}` };
}

/** Process AI actions extracted from a Messenger reply, then return the cleaned text. */
export async function processAiActionsForMessenger(opts: {
  userId: string;
  pageId: string;
  pageToken: string;
  senderId: string;
  senderName: string | null;
  rawReply: string;
}): Promise<string> {
  const { cleanText, orders, imageRequests } = extractAiActions(opts.rawReply);

  for (const o of orders) {
    await persistAiOrder(opts.userId, opts.pageId, opts.senderId, opts.senderName, o);
  }
  for (const name of imageRequests) {
    await sendProductImagesForClient(opts.userId, opts.pageId, opts.pageToken, opts.senderId, name);
  }
  return cleanText;
}

/** Reply to a comment publicly. */
export async function sendCommentReply(pageToken: string, commentId: string, text: string) {
  const res = await fetch(
    `https://graph.facebook.com/v21.0/${commentId}/comments?access_token=${pageToken}`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ message: text }),
    },
  );
  if (!res.ok) throw new Error(`Comment reply ${res.status}: ${(await res.text()).slice(0, 200)}`);
}

/** Send a private reply to a comment (redirects user to Messenger). Supports chunked unlimited text. */
export async function sendPrivateReply(pageToken: string, commentId: string, text: string) {
  const chunks = splitMessengerText(text);
  if (chunks.length === 0) return;
  const res = await fetch(
    `https://graph.facebook.com/v21.0/me/messages?access_token=${pageToken}`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        recipient: { comment_id: commentId },
        message: { text: chunks[0] },
        messaging_type: "RESPONSE",
      }),
    },
  );
  if (!res.ok) throw new Error(`Private reply ${res.status}: ${(await res.text()).slice(0, 200)}`);
}

/* --------------- Webhook processing entry --------------- */

async function getPage(pageId: string) {
  const { data } = await supabaseAdmin
    .from("facebook_pages")
    .select("*")
    .eq("page_id", pageId)
    .eq("is_connected", true)
    .maybeSingle();
  return data;
}

async function handleMessengerEvent(page: any, ev: any) {
  const senderId = ev?.sender?.id;
  if (!senderId || senderId === page.page_id) return;
  if (ev.message?.is_echo) return;
  const msg = ev.message;
  if (!msg) return;

  const { data: settings } = await supabaseAdmin
    .from("settings")
    .select("auto_reply_messages,private_message_link,global_ia_stopped")
    .eq("user_id", page.user_id)
    .maybeSingle();

  const text: string = msg.text ?? "";
  const attachments: any[] = msg.attachments ?? [];
  const parts: AiPart[] = [];
  if (text) parts.push({ text });
  let mediaType: string | null = null;
  let mediaUrl: string | null = null;
  for (const a of attachments) {
    if (a.type === "image" && a.payload?.url) {
      const p = await fetchAsInlinePart(a.payload.url);
      if (p) parts.push(p);
      mediaType = "image";
      mediaUrl = a.payload.url;
    } else if (a.type === "audio" && a.payload?.url) {
      parts.push({ text: `[Message vocal reçu : ${a.payload.url}]` });
      mediaType = "audio";
      mediaUrl = a.payload.url;
    }
  }
  if (parts.length === 0) parts.push({ text: "(message vide)" });

  // Historique AVANT d'insérer le message courant (pour ne pas le dupliquer).
  const history = await fetchMessengerHistoryForReply(page, senderId, text, 24);

  await insertMessageLog(
    {
      user_id: page.user_id,
      page_id: page.page_id,
      sender_id: senderId,
      content: text || null,
      direction: INCOMING_DIRECTION,
      status: "received",
      media_type: mediaType,
      media_url: mediaUrl,
    },
    "incoming-webhook",
  );

  if (!(settings?.auto_reply_messages ?? true)) return;
  if ((settings as any)?.global_ia_stopped) {
    console.log("[stop-ia] global stopped for user", page.user_id);
    return;
  }

  // Check per-client IA stop
  const { data: clientState } = await supabaseAdmin
    .from("client_ia_state")
    .select("ia_stopped")
    .eq("user_id", page.user_id)
    .eq("page_id", page.page_id)
    .eq("client_fb_id", senderId)
    .maybeSingle();
  if (clientState?.ia_stopped) {
    console.log("[stop-ia] client stopped", senderId);
    return;
  }

  try {
    const systemPrompt = await buildSystemPrompt(page.user_id, "message", page.page_id);
    if (!systemPrompt) {
      console.log("[skip] no prompt configured for page", page.page_id);
      return;
    }
    const { text: reply, provider } = await generateAiReply({
      userId: page.user_id,
      systemPrompt,
      history,
      parts,
      allowLinks: true,
    });
    const rawReply = reply || "Misaotra tamin'ny hafatrao. Handray anao tsy ho ela izahay.";
    const finalReply = await processAiActionsForMessenger({
      userId: page.user_id,
      pageId: page.page_id,
      pageToken: page.page_access_token,
      senderId,
      senderName: null,
      rawReply,
    });
    if (finalReply) await sendMessengerReply(page.page_access_token, senderId, finalReply);
    await insertMessageLog(
      {
        user_id: page.user_id,
        page_id: page.page_id,
        sender_id: senderId,
        content: finalReply,
        ai_response: finalReply,
        direction: OUTGOING_DIRECTION,
        status: `sent:${provider}`,
      },
      "outgoing-webhook",
    );
  } catch (e) {
    console.error("[messenger reply]", e);
    await insertMessageLog(
      {
        user_id: page.user_id,
        page_id: page.page_id,
        sender_id: senderId,
        direction: OUTGOING_DIRECTION,
        status: `error:${e instanceof Error ? e.message.slice(0, 120) : "unknown"}`,
      },
      "error-webhook",
    );
  }
}

async function fetchCommentAttachments(commentId: string, pageToken: string): Promise<AiPart[]> {
  const parts: AiPart[] = [];
  try {
    const res = await fetch(
      `https://graph.facebook.com/v21.0/${commentId}/attachment?access_token=${pageToken}`,
    );
    const j: any = await res.json();
    const media = j?.media?.image?.src ?? j?.data?.[0]?.media?.image?.src;
    if (media) {
      const p = await fetchAsInlinePart(media);
      if (p) parts.push(p);
    }
  } catch (e) {
    console.warn("[fetchCommentAttachments]", e);
  }
  return parts;
}

/** Historique des commentaires précédents du même auteur sur la même publication. */
async function fetchCommentHistory(
  userId: string,
  postId: string,
  authorId: string,
  limit = 8,
): Promise<ChatTurn[]> {
  const { data } = await supabaseAdmin
    .from("comments_log")
    .select("content,ai_response,created_at")
    .eq("user_id", userId)
    .eq("post_id", postId)
    .eq("author_id", authorId)
    .order("created_at", { ascending: false })
    .limit(limit);
  const rows = (data ?? []).reverse();
  const turns: ChatTurn[] = [];
  for (const r of rows) {
    if (r.content) turns.push({ role: "user", text: r.content });
    if (r.ai_response) {
      const cleaned = String(r.ai_response)
        .replace(/^\[[^\]]+\]\s*/, "")
        .split("\n---MP---\n")[0];
      if (cleaned.trim()) turns.push({ role: "assistant", text: cleaned });
    }
  }
  return turns;
}

async function handleFeedChange(page: any, value: any) {
  if (value?.item !== "comment" || value.verb !== "add") return;
  const commentId: string = value.comment_id;
  const postId: string = value.post_id;
  const authorId: string = value.from?.id ?? "";
  const authorName: string | null = value.from?.name ?? null;
  const content: string = value.message ?? "";
  if (!commentId || authorId === page.page_id) return;

  const { data: existing } = await supabaseAdmin
    .from("comments_log")
    .select("id,replied")
    .eq("comment_id", commentId)
    .maybeSingle();
  if (existing?.replied) return;

  const { data: settings } = await supabaseAdmin
    .from("settings")
    .select("auto_reply_comments,private_message_link,global_ia_stopped")
    .eq("user_id", page.user_id)
    .maybeSingle();
  if ((settings as any)?.global_ia_stopped) return;

  const history = await fetchCommentHistory(page.user_id, postId, authorId, 8);

  if (!existing) {
    await supabaseAdmin.from("comments_log").insert({
      user_id: page.user_id,
      page_id: page.page_id,
      post_id: postId,
      comment_id: commentId,
      author_id: authorId,
      author_name: authorName,
      content,
      replied: false,
    });
  }
  if (!(settings?.auto_reply_comments ?? true)) return;

  try {
    const postContext = await fetchPostContext(postId, page.page_access_token);
    const imageParts = await fetchCommentAttachments(commentId, page.page_access_token);
    const systemPrompt = await buildSystemPrompt(page.user_id, "comment", page.page_id);
    if (!systemPrompt) {
      console.log("[skip] no prompt configured for page", page.page_id);
      return;
    }
    const privateLink = settings?.private_message_link ?? "";

    const baseContext = `Publication de la page :\n"""${postContext}"""\n\nCommentaire de ${authorName ?? "l'utilisateur"} :\n"""${content || "(sans texte)"}"""${imageParts.length ? "\n\n(Une image a été jointe au commentaire, analyse-la avant de répondre.)" : ""}`;

    // 1) Réponse publique (doit s'aligner strictement avec la description de la publication et répondre au commentaire)
    let finalPublic = "";
    let providerUsed = "";
    try {
      const pubPrompt = `${baseContext}\n\nRédige une réponse publique au commentaire de l'utilisateur qui s'aligne STRICTEMENT avec la description de la publication ci-dessus et répond directement à sa question (en malgache si le client écrit en malgache, en français sinon). 1 à 2 phrases chaleureuses, professionnelles et bienveillantes, invitant la personne. Sans lien, sans * ni #.`;
      const pub = await generateAiReply({
        userId: page.user_id,
        systemPrompt,
        history,
        parts: [{ text: pubPrompt }, ...imageParts],
        allowLinks: false,
      });
      finalPublic = extractAiActions(pub.text).cleanText;
      providerUsed = pub.provider;
    } catch (e) {
      console.warn("[public reply failed]", e instanceof Error ? e.message : e);
    }

    if (!finalPublic.trim()) {
      finalPublic = "Misaotra tamin'ny hevitrao. Handray anao amin'ny antsipiriany izahay.";
    }
    await sendCommentReply(page.page_access_token, commentId, finalPublic);

    // 2) Message privé détaillé (illimité, multi-part si long)
    let privateSent = false;
    let privateReply = "";
    try {
      const privPrompt = `${baseContext}\n\nRédige une réponse Messenger privée complète et détaillée basée sur la publication : explication claire, étapes numérotées si besoin (avec des chiffres, pas de #), et si utile le lien : ${privateLink || "(aucun lien fourni)"}. Style calme, aéré, sans * ni #.`;
      const priv = await generateAiReply({
        userId: page.user_id,
        systemPrompt,
        history,
        parts: [{ text: privPrompt }, ...imageParts],
        allowLinks: true,
      });
      privateReply = extractAiActions(priv.text).cleanText;
      providerUsed = providerUsed || priv.provider;
      if (privateReply.trim()) {
        await sendPrivateReply(page.page_access_token, commentId, privateReply);
        const chunks = splitMessengerText(privateReply);
        if (chunks.length > 1 && authorId) {
          for (let k = 1; k < chunks.length; k++) {
            await sendMessengerReply(page.page_access_token, authorId, chunks[k]);
          }
        }
        privateSent = true;
      }
    } catch (e) {
      console.warn("[private reply failed]", e instanceof Error ? e.message : e);
    }

    await supabaseAdmin
      .from("comments_log")
      .update({
        replied: true,
        replied_at: new Date().toISOString(),
        ai_response: `[${providerUsed}${privateSent ? "+MP" : "+public-only"}] ${finalPublic}${privateReply ? `\n---MP---\n${privateReply}` : ""}`,
      })
      .eq("comment_id", commentId);
  } catch (e) {
    console.error("[comment reply]", e);
  }
}

export async function processWebhookEvent(body: any) {
  if (body?.object !== "page") return;
  for (const entry of body.entry ?? []) {
    const pageId = String(entry.id);
    const page = await getPage(pageId);
    if (!page) continue;
    for (const ev of entry.messaging ?? []) {
      await handleMessengerEvent(page, ev).catch((e) => console.error("[messenger]", e));
    }
    for (const change of entry.changes ?? []) {
      if (change.field === "feed") {
        await handleFeedChange(page, change.value).catch((e) => console.error("[feed]", e));
      }
    }
  }
}

/* --------------- Batch: reply to ALL pending private messages --------------- */

/** Fetch pending Messenger conversations directly from Facebook Graph API.
 *  A conversation is "pending" if its most recent message is from someone other than the page. */
async function fetchPendingConversations(
  page: any,
  maxConversations: number,
  lookbackHours: number,
) {
  const sinceMs = Date.now() - lookbackHours * 3600 * 1000;
  const url =
    `https://graph.facebook.com/v21.0/${page.page_id}/conversations` +
    `?platform=messenger&fields=participants,updated_time,messages.limit(5){message,from,created_time,attachments{mime_type,image_data,file_url,type}}` +
    `&limit=${Math.min(maxConversations, 50)}&access_token=${page.page_access_token}`;
  const res = await fetch(url);
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`Graph conversations ${res.status}: ${t.slice(0, 200)}`);
  }
  const j: any = await res.json();
  const convos: any[] = j.data ?? [];
  const pending: Array<{
    senderId: string;
    senderName: string | null;
    lastText: string;
    lastAttachmentUrl: string | null;
    lastAttachmentType: string | null;
  }> = [];
  for (const c of convos) {
    const updatedMs = c.updated_time ? Date.parse(c.updated_time) : 0;
    if (updatedMs && updatedMs < sinceMs) continue;
    const msgs: any[] = c.messages?.data ?? [];
    if (msgs.length === 0) continue;
    const last = msgs[0]; // Graph returns newest first
    const fromId = last.from?.id;
    if (!fromId || fromId === page.page_id) continue;
    const participants: any[] = c.participants?.data ?? [];
    const other = participants.find((p) => p.id && p.id !== page.page_id);
    const senderId = other?.id ?? fromId;
    const senderName = other?.name ?? last.from?.name ?? null;
    const att = last.attachments?.data?.[0];
    const attUrl: string | null =
      att?.image_data?.url ?? att?.image_data?.preview_url ?? att?.file_url ?? null;
    const attType: string | null = att?.mime_type?.startsWith("image/")
      ? "image"
      : (att?.type ?? null);
    pending.push({
      senderId,
      senderName,
      lastText: last.message ?? "",
      lastAttachmentUrl: attUrl,
      lastAttachmentType: attType,
    });
    if (pending.length >= maxConversations) break;
  }
  return pending;
}

/** Reply to all conversations whose last message is unanswered, for one user. */
export async function replyAllPendingForUser(
  userId: string,
  opts: { lookbackHours?: number; maxConversations?: number } = {},
): Promise<{ processed: number; replied: number; errors: number; details: string[] }> {
  const lookbackHours = opts.lookbackHours ?? 23.5;
  const maxConversations = opts.maxConversations ?? 50;
  const details: string[] = [];
  let processed = 0;
  let replied = 0;
  let errors = 0;

  const { data: pages } = await supabaseAdmin
    .from("facebook_pages")
    .select("*")
    .eq("user_id", userId)
    .eq("is_connected", true);
  if (!pages || pages.length === 0) {
    return { processed, replied, errors, details: ["Aucune page connectée"] };
  }

  // Global stop-IA check
  const { data: settings } = await supabaseAdmin
    .from("settings")
    .select("global_ia_stopped")
    .eq("user_id", userId)
    .maybeSingle();
  if ((settings as any)?.global_ia_stopped) {
    return { processed, replied, errors, details: ["Stop IA global activé"] };
  }

  // Load per-client stop states once
  const { data: stopStates } = await supabaseAdmin
    .from("client_ia_state")
    .select("page_id,client_fb_id,ia_stopped")
    .eq("user_id", userId)
    .eq("ia_stopped", true);
  const stoppedSet = new Set((stopStates ?? []).map((s: any) => `${s.page_id}::${s.client_fb_id}`));

  for (const page of pages) {
    const systemPrompt = await buildSystemPrompt(userId, "message", page.page_id);
    if (!systemPrompt) {
      details.push(`- ${page.page_name ?? page.page_id} : aucun prompt configuré, IA désactivée`);
      continue;
    }
    let pending: Awaited<ReturnType<typeof fetchPendingConversations>> = [];
    try {
      pending = await fetchPendingConversations(page, maxConversations, lookbackHours);
      console.log(
        `[batch] page ${page.page_name ?? page.page_id}: ${pending.length} conversation(s) en attente`,
      );
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      errors++;
      details.push(`✗ ${page.page_name ?? page.page_id} (fetch): ${msg.slice(0, 160)}`);
      continue;
    }

    for (const p of pending) {
      processed++;
      if (stoppedSet.has(`${page.page_id}::${p.senderId}`)) {
        details.push(
          `- ${page.page_name ?? page.page_id} → ${p.senderName ?? p.senderId} : IA arrêtée pour ce client`,
        );
        continue;
      }
      try {
        const parts: AiPart[] = [];
        if (p.lastText) parts.push({ text: p.lastText });
        if (p.lastAttachmentType === "image" && p.lastAttachmentUrl) {
          const ip = await fetchAsInlinePart(p.lastAttachmentUrl);
          if (ip) parts.push(ip);
        }
        if (parts.length === 0) parts.push({ text: "(message vide)" });

        const history = await fetchMessengerHistoryForReply(page, p.senderId, p.lastText, 24);
        const { text: reply, provider } = await generateAiReply({
          userId,
          systemPrompt,
          history,
          parts,
          allowLinks: true,
        });
        const rawReply = reply || "Misaotra tamin'ny hafatrao. Handray anao tsy ho ela izahay.";
        const finalReply = await processAiActionsForMessenger({
          userId,
          pageId: page.page_id,
          pageToken: page.page_access_token,
          senderId: p.senderId,
          senderName: p.senderName,
          rawReply,
        });
        if (finalReply) await sendMessengerReply(page.page_access_token, p.senderId, finalReply);
        await insertMessageLog(
          [
            {
              user_id: userId,
              page_id: page.page_id,
              sender_id: p.senderId,
              sender_name: p.senderName,
              content: p.lastText || null,
              direction: INCOMING_DIRECTION,
              status: "received:batch",
              media_type: p.lastAttachmentType,
              media_url: p.lastAttachmentUrl,
            },
            {
              user_id: userId,
              page_id: page.page_id,
              sender_id: p.senderId,
              sender_name: p.senderName,
              content: finalReply,
              ai_response: finalReply,
              direction: OUTGOING_DIRECTION,
              status: `sent:batch:${provider}`,
            },
          ],
          "batch-success",
        );
        replied++;
        details.push(`✓ ${page.page_name ?? page.page_id} → ${p.senderName ?? p.senderId}`);
      } catch (e) {
        errors++;
        const msg = e instanceof Error ? e.message : String(e);
        console.error("[batch reply]", page.page_id, p.senderId, msg);
        details.push(
          `✗ ${page.page_name ?? page.page_id} → ${p.senderName ?? p.senderId} : ${msg.slice(0, 160)}`,
        );
        await insertMessageLog(
          {
            user_id: userId,
            page_id: page.page_id,
            sender_id: p.senderId,
            direction: OUTGOING_DIRECTION,
            status: `error:batch:${msg.slice(0, 120)}`,
          },
          "batch-error",
        );
      }
    }
  }

  return { processed, replied, errors, details };
}

/** Iterate every connected user's pages: used by the cron job. */
export async function replyAllPendingForAllUsers(): Promise<{
  users: number;
  processed: number;
  replied: number;
  errors: number;
}> {
  const { data: pages } = await supabaseAdmin
    .from("facebook_pages")
    .select("user_id")
    .eq("is_connected", true);
  const userIds = [...new Set((pages ?? []).map((p) => p.user_id).filter(Boolean))] as string[];

  let processed = 0;
  let replied = 0;
  let errors = 0;
  for (const uid of userIds) {
    try {
      const { data: settings } = await supabaseAdmin
        .from("settings")
        .select("auto_reply_messages")
        .eq("user_id", uid)
        .maybeSingle();
      if (!(settings?.auto_reply_messages ?? true)) continue;
      const res = await replyAllPendingForUser(uid);
      processed += res.processed;
      replied += res.replied;
      errors += res.errors;
    } catch (e) {
      console.error("[replyAllPendingForAllUsers]", uid, e);
      errors++;
    }
  }
  return { users: userIds.length, processed, replied, errors };
}

/** Scan recent published posts for a user's connected pages and auto-reply to unhandled comments. */
export async function scanAndReplyCommentsForUser(userId: string): Promise<{
  scanned: number;
  replied: number;
  errors: number;
  details: string[];
}> {
  const details: string[] = [];
  let scanned = 0;
  let replied = 0;
  let errors = 0;

  const { data: pages } = await supabaseAdmin
    .from("facebook_pages")
    .select("*")
    .eq("user_id", userId)
    .eq("is_connected", true);

  if (!pages || pages.length === 0) {
    return { scanned, replied, errors, details: ["Aucune page Facebook connectée."] };
  }

  for (const page of pages) {
    try {
      const postsUrl =
        `https://graph.facebook.com/v21.0/${page.page_id}/published_posts` +
        `?fields=id,message,created_time,comments.limit(25){id,from,message,created_time}` +
        `&limit=10&access_token=${page.page_access_token}`;
      const res = await fetch(postsUrl);
      if (!res.ok) {
        const t = await res.text();
        errors++;
        const pageName = page.page_name ?? page.page_id;
        details.push(`✗ ${pageName} : Erreur Graph API (${res.status}) ${t.slice(0, 100)}`);
        continue;
      }
      const json: any = await res.json();
      const posts: any[] = json.data ?? [];

      for (const post of posts) {
        const comments: any[] = post.comments?.data ?? [];
        for (const c of comments) {
          scanned++;
          const commentId = c.id;
          const authorId = c.from?.id;
          if (!commentId || !authorId || authorId === page.page_id) continue;

          const { data: existing } = await supabaseAdmin
            .from("comments_log")
            .select("id,replied")
            .eq("comment_id", commentId)
            .maybeSingle();

          if (existing?.replied) continue;

          await handleFeedChange(page, {
            item: "comment",
            verb: "add",
            comment_id: commentId,
            post_id: post.id,
            from: c.from,
            message: c.message ?? "",
          });

          const { data: updated } = await supabaseAdmin
            .from("comments_log")
            .select("replied")
            .eq("comment_id", commentId)
            .maybeSingle();

          if (updated?.replied) {
            replied++;
            details.push(`✓ Commentaire de ${c.from?.name ?? authorId} répondu.`);
          }
        }
      }
    } catch (e) {
      errors++;
      const msg = e instanceof Error ? e.message : String(e);
      details.push(`✗ ${page.page_name ?? page.page_id} : ${msg.slice(0, 120)}`);
    }
  }

  return { scanned, replied, errors, details };
}
