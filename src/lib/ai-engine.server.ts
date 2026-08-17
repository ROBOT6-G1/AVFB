// Server-only AI engine: Lovable AI par défaut + rotation Gemini en fallback.
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import fs from "fs";
import path from "path";

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
  const safeText = typeof text === "string" ? text : String(text ?? "");
  // 1. Extract URLs first so replacements below never touch them.
  const urlRegex = /(https?:\/\/[^\s<>()"']+|www\.[^\s<>()"']+)/gi;
  const urls: string[] = [];
  let t = safeText.replace(urlRegex, (m) => {
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
  const safeText = typeof text === "string" ? text : String(text ?? "");
  return /(https?:\/\/|www\.)/i.test(safeText);
}

function getTextFromParts(parts: AiPart[]): string {
  return parts
    .map((p) => ("text" in p ? p.text : "[sary]"))
    .join("\n")
    .trim();
}

function appendClarityInstructions(systemPrompt: string): string {
  return `${systemPrompt}

RÈGLE ABSOLUE ET STRICTE :
- Valio MIVANTANA amin'ny teny Malagasy (na Frantsay raha niteny frantsay) ny mpanjifa.
- AZA MANORATRA FANDINIHANA (thinking/scratchpad), AZA MANORATRA TENY ANGLAIS, AZA MANORATRA BROUILLON NA AUTO-ÉVALUATION (ohatra : "No markdown? Yes", "Language: ...", "Length: ...", "Expansion: ...", "Closing: ...", "Draft: ...", "Let's expand").
- Valin-teny farany vonona ho vakian'ny mpanjifa ihany no avoaka.`;
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
    } catch (e: any) {
      const isQuota = Boolean(e?.isQuota || (e instanceof Error && (e.message.includes("Quota") || e.message.includes("429"))));
      console.error("[Gemini retry] error", key.label, e);
      await markKeyError(key.id, key.error_count ?? 0, isQuota);
    }
  }

  return null;
}

export function splitMessengerText(text: string, maxLength = MESSENGER_TEXT_LIMIT): string[] {
  const safeText = typeof text === "string" ? text : String(text ?? "");
  const normalized = safeText.replace(/\r/g, "").trim();
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

async function markKeyError(id: string, currentErrors: number, isQuota = false) {
  const next = currentErrors + 1;
  const disabled = isQuota || next >= 3 ? new Date(Date.now() + 15 * 60 * 1000).toISOString() : null;
  await supabaseAdmin
    .from("gemini_keys")
    .update({ error_count: next, disabled_until: disabled })
    .eq("id", id);
}

/** Auto-detect available Gemini text/chat models dynamically from the Google Gemini API key */
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
      .filter((name) => {
        if (!name) return false;
        const lower = name.toLowerCase();
        // Exclude TTS, embedding, audio, imagen, and non-chat models
        if (
          lower.includes("-tts") ||
          lower.includes("embedding") ||
          lower.includes("audio") ||
          lower.includes("imagen") ||
          lower.includes("aqa")
        ) {
          return false;
        }
        return true;
      });
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
  cleaned = cleaned.replace(/<scratchpad>[\s\S]*?<\/scratchpad>/gi, "");
  cleaned = cleaned.replace(/```(?:thinking|thought|reasoning|scratchpad)[\s\S]*?```/gi, "");

  // 2. Extract technical action blocks first so they are never lost during cleanup
  const actionTags: string[] = [];
  cleaned = cleaned.replace(
    /\[\[?\s*(?:SEND_?IMAGE_?ID|IMAGE_?ID|SEND_?IMAGE|SEND_?IMAGES?|SENDIMAGES?|SEND_?PHOTOS?|SENDPHOTOS?|ORDER)[^\]\n]*\]\]?/gi,
    (match) => {
      let normalized = match.trim();
      if (!normalized.startsWith("[[")) normalized = "[" + normalized;
      if (!normalized.endsWith("]]")) normalized = normalized + "]";
      actionTags.push(normalized);
      return "";
    },
  );

  // 3. If explicit "Final response / Final Text Construction" marker is present, take text after marker
  const finalMarkers = [
    /(?:^|\n)\s*(?:final response|reponse finale|réponse finale|valiny mivantana|valiny farany|final answer|final text construction|final text)\s*:\s*\n?/i,
  ];
  for (const marker of finalMarkers) {
    const parts = cleaned.split(marker);
    if (parts.length > 1 && parts[parts.length - 1].trim().length > 5) {
      cleaned = parts[parts.length - 1].trim();
      break;
    }
  }

  // 4. Line-by-line filtering of English meta-commentary, scratchpad, rule checks, and draft quotes
  const lines = cleaned.split("\n");
  const validLines: string[] = [];

  for (const rawLine of lines) {
    let line = rawLine.trim();
    if (!line) {
      validLines.push("");
      continue;
    }

    // Strip wrapping quotes on drafts: "Salama tompoko." -> Salama tompoko.
    if (
      (line.startsWith('"') && line.endsWith('"')) ||
      (line.startsWith("'") && line.endsWith("'"))
    ) {
      line = line.slice(1, -1).trim();
    }

    const low = line.toLowerCase();

    // Check for audit checklist items like: No markdown? Yes. / Language: Malagasy? Yes. / No bullets? Check.
    if (/\?\s*(?:yes|no|ok|done|true|false|check|malagasy|french|english)\b/i.test(low)) {
      continue;
    }
    if (
      low.startsWith("(") &&
      (low.includes("prompt says") ||
        low.includes("wait,") ||
        low.includes("let's ensure") ||
        low.includes("no characters") ||
        low.includes("catalog is"))
    ) {
      continue;
    }

    // Skip English thoughts, planning headers, and instruction echoes
    if (
      /^(?:\*|\*\*|\[)?(?:thinking|thought|thoughts|reasoning|analyse|analysis|penser|réflexion|reflexion|internal notes|draft|draft\s*\d+|plan|greeting|response|description|closing|technical block|technical|hook|value proposition|trust|trust\/ease|benefit|check|cta|final cta|urgency|urgency\/engagement|self-correction|step\s*\d+|expansion|length|language|audit|checklist|verification|self-check|rule check|final text construction|final text)\s*(?::|\*|\*\*|\]|\.|\-|\?)/i.test(
        low,
      ) ||
      low.startsWith("no markdown") ||
      low.startsWith("no bold") ||
      low.startsWith("no bullet") ||
      low.startsWith("no italic") ||
      low.startsWith("needs to be around") ||
      low.startsWith("let's expand") ||
      low.startsWith("let us expand") ||
      low.startsWith("add more detail") ||
      low.startsWith("mention that the team") ||
      low.startsWith("do not describe this block") ||
      low.startsWith("only one send") ||
      low.startsWith("the user is asking") ||
      low.startsWith("the customer is asking") ||
      low.startsWith("the product being discussed") ||
      low.startsWith("based on the product name") ||
      low.startsWith("no thinking process") ||
      low.startsWith("no repeating question") ||
      low.startsWith("same language") ||
      low.startsWith("professional/warm") ||
      low.startsWith("professional style") ||
      low.startsWith("one block") ||
      low.startsWith("let me analyze") ||
      low.startsWith("let me check") ||
      low.startsWith("let me see") ||
      low.startsWith("let's analyze") ||
      low.startsWith("let's check") ||
      low.startsWith("let's think") ||
      low.startsWith("let's ensure") ||
      low.startsWith("i will ensure") ||
      low.startsWith("acknowledge the request") ||
      low.startsWith("briefly mention") ||
      low.startsWith("a clear closing") ||
      low === "check." ||
      low === "check" ||
      low === "ready." ||
      low.includes("(text looks good") ||
      low.includes("total length is sufficient") ||
      low.includes("character count")
    ) {
      continue;
    }

    validLines.push(line);
  }

  cleaned = validLines.join("\n").replace(/\n{3,}/g, "\n\n").trim();

  // 5. If there is an isolated preamble draft list followed by the real conversational greeting, discard preamble
  const paragraphs = cleaned
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean);

  let startIndex = 0;
  for (let i = 0; i < paragraphs.length; i++) {
    const p = paragraphs[i];
    if (
      /^(?:miala tsiny|salama|manao ahoana|bonjour|bonsoir|misaotra|mankasitraka|eny tompoko|tsia tompoko|ity vokatra|momba ny|raha|ny vidin)/i.test(
        p,
      )
    ) {
      const preceding = paragraphs.slice(0, i).join(" ");
      if (preceding && !/^(?:salama|bonjour|manao ahoana)/i.test(paragraphs[0])) {
        startIndex = i;
      }
      break;
    }
  }

  const usefulParagraphs = paragraphs.slice(startIndex);

  // 6. Deduplicate repeated paragraphs (e.g. repeated greetings)
  const dedupedParagraphs: string[] = [];
  const seenParagraphs = new Set<string>();
  for (const p of usefulParagraphs) {
    if (seenParagraphs.has(p)) continue;
    seenParagraphs.add(p);
    dedupedParagraphs.push(p);
  }

  cleaned = dedupedParagraphs.join("\n\n").trim();

  // 7. Clean any remaining internal bracket tags
  cleaned = cleaned.replace(/\[\[[\s\S]*?\]\]/g, "");
  cleaned = cleaned.replace(
    /\[(?:SEND_?IMAGE_?ID|SEND_?IMAGES?|SENDIMAGES?|SEND_?PHOTOS?|SENDPHOTOS?|ORDER)[^\]]*\]/gi,
    "",
  );

  // 8. Re-attach technical action tag at the end
  if (actionTags.length > 0) {
    cleaned = `${cleaned}\n\n${actionTags[actionTags.length - 1]}`.trim();
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
        const genConfig: Record<string, any> = { temperature: 0.1, maxOutputTokens: 1500 };
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
          // If key is out of quota (429 or RESOURCE_EXHAUSTED), fail immediately to try next key or fallback
          if (res.status === 429 || t.includes("RESOURCE_EXHAUSTED") || t.toLowerCase().includes("quota")) {
            console.warn(`[gemini] Key quota exceeded on model ${m}:`, lastError);
            const quotaErr = new Error(`Quota dépassé pour cette clé (${m}): ${t.slice(0, 150)}`);
            (quotaErr as any).isQuota = true;
            throw quotaErr;
          }
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
    body: JSON.stringify({ model: LOVABLE_MODEL, messages, temperature: 0.1, max_tokens: 1500 }),
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
      const sanitized = sanitizeAiResponse(raw);
      const cleaned = sanitizeReply(sanitized, allowLinks);
      if (looksTruncated(cleaned)) {
        const completed = await retryTruncatedReply({
          userId,
          systemPrompt,
          history,
          parts,
          currentReply: cleaned,
          allowLinks,
        });
        if (completed) {
          const completedSanitized = sanitizeAiResponse(completed.raw);
          return { text: sanitizeReply(completedSanitized, allowLinks), provider: completed.provider };
        }
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
      const sanitized = sanitizeAiResponse(raw);
      const cleaned = sanitizeReply(sanitized, allowLinks);
      if (looksTruncated(cleaned)) {
        const completed = await retryTruncatedReply({
          userId,
          systemPrompt,
          history,
          parts,
          currentReply: cleaned,
          allowLinks,
        });
        if (completed) {
          const completedSanitized = sanitizeAiResponse(completed.raw);
          return { text: sanitizeReply(completedSanitized, allowLinks), provider: completed.provider };
        }
      }
      return { text: cleaned, provider: `gemini:${key.label}` };
    } catch (e: any) {
      const errMsg = e instanceof Error ? e.message : String(e);
      const isQuota = Boolean(e?.isQuota || errMsg.includes("Quota") || errMsg.includes("429"));
      console.error("[Gemini] error", key.label, errMsg);
      keyErrors.push(`${key.label}: ${errMsg}`);
      await markKeyError(key.id, key.error_count ?? 0, isQuota);
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
      .select("id,name,price,stock,description,payment_flow, product_images(id, image_path, sort_order)")
      .eq("user_id", userId)
      .eq("is_active", true);
    const { data: pmethods } = await supabaseAdmin
      .from("payment_methods")
      .select("label,number,instructions")
      .eq("user_id", userId)
      .eq("is_active", true);
    if (!products || products.length === 0) return "";
    const list = products
      .map((p: any) => {
        const imgs = (p.product_images ?? []).sort((a: any, b: any) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
        const imgStrs = imgs.map((img: any) => `   - Sary [ID_IMAGE: ${img.id}]`).join("\n");
        return `• [ID_PRODUIT: ${p.id}] ${p.name} — ${Number(p.price).toLocaleString()} Ar (stock : ${p.stock})\n   ${p.description ?? ""}\n${imgStrs}`;
      })
      .join("\n\n");
    const pm = (pmethods ?? [])
      .map((p: any) => `- ${p.label} : ${p.number}${p.instructions ? ` (${p.instructions})` : ""}`)
      .join("\n");

    const imageProtocol =
      "PROTOCOLE PHOTOS PRODUIT AVEC ID (OBLIGATOIRE) :\n" +
      "Rehefa mangataka sary ny client (photos, sary, voir, images, aperçu, asehoy), " +
      "jereo ao amin'ny katalaogy eo ambony ny ID an'ilay sary ([ID_IMAGE: ...]) na ny anaran'ny vokatra, ary ampidiro any amin'ny farany (amin'ny andalana manokana) ny bloc teknika :\n" +
      "[[SEND_IMAGE_ID: ID_DE_LA_SARY]] na [[SEND_IMAGES: NOM_OU_ID_DU_PRODUIT]]\n" +
      "- Handefa mivantana ilay sary voatondro ny rafitra.\n" +
      "- Aza tononina na hazavaina amin'ny mpanjifa io bloc io fa miafina izy io.";

    const orderProtocol =
      "PROTOCOLE EXPLICATION PRODUIT SY COMMANDE TSIKILIKELY (STRICTEMENT OBLIGATOIRE) :\n\n" +
      "1. REHEFA MANAZAVA PRODUIT (TANDREMO TSY TONGA DIA MAMPISEHO PAIEMENT NA COMMANDE) :\n" +
      "   - Hazavao amin'ny fomba tsotra sy mazava ny momba ilay vokatra (antsipiriany, tombontsoa, vidiny).\n" +
      "   - Raha nangataka sary izy dia asio [[SEND_IMAGES:NOM EXACT DU PRODUIT]] any amin'ny farany.\n" +
      "   - REHEFA VITA NY FANAZAVANA : ANONTANIO ALOHA NY FANAPAHAN-KEVITRY NY MPANJIFA (DÉCISION) : ohatra 'Mahaliana anao ve ity vokatra ity? Tianao ve ny hanafatra azy sa mbola misy fanazavana fanampiny tianao ho fantatra?'.\n" +
      "   - TSY AZO OMENA LAHARANA FANDOAVAM-BOLA NA ANGATAHINA ADIRESY/COMMANDE NY MPANJIFA raha mbola tsy niteny mazava izy fa HANDRAY NA HIVIDY NA HANAFATRA.\n\n" +
      "2. REHEFA NANAIKY HIVIDY NY MPANJIFA (FAKANA COMMANDE TSIKILIKELY ISAKY NY VALIN-TENY) :\n" +
      "   Rehefa nilaza mazava ny mpanjifa fa hividy na handray (ohatra: 'Eny handray aho', 'Tiako hovidina', 'Commander-ko', 'Hanafatra aho'), anontanio TSIKILIKELY isaky ny hafatra ireto fampahalalana ireto (TSY AZO ANGATAHINA MIARAKA DAHOLO, ary jereo tsara ny resaka teo aloha mba tsy hamerenana fanontaniana efa voavaly) :\n" +
      "   • Dingana 1 : ANARANA FENO — Anontanio ny anarana fenon'ny mpanjifa (raha mbola tsy voalaza).\n" +
      "   • Dingana 2 : LAHARANA FINDAY — Rehefa azo ny anarana dia anontanio ny laharana finday afaka iantsoana azy na WhatsApp.\n" +
      "   • Dingana 3 : ADIRESY FENO MAZAVA — Rehefa azo ny laharana dia anontanio ny adiresy mazava misy azy (Faritra / RÉGION, Distrika / DISTRICT, FOKONTANY, ary toerana famantarana / REPÈRE).\n" +
      "   • Dingana 4 : FOMBA FANDOAVAM-BOLA SY FAMARANANA :\n" +
      "      - Raha 'Paiement avant livraison / Par numéros' : Omeo ny laharana fandoavam-bola (Mvola, Airtel Money, Orange Money) ary angataho ny référence sy ny anaran'ny mpanefa. Rehefa azo izany dia ampidiro ny bloc ORDER.\n" +
      "      - Raha 'Paiement à la livraison / Contact client' : Rehefa azo ireo 3 voalohany (Anarana, Laharana, Adiresy mazava) dia ampidiro AVY HATRANY ny bloc ORDER ary lazao amin'ny mpanjifa fa voaray soa aman-tsara ny commande-ny ary haterin'ny mpanao livraison aminy.\n\n" +
      "BLOC TECHNIQUE ORDER (ampidiro eo amin'ny farany indrindra amin'ny andalana manokana, rehefa feno ny fampahalalana) :\n" +
      `[[ORDER:{"type":"sales","product":"NOM EXACT DU PRODUIT","quantity":1,"client_fb_name":"ANARANA","client_phone":"LAHARANA","client_whatsapp":"WHATSAPP","client_address":"ADIRESY (REGION DISTRICT FOKONTANY REPERE)","payment_reference":"REFERENCE NA VIDE","notes":""}]]\n` +
      "- Tsy maintsy ampidirina ity bloc ORDER ity mba hiditra mivantana ao amin'ny pejy Commandes ny commande.\n" +
      "- Tsy hita maso ity bloc ity, aza hazavaina amin'ny mpanjifa.";

    return `CATALOGUE PRODUITS :\n${list}\n\n${pm ? `NUMÉROS DE PAIEMENT :\n${pm}\n\n` : ""}RÈGLES IMPORTANTES :\n- Vérifie toujours le stock disponible avant de confirmer.\n- Omeo ny vidiny marina sy ny antsipiriany araka ny voalaza etsy ambony.\n- Tsikelikely foana no manontany ny mombamomba ny mpanjifa (Anarana -> Laharana finday -> Adiresy mazava misy Région, District, Fokontany -> Fomba fandoavana).\n- Confirme toujours nom du produit, prix, quantité ET adresse.\n\n${linkRule}\n\n${imageProtocol}\n\n${orderProtocol}`;
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
    "1. MPANJIFA VAOVAO / FIARAHABANA : Rehefa mpanjifa vao manomboka miresaka na manao salama / bonjour / manao ahoana, miarahaba am-pifaliana sy am-panajana, mampahafantatra fohy ireo vokatra misy ao amin'ny pejy, ary manontany hoe inona amin'ireo no tiany ho fantatra kokoa.\n" +
    "2. RÉPONSE DIRECTE ET PRÉCISE : Réponds DIRECTEMENT à la question du client sans détour, sans préambule inutile et sans répéter la question du client.\n" +
    "3. AUCUNE PENSÉE NI ANALYSE VISIBLE : INTERDICTION FORMELLE d'inclure ton processus de réflexion, brouillon, 'Thinking:', 'Thought:', 'Hook:', 'Check', 'Let me check', 'Analyse:' ou du texte en anglais. Donne UNIQUEMENT la réponse finale pour le client.\n" +
    "4. LANGUE EXACTE DU CLIENT : Réponds STRICTEMENT dans la même langue que le client (en malgache si le client écrit en malgache, en français s'il écrit en français). N'utilise JAMAIS l'anglais.\n" +
    "5. EXPLICATION PUIS DÉCISION : Rehefa manazava produit dia hazavao ny momba azy sy ny vidiny, ary ANONTANIO ALOHA NY DÉCISION-NY ('Mahaliana anao ve? Tianao ve ny hanafatra azy?'). Aza mbola manome laharana fandoavam-bola na maka adiresy raha tsy manaiky mazava hividy izy.\n" +
    "6. DEMANDE D'INFOS PROGRESSIVE (TSIKILIKELY) : Rehefa nanaiky hividy izy vao maka commande tsikelikely (1. Nom complet -> 2. Numéro -> 3. Adresse Région/District/Fokontany/Repère -> 4. Paiement). Ne pose JAMAIS toutes les questions d'un coup.\n" +
    "7. PHOTOS DU PRODUIT : Si le client demande à voir ou demande des photos/sary du produit, ajoute [[SEND_IMAGES:NOM DU PRODUIT]] à la fin pour lui envoyer automatiquement les photos de la galerie.\n" +
    "8. TON NATUREL ET CHALEUREUX : Ton poli, accueillant, bienveillant et professionnel comme un vrai conseiller humain.\n" +
    "9. FORMAT PROPRE : Phrases courtes, saut de ligne entre les idées pour un texte facile à lire. N'utilise JAMAIS de markdown (* ou #).\n" +
    "10. HISTORIQUE : Tiens compte des échanges précédents dans la conversation pour ne pas reposer les mêmes questions.";

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
  const current = (currentText || "").trim();
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

/** Send a single image attachment via Messenger. Supports Data URLs, local file paths, and remote URLs with binary multipart upload. */
const APP_BASE_URL =
  process.env.APP_URL ||
  process.env.PUBLIC_URL ||
  "https://ais-dev-i7b5jeeh6qqkeyb3nv4dw4-469517843202.europe-west2.run.app";

function resolvePublicImageUrl(imagePathOrId: string, imageId?: string): string {
  if (imageId) {
    return `${APP_BASE_URL}/api/public/img?id=${encodeURIComponent(imageId)}`;
  }
  if (imagePathOrId.startsWith("http://") || imagePathOrId.startsWith("https://")) {
    return imagePathOrId;
  }
  return `${APP_BASE_URL}/api/public/img?path=${encodeURIComponent(imagePathOrId)}`;
}

function tryParseUrl(u: string): URL | null {
  try {
    return new URL(u);
  } catch {
    return null;
  }
}

export async function getMessengerImageSource(
  rawUrlOrPath: string,
  imageId?: string,
): Promise<{
  publicUrl: string | null;
  buffer: Buffer | null;
  mimeType: string;
  filename: string;
}> {
  let target = rawUrlOrPath;
  let mimeType = "image/jpeg";
  let filename = "image.jpg";

  // 0. If imageId is provided, fetch image_path from product_images
  if (imageId) {
    const { data: imgRow } = await supabaseAdmin
      .from("product_images")
      .select("image_path")
      .eq("id", imageId)
      .maybeSingle();
    if (imgRow?.image_path) {
      target = imgRow.image_path;
    }
  }

  if (!target) {
    return { publicUrl: null, buffer: null, mimeType, filename };
  }

  // 1. Data URL (Base64)
  if (target.startsWith("data:image/") || target.startsWith("data:application/")) {
    const parsed = stripDataUrl(target);
    if (parsed) {
      const buffer = Buffer.from(parsed.base64, "base64");
      mimeType = parsed.mime || "image/jpeg";
      const ext = mimeType.includes("png") ? "png" : mimeType.includes("webp") ? "webp" : "jpg";
      filename = `image.${ext}`;
      return { publicUrl: null, buffer, mimeType, filename };
    }
  }

  // 2. Local Filesystem check (handles local uploads in public/uploads/ or public/)
  const parsedUrl = target.startsWith("http://") || target.startsWith("https://") ? tryParseUrl(target) : null;
  const urlPathname = parsedUrl ? parsedUrl.pathname : target;
  const cleanPath = urlPathname.replace(/^\/+/, "");
  const baseName = path.basename(cleanPath);

  const possibleLocalPaths = [
    path.join(process.cwd(), "public", "uploads", baseName),
    path.join(process.cwd(), "public", cleanPath.replace(/^public\//, "")),
    path.join(process.cwd(), cleanPath),
  ];

  for (const p of possibleLocalPaths) {
    if (fs.existsSync(p) && fs.statSync(p).isFile()) {
      try {
        const buffer = fs.readFileSync(p);
        const ext = path.extname(p).toLowerCase();
        mimeType =
          ext === ".png"
            ? "image/png"
            : ext === ".webp"
              ? "image/webp"
              : ext === ".gif"
                ? "image/gif"
                : "image/jpeg";
        filename = baseName || `image${ext || ".jpg"}`;
        return { publicUrl: null, buffer, mimeType, filename };
      } catch (fsErr) {
        console.warn("[getMessengerImageSource] local read error:", fsErr);
      }
    }
  }

  // 3. Supabase Storage (path or URL)
  try {
    let bucketPath = target;
    if (target.includes("/storage/v1/object/public/product-images/")) {
      bucketPath = target.split("/storage/v1/object/public/product-images/")[1] || target;
    } else if (target.includes("/storage/v1/object/sign/product-images/")) {
      bucketPath = target.split("/storage/v1/object/sign/product-images/")[1]?.split("?")[0] || target;
    }

    const { data: signed } = await supabaseAdmin.storage
      .from("product-images")
      .createSignedUrl(bucketPath, 3600);

    const { data: stBlob } = await supabaseAdmin.storage
      .from("product-images")
      .download(bucketPath);

    let buffer: Buffer | null = null;
    if (stBlob) {
      const arrayBuf = await stBlob.arrayBuffer();
      buffer = Buffer.from(arrayBuf);
      mimeType = stBlob.type || "image/jpeg";
      const ext = mimeType.includes("png") ? "png" : "jpg";
      filename = `product.${ext}`;
    }

    if (signed?.signedUrl || buffer) {
      return {
        publicUrl: signed?.signedUrl || null,
        buffer,
        mimeType,
        filename,
      };
    }
  } catch (stErr) {
    console.warn("[getMessengerImageSource] Supabase Storage error:", stErr);
  }

  // 4. Remote HTTP/HTTPS URL
  if (target.startsWith("http://") || target.startsWith("https://")) {
    const isDevUrl = target.includes("localhost") || target.includes("ais-dev") || target.includes("ais-pre");
    let publicUrl = isDevUrl ? null : target;

    try {
      const res = await fetch(target);
      if (res.ok) {
        const ct = res.headers.get("content-type") || "";
        if (ct.startsWith("image/")) {
          const arrayBuf = await res.arrayBuffer();
          const buffer = Buffer.from(arrayBuf);
          mimeType = ct;
          const ext = ct.includes("png") ? "png" : ct.includes("webp") ? "webp" : "jpg";
          filename = baseName || `image.${ext}`;
          return { publicUrl, buffer, mimeType, filename };
        }
      }
    } catch (e) {
      console.warn("[getMessengerImageSource] remote fetch failed:", e);
    }

    if (publicUrl) {
      return { publicUrl, buffer: null, mimeType, filename };
    }
  }

  return { publicUrl: null, buffer: null, mimeType, filename };
}

/** Send a single image attachment via Messenger. Supports fast binary FormData upload with URL fallback. */
async function sendMessengerImage(
  pageToken: string,
  recipientId: string,
  rawUrlOrPath: string,
  imageId?: string,
) {
  const source = await getMessengerImageSource(rawUrlOrPath, imageId);

  // Strategy A: Direct Multipart Binary Upload via Blob (Works 100% reliably in server environments)
  if (source.buffer && source.buffer.length > 0) {
    try {
      const blob = new Blob([source.buffer], { type: source.mimeType });
      const form = new FormData();
      form.append("recipient", JSON.stringify({ id: recipientId }));
      form.append("message", JSON.stringify({ attachment: { type: "image", payload: {} } }));
      form.append("filedata", blob, source.filename);
      form.append("messaging_type", "RESPONSE");

      const res = await fetch(
        `https://graph.facebook.com/v21.0/me/messages?access_token=${pageToken}`,
        {
          method: "POST",
          body: form,
        },
      );

      if (res.ok) {
        console.log(`[sendMessengerImage] Sent binary image successfully (${source.buffer.length} bytes, ${source.mimeType})`);
        return;
      }

      const errText = await res.text();
      console.warn(`[sendMessengerImage:binary] Facebook API error ${res.status}: ${errText}, trying public URL...`);
    } catch (binErr) {
      console.warn("[sendMessengerImage:binary] Upload error:", binErr);
    }
  }

  // Strategy B: Standard URL payload fallback
  if (source.publicUrl) {
    try {
      const res = await fetch(
        `https://graph.facebook.com/v21.0/me/messages?access_token=${pageToken}`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            recipient: { id: recipientId },
            message: {
              attachment: {
                type: "image",
                payload: { url: source.publicUrl },
              },
            },
            messaging_type: "RESPONSE",
          }),
        },
      );

      if (res.ok) {
        console.log("[sendMessengerImage] Sent successfully via public URL payload");
        return;
      }
      const errText = await res.text();
      console.error(`[sendMessengerImage:url] Facebook API error (${res.status}): ${errText}`);
    } catch (urlErr) {
      console.error("[sendMessengerImage:url] network error:", urlErr);
    }
  }

  throw new Error(`Unable to send Messenger image for: ${rawUrlOrPath}`);
}

const recentMidCache = new Map<string, number>();

function isDuplicateMid(mid: string): boolean {
  if (!mid) return false;
  const now = Date.now();
  for (const [k, ts] of recentMidCache.entries()) {
    if (now - ts > 300000) recentMidCache.delete(k);
  }
  if (recentMidCache.has(mid)) return true;
  recentMidCache.set(mid, now);
  return false;
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
  const safeText = typeof text === "string" ? text : String(text ?? "");
  const orders: any[] = [];
  const imageRequests: string[] = [];
  let cleaned = safeText;

  cleaned = cleaned.replace(/\[\[?\s*ORDER:\s*(\{[\s\S]*?\})\s*\]\]?/gi, (_, json) => {
    try {
      orders.push(JSON.parse(json));
    } catch (e) {
      console.warn("[extractAiActions] bad ORDER json:", json.slice(0, 200));
    }
    return "";
  });

  cleaned = cleaned.replace(
    /\[\[?\s*(?:SEND_?IMAGE_?ID|IMAGE_?ID|SEND_?IMAGE|SEND_?IMAGES?|SENDIMAGES?|SEND_?PHOTOS?|SENDPHOTOS?|IMAGES?|PHOTOS?|SARY|VOIR_?IMAGES?)(?::\s*([^\]\n]*?))?\s*\]\]?/gi,
    (_, name) => {
      imageRequests.push(String(name || "").trim());
      return "";
    },
  );

  // Remove any remaining internal brackets or technical strings
  cleaned = cleaned.replace(/\[\[[\s\S]*?\]\]/g, "");
  cleaned = cleaned.replace(/\[(?:SEND_?IMAGE_?ID|SEND_?IMAGES?|SENDIMAGES?|SEND_?PHOTOS?|SENDPHOTOS?|ORDER)[^\]]*\]/gi, "");

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
      client_phone: order.client_phone || order.client_whatsapp || null,
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

/** Send product photos or specific image by ID for a client. */
async function sendProductImagesForClient(
  userId: string,
  pageId: string,
  pageToken: string,
  senderId: string,
  queryParam: string,
): Promise<{ sent: number; note: string }> {
  const cleanParam = (queryParam || "").trim();
  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(cleanParam);

  // 1. If queryParam is a specific Image ID (UUID)
  if (isUuid) {
    const { data: imgRow } = await supabaseAdmin
      .from("product_images")
      .select("id, image_path, product_id, products(name)")
      .eq("id", cleanParam)
      .maybeSingle();

    if (imgRow?.image_path) {
      try {
        await sendMessengerImage(pageToken, senderId, imgRow.image_path, imgRow.id);
        const productName = (imgRow as any).products?.name || "Produit";
        await insertMessageLog(
          {
            user_id: userId,
            page_id: pageId,
            sender_id: senderId,
            content: `[Sary : ${productName}]`,
            media_type: "image",
            media_url: resolvePublicImageUrl(imgRow.image_path, imgRow.id),
            direction: OUTGOING_DIRECTION,
            status: "sent",
          },
          "image-sent",
        );
        return { sent: 1, note: `sent-image-id:${imgRow.id}` };
      } catch (e) {
        console.error("[sendProductImagesForClient by image ID]", e);
      }
    }
  }

  // 2. Otherwise, lookup by Product Name or Product ID
  const { data: prods } = await supabaseAdmin
    .from("products")
    .select("id,name, product_images(id, image_path, sort_order)")
    .eq("user_id", userId)
    .eq("is_active", true);

  if (!prods || prods.length === 0) return { sent: 0, note: "no-products" };

  let product: any = null;
  const target = normalizeName(cleanParam);
  const genericWords = new Set(["sary", "sarin", "photo", "photos", "image", "images", "apercu", "voir", "jereo", "produit", "produits", "all", "galerie", ""]);
  const isGeneric = !target || genericWords.has(target);

  if (!isGeneric && target) {
    product =
      prods.find((p: any) => p.id === cleanParam || normalizeName(p.name) === target) ??
      prods.find(
        (p: any) => normalizeName(p.name).includes(target) || target.includes(normalizeName(p.name)),
      );
  }

  // If matched product has no images or target was generic, find first product with images
  if (!product || !Array.isArray(product.product_images) || product.product_images.length === 0) {
    product = prods.find((p: any) => Array.isArray(p.product_images) && p.product_images.length > 0) || prods[0];
  }

  let images = (product.product_images ?? []).sort((a: any, b: any) => (a.sort_order ?? 0) - (b.sort_order ?? 0));

  // Absolute fallback: query product_images directly for this user
  if (!images || images.length === 0) {
    const { data: directImgs } = await supabaseAdmin
      .from("product_images")
      .select("id, image_path")
      .eq("user_id", userId)
      .limit(10);
    if (directImgs && directImgs.length > 0) {
      images = directImgs;
    }
  }

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
  let offset = offsets[product.id || "default"] ?? 0;
  if (offset >= images.length) {
    offset = 0;
  }

  // Send 1 image per request for maximum stability & no rate limits
  const batch = images.slice(offset, offset + 1);
  if (batch.length === 0) return { sent: 0, note: "already-sent-all" };

  let sent = 0;
  for (const img of batch) {
    if (!img.image_path) continue;
    try {
      await sendMessengerImage(pageToken, senderId, img.image_path, img.id);
      sent++;
      await insertMessageLog(
        {
          user_id: userId,
          page_id: pageId,
          sender_id: senderId,
          content: `[Sary : ${product.name || "Produit"}]`,
          media_type: "image",
          media_url: resolvePublicImageUrl(img.image_path, img.id),
          direction: OUTGOING_DIRECTION,
          status: "sent",
        },
        "image-sent",
      );
    } catch (e) {
      console.error("[sendProductImagesForClient batch]", e);
    }
  }

  const newOffsets = { ...offsets, [product.id || "default"]: offset + sent };
  await supabaseAdmin.from("client_ia_state").upsert(
    {
      user_id: userId,
      page_id: pageId,
      client_fb_id: senderId,
      product_image_offsets: newOffsets,
    },
    { onConflict: "user_id,page_id,client_fb_id" },
  );

  return { sent, note: `batch:${sent}/${images.length}` };
}

/** Process AI actions extracted from a Messenger reply, send standalone images first, then return the cleaned text. */
export async function processAiActionsForMessenger(opts: {
  userId: string;
  pageId: string;
  pageToken: string;
  senderId: string;
  senderName: string | null;
  rawReply: string;
  userMessageText?: string;
}): Promise<{ cleanText: string; totalImagesSent: number }> {
  const { cleanText, orders, imageRequests } = extractAiActions(opts.rawReply);

  // If user explicitly asked for photos and AI didn't output tag, auto-send images
  if (
    imageRequests.length === 0 &&
    opts.userMessageText &&
    /\b(sary|sarin|photo|photos|image|images|asehoy|ataovy sary|jereo|voir|aperçu)\b/i.test(opts.userMessageText)
  ) {
    imageRequests.push("");
  }

  // 1. Persist orders
  for (const o of orders) {
    await persistAiOrder(opts.userId, opts.pageId, opts.senderId, opts.senderName, o);
  }

  // 2. Send images standalone FIRST before any text reply
  let totalImagesSent = 0;
  for (const name of imageRequests) {
    const res = await sendProductImagesForClient(opts.userId, opts.pageId, opts.pageToken, opts.senderId, name);
    totalImagesSent += res.sent;
  }

  return { cleanText, totalImagesSent };
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

  const mid = msg.mid || "";
  if (mid && isDuplicateMid(mid)) {
    console.log("[dedup] ignoring duplicate messenger event mid:", mid);
    return;
  }

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
    const { cleanText, totalImagesSent } = await processAiActionsForMessenger({
      userId: page.user_id,
      pageId: page.page_id,
      pageToken: page.page_access_token,
      senderId,
      senderName: null,
      rawReply,
      userMessageText: text,
    });

    if (totalImagesSent > 0) {
      // Pause so that photos arrive in Messenger first before the explanation text
      await new Promise((r) => setTimeout(r, 600));
    }

    if (cleanText) {
      await sendMessengerReply(page.page_access_token, senderId, cleanText);
      await insertMessageLog(
        {
          user_id: page.user_id,
          page_id: page.page_id,
          sender_id: senderId,
          content: cleanText,
          ai_response: cleanText,
          direction: OUTGOING_DIRECTION,
          status: `sent:${provider}`,
        },
        "outgoing-webhook",
      );
    }
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
        const { cleanText: finalReply } = await processAiActionsForMessenger({
          userId,
          pageId: page.page_id,
          pageToken: page.page_access_token,
          senderId: p.senderId,
          senderName: p.senderName,
          rawReply,
          userMessageText: p.lastText,
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

/** Scan comments for all connected users' pages: used by background cron. */
export async function scanAndReplyCommentsForAllUsers(): Promise<{
  users: number;
  scanned: number;
  replied: number;
  errors: number;
}> {
  const { data: pages } = await supabaseAdmin
    .from("facebook_pages")
    .select("user_id")
    .eq("is_connected", true);
  const userIds = [...new Set((pages ?? []).map((p) => p.user_id).filter(Boolean))] as string[];

  let scanned = 0;
  let replied = 0;
  let errors = 0;
  for (const uid of userIds) {
    try {
      const { data: settings } = await supabaseAdmin
        .from("settings")
        .select("auto_reply_comments")
        .eq("user_id", uid)
        .maybeSingle();
      if (!(settings?.auto_reply_comments ?? true)) continue;
      const res = await scanAndReplyCommentsForUser(uid);
      scanned += res.scanned;
      replied += res.replied;
      errors += res.errors;
    } catch (e) {
      console.error("[scanAndReplyCommentsForAllUsers]", uid, e);
      errors++;
    }
  }
  return { users: userIds.length, scanned, replied, errors };
}

