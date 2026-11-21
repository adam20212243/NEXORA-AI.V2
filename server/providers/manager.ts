import { GoogleGenAI } from '@google/genai';
import { PROVIDER_CATALOG } from '../../src/shared/constants.ts';
import type { AIProviderId, AttachedDocumentInput, ProviderStatus } from '../../src/shared/types.ts';

export interface ProviderGenerationRequest {
  provider: AIProviderId;
  model?: string;
  systemInstruction: string;
  prompt: string;
  history?: Array<{ role: 'user' | 'assistant'; content: string }>;
  attachments?: AttachedDocumentInput[];
  enableFallback?: boolean;
}

export interface ProviderGenerationResult {
  text: string;
  providerUsed: AIProviderId;
  modelUsed: string;
  fallbackTriggered: boolean;
  warnings: string[];
}

export class ProviderError extends Error {
  public readonly provider: AIProviderId;
  public readonly code:
    | 'NOT_CONFIGURED'
    | 'QUOTA_EXCEEDED'
    | 'INVALID_KEY'
    | 'MODEL_NOT_FOUND'
    | 'VISION_UNSUPPORTED'
    | 'NETWORK_ERROR'
    | 'UPSTREAM_ERROR';
  public readonly statusCode: number;

  constructor(
    provider: AIProviderId,
    code: ProviderError['code'],
    message: string,
    statusCode = 502
  ) {
    super(message);
    this.provider = provider;
    this.code = code;
    this.statusCode = statusCode;
  }
}

export function createGeminiClient(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey || apiKey === 'MY_GEMINI_API_KEY') {
    throw new ProviderError(
      'gemini',
      'NOT_CONFIGURED',
      'GEMINI_API_KEY is not configured on the server.',
      503
    );
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'nexora-ai-server',
      },
    },
  });
}

export function getProvidersStatus(): ProviderStatus[] {
  const geminiConfigured = Boolean(
    process.env.GEMINI_API_KEY?.trim() && process.env.GEMINI_API_KEY.trim() !== 'MY_GEMINI_API_KEY'
  );
  const openaiConfigured = Boolean(process.env.OPENAI_API_KEY?.trim());
  const anthropicConfigured = Boolean(process.env.ANTHROPIC_API_KEY?.trim());
  const compatibleConfigured = Boolean(
    process.env.OPENAI_COMPATIBLE_BASE_URL?.trim() && process.env.OPENAI_COMPATIBLE_API_KEY?.trim()
  );
  const localConfigured = Boolean(process.env.LOCAL_LLM_URL?.trim());

  const configuredMap: Record<AIProviderId, boolean> = {
    gemini: geminiConfigured,
    openai: openaiConfigured,
    anthropic: anthropicConfigured,
    'openai-compatible': compatibleConfigured,
    local: localConfigured,
  };

  return (Object.keys(PROVIDER_CATALOG) as AIProviderId[]).map((id) => ({
    id,
    ...PROVIDER_CATALOG[id],
    configured: configuredMap[id],
  }));
}

function getBinaryInlineAttachments(attachments?: AttachedDocumentInput[]): Array<{
  fileName: string;
  mimeType: string;
  data: string;
}> {
  if (!attachments || attachments.length === 0) return [];
  return attachments
    .filter(
      (a) =>
        Boolean(a.base64Data) &&
        (a.mimeType.startsWith('image/') || a.mimeType === 'application/pdf')
    )
    .map((a) => ({
      fileName: a.fileName,
      mimeType: a.mimeType,
      data: a.base64Data as string,
    }));
}

async function sleep(ms: number): Promise<void> {
  await new Promise((r) => setTimeout(r, ms));
}

async function callGemini(
  model: string,
  systemInstruction: string,
  prompt: string,
  history: Array<{ role: 'user' | 'assistant'; content: string }>,
  attachments?: AttachedDocumentInput[]
): Promise<string> {
  const ai = createGeminiClient();
  const inlineMedia = getBinaryInlineAttachments(attachments);

  const userParts: Array<
    | { text: string }
    | { inlineData: { mimeType: string; data: string } }
  > = [
    ...inlineMedia.map((m) => ({
      inlineData: {
        mimeType: m.mimeType,
        data: m.data,
      },
    })),
    { text: prompt },
  ];

  const contents = [
    ...history.slice(-8).map((h) => ({
      role: h.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: h.content }],
    })),
    { role: 'user', parts: userParts },
  ];

  const chosenModel = model || PROVIDER_CATALOG.gemini.modelDefault;
  let lastError: unknown = null;

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const response = await ai.models.generateContent({
        model: chosenModel,
        contents,
        config: {
          systemInstruction,
        },
      });
      const text = response.text?.trim();
      if (!text) {
        throw new ProviderError('gemini', 'UPSTREAM_ERROR', 'Gemini returned an empty response.');
      }
      return text;
    } catch (err) {
      lastError = err;
      if (err instanceof ProviderError) throw err;
      const msg = err instanceof Error ? err.message : String(err);

      if (msg.includes('429') || msg.includes('RESOURCE_EXHAUSTED') || msg.includes('quota')) {
        throw new ProviderError(
          'gemini',
          'QUOTA_EXCEEDED',
          'تم بلوغ حد الطلبات أو الحصة المسموحة في Gemini API (HTTP 429 RESOURCE_EXHAUSTED). يرجى المحاولة بعد قليل أو مراجعة الحصة في إعدادات المفاتيح.',
          429
        );
      }
      if (msg.includes('403') || msg.includes('401') || msg.includes('API_KEY_INVALID') || msg.includes('PERMISSION_DENIED')) {
        throw new ProviderError(
          'gemini',
          'INVALID_KEY',
          'مفتاح Gemini API غير صالح أو يفتقر إلى الصلاحيات (HTTP 401/403). تحقق من متغير البيئة GEMINI_API_KEY على الخادم.',
          403
        );
      }
      if (msg.includes('404') || msg.includes('NOT_FOUND')) {
        throw new ProviderError(
          'gemini',
          'MODEL_NOT_FOUND',
          `النموذج المطلوب (${chosenModel}) غير متاح أو غير مدعوم (HTTP 404).`,
          404
        );
      }

      // Retry once on transient network/503 error
      if (attempt === 0 && (msg.includes('503') || msg.includes('ECONNRESET') || msg.includes('timeout') || msg.includes('fetch'))) {
        await sleep(600);
        continue;
      }

      throw new ProviderError('gemini', 'UPSTREAM_ERROR', `تعذر الاتصال بخدمة Gemini: ${msg}`, 502);
    }
  }

  throw new ProviderError(
    'gemini',
    'UPSTREAM_ERROR',
    lastError instanceof Error ? lastError.message : 'Gemini request failed.',
    502
  );
}

async function callOpenAICompatible(
  provider: 'openai' | 'openai-compatible' | 'local',
  baseUrl: string,
  apiKey: string | undefined,
  model: string,
  systemInstruction: string,
  prompt: string,
  history: Array<{ role: 'user' | 'assistant'; content: string }>,
  attachments?: AttachedDocumentInput[]
): Promise<string> {
  const inlineImages = getBinaryInlineAttachments(attachments).filter((m) =>
    m.mimeType.startsWith('image/')
  );

  if (inlineImages.length > 0 && provider !== 'openai') {
    throw new ProviderError(
      provider,
      'VISION_UNSUPPORTED',
      `المزود المحدد (${provider}) لا يدعم تحليل الصور المرفقة حاليًا. استخدم Google Gemini أو OpenAI (gpt-4o).`,
      400
    );
  }

  const cleanBase = baseUrl.replace(/\/+$/, '');
  const endpoint = cleanBase.endsWith('/chat/completions')
    ? cleanBase
    : `${cleanBase}/chat/completions`;

  const userContent =
    inlineImages.length > 0 && provider === 'openai'
      ? [
          ...inlineImages.map((img) => ({
            type: 'image_url',
            image_url: { url: `data:${img.mimeType};base64,${img.data}` },
          })),
          { type: 'text', text: prompt },
        ]
      : prompt;

  const messages = [
    { role: 'system', content: systemInstruction },
    ...history.slice(-8).map((h) => ({ role: h.role, content: h.content })),
    { role: 'user', content: userContent },
  ];

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (apiKey) {
    headers.Authorization = `Bearer ${apiKey}`;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30000);
  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify({ model, messages }),
      signal: controller.signal,
    });

    if (res.status === 429) {
      throw new ProviderError(provider, 'QUOTA_EXCEEDED', `${provider} rate/quota limit reached (HTTP 429).`, 429);
    }
    if (res.status === 401 || res.status === 403) {
      throw new ProviderError(provider, 'INVALID_KEY', `${provider} authentication failed.`, res.status);
    }
    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      throw new ProviderError(
        provider,
        'UPSTREAM_ERROR',
        `${provider} HTTP ${res.status}: ${errText.slice(0, 200)}`,
        res.status
      );
    }

    const data = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const text = data.choices?.[0]?.message?.content?.trim();
    if (!text) {
      throw new ProviderError(provider, 'UPSTREAM_ERROR', `${provider} returned empty text.`);
    }
    return text;
  } catch (err) {
    if (err instanceof ProviderError) throw err;
    throw new ProviderError(
      provider,
      'NETWORK_ERROR',
      err instanceof Error ? err.message : 'Network failure',
      503
    );
  } finally {
    clearTimeout(timer);
  }
}

async function callAnthropic(
  model: string,
  systemInstruction: string,
  prompt: string,
  history: Array<{ role: 'user' | 'assistant'; content: string }>,
  attachments?: AttachedDocumentInput[]
): Promise<string> {
  const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
  if (!apiKey) {
    throw new ProviderError('anthropic', 'NOT_CONFIGURED', 'ANTHROPIC_API_KEY is not configured.', 503);
  }

  const inlineImages = getBinaryInlineAttachments(attachments).filter((m) =>
    m.mimeType.startsWith('image/')
  );

  const userContent =
    inlineImages.length > 0
      ? [
          ...inlineImages.map((img) => ({
            type: 'image',
            source: {
              type: 'base64',
              media_type: img.mimeType,
              data: img.data,
            },
          })),
          { type: 'text', text: prompt },
        ]
      : prompt;

  const messages = [
    ...history.slice(-8).map((h) => ({ role: h.role, content: h.content })),
    { role: 'user', content: userContent },
  ];

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30000);
  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: model || PROVIDER_CATALOG.anthropic.modelDefault,
        max_tokens: 1800,
        system: systemInstruction,
        messages,
      }),
      signal: controller.signal,
    });

    if (res.status === 429) {
      throw new ProviderError('anthropic', 'QUOTA_EXCEEDED', 'Anthropic quota exceeded (HTTP 429).', 429);
    }
    if (res.status === 401 || res.status === 403) {
      throw new ProviderError('anthropic', 'INVALID_KEY', 'Anthropic API key rejected.', res.status);
    }
    if (!res.ok) {
      const txt = await res.text().catch(() => '');
      throw new ProviderError('anthropic', 'UPSTREAM_ERROR', `Anthropic HTTP ${res.status}: ${txt.slice(0, 200)}`);
    }

    const data = (await res.json()) as {
      content?: Array<{ type: string; text?: string }>;
    };
    const text = data.content?.find((c) => c.type === 'text')?.text?.trim();
    if (!text) {
      throw new ProviderError('anthropic', 'UPSTREAM_ERROR', 'Anthropic returned empty content.');
    }
    return text;
  } catch (err) {
    if (err instanceof ProviderError) throw err;
    throw new ProviderError(
      'anthropic',
      'NETWORK_ERROR',
      err instanceof Error ? err.message : 'Anthropic network failure',
      503
    );
  } finally {
    clearTimeout(timer);
  }
}

async function invokeSingleProvider(
  provider: AIProviderId,
  model: string | undefined,
  systemInstruction: string,
  prompt: string,
  history: Array<{ role: 'user' | 'assistant'; content: string }>,
  attachments?: AttachedDocumentInput[]
): Promise<{ text: string; modelUsed: string }> {
  const chosenModel = model?.trim() || PROVIDER_CATALOG[provider].modelDefault;

  switch (provider) {
    case 'gemini':
      return {
        text: await callGemini(chosenModel, systemInstruction, prompt, history, attachments),
        modelUsed: chosenModel,
      };
    case 'openai': {
      const key = process.env.OPENAI_API_KEY?.trim();
      if (!key) {
        throw new ProviderError('openai', 'NOT_CONFIGURED', 'OPENAI_API_KEY is not configured.', 503);
      }
      return {
        text: await callOpenAICompatible(
          'openai',
          'https://api.openai.com/v1',
          key,
          chosenModel,
          systemInstruction,
          prompt,
          history,
          attachments
        ),
        modelUsed: chosenModel,
      };
    }
    case 'anthropic':
      return {
        text: await callAnthropic(chosenModel, systemInstruction, prompt, history, attachments),
        modelUsed: chosenModel,
      };
    case 'openai-compatible': {
      const base = process.env.OPENAI_COMPATIBLE_BASE_URL?.trim();
      const key = process.env.OPENAI_COMPATIBLE_API_KEY?.trim();
      if (!base || !key) {
        throw new ProviderError(
          'openai-compatible',
          'NOT_CONFIGURED',
          'OPENAI_COMPATIBLE_BASE_URL or OPENAI_COMPATIBLE_API_KEY is not configured.',
          503
        );
      }
      return {
        text: await callOpenAICompatible(
          'openai-compatible',
          base,
          key,
          chosenModel,
          systemInstruction,
          prompt,
          history,
          attachments
        ),
        modelUsed: chosenModel,
      };
    }
    case 'local': {
      const base = process.env.LOCAL_LLM_URL?.trim();
      if (!base) {
        throw new ProviderError(
          'local',
          'NOT_CONFIGURED',
          'LOCAL_LLM_URL is not configured.',
          503
        );
      }
      const normalized = base.includes('/v1') ? base : `${base.replace(/\/+$/, '')}/v1`;
      return {
        text: await callOpenAICompatible(
          'local',
          normalized,
          undefined,
          process.env.LOCAL_LLM_MODEL?.trim() || chosenModel,
          systemInstruction,
          prompt,
          history,
          attachments
        ),
        modelUsed: process.env.LOCAL_LLM_MODEL?.trim() || chosenModel,
      };
    }
  }
}

export async function generateWithProviders(
  req: ProviderGenerationRequest
): Promise<ProviderGenerationResult> {
  const warnings: string[] = [];
  const history = req.history ?? [];
  const hasImages = (req.attachments ?? []).some((a) => a.mimeType.startsWith('image/') && a.base64Data);

  try {
    const primary = await invokeSingleProvider(
      req.provider,
      req.model,
      req.systemInstruction,
      req.prompt,
      history,
      req.attachments
    );
    return {
      text: primary.text,
      providerUsed: req.provider,
      modelUsed: primary.modelUsed,
      fallbackTriggered: false,
      warnings,
    };
  } catch (primaryErr) {
    const primaryMsg = primaryErr instanceof Error ? primaryErr.message : String(primaryErr);
    warnings.push(`Primary provider (${req.provider}) unavailable: ${primaryMsg}`);

    if (!req.enableFallback) {
      throw primaryErr;
    }

    const statuses = getProvidersStatus().filter(
      (s) => s.id !== req.provider && s.configured && (!hasImages || s.supportsVision)
    );
    for (const candidate of statuses) {
      try {
        const res = await invokeSingleProvider(
          candidate.id,
          candidate.modelDefault,
          req.systemInstruction,
          req.prompt,
          history,
          req.attachments
        );
        warnings.push(`Switched automatically to fallback provider: ${candidate.id}`);
        return {
          text: res.text,
          providerUsed: candidate.id,
          modelUsed: res.modelUsed,
          fallbackTriggered: true,
          warnings,
        };
      } catch (fallbackErr) {
        const msg = fallbackErr instanceof Error ? fallbackErr.message : String(fallbackErr);
        warnings.push(`Fallback provider (${candidate.id}) failed: ${msg}`);
      }
    }

    throw primaryErr;
  }
}

export async function generateWithProvidersStream(
  req: ProviderGenerationRequest,
  handlers: {
    onToken: (chunk: string) => void;
    signal?: AbortSignal;
  }
): Promise<ProviderGenerationResult> {
  const warnings: string[] = [];
  const history = req.history ?? [];

  if (req.provider === 'gemini') {
    const ai = createGeminiClient();
    const inlineMedia = getBinaryInlineAttachments(req.attachments);
    const userParts: Array<
      | { text: string }
      | { inlineData: { mimeType: string; data: string } }
    > = [
      ...inlineMedia.map((m) => ({
        inlineData: { mimeType: m.mimeType, data: m.data },
      })),
      { text: req.prompt },
    ];
    const contents = [
      ...history.slice(-8).map((h) => ({
        role: h.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: h.content }],
      })),
      { role: 'user', parts: userParts },
    ];
    const chosenModel = req.model?.trim() || PROVIDER_CATALOG.gemini.modelDefault;

    try {
      const stream = await ai.models.generateContentStream({
        model: chosenModel,
        contents,
        config: { systemInstruction: req.systemInstruction },
      });
      let fullText = '';
      for await (const chunk of stream) {
        if (handlers.signal?.aborted) break;
        const textPart = chunk.text ?? '';
        if (textPart) {
          fullText += textPart;
          handlers.onToken(textPart);
        }
      }
      const trimmed = fullText.trim();
      if (!trimmed && !handlers.signal?.aborted) {
        throw new ProviderError('gemini', 'UPSTREAM_ERROR', 'Gemini stream returned empty text.');
      }
      return {
        text: trimmed,
        providerUsed: 'gemini',
        modelUsed: chosenModel,
        fallbackTriggered: false,
        warnings,
      };
    } catch (err) {
      if (err instanceof ProviderError) throw err;
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('429') || msg.includes('RESOURCE_EXHAUSTED') || msg.includes('quota')) {
        throw new ProviderError(
          'gemini',
          'QUOTA_EXCEEDED',
          'تم بلوغ حد الطلبات أو الحصة المسموحة في Gemini API (HTTP 429 RESOURCE_EXHAUSTED). يرجى المحاولة بعد قليل.',
          429
        );
      }
      if (msg.includes('403') || msg.includes('401') || msg.includes('API_KEY_INVALID')) {
        throw new ProviderError(
          'gemini',
          'INVALID_KEY',
          'مفتاح Gemini API غير صالح أو يفتقر إلى الصلاحيات (HTTP 401/403).',
          403
        );
      }
      throw new ProviderError('gemini', 'UPSTREAM_ERROR', `تعذر البث عبر Gemini: ${msg}`, 502);
    }
  }

  // Non-Gemini providers: generate full reply then stream word/chunk delta cleanly
  const res = await generateWithProviders(req);
  const words = res.text.split(/(\s+)/);
  for (let i = 0; i < words.length; i += 4) {
    if (handlers.signal?.aborted) break;
    handlers.onToken(words.slice(i, i + 4).join(''));
  }
  return res;
}

