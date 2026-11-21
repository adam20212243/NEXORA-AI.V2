export type ApkReleaseStatus = 'available' | 'not_configured' | 'no_release_yet' | 'unreachable';

export interface ResolvedAndroidReleaseInfo {
  apkAvailable: boolean;
  apkUrl: string | null;
  apkStatus: ApkReleaseStatus;
  apkSource: 'github_release' | 'env_url' | 'none';
  githubRepo: string | null;
  apkVersion: string | null;
  apkFileName: string | null;
  apkSizeBytes: number | null;
  apkPublishedAt: string | null;
  releasePageUrl: string | null;
  statusMessage?: string;
  checkedAt: string;
}

interface CacheEntry {
  cacheKey: string;
  expiresAt: number;
  value: ResolvedAndroidReleaseInfo;
}

let releaseCache: CacheEntry | null = null;
const CACHE_TTL_MS = 120_000;

export function clearReleaseResolverCache(): void {
  releaseCache = null;
}

export function isValidGithubRepoSlug(slug: string): boolean {
  return /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(slug.trim());
}

export function isValidReleaseAssetUrl(rawUrl: string): boolean {
  const trimmed = rawUrl.trim();
  if (!trimmed) return false;
  if (/(?:MY_|YOUR_|example\.com|<owner>|<repo>|placeholder|TODO)/i.test(trimmed)) {
    return false;
  }
  try {
    const parsed = new URL(trimmed);
    const isTestLoopback =
      process.env.NODE_ENV === 'test' &&
      parsed.protocol === 'http:' &&
      parsed.hostname === '127.0.0.1';
    if (parsed.protocol !== 'https:' && !isTestLoopback) {
      return false;
    }
    const host = parsed.hostname.toLowerCase();
    if (!isTestLoopback) {
      if (
        host === 'localhost' ||
        host === '127.0.0.1' ||
        host === '::1' ||
        host.startsWith('10.') ||
        host.startsWith('192.168.') ||
        /^172\.(1[6-9]|2\d|3[01])\./.test(host) ||
        host.startsWith('169.254.')
      ) {
        return false;
      }
    }
    return true;
  } catch {
    return false;
  }
}

interface GithubReleaseAsset {
  name?: string;
  size?: number;
  browser_download_url?: string;
}

interface GithubLatestReleasePayload {
  tag_name?: string;
  html_url?: string;
  published_at?: string;
  draft?: boolean;
  assets?: GithubReleaseAsset[];
}

async function resolveFromGithubRepo(
  repo: string,
  fetchFn: typeof fetch,
  githubApiBaseUrl: string
): Promise<ResolvedAndroidReleaseInfo> {
  const checkedAt = new Date().toISOString();
  const base = githubApiBaseUrl.replace(/\/+$/, '');
  const apiUrl = `${base}/repos/${repo}/releases/latest`;
  const releasesPage = `https://github.com/${repo}/releases`;

  try {
    const res = await fetchFn(apiUrl, {
      headers: {
        Accept: 'application/vnd.github+json',
        'User-Agent': 'NEXORA-AI-Release-Resolver',
      },
      signal: AbortSignal.timeout(5000),
    });

    if (res.status === 404) {
      return {
        apkAvailable: false,
        apkUrl: null,
        apkStatus: 'no_release_yet',
        apkSource: 'none',
        githubRepo: repo,
        apkVersion: null,
        apkFileName: null,
        apkSizeBytes: null,
        apkPublishedAt: null,
        releasePageUrl: releasesPage,
        statusMessage: `No published GitHub release found yet for ${repo}.`,
        checkedAt,
      };
    }

    if (!res.ok) {
      return {
        apkAvailable: false,
        apkUrl: null,
        apkStatus: 'unreachable',
        apkSource: 'none',
        githubRepo: repo,
        apkVersion: null,
        apkFileName: null,
        apkSizeBytes: null,
        apkPublishedAt: null,
        releasePageUrl: releasesPage,
        statusMessage: `GitHub Releases API returned HTTP ${res.status}.`,
        checkedAt,
      };
    }

    const data = (await res.json()) as GithubLatestReleasePayload;
    const assets = Array.isArray(data.assets) ? data.assets : [];
    const apkAssets = assets.filter(
      (a) =>
        typeof a.name === 'string' &&
        a.name.toLowerCase().endsWith('.apk') &&
        typeof a.browser_download_url === 'string' &&
        isValidReleaseAssetUrl(a.browser_download_url)
    );
    const chosen =
      apkAssets.find((a) => a.name?.toLowerCase() === 'nexora-ai-latest.apk') ?? apkAssets[0];

    if (!chosen || !chosen.browser_download_url) {
      return {
        apkAvailable: false,
        apkUrl: null,
        apkStatus: 'no_release_yet',
        apkSource: 'none',
        githubRepo: repo,
        apkVersion: data.tag_name ?? null,
        apkFileName: null,
        apkSizeBytes: null,
        apkPublishedAt: data.published_at ?? null,
        releasePageUrl: data.html_url ?? releasesPage,
        statusMessage: `Release ${data.tag_name ?? ''} exists on GitHub, but no .apk asset is attached yet.`,
        checkedAt,
      };
    }

    return {
      apkAvailable: true,
      apkUrl: chosen.browser_download_url,
      apkStatus: 'available',
      apkSource: 'github_release',
      githubRepo: repo,
      apkVersion: data.tag_name ?? null,
      apkFileName: chosen.name ?? null,
      apkSizeBytes: typeof chosen.size === 'number' ? chosen.size : null,
      apkPublishedAt: data.published_at ?? null,
      releasePageUrl: data.html_url ?? releasesPage,
      checkedAt,
    };
  } catch (err) {
    return {
      apkAvailable: false,
      apkUrl: null,
      apkStatus: 'unreachable',
      apkSource: 'none',
      githubRepo: repo,
      apkVersion: null,
      apkFileName: null,
      apkSizeBytes: null,
      apkPublishedAt: null,
      releasePageUrl: releasesPage,
      statusMessage: err instanceof Error ? err.message : 'Failed contacting GitHub Releases API.',
      checkedAt,
    };
  }
}

async function verifyDirectApkUrl(
  url: string,
  fetchFn: typeof fetch,
  githubRepo: string | null
): Promise<ResolvedAndroidReleaseInfo> {
  const checkedAt = new Date().toISOString();
  try {
    let res = await fetchFn(url, {
      method: 'HEAD',
      redirect: 'follow',
      headers: { 'User-Agent': 'NEXORA-AI-Release-Resolver' },
      signal: AbortSignal.timeout(5000),
    });
    if (res.status === 405 || res.status === 501) {
      res = await fetchFn(url, {
        method: 'GET',
        redirect: 'follow',
        headers: {
          Range: 'bytes=0-0',
          'User-Agent': 'NEXORA-AI-Release-Resolver',
        },
        signal: AbortSignal.timeout(5000),
      });
    }

    if (!res.ok) {
      return {
        apkAvailable: false,
        apkUrl: null,
        apkStatus: 'unreachable',
        apkSource: 'none',
        githubRepo,
        apkVersion: null,
        apkFileName: null,
        apkSizeBytes: null,
        apkPublishedAt: null,
        releasePageUrl: githubRepo ? `https://github.com/${githubRepo}/releases` : null,
        statusMessage: `Configured APK URL returned HTTP ${res.status} and is not downloadable.`,
        checkedAt,
      };
    }

    const contentLen = Number(res.headers.get('content-length'));
    const finalUrl = res.url && isValidReleaseAssetUrl(res.url) ? res.url : url;
    const versionMatch = finalUrl.match(/\/download\/(v?[0-9]+(?:\.[0-9]+)*[^/]*)\//i);
    const fileMatch = finalUrl.split('/').pop()?.split('?')[0] ?? null;

    return {
      apkAvailable: true,
      apkUrl: finalUrl,
      apkStatus: 'available',
      apkSource: 'env_url',
      githubRepo,
      apkVersion: versionMatch?.[1] ?? null,
      apkFileName: fileMatch,
      apkSizeBytes: Number.isFinite(contentLen) && contentLen > 0 ? contentLen : null,
      apkPublishedAt: null,
      releasePageUrl: githubRepo ? `https://github.com/${githubRepo}/releases` : null,
      checkedAt,
    };
  } catch (err) {
    return {
      apkAvailable: false,
      apkUrl: null,
      apkStatus: 'unreachable',
      apkSource: 'none',
      githubRepo,
      apkVersion: null,
      apkFileName: null,
      apkSizeBytes: null,
      apkPublishedAt: null,
      releasePageUrl: githubRepo ? `https://github.com/${githubRepo}/releases` : null,
      statusMessage: err instanceof Error ? err.message : 'Configured APK URL could not be reached.',
      checkedAt,
    };
  }
}

export async function resolveAndroidReleaseInfo(options?: {
  forceRefresh?: boolean;
  fetchImpl?: typeof fetch;
  githubApiBaseUrl?: string;
}): Promise<ResolvedAndroidReleaseInfo> {
  const githubRepoRaw = process.env.NEXORA_GITHUB_REPO?.trim() || '';
  const githubRepo = isValidGithubRepoSlug(githubRepoRaw) ? githubRepoRaw : null;
  const rawApkUrl = process.env.NEXORA_APK_RELEASE_URL?.trim() || '';
  const validApkUrl = isValidReleaseAssetUrl(rawApkUrl) ? rawApkUrl : '';
  const cacheKey = `${githubRepo ?? ''}|${validApkUrl}`;

  if (!options?.forceRefresh && releaseCache && releaseCache.cacheKey === cacheKey && Date.now() < releaseCache.expiresAt) {
    return releaseCache.value;
  }

  const fetchFn = options?.fetchImpl ?? fetch;
  const githubApiBase = options?.githubApiBaseUrl ?? 'https://api.github.com';
  let resolved: ResolvedAndroidReleaseInfo | null = null;

  if (githubRepo) {
    const ghOut = await resolveFromGithubRepo(githubRepo, fetchFn, githubApiBase);
    if (ghOut.apkAvailable || !validApkUrl) {
      resolved = ghOut;
    }
  }

  if (!resolved && validApkUrl) {
    resolved = await verifyDirectApkUrl(validApkUrl, fetchFn, githubRepo);
  }

  if (!resolved) {
    resolved = {
      apkAvailable: false,
      apkUrl: null,
      apkStatus: rawApkUrl && !validApkUrl ? 'unreachable' : 'not_configured',
      apkSource: 'none',
      githubRepo,
      apkVersion: null,
      apkFileName: null,
      apkSizeBytes: null,
      apkPublishedAt: null,
      releasePageUrl: githubRepo ? `https://github.com/${githubRepo}/releases` : null,
      statusMessage:
        rawApkUrl && !validApkUrl
          ? 'NEXORA_APK_RELEASE_URL is invalid or uses a placeholder value.'
          : 'Configure NEXORA_GITHUB_REPO or NEXORA_APK_RELEASE_URL after publishing your first GitHub Release.',
      checkedAt: new Date().toISOString(),
    };
  }

  releaseCache = {
    cacheKey,
    expiresAt: Date.now() + CACHE_TTL_MS,
    value: resolved,
  };
  return resolved;
}
