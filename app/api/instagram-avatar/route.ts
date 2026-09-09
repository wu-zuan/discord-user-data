type InstagramProfileResponse = {
  data?: {
    user?: {
      profile_pic_url_hd?: string | null;
      profile_pic_url?: string | null;
    } | null;
  };
};

type AvatarPayload = {
  avatarUrl: string | null;
  source: string;
  status: number;
  reason: string;
  authenticated: boolean;
  cachedAt: number;
};

const INSTAGRAM_APP_ID = '936619743392459';
const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';
const avatarCache = new Map<string, AvatarPayload>();

function instagramCookie() {
  return process.env.IG_COOKIE?.trim() || '';
}

function validHandle(value: string | null) {
  const handle = (value || '').replace(/^@+/, '').toLowerCase();
  return /^[a-z0-9._]{1,30}$/i.test(handle) && !/^\d+$/.test(handle)
    ? handle
    : '';
}

async function fetchWithTimeout(url: string, init: RequestInit) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 4500);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

function json(payload: Record<string, unknown>, status = 200) {
  return Response.json(payload, {
    status,
    headers: {
      'Cache-Control': status === 200 ? 'private, max-age=900' : 'no-store',
    },
  });
}

function firstProfileImageFromHtml(html: string) {
  const decoded = html.replace(/\\u0026/g, '&').replace(/\\\//g, '/');
  const patterns = [
    /"profile_pic_url_hd"\s*:\s*"([^"]+)"/,
    /"profile_pic_url"\s*:\s*"([^"]+)"/,
    /<meta\s+property="og:image"\s+content="([^"]+)"/i,
    /<meta\s+content="([^"]+)"\s+property="og:image"/i,
  ];
  for (const pattern of patterns) {
    const match = decoded.match(pattern);
    if (match?.[1]) return match[1].replace(/&amp;/g, '&');
  }
  return null;
}

function instagramHeaders(accept: string, cookie: string) {
  const headers: Record<string, string> = {
    accept,
    referer: 'https://www.instagram.com/',
    'user-agent': USER_AGENT,
    'x-ig-app-id': INSTAGRAM_APP_ID,
    'x-ig-www-claim': '0',
  };
  if (cookie) {
    headers.cookie = cookie;
    const csrf = cookie.match(/(?:^|;\s*)csrftoken=([^;]+)/)?.[1];
    if (csrf) headers['x-csrftoken'] = csrf;
    headers['x-requested-with'] = 'XMLHttpRequest';
  }
  return headers;
}

async function resolveFromWebProfile(handle: string, cookie: string) {
  const response = await fetchWithTimeout(
    `https://www.instagram.com/api/v1/users/web_profile_info/?username=${encodeURIComponent(handle)}`,
    {
      headers: instagramHeaders('application/json', cookie),
    },
  );
  if (!response.ok)
    return {
      avatarUrl: null,
      source: cookie ? 'web_profile_info_cookie' : 'web_profile_info',
      status: response.status,
      reason: `Instagram web profile API returned ${response.status}`,
      authenticated: Boolean(cookie),
    };
  const payload = (await response.json()) as InstagramProfileResponse;
  return {
    avatarUrl:
      payload.data?.user?.profile_pic_url_hd ||
      payload.data?.user?.profile_pic_url ||
      null,
    source: cookie ? 'web_profile_info_cookie' : 'web_profile_info',
    status: response.status,
    reason: 'No avatar URL in web profile response',
    authenticated: Boolean(cookie),
  };
}

async function resolveFromProfileHtml(handle: string, cookie: string) {
  const response = await fetchWithTimeout(
    `https://www.instagram.com/${encodeURIComponent(handle)}/`,
    {
      headers: instagramHeaders('text/html', cookie),
    },
  );
  if (!response.ok)
    return {
      avatarUrl: null,
      source: cookie ? 'profile_html_cookie' : 'profile_html',
      status: response.status,
      reason: `Instagram profile page returned ${response.status}`,
      authenticated: Boolean(cookie),
    };
  return {
    avatarUrl: firstProfileImageFromHtml(await response.text()),
    source: cookie ? 'profile_html_cookie' : 'profile_html',
    status: response.status,
    reason: cookie
      ? 'No avatar URL in profile HTML with IG cookie'
      : 'No avatar URL in public profile HTML',
    authenticated: Boolean(cookie),
  };
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const handle = validHandle(url.searchParams.get('handle'));
  if (!handle)
    return Response.json({ error: 'Invalid Instagram handle' }, { status: 400 });

  const cached = avatarCache.get(handle);
  if (cached && Date.now() - cached.cachedAt < 24 * 60 * 60 * 1000)
    return Response.json(
      {
        handle,
        avatarUrl: cached.avatarUrl,
        source: cached.source,
        status: cached.status,
        reason: cached.reason,
        authenticated: cached.authenticated,
      },
      { headers: { 'Cache-Control': 'private, max-age=86400' } },
    );

  try {
    const cookie = instagramCookie();
    const attempts = [
      await resolveFromProfileHtml(handle, cookie),
      await resolveFromWebProfile(handle, cookie),
    ];
    const success = attempts.find((attempt) => attempt.avatarUrl);
    const result = success || attempts.at(-1);
    if (!result) return json({ handle, avatarUrl: null }, 502);
    avatarCache.set(handle, { ...result, cachedAt: Date.now() });
    return json({ handle, attempts, ...result });
  } catch {
    return json(
      {
        handle,
        avatarUrl: null,
        source: 'network',
        status: 0,
        reason: 'Avatar request failed before Instagram returned a response',
      },
      200,
    );
  }
}
