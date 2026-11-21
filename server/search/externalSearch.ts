import net from 'node:net';
import type {
  ExternalSearchReport,
  ExternalSearchResult,
  ReferenceImageItem,
  WebPageBrowseResult,
} from '../../src/shared/types.ts';
import { recordActivityLog, recordSearchHistory } from '../db/database.ts';
import { createGeminiClient } from '../providers/manager.ts';

function isPrivateOrBlockedHost(hostname: string): boolean {
  const lower = hostname.toLowerCase();
  if (
    lower === 'localhost' ||
    lower === '127.0.0.1' ||
    lower === '0.0.0.0' ||
    lower === '::1' ||
    lower.endsWith('.local') ||
    lower.endsWith('.internal')
  ) {
    return true;
  }

  if (net.isIP(lower)) {
    const parts = lower.split('.').map(Number);
    if (parts.length === 4) {
      const [a, b] = parts;
      if (
        a === 10 ||
        a === 127 ||
        a === 0 ||
        (a === 169 && b === 254) ||
        (a === 172 && b >= 16 && b <= 31) ||
        (a === 192 && b === 168)
      ) {
        return true;
      }
    }
    if (lower.startsWith('fc') || lower.startsWith('fd') || lower.startsWith('fe80')) {
      return true;
    }
  }
  return false;
}

export function validateExternalUrl(rawUrl: string): boolean {
  try {
    const parsed = new URL(rawUrl);
    if (parsed.protocol !== 'https:') return false;
    if (isPrivateOrBlockedHost(parsed.hostname)) return false;
    return true;
  } catch {
    return false;
  }
}

function scoreSourceReliability(url: string, provider: ExternalSearchResult['provider']): number {
  const lower = url.toLowerCase();
  if (
    lower.includes('.gov') ||
    lower.includes('.edu') ||
    lower.includes('who.int') ||
    lower.includes('nih.gov') ||
    lower.includes('openalex.org') ||
    lower.includes('doi.org')
  ) {
    return 0.95;
  }
  if (
    lower.includes('wikipedia.org') ||
    lower.includes('britannica.com') ||
    lower.includes('developer.mozilla.org') ||
    lower.includes('python.org') ||
    lower.includes('typescriptlang.org') ||
    lower.includes('android.com')
  ) {
    return 0.88;
  }
  if (provider === 'gemini_google_search') {
    return 0.8;
  }
  return 0.72;
}

function detectSourceConflicts(results: ExternalSearchResult[]): string[] {
  const conflicts: string[] = [];
  if (results.length < 2) return conflicts;

  const yearPattern = /\b(19\d{2}|20\d{2})\b/g;
  const snippetYears = results.map((r) => ({
    source: r.sourceName,
    years: Array.from(new Set(r.snippet.match(yearPattern) ?? [])),
  }));

  const allYears = new Set(snippetYears.flatMap((s) => s.years));
  if (allYears.size >= 4) {
    conflicts.push(
      `تم رصد تباين زمني محتمل عبر المصادر الخارجية (${Array.from(allYears).slice(0, 4).join(', ')}).`
    );
  }
  return conflicts;
}

async function searchWikipediaLive(
  query: string,
  lang: 'ar' | 'en'
): Promise<ExternalSearchResult[]> {
  const host = lang === 'ar' ? 'https://ar.wikipedia.org' : 'https://en.wikipedia.org';
  const params = new URLSearchParams({
    action: 'query',
    list: 'search',
    srsearch: query,
    srlimit: '4',
    srprop: 'snippet|timestamp',
    format: 'json',
  });

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 4500);
  try {
    const res = await fetch(`${host}/w/api.php?${params.toString()}`, {
      headers: { 'User-Agent': 'NEXORA-AI-Search/1.0' },
      signal: controller.signal,
    });
    if (!res.ok) {
      throw new Error(`Wikipedia HTTP ${res.status}`);
    }
    const data = (await res.json()) as {
      query?: {
        search?: Array<{ title: string; snippet: string; timestamp: string }>;
      };
    };

    const accessedAt = new Date().toISOString();
    return (data.query?.search ?? []).map((item) => {
      const url = `${host}/wiki/${encodeURIComponent(item.title.replace(/\s+/g, '_'))}`;
      const cleanSnippet = item.snippet.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
      return {
        title: item.title,
        url,
        snippet: cleanSnippet,
        sourceName: lang === 'ar' ? 'ويكيبيديا العربية' : 'Wikipedia (EN)',
        publishedAt: item.timestamp || null,
        accessedAt,
        reliabilityScore: scoreSourceReliability(url, 'wikipedia_api'),
        provider: 'wikipedia_api' as const,
      };
    });
  } finally {
    clearTimeout(timer);
  }
}

async function searchOpenAlexLive(query: string): Promise<ExternalSearchResult[]> {
  const params = new URLSearchParams({
    search: query,
    'per-page': '3',
  });
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 4500);
  try {
    const res = await fetch(`https://api.openalex.org/works?${params.toString()}`, {
      headers: { 'User-Agent': 'NEXORA-AI-Search/1.0' },
      signal: controller.signal,
    });
    if (!res.ok) {
      throw new Error(`OpenAlex HTTP ${res.status}`);
    }
    const data = (await res.json()) as {
      results?: Array<{
        id: string;
        title?: string;
        doi?: string;
        publication_date?: string;
        primary_location?: { source?: { display_name?: string } };
      }>;
    };
    const accessedAt = new Date().toISOString();
    return (data.results ?? [])
      .filter((w) => Boolean(w.title))
      .map((w) => {
        const url = w.doi || w.id;
        return {
          title: w.title ?? 'Academic Work',
          url,
          snippet: `ورقة علمية منشورة${w.primary_location?.source?.display_name ? ` في ${w.primary_location.source.display_name}` : ''}.`,
          sourceName: w.primary_location?.source?.display_name || 'OpenAlex Academic Index',
          publishedAt: w.publication_date || null,
          accessedAt,
          reliabilityScore: scoreSourceReliability(url, 'openalex_api'),
          provider: 'openalex_api' as const,
        };
      });
  } finally {
    clearTimeout(timer);
  }
}

async function searchWithGeminiGrounding(query: string): Promise<{
  results: ExternalSearchResult[];
  summaryText: string;
}> {
  const ai = createGeminiClient();
  const response = await ai.models.generateContent({
    model: 'gemini-4-hydrogen',
    contents: query,
    config: {
      tools: [{ googleSearch: {} }],
    },
  });

  const chunks = response.candidates?.[0]?.groundingMetadata?.groundingChunks ?? [];
  const accessedAt = new Date().toISOString();
  const results: ExternalSearchResult[] = [];

  for (const chunk of chunks) {
    const web = (chunk as { web?: { uri?: string; title?: string } }).web;
    if (web?.uri && validateExternalUrl(web.uri)) {
      results.push({
        title: web.title || web.uri,
        url: web.uri,
        snippet: (response.text ?? '').slice(0, 220),
        sourceName: new URL(web.uri).hostname.replace(/^www\./, ''),
        publishedAt: null,
        accessedAt,
        reliabilityScore: scoreSourceReliability(web.uri, 'gemini_google_search'),
        provider: 'gemini_google_search',
      });
    }
  }

  return {
    results,
    summaryText: response.text ?? '',
  };
}

export async function runExternalSearch(
  query: string,
  preferArabic = false
): Promise<ExternalSearchReport> {
  const started = Date.now();
  const cleanQuery = query.trim().slice(0, 240);
  if (!cleanQuery) {
    return {
      query: cleanQuery,
      executed: false,
      providerUsed: 'none',
      results: [],
      conflictsDetected: [],
      error: 'Empty search query.',
      durationMs: 0,
    };
  }

  const results: ExternalSearchResult[] = [];
  const errors: string[] = [];
  const providersUsed: string[] = [];

  // 1. Try Gemini Google Search Grounding when GEMINI_API_KEY is available
  if (
    process.env.GEMINI_API_KEY?.trim() &&
    process.env.GEMINI_API_KEY.trim() !== 'MY_GEMINI_API_KEY'
  ) {
    try {
      const grounded = await searchWithGeminiGrounding(cleanQuery);
      if (grounded.results.length > 0) {
        results.push(...grounded.results);
        providersUsed.push('Gemini Google Search Grounding');
      }
    } catch (err) {
      errors.push(`Google Search Grounding: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // 2. Always cross-verify with authorized open APIs (Wikipedia + OpenAlex)
  const wikiLang = preferArabic || /[\u0600-\u06FF]/.test(cleanQuery) ? 'ar' : 'en';
  const [wikiSettled, openAlexSettled] = await Promise.allSettled([
    searchWikipediaLive(cleanQuery, wikiLang),
    searchOpenAlexLive(cleanQuery),
  ]);

  if (wikiSettled.status === 'fulfilled' && wikiSettled.value.length > 0) {
    results.push(...wikiSettled.value);
    providersUsed.push(`Wikipedia (${wikiLang.toUpperCase()})`);
  } else if (wikiSettled.status === 'rejected') {
    errors.push(`Wikipedia API: ${wikiSettled.reason?.message ?? 'Request failed'}`);
  }

  if (openAlexSettled.status === 'fulfilled' && openAlexSettled.value.length > 0) {
    results.push(...openAlexSettled.value);
    providersUsed.push('OpenAlex');
  } else if (openAlexSettled.status === 'rejected') {
    errors.push(`OpenAlex API: ${openAlexSettled.reason?.message ?? 'Request failed'}`);
  }

  // Deduplicate by URL and rank by reliabilityScore descending
  const seenUrls = new Set<string>();
  const deduped = results
    .filter((r) => {
      if (!r.url || seenUrls.has(r.url)) return false;
      seenUrls.add(r.url);
      return true;
    })
    .sort((a, b) => b.reliabilityScore - a.reliabilityScore)
    .slice(0, 8);

  const conflictsDetected = detectSourceConflicts(deduped);

  if (deduped.length > 0) {
    const top = deduped[0];
    recordSearchHistory({
      site_name: top.sourceName,
      url: top.url,
      query: cleanQuery,
      summary: `${deduped.length} نتائج (${providersUsed.join(' + ')}): ${top.title}`,
      mode: 'search',
    });
    recordActivityLog({
      category: 'search',
      action: 'web_search',
      target: cleanQuery,
      tool_id: 'web_search',
      status: 'success',
      detail: `Found ${deduped.length} results via ${providersUsed.join(' + ')}`,
    });
  } else if (errors.length > 0) {
    recordActivityLog({
      category: 'search',
      action: 'web_search',
      target: cleanQuery,
      tool_id: 'web_search',
      status: 'failed',
      detail: errors.join(' | '),
    });
  }

  return {
    query: cleanQuery,
    executed: providersUsed.length > 0,
    providerUsed: providersUsed.join(' + ') || 'none',
    results: deduped,
    conflictsDetected,
    error: deduped.length === 0 && errors.length > 0 ? errors.join(' | ') : null,
    durationMs: Date.now() - started,
  };
}

/**
 * Browse & Execute Mode: safely fetch an HTTPS webpage (strictly blocking private/local IPs & unsafe redirects),
 * extract title, readable text, links, available HTML forms, and search within page content.
 */
export async function browseAndReadWebPage(
  rawUrl: string,
  searchWithinQuery?: string
): Promise<WebPageBrowseResult> {
  const cleanUrl = rawUrl.trim();
  if (!validateExternalUrl(cleanUrl)) {
    recordActivityLog({
      category: 'browse',
      action: 'browse_url',
      target: cleanUrl,
      tool_id: 'web_browse',
      status: 'failed',
      detail: 'Blocked URL: Only public HTTPS websites are allowed.',
    });
    throw new Error('الرابط غير صالح أو محظور لأسباب أمنية (يُسمح فقط بروابط HTTPS العامة).');
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);

  try {
    const res = await fetch(cleanUrl, {
      headers: {
        'User-Agent': 'NEXORA-AI-Browser/1.0',
        Accept: 'text/html,application/xhtml+xml,application/json,text/plain;q=0.9',
      },
      redirect: 'follow',
      signal: controller.signal,
    });

    const finalUrl = res.url || cleanUrl;
    if (!validateExternalUrl(finalUrl)) {
      throw new Error('Redirect target blocked by HTTPS/SSRF policy.');
    }
    if (!res.ok) {
      throw new Error(`HTTP ${res.status} while loading page.`);
    }

    const rawText = (await res.text()).slice(0, 500_000);
    const titleMatch = rawText.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    const parsedHost = new URL(finalUrl).hostname.replace(/^www\./, '');
    const title = titleMatch
      ? titleMatch[1].replace(/\s+/g, ' ').trim()
      : parsedHost;

    // Extract links (up to 15 clean HTTPS links)
    const links: Array<{ text: string; url: string }> = [];
    const linkRe = /<a\s+[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
    let lMatch: RegExpExecArray | null;
    while ((lMatch = linkRe.exec(rawText)) !== null && links.length < 15) {
      try {
        const absUrl = new URL(lMatch[1], finalUrl).toString();
        const linkText = lMatch[2].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
        if (validateExternalUrl(absUrl) && linkText.length > 1) {
          links.push({ text: linkText.slice(0, 80), url: absUrl });
        }
      } catch {
        // Ignore malformed relative href
      }
    }

    // Extract available forms so user can review & approve permitted actions
    const forms: Array<{ action: string; method: string; inputs: string[] }> = [];
    const formRe = /<form([^>]*)>([\s\S]*?)<\/form>/gi;
    let fMatch: RegExpExecArray | null;
    while ((fMatch = formRe.exec(rawText)) !== null && forms.length < 5) {
      const attrs = fMatch[1] || '';
      const body = fMatch[2] || '';
      const actionAttr = attrs.match(/action=["']([^"']*)["']/i)?.[1] ?? finalUrl;
      const methodAttr = (attrs.match(/method=["']([^"']*)["']/i)?.[1] ?? 'GET').toUpperCase();
      const inputNames = Array.from(body.matchAll(/name=["']([^"']+)["']/gi)).map((m) => m[1]);
      let resolvedAction = finalUrl;
      try {
        resolvedAction = new URL(actionAttr, finalUrl).toString();
      } catch {
        resolvedAction = finalUrl;
      }
      forms.push({
        action: resolvedAction,
        method: methodAttr,
        inputs: Array.from(new Set(inputNames)).slice(0, 10),
      });
    }

    // Clean readable text
    const stripped = rawText
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    const textExcerpt = stripped.slice(0, 5000);

    // Search within page if requested
    const inPageMatches: string[] = [];
    if (searchWithinQuery?.trim()) {
      const needle = searchWithinQuery.trim().toLowerCase();
      const sentences = stripped.split(/(?<=[.!?؟])\s+/);
      for (const s of sentences) {
        if (s.toLowerCase().includes(needle)) {
          inPageMatches.push(s.slice(0, 260));
          if (inPageMatches.length >= 6) break;
        }
      }
    }

    const fetchedAt = new Date().toISOString();

    recordSearchHistory({
      site_name: parsedHost,
      url: finalUrl,
      query: searchWithinQuery?.trim() || title,
      summary: textExcerpt.slice(0, 220),
      mode: 'browse',
    });

    recordActivityLog({
      category: 'browse',
      action: 'browse_page',
      target: finalUrl,
      tool_id: 'web_browse',
      status: 'success',
      detail: `Loaded "${title}" (${links.length} links, ${forms.length} forms)`,
    });

    return {
      url: cleanUrl,
      finalUrl,
      siteName: parsedHost,
      title,
      textExcerpt,
      inPageMatches,
      links,
      forms,
      fetchedAt,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Failed loading webpage.';
    recordActivityLog({
      category: 'browse',
      action: 'browse_page',
      target: cleanUrl,
      tool_id: 'web_browse',
      status: 'failed',
      detail: msg,
    });
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Fetch real verified reference photos/diagrams from Wikimedia Commons & Wikipedia (strictly NO AI generation).
 */
export async function searchReferenceImages(
  query: string,
  preferArabic = false
): Promise<ReferenceImageItem[]> {
  const clean = query.trim().slice(0, 120);
  if (!clean) return [];

  const host = preferArabic || /[\u0600-\u06FF]/.test(clean)
    ? 'https://ar.wikipedia.org'
    : 'https://en.wikipedia.org';

  const params = new URLSearchParams({
    action: 'query',
    generator: 'search',
    gsrsearch: clean,
    gsrlimit: '4',
    prop: 'pageimages|info',
    piprop: 'thumbnail|original',
    pithumbsize: '480',
    inprop: 'url',
    format: 'json',
  });

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 4000);
  try {
    const res = await fetch(`${host}/w/api.php?${params.toString()}`, {
      headers: { 'User-Agent': 'NEXORA-AI-ImageRef/1.0' },
      signal: controller.signal,
    });
    if (!res.ok) return [];
    const data = (await res.json()) as {
      query?: {
        pages?: Record<
          string,
          {
            title?: string;
            fullurl?: string;
            thumbnail?: { source?: string };
            original?: { source?: string };
          }
        >;
      };
    };

    const pages = Object.values(data.query?.pages ?? {});
    const images: ReferenceImageItem[] = [];
    for (const p of pages) {
      const thumb = p.thumbnail?.source;
      const orig = p.original?.source || thumb;
      const pageUrl = p.fullurl;
      if (thumb && orig && pageUrl && validateExternalUrl(thumb) && validateExternalUrl(orig)) {
        images.push({
          title: p.title || clean,
          thumbUrl: thumb,
          imageUrl: orig,
          pageUrl,
          sourceName: preferArabic ? 'ويكيبيديا / ويكيميديا' : 'Wikipedia / Wikimedia',
        });
      }
      if (images.length >= 3) break;
    }
    return images;
  } catch {
    return [];
  } finally {
    clearTimeout(timer);
  }
}

