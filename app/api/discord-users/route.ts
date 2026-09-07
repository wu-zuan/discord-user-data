type DiscordUser = {
  id: string;
  username: string;
  global_name?: string | null;
  avatar?: string | null;
  discriminator?: string;
};

type PublicProfile = {
  id: string;
  username: string;
  displayName: string;
  avatarUrl: string | null;
};

const profileCache = new Map<string, PublicProfile>();
const USER_AGENT = 'DiscordBot (https://github.com/wu-zuan/discord-user-data, 1.0)';

function defaultAvatarIndex(user: DiscordUser) {
  if (user.discriminator && user.discriminator !== '0') return Number(user.discriminator) % 5;
  return Number((BigInt(user.id) >> BigInt(22)) % BigInt(6));
}

function toDataUrl(buffer: ArrayBuffer, contentType: string) {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 8192) binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
  return `data:${contentType};base64,${btoa(binary)}`;
}

async function fetchProfile(id: string, token: string): Promise<PublicProfile | null> {
  const cached = profileCache.get(id);
  if (cached) return cached;
  const response = await fetch(`https://discord.com/api/v10/users/${id}`, {
    headers: { Authorization: `Bot ${token}`, 'User-Agent': USER_AGENT },
  });
  if (!response.ok) return null;
  const user = await response.json() as DiscordUser;
  const imageUrl = user.avatar
    ? `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.webp?size=128`
    : `https://cdn.discordapp.com/embed/avatars/${defaultAvatarIndex(user)}.png`;
  const imageResponse = await fetch(imageUrl, { headers: { 'User-Agent': USER_AGENT } });
  const avatarUrl = imageResponse.ok ? toDataUrl(await imageResponse.arrayBuffer(), imageResponse.headers.get('content-type') || 'image/webp') : null;
  const profile = { id: user.id, username: user.username, displayName: user.global_name || user.username, avatarUrl };
  profileCache.set(id, profile);
  return profile;
}

export async function POST(request: Request) {
  const token = process.env.DISCORD_BOT_TOKEN;
  if (!token) return Response.json({ error: 'DISCORD_BOT_TOKEN is not configured' }, { status: 503 });
  let body: { ids?: unknown };
  try { body = await request.json() as { ids?: unknown }; }
  catch { return Response.json({ error: 'Invalid JSON body' }, { status: 400 }); }
  if (!Array.isArray(body.ids)) return Response.json({ error: 'ids must be an array' }, { status: 400 });
  const ids = [...new Set(body.ids.filter((id): id is string => typeof id === 'string' && /^\d{17,20}$/.test(id)))].slice(0, 20);
  const profiles: PublicProfile[] = [];
  for (const id of ids) {
    try { const profile = await fetchProfile(id, token); if (profile) profiles.push(profile); }
    catch { /* Keep successfully resolved profiles. */ }
  }
  return Response.json({ profiles }, { headers: { 'Cache-Control': 'private, max-age=3600' } });
}
