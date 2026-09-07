'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity, ArrowDownToLine, CalendarDays, Check, ChevronDown, Clock3,
  FileCode2, FileJson, FileSpreadsheet, FolderOpen, Hash, Headphones, Image,
  LockKeyhole, MessageCircle, Search, Server, Share2, Sparkles, Users, X,
} from 'lucide-react';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from '@/components/ui/sheet';

type RawMessage = { Timestamp?: string; Contents?: string; Attachments?: string };
type MessagePoint = { at: number; chars: number; attachments: number; links: number };
type Channel = {
  id: string;
  kind: 'DM' | 'GROUP_DM' | 'GUILD_TEXT' | 'OTHER';
  name: string;
  server: string;
  points: MessagePoint[];
  source: File;
  recipientId?: string;
};
type ChatMessage = { at: number; content: string; attachments: number };
type ConversationState = { name: string; recipientId?: string; messages: ChatMessage[]; loading: boolean; error?: string };
type ParticipantProfile = { id: string; username: string; displayName: string; avatarUrl: string | null; avatar?: ImageBitmap };
type VoiceSession = { at: number; connectedMs: number; speakingMs: number; channelId: string; guildId: string };
type ImportedData = {
  userId: string;
  userName: string;
  userHandle: string;
  bio: string;
  avatar?: ImageBitmap;
  packageName: string;
  channels: Channel[];
  voiceSource?: File;
  channelNames: Record<string, string>;
  guildNames: Record<string, string>;
};
type RangePreset = 'all' | 'year' | 'lastyear' | '90days' | 'custom';
type ChannelFilter = 'all' | 'dm' | 'server';
type ExportFormat = 'excel' | 'html' | 'png';
type ExportPurpose = 'story' | 'share' | 'report';
type ExportSections = { identity: boolean; summary: boolean; people: boolean; trend: boolean; voice: boolean };

const number = new Intl.NumberFormat('zh-TW');
const date = new Intl.DateTimeFormat('zh-TW', { year: 'numeric', month: 'short', day: 'numeric' });
const monthLabel = new Intl.DateTimeFormat('zh-TW', { year: 'numeric', month: 'short' });
const messageTime = new Intl.DateTimeFormat('zh-TW', { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
const weekdays = ['日', '一', '二', '三', '四', '五', '六'];

function normalizePath(path: string) { return path.replace(/\\/g, '/'); }
function parseTimestamp(value?: string) {
  if (!value) return NaN;
  return Date.parse(value.includes('T') ? value : `${value.replace(' ', 'T')}Z`);
}
function countAttachments(value?: string) {
  if (!value?.trim()) return 0;
  return value.split(/\s*,\s*|\r?\n/).filter(Boolean).length;
}
function isUnknownParticipant(name: string) { return /^(unknown participant|未知參與者)$/i.test(name.trim()); }
function channelIdentity(label: string | undefined, kind: Channel['kind'], id: string) {
  const fallback = `未知頻道 · ${id.slice(-6)}`;
  if (!label) return { name: fallback, server: kind === 'DM' ? '私人訊息' : '未知伺服器' };
  if (kind === 'DM') return { name: label.replace(/^Direct Message with\s*/i, '').trim() || fallback, server: '私人訊息' };
  if (kind === 'GROUP_DM') return { name: label === 'Unknown channel' ? '未命名群組' : label, server: '群組私訊' };
  const comma = label.indexOf(', ');
  return comma >= 0
    ? { name: label.slice(0, comma) || fallback, server: label.slice(comma + 2) || '未知伺服器' }
    : { name: label || fallback, server: '未知伺服器' };
}

async function importPackage(files: FileList, onProgress: (value: number) => void): Promise<ImportedData> {
  const all = Array.from(files);
  const byPath = new Map(all.map((file) => [normalizePath(file.webkitRelativePath || file.name), file]));
  const indexFile = all.find((file) => /(^|\/)Messages\/index\.json$/i.test(normalizePath(file.webkitRelativePath)));
  const messageFiles = all.filter((file) => /(^|\/)Messages\/c?\d+\/messages\.json$/i.test(normalizePath(file.webkitRelativePath)));
  if (!indexFile || messageFiles.length === 0) throw new Error('找不到 Discord 訊息資料。請選擇內含 Messages 資料夾的 package。');

  const index = JSON.parse(await indexFile.text()) as Record<string, string>;
  const accountFile = all.find((file) => /(^|\/)Account\/user\.json$/i.test(normalizePath(file.webkitRelativePath)));
  let userName = 'Discord 使用者';
  let userId = '';
  let userHandle = '';
  let bio = '';
  if (accountFile) {
    try {
      const account = JSON.parse(await accountFile.text()) as { id?: string; global_name?: string; username?: string; bio?: string; about_me?: string; pronouns?: string; profile?: { bio?: string }; user_profile?: { bio?: string } };
      userId = account.id || '';
      userName = account.global_name || account.username || userName;
      userHandle = account.username ? `@${account.username}` : '';
      bio = account.bio || account.about_me || account.profile?.bio || account.user_profile?.bio || account.pronouns || '';
    } catch { /* Account data is optional. */ }
  }
  const avatarFile = all.find((file) => /(^|\/)Account\/avatar\.(png|jpe?g|webp|gif)$/i.test(normalizePath(file.webkitRelativePath)));
  let avatar: ImageBitmap | undefined;
  try { if (avatarFile) avatar = await createImageBitmap(avatarFile); } catch { /* Use the generated fallback avatar. */ }

  const channelNames: Record<string, string> = {};
  const guildNames: Record<string, string> = {};
  const guildFiles = all.filter((file) => /(^|\/)Servers\/\d+\/guild\.json$/i.test(normalizePath(file.webkitRelativePath)));
  for (const file of guildFiles) {
    try { const guild = JSON.parse(await file.text()) as { id?: string; name?: string }; if (guild.id && guild.name) guildNames[guild.id] = guild.name; } catch { /* Optional lookup. */ }
  }
  const serverChannelFiles = all.filter((file) => /(^|\/)Servers\/\d+\/channels\.json$/i.test(normalizePath(file.webkitRelativePath)));
  for (const file of serverChannelFiles) {
    try {
      const rows = JSON.parse(await file.text()) as { id?: string; name?: string }[];
      for (const row of rows) if (row.id && row.name) channelNames[row.id] = row.name;
    } catch { /* Optional lookup. */ }
  }

  const channels: Channel[] = [];
  for (let i = 0; i < messageFiles.length; i += 1) {
    const messageFile = messageFiles[i];
    const path = normalizePath(messageFile.webkitRelativePath);
    const channelFile = byPath.get(path.replace(/messages\.json$/i, 'channel.json'));
    let channelJson: { id?: string; type?: string; recipients?: string[] } = {};
    try { if (channelFile) channelJson = JSON.parse(await channelFile.text()); } catch { /* Keep going. */ }
    const folderMatch = path.match(/\/c?(\d+)\/messages\.json$/i);
    const id = String(channelJson.id || folderMatch?.[1] || `channel-${i}`);
    const rawType = String(channelJson.type || 'OTHER');
    const kind: Channel['kind'] = rawType === 'DM' || rawType === 'GROUP_DM' || rawType === 'GUILD_TEXT' ? rawType : 'OTHER';
    const recipientId = kind === 'DM' && userId ? channelJson.recipients?.find((recipient) => recipient !== userId) : undefined;
    const identity = channelIdentity(index[id], kind, id);
    try {
      const parsed = JSON.parse(await messageFile.text()) as RawMessage[] | RawMessage;
      const messages = Array.isArray(parsed) ? parsed : [parsed];
      const points = messages.map((message) => {
        const at = parseTimestamp(message.Timestamp);
        const contents = message.Contents || '';
        return { at, chars: contents.length, attachments: countAttachments(message.Attachments), links: (contents.match(/https?:\/\/\S+/gi) || []).length };
      }).filter((point) => Number.isFinite(point.at));
      if (points.length) channels.push({ id, kind, ...identity, points, source: messageFile, recipientId });
    } catch { /* Skip only malformed channels. */ }
    if (i % 12 === 0 || i === messageFiles.length - 1) onProgress(Math.round(((i + 1) / messageFiles.length) * 100));
  }
  if (!channels.length) throw new Error('訊息檔案存在，但沒有可讀取的時間資料。');
  const root = normalizePath(indexFile.webkitRelativePath).split('/Messages/')[0] || 'package';
  const activityFiles = all.filter((file) => /(^|\/)Activity\/[^/]+\/events-[^/]+\.json$/i.test(normalizePath(file.webkitRelativePath)));
  const voiceSource = activityFiles.sort((a, b) => a.size - b.size)[0];
  return { userId, userName, userHandle, bio, avatar, packageName: root.split('/').pop() || 'package', channels, voiceSource, channelNames, guildNames };
}

function getPresetBounds(preset: RangePreset, latest: number) {
  const currentYear = new Date().getFullYear();
  if (preset === 'year') return { start: new Date(currentYear, 0, 1).getTime(), end: new Date(currentYear + 1, 0, 1).getTime() - 1 };
  if (preset === 'lastyear') return { start: new Date(currentYear - 1, 0, 1).getTime(), end: new Date(currentYear, 0, 1).getTime() - 1 };
  if (preset === '90days') return { start: latest - 90 * 86400000, end: Infinity };
  return { start: -Infinity, end: Infinity };
}

async function scanVoiceActivity(file: File, onProgress: (value: number) => void): Promise<VoiceSession[]> {
  const reader = file.stream().getReader();
  const decoder = new TextDecoder();
  const sessions: VoiceSession[] = [];
  const seen = new Set<string>();
  let buffer = '';
  let readBytes = 0;
  let updates = 0;
  const parseLine = (line: string) => {
    if (!line.includes('"event_type":"voice_disconnect"')) return;
    try {
      const event = JSON.parse(line) as Record<string, unknown>;
      const textValue = (value: unknown) => typeof value === 'string' || typeof value === 'number' ? String(value) : '';
      const eventId = textValue(event.event_id);
      if (eventId && seen.has(eventId)) return;
      if (eventId) seen.add(eventId);
      const rawTimestamp = textValue(event.timestamp).replace(/^"|"$/g, '');
      const at = parseTimestamp(rawTimestamp);
      const connectedMs = Number(event.duration_connected_ms || event.duration || 0);
      const speakingMs = Number(event.duration_speaking_ms || 0);
      if (Number.isFinite(at) && connectedMs > 0) sessions.push({ at, connectedMs, speakingMs, channelId: textValue(event.channel_id), guildId: textValue(event.guild_id) });
    } catch { /* Ignore truncated or malformed activity rows. */ }
  };
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    readBytes += value.byteLength;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() || '';
    for (const line of lines) parseLine(line);
    updates += 1;
    if (updates % 48 === 0) onProgress(Math.min(99, Math.round((readBytes / file.size) * 100)));
  }
  if (buffer) parseLine(buffer);
  onProgress(100);
  return sessions;
}

function formatDuration(ms: number) {
  const hours = Math.floor(ms / 3600000);
  const minutes = Math.round((ms % 3600000) / 60000);
  return hours ? `${number.format(hours)} 小時 ${minutes} 分` : `${minutes} 分鐘`;
}

function StatCard({ icon, label, value, note }: { icon: React.ReactNode; label: string; value: string; note: string }) {
  return <article className="stat-card"><div className="stat-icon">{icon}</div><p>{label}</p><strong>{value}</strong><span>{note}</span></article>;
}

function AvatarImage({ src, alt }: { src: string; alt: string }) {
  // The API already returns a small, private data URL; image optimization cannot improve it.
  // oxlint-disable-next-line next/no-img-element
  return <img src={src} alt={alt} />;
}

function DiscordMark({ size = 21 }: { size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden="true"><path fill="currentColor" d="M17 21c8-6 22-6 30 0 6 10 8 20 6 29-5 4-10 7-15 9l-4-6c-1 0-3 1-4 0l-4 6c-5-2-10-5-15-9-2-9 0-19 6-29Z"/><circle cx="24" cy="37" r="4" fill="#5865f2"/><circle cx="40" cy="37" r="4" fill="#5865f2"/><path d="M21 19l-3-7M43 19l3-7" stroke="currentColor" strokeWidth="5" strokeLinecap="round"/></svg>;
}

function EmptyState({ onChoose }: { onChoose: () => void }) {
  return <main className="import-page">
    <nav className="brand-bar"><div className="brand"><span className="brand-mark"><DiscordMark /></span><span>Discord Lens</span></div><div className="local-pill"><LockKeyhole size={14} /> 只在你的裝置處理</div></nav>
    <section className="import-shell">
      <div className="intro-copy">
        <div className="eyebrow"><Sparkles size={15} /> Discord Data Package 分析器</div>
        <h1>把聊天紀錄，<br /><span>變成看得懂的故事。</span></h1>
        <p>選擇 Discord 匯出的 package 資料夾，幾秒內找出你最常聯絡的人、最活躍的伺服器，以及自己的聊天節奏。</p>
        <div className="privacy-row"><div className="avatars"><span>私</span><span>密</span><span>安</span></div><p><b>零上傳</b><br />所有 JSON 都留在這台電腦</p></div>
      </div>
      <div className="drop-card">
        <div className="folder-illustration"><FolderOpen size={38} /></div><h2>選擇你的 package 資料夾</h2>
        <p>需要包含 <code>Messages/index.json</code> 與各頻道的 <code>messages.json</code></p>
        <button className="primary-button" onClick={onChoose}><FolderOpen size={18} /> 選擇資料夾</button>
        <div className="requirements"><div><Check size={16} /><span><b>基本分析</b>不需要 Token 或 Bot</span></div><div><Check size={16} /><span>可直接套用任何人的官方資料包</span></div><div><Check size={16} /><span>Chrome、Edge 桌面版效果最佳</span></div></div>
      </div>
    </section>
    <section className="feature-strip" aria-label="可用統計"><div><Users size={20} /><span><b>私訊排行</b>最常聯絡的人</span></div><div><Activity size={20} /><span><b>活躍趨勢</b>月份、星期與時段</span></div><div><Server size={20} /><span><b>社群排行</b>伺服器與頻道分布</span></div></section>
    <footer>訊息原文留在瀏覽器 · 頭像可由本機伺服器向 Discord 查詢</footer>
  </main>;
}

export default function Home() {
  const inputRef = useRef<HTMLInputElement>(null);
  const conversationRequestRef = useRef(0);
  const profileRequestedRef = useRef(new Set<string>());
  const [data, setData] = useState<ImportedData | null>(null);
  const [progress, setProgress] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [preset, setPreset] = useState<RangePreset>('all');
  const [channelFilter, setChannelFilter] = useState<ChannelFilter>('all');
  const [customStart, setCustomStart] = useState('');
  const [customEnd, setCustomEnd] = useState('');
  const [query, setQuery] = useState('');
  const [rankingTab, setRankingTab] = useState<'people' | 'servers' | 'channels'>('people');
  const [showUnknownParticipants, setShowUnknownParticipants] = useState(true);
  const [voiceSessions, setVoiceSessions] = useState<VoiceSession[]>([]);
  const [voiceStatus, setVoiceStatus] = useState<'idle' | 'scanning' | 'done' | 'unavailable' | 'error'>('idle');
  const [voiceProgress, setVoiceProgress] = useState(0);
  const [exportOpen, setExportOpen] = useState(false);
  const [exportFormat, setExportFormat] = useState<ExportFormat>('png');
  const [exportPurpose, setExportPurpose] = useState<ExportPurpose>('story');
  const [exportSections, setExportSections] = useState<ExportSections>({ identity: true, summary: true, people: true, trend: true, voice: true });
  const [conversation, setConversation] = useState<ConversationState | null>(null);
  const [visibleMessages, setVisibleMessages] = useState(300);
  const [participantProfiles, setParticipantProfiles] = useState<Record<string, ParticipantProfile>>({});
  const chooseFolder = () => inputRef.current?.click();

  async function handleFiles(files: FileList | null) {
    if (!files?.length) return;
    setLoading(true); setProgress(1); setError('');
    try {
      const imported = await importPackage(files, setProgress);
      data?.avatar?.close();
      Object.values(participantProfiles).forEach((profile) => profile.avatar?.close()); profileRequestedRef.current.clear(); setParticipantProfiles({});
      setData(imported); setPreset('all'); setQuery(''); setVoiceSessions([]);
      if (imported.voiceSource) {
        setVoiceStatus('scanning'); setVoiceProgress(0);
        void scanVoiceActivity(imported.voiceSource, setVoiceProgress)
          .then((sessions) => { setVoiceSessions(sessions); setVoiceStatus('done'); })
          .catch(() => setVoiceStatus('error'));
      } else setVoiceStatus('unavailable');
    }
    catch (reason) { setError(reason instanceof Error ? reason.message : '讀取失敗，請確認資料夾內容。'); }
    finally { setLoading(false); }
  }

  async function analyzeVoice() {
    if (!data?.voiceSource || voiceStatus === 'scanning') return;
    setVoiceStatus('scanning'); setVoiceProgress(0);
    try { setVoiceSessions(await scanVoiceActivity(data.voiceSource, setVoiceProgress)); setVoiceStatus('done'); }
    catch { setVoiceStatus('error'); }
  }

  const derived = useMemo(() => {
    if (!data) return null;
    let earliest = Infinity;
    let latest = -Infinity;
    for (const channel of data.channels) {
      for (const point of channel.points) {
        if (point.at < earliest) earliest = point.at;
        if (point.at > latest) latest = point.at;
      }
    }
    let { start, end } = getPresetBounds(preset, latest);
    if (preset === 'custom') {
      if (customStart) start = new Date(`${customStart}T00:00:00`).getTime();
      if (customEnd) end = new Date(`${customEnd}T23:59:59.999`).getTime();
    }
    const filteredChannels = data.channels
      .filter((channel) => channelFilter === 'all' || (channelFilter === 'dm' ? channel.kind === 'DM' : channel.kind !== 'DM'))
      .map((channel) => ({ ...channel, points: channel.points.filter((point) => point.at >= start && point.at <= end) }))
      .filter((channel) => channel.points.length);
    const points = filteredChannels.flatMap((channel) => channel.points);
    const total = points.length;
    const attachments = points.reduce((sum, point) => sum + point.attachments, 0);
    const links = points.reduce((sum, point) => sum + point.links, 0);
    const chars = points.reduce((sum, point) => sum + point.chars, 0);
    const activeDays = new Set(points.map((point) => new Date(point.at).toISOString().slice(0, 10))).size;
    const aggregate = (key: (channel: Channel) => string, allowed?: (channel: Channel) => boolean) => {
      const map = new Map<string, number>();
      filteredChannels.filter(allowed || (() => true)).forEach((channel) => map.set(key(channel), (map.get(key(channel)) || 0) + channel.points.length));
      return [...map.entries()].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count);
    };
    const people = aggregate((channel) => channel.name, (channel) => channel.kind === 'DM');
    const servers = aggregate((channel) => channel.server, (channel) => channel.kind !== 'DM');
    const channels = filteredChannels.map((channel) => ({ name: `${channel.name} · ${channel.server}`, count: channel.points.length })).sort((a, b) => b.count - a.count);
    const months = new Map<string, number>();
    points.forEach((point) => { const d = new Date(point.at); const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`; months.set(key, (months.get(key) || 0) + 1); });
    const trend = [...months.entries()].sort(([a], [b]) => a.localeCompare(b)).slice(-18).map(([key, count]) => ({ key, count }));
    const hours = Array.from({ length: 24 }, () => 0); const days = Array.from({ length: 7 }, () => 0);
    points.forEach((point) => { const d = new Date(point.at); hours[d.getHours()] += 1; days[d.getDay()] += 1; });
    const filteredVoice = voiceSessions.filter((session) => session.at >= start && session.at <= end);
    const voiceConnectedMs = filteredVoice.reduce((sum, session) => sum + session.connectedMs, 0);
    const voiceSpeakingMs = filteredVoice.reduce((sum, session) => sum + session.speakingMs, 0);
    const voicePlaces = new Map<string, number>();
    filteredVoice.forEach((session) => {
      const channelName = data.channelNames[session.channelId] || (session.channelId ? `語音頻道 · ${session.channelId.slice(-6)}` : '私人通話');
      const guildName = data.guildNames[session.guildId];
      const name = guildName ? `${channelName} · ${guildName}` : channelName;
      voicePlaces.set(name, (voicePlaces.get(name) || 0) + session.connectedMs);
    });
    const topVoicePlaces = [...voicePlaces.entries()].map(([name, durationMs]) => ({ name, durationMs })).sort((a, b) => b.durationMs - a.durationMs).slice(0, 6);
    return { start, end, earliest, latest, total, attachments, links, chars, activeDays, people, servers, channels, trend, hours, days, peakHour: hours.indexOf(Math.max(...hours)), peakDay: days.indexOf(Math.max(...days)), voiceConnectedMs, voiceSpeakingMs, voiceCount: filteredVoice.length, topVoicePlaces };
  }, [data, preset, channelFilter, customStart, customEnd, voiceSessions]);

  const rangeText = useMemo(() => {
    if (!derived) return '';
    if (preset === 'year') return `${new Date().getFullYear()} 年`;
    if (preset === 'lastyear') return `${new Date().getFullYear() - 1} 年`;
    if (preset === '90days') return '近 90 天';
    if (preset === 'custom') return `${customStart || '最早'} 至 ${customEnd || '現在'}`;
    return `${date.format(derived.earliest)} 至 ${date.format(derived.latest)}`;
  }, [derived, preset, customStart, customEnd]);

  useEffect(() => {
    if (!data || !derived) return;
    const requestedIds = profileRequestedRef.current;
    const ids = [...new Set(derived.people.filter((item) => showUnknownParticipants || !isUnknownParticipant(item.name)).map((item) => data.channels.find((channel) => channel.kind === 'DM' && channel.name === item.name && channel.recipientId)?.recipientId).filter((id): id is string => Boolean(id)))].slice(0, 20).filter((id) => !requestedIds.has(id));
    if (!ids.length) return;
    ids.forEach((id) => requestedIds.add(id));
    const controller = new AbortController();
    let settled = false;
    void fetch('/api/discord-users', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ids }), signal: controller.signal })
      .then((response) => { if (!response.ok) throw new Error('Profile lookup failed'); return response.json() as Promise<{ profiles?: ParticipantProfile[] }>; })
      .then(async ({ profiles = [] }) => {
        const hydrated = await Promise.all(profiles.map(async (profile) => {
          if (!profile.avatarUrl) return profile;
          try { const avatar = await createImageBitmap(await (await fetch(profile.avatarUrl)).blob()); return { ...profile, avatar }; }
          catch { return profile; }
        }));
        settled = true;
        const resolvedIds = new Set(hydrated.map((profile) => profile.id));
        ids.filter((id) => !resolvedIds.has(id)).forEach((id) => requestedIds.delete(id));
        setParticipantProfiles((current) => ({ ...current, ...Object.fromEntries(hydrated.map((profile) => [profile.id, profile])) }));
      })
      .catch(() => ids.forEach((id) => requestedIds.delete(id)));
    return () => {
      controller.abort();
      if (!settled) ids.forEach((id) => requestedIds.delete(id));
    };
  }, [data, derived, showUnknownParticipants]);

  async function openConversation(name: string) {
    if (!data || !derived) return;
    const requestId = ++conversationRequestRef.current;
    const rangeStart = derived.start; const rangeEnd = derived.end;
    const matchingChannels = data.channels.filter((channel) => channel.kind === 'DM' && channel.name === name);
    const recipientId = matchingChannels.find((channel) => channel.recipientId)?.recipientId;
    setVisibleMessages(300); setConversation({ name, recipientId, messages: [], loading: true });
    try {
      const sources = matchingChannels.map((channel) => channel.source);
      const groups = await Promise.all(sources.map(async (source) => {
        const parsed = JSON.parse(await source.text()) as RawMessage[] | RawMessage;
        return (Array.isArray(parsed) ? parsed : [parsed]).map((message) => ({ at: parseTimestamp(message.Timestamp), content: message.Contents || '', attachments: countAttachments(message.Attachments) }));
      }));
      if (requestId !== conversationRequestRef.current) return;
      const messages = groups.flat().filter((message) => Number.isFinite(message.at) && message.at >= rangeStart && message.at <= rangeEnd).sort((a, b) => b.at - a.at);
      setConversation({ name, recipientId, messages, loading: false });
    } catch { if (requestId === conversationRequestRef.current) setConversation({ name, recipientId, messages: [], loading: false, error: '無法讀取這個私訊頻道的訊息檔案。' }); }
  }

  function downloadBlob(blob: Blob, filename: string) {
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url; anchor.download = filename; anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function exportExcel() {
    if (!derived || !data) return;
    const xml = (value: string | number) => String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    const row = (cells: (string | number)[], header = false) => `<Row>${cells.map((cell) => `<Cell${header ? ' ss:StyleID="Header"' : ''}><Data ss:Type="${typeof cell === 'number' ? 'Number' : 'String'}">${xml(cell)}</Data></Cell>`).join('')}</Row>`;
    const sheets: string[] = [];
    const summaryRows: string[] = [row(['Discord Lens 匯出報告'], true), row(['篩選範圍', rangeText])];
    if (exportSections.identity) { summaryRows.push(row(['帳號名稱', data.userName])); if (data.userHandle) summaryRows.push(row(['Discord 帳號', data.userHandle])); if (data.bio.trim()) summaryRows.push(row(['自介', data.bio.trim()])); }
    if (exportSections.summary) summaryRows.push(row(['送出訊息', derived.total]), row(['活躍日', derived.activeDays]), row(['私訊對象', derived.people.length]), row(['活躍頻道', derived.channels.length]), row(['附件', derived.attachments]), row(['連結', derived.links]));
    if (exportSections.voice && voiceStatus === 'done') summaryRows.push(row(['語音連線（分鐘）', Math.round(derived.voiceConnectedMs / 60000)]), row(['實際發言（分鐘）', Math.round(derived.voiceSpeakingMs / 60000)]), row(['通話場次', derived.voiceCount]));
    sheets.push(`<Worksheet ss:Name="摘要"><Table>${summaryRows.join('')}</Table></Worksheet>`);
    if (exportSections.people) sheets.push(`<Worksheet ss:Name="私訊排行"><Table>${row(['排名', '對象', '訊息數'], true)}${derived.people.filter((item) => showUnknownParticipants || !isUnknownParticipant(item.name)).map((item, index) => row([index + 1, item.name, item.count])).join('')}</Table></Worksheet>`);
    if (exportSections.trend) sheets.push(`<Worksheet ss:Name="每月趨勢"><Table>${row(['月份', '訊息數'], true)}${derived.trend.map((item) => row([item.key, item.count])).join('')}</Table></Worksheet>`);
    if (exportSections.voice && voiceStatus === 'done') sheets.push(`<Worksheet ss:Name="語音排行"><Table>${row(['排名', '頻道', '分鐘'], true)}${derived.topVoicePlaces.map((item, index) => row([index + 1, item.name, Math.round(item.durationMs / 60000)])).join('')}</Table></Worksheet>`);
    const workbook = `<?xml version="1.0"?><Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet"><Styles><Style ss:ID="Header"><Font ss:Color="#FFFFFF" ss:Bold="1"/><Interior ss:Color="#5965E8" ss:Pattern="Solid"/></Style></Styles>${sheets.join('')}</Workbook>`;
    downloadBlob(new Blob([`\uFEFF${workbook}`], { type: 'application/vnd.ms-excel;charset=utf-8' }), 'discord-lens-report.xls');
  }

  function exportHtml() {
    if (!derived || !data) return;
    const html = (value: string | number) => String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    const topPeople = derived.people.filter((item) => showUnknownParticipants || !isUnknownParticipant(item.name)).slice(0, 10);
    const sections = [
      exportSections.summary ? `<section><h2>重點數據</h2><div class="cards"><div><span>送出的訊息</span><b>${number.format(derived.total)}</b></div><div><span>活躍日</span><b>${number.format(derived.activeDays)}</b></div><div><span>私訊對象</span><b>${number.format(derived.people.length)}</b></div><div><span>活躍頻道</span><b>${number.format(derived.channels.length)}</b></div></div></section>` : '',
      exportSections.people ? `<section><h2>最常聯絡</h2><ol>${topPeople.map((item) => `<li><span>${html(item.name)}</span><b>${number.format(item.count)} 則</b></li>`).join('')}</ol></section>` : '',
      exportSections.trend ? `<section><h2>每月趨勢</h2><div class="trend">${derived.trend.map((item) => `<div><span style="height:${Math.max(5, item.count / Math.max(1, ...derived.trend.map((x) => x.count)) * 100)}%"></span><small>${html(item.key)}</small></div>`).join('')}</div></section>` : '',
      exportSections.voice && voiceStatus === 'done' ? `<section><h2>語音活動</h2><div class="cards"><div><span>連線時間</span><b>${formatDuration(derived.voiceConnectedMs)}</b></div><div><span>實際發言</span><b>${formatDuration(derived.voiceSpeakingMs)}</b></div><div><span>通話場次</span><b>${number.format(derived.voiceCount)}</b></div></div></section>` : '',
    ].join('');
    const profileHtml = exportSections.identity ? `<h1>${html(data.userName)}</h1>${data.userHandle ? `<p>${html(data.userHandle)}</p>` : ''}${data.bio.trim() ? `<p class="bio">${html(data.bio.trim())}</p>` : ''}` : '<h1>Discord 使用報告</h1>';
    const documentHtml = `<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Discord Lens 報告</title><style>*{box-sizing:border-box}body{margin:0;background:#090e1a;color:#edf2ff;font-family:Arial,"Noto Sans TC",sans-serif}.page{width:min(100% - 40px,900px);margin:auto;padding:64px 0}.brand{color:#9da6ff;font-weight:800}h1{font-size:42px;margin:14px 0 8px}header p{margin:5px 0;color:#8f9bb5}.bio{max-width:650px;color:#c5ccdc!important;font-size:16px;line-height:1.6}section{margin-top:20px;padding:24px;border:1px solid #27314a;border-radius:18px;background:#12192a}h2{margin:0 0 18px;font-size:20px}.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px}.cards div{padding:16px;border-radius:12px;background:#0e1525}.cards span{display:block;color:#7f8ba7;font-size:12px}.cards b{display:block;margin-top:7px;font-size:22px}ol{margin:0;padding:0;list-style:none}li{display:flex;justify-content:space-between;padding:10px 0;border-bottom:1px solid #27314a}li span{color:#cbd3e4}.trend{height:220px;display:flex;align-items:end;gap:8px}.trend div{height:100%;flex:1;display:flex;align-items:center;justify-content:end;flex-direction:column}.trend div span{width:70%;border-radius:5px 5px 0 0;background:#5965e8}.trend small{margin-top:7px;color:#77839e;font-size:9px}footer{margin-top:24px;color:#66728c;font-size:12px}</style></head><body><main class="page"><header><div class="brand">DISCORD LENS</div>${profileHtml}<p>${html(rangeText)}</p></header>${sections}<footer>由 Discord Data Package 在本機產生 · 統計以匯出資料為準</footer></main></body></html>`;
    downloadBlob(new Blob([documentHtml], { type: 'text/html;charset=utf-8' }), 'discord-lens-report.html');
  }

  function renderPngCanvas(canvas: HTMLCanvasElement) {
    if (!derived || !data) return false;
    const sizes = { story: [1080, 1920], share: [1200, 1200], report: [1600, 1200] } as const;
    const [width, height] = sizes[exportPurpose];
    canvas.width = width; canvas.height = height;
    const ctx = canvas.getContext('2d'); if (!ctx) return false;
    const C = { bg: '#111214', panel: '#1e1f22', panel2: '#2b2d31', line: '#3f4147', text: '#f2f3f5', muted: '#b5bac1', dim: '#80848e', blurple: '#5865f2', light: '#c9cdfb', green: '#23a559', yellow: '#f0b232' };
    const exportPeople = derived.people.filter((item) => showUnknownParticipants || !isUnknownParticipant(item.name));
    const rounded = (x: number, y: number, w: number, h: number, r: number, fill: string, stroke?: string) => { ctx.beginPath(); ctx.roundRect(x, y, w, h, r); ctx.fillStyle = fill; ctx.fill(); if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = 2; ctx.stroke(); } };
    const font = (size: number, weight = 600) => { ctx.font = `${weight} ${size}px "Segoe UI", Arial, sans-serif`; };
    const fitText = (value: string, maxWidth: number) => { let result = value; while (result.length > 2 && ctx.measureText(result).width > maxWidth) result = `${result.slice(0, -2)}…`; return result; };
    const drawLines = (value: string, x: number, y: number, maxWidth: number, lineHeight: number, maxLines = 2) => {
      const characters = Array.from(value.trim()); const lines: string[] = []; let line = '';
      for (const character of characters) {
        const candidate = line + character;
        if (line && ctx.measureText(candidate).width > maxWidth) { lines.push(line); line = character; if (lines.length === maxLines) break; }
        else line = candidate;
      }
      if (lines.length < maxLines && line) lines.push(line);
      if (lines.join('').length < characters.length && lines.length) lines[lines.length - 1] = fitText(`${lines[lines.length - 1]}…`, maxWidth);
      lines.forEach((text, index) => ctx.fillText(text, x, y + index * lineHeight));
    };
    const drawBackground = () => {
      ctx.fillStyle = C.bg; ctx.fillRect(0, 0, width, height);
      const glow = ctx.createRadialGradient(width * .86, height * .08, 0, width * .86, height * .08, width * .48); glow.addColorStop(0, 'rgba(88,101,242,.28)'); glow.addColorStop(1, 'rgba(88,101,242,0)'); ctx.fillStyle = glow; ctx.fillRect(0, 0, width, height * .55);
      const glow2 = ctx.createRadialGradient(width * .05, height * .88, 0, width * .05, height * .88, width * .42); glow2.addColorStop(0, 'rgba(35,165,89,.11)'); glow2.addColorStop(1, 'rgba(35,165,89,0)'); ctx.fillStyle = glow2; ctx.fillRect(0, height * .45, width, height * .55);
    };
    const drawBrand = (x: number, y: number, size: number) => {
      rounded(x, y, size, size, size * .3, C.blurple);
      ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.moveTo(x + size * .23, y + size * .37); ctx.bezierCurveTo(x + size * .34, y + size * .28, x + size * .66, y + size * .28, x + size * .77, y + size * .37); ctx.bezierCurveTo(x + size * .86, y + size * .53, x + size * .82, y + size * .69, x + size * .68, y + size * .76); ctx.lineTo(x + size * .6, y + size * .66); ctx.bezierCurveTo(x + size * .53, y + size * .69, x + size * .47, y + size * .69, x + size * .4, y + size * .66); ctx.lineTo(x + size * .32, y + size * .76); ctx.bezierCurveTo(x + size * .18, y + size * .69, x + size * .14, y + size * .53, x + size * .23, y + size * .37); ctx.fill();
      ctx.fillStyle = C.blurple; ctx.beginPath(); ctx.arc(x + size * .39, y + size * .51, size * .065, 0, Math.PI * 2); ctx.arc(x + size * .61, y + size * .51, size * .065, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = C.text; font(size * .34, 800); ctx.fillText('Discord Lens', x + size * 1.25, y + size * .66);
    };
    const drawAvatar = (x: number, y: number, size: number) => {
      ctx.save(); ctx.beginPath(); ctx.arc(x + size / 2, y + size / 2, size / 2, 0, Math.PI * 2); ctx.clip();
      if (data.avatar) {
        const scale = Math.max(size / data.avatar.width, size / data.avatar.height); const dw = data.avatar.width * scale; const dh = data.avatar.height * scale;
        ctx.drawImage(data.avatar, x + (size - dw) / 2, y + (size - dh) / 2, dw, dh);
      } else {
        const avatarGlow = ctx.createLinearGradient(x, y, x + size, y + size); avatarGlow.addColorStop(0, C.blurple); avatarGlow.addColorStop(1, '#9b84ee'); ctx.fillStyle = avatarGlow; ctx.fillRect(x, y, size, size); ctx.fillStyle = '#fff'; font(size * .43, 800); ctx.textAlign = 'center'; ctx.fillText(Array.from(data.userName)[0]?.toUpperCase() || '?', x + size / 2, y + size * .66); ctx.textAlign = 'left';
      }
      ctx.restore(); ctx.strokeStyle = C.panel2; ctx.lineWidth = Math.max(5, size * .06); ctx.beginPath(); ctx.arc(x + size / 2, y + size / 2, size / 2, 0, Math.PI * 2); ctx.stroke(); ctx.fillStyle = C.green; ctx.beginPath(); ctx.arc(x + size * .84, y + size * .84, size * .13, 0, Math.PI * 2); ctx.fill(); ctx.strokeStyle = C.panel2; ctx.lineWidth = Math.max(4, size * .045); ctx.stroke();
    };
    const drawHeader = (pad: number, compact = false) => {
      const mark = compact ? 48 : 58; drawBrand(pad, compact ? 54 : 68, mark);
      if (exportSections.identity) {
        const avatarSize = compact ? 82 : 112; const avatarY = compact ? 128 : 166; const profileX = pad + avatarSize + (compact ? 24 : 30);
        ctx.fillStyle = C.light; font(compact ? 12 : 14, 800); ctx.fillText(exportPurpose === 'story' ? 'MY DISCORD STORY' : 'MY DISCORD REPORT', pad, avatarY - 16);
        drawAvatar(pad, avatarY, avatarSize); ctx.fillStyle = C.text; font(compact ? 36 : 46, 800); ctx.fillText(fitText(data.userName, width - profileX - pad), profileX, avatarY + (compact ? 35 : 43));
        ctx.fillStyle = C.muted; font(compact ? 16 : 18, 550); ctx.fillText(data.userHandle || 'Discord 使用者', profileX, avatarY + (compact ? 62 : 73));
        if (data.bio.trim()) { ctx.fillStyle = C.muted; font(compact ? 14 : 17, 500); drawLines(data.bio, profileX, avatarY + (compact ? 86 : 101), width - profileX - pad, compact ? 19 : 23, 2); }
        const badgeY = compact ? 244 : 304; rounded(pad, badgeY, compact ? 278 : 320, compact ? 35 : 40, 20, 'rgba(88,101,242,.18)', 'rgba(88,101,242,.45)'); ctx.fillStyle = C.light; font(compact ? 13 : 15, 700); ctx.fillText(`●  ${fitText(rangeText, compact ? 240 : 280)}`, pad + 16, badgeY + (compact ? 23 : 26));
        return compact ? 298 : 360;
      }
      const titleY = compact ? 165 : 196; ctx.fillStyle = C.text; font(compact ? 48 : 62, 800); ctx.fillText(exportPurpose === 'story' ? 'Discord 足跡' : 'Discord 使用報告', pad, titleY);
      ctx.fillStyle = C.muted; font(compact ? 18 : 21, 500); ctx.fillText(fitText(rangeText, width - pad * 2), pad, titleY + (compact ? 42 : 48));
      rounded(pad, titleY + (compact ? 64 : 74), compact ? 166 : 186, compact ? 35 : 40, 20, 'rgba(88,101,242,.18)', 'rgba(88,101,242,.45)'); ctx.fillStyle = C.light; font(compact ? 13 : 15, 700); ctx.fillText('●  本機產生 · 原文不上傳', pad + 16, titleY + (compact ? 87 : 100));
      return titleY + (compact ? 123 : 142);
    };
    const drawStats = (x: number, y: number, w: number, cardH: number, columns: number) => {
      const items = [['送出的訊息', number.format(derived.total), C.blurple], ['活躍日', number.format(derived.activeDays), C.green], ['私訊對象', number.format(derived.people.length), C.yellow], ['活躍頻道', number.format(derived.channels.length), '#eb459e']];
      const gap = 14; const cardW = (w - gap * (columns - 1)) / columns;
      items.forEach(([label, value, color], index) => { const col = index % columns; const row = Math.floor(index / columns); const left = x + col * (cardW + gap); const top = y + row * (cardH + gap); rounded(left, top, cardW, cardH, 20, C.panel2, C.line); rounded(left + 20, top + 20, 10, 42, 5, color); ctx.fillStyle = C.muted; font(16, 650); ctx.fillText(label, left + 47, top + 37); ctx.fillStyle = C.text; font(columns === 4 ? 30 : 36, 800); ctx.fillText(value, left + 47, top + 82); });
      return Math.ceil(items.length / columns) * cardH + (Math.ceil(items.length / columns) - 1) * gap;
    };
    const drawPeople = (x: number, y: number, w: number, h: number, count: number) => {
      rounded(x, y, w, h, 24, C.panel, C.line); ctx.fillStyle = C.text; font(25, 750); ctx.fillText('最常聯絡', x + 28, y + 43); ctx.fillStyle = C.dim; font(14, 550); ctx.textAlign = 'right'; ctx.fillText('你送出的訊息', x + w - 28, y + 42); ctx.textAlign = 'left';
      const top = exportPeople.slice(0, count); const max = Math.max(1, ...top.map((item) => item.count)); const rowH = (h - 80) / Math.max(1, top.length); const avatarColors = ['#5865f2', '#23a559', '#eb459e', '#f0b232', '#3ba55c', '#9b84ee'];
      top.forEach((item, index) => {
        const cy = y + 78 + index * rowH;
        const recipientId = data.channels.find((channel) => channel.kind === 'DM' && channel.name === item.name && channel.recipientId)?.recipientId;
        const avatar = recipientId ? participantProfiles[recipientId]?.avatar : undefined;
        ctx.save(); ctx.beginPath(); ctx.arc(x + 50, cy, 21, 0, Math.PI * 2); ctx.clip();
        if (avatar) {
          const size = 42; const scale = Math.max(size / avatar.width, size / avatar.height); const dw = avatar.width * scale; const dh = avatar.height * scale;
          ctx.drawImage(avatar, x + 50 - dw / 2, cy - dh / 2, dw, dh);
        } else {
          ctx.fillStyle = avatarColors[index % avatarColors.length]; ctx.fillRect(x + 29, cy - 21, 42, 42); ctx.fillStyle = '#fff'; font(15, 800); ctx.textAlign = 'center'; ctx.fillText(Array.from(item.name)[0]?.toUpperCase() || '?', x + 50, cy + 5);
        }
        ctx.restore(); ctx.strokeStyle = C.panel2; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(x + 50, cy, 21, 0, Math.PI * 2); ctx.stroke(); ctx.textAlign = 'left'; ctx.fillStyle = C.text; font(16, 650); ctx.fillText(fitText(`${index + 1}. ${item.name}`, w * .53), x + 84, cy + 1); ctx.fillStyle = C.light; font(15, 750); ctx.textAlign = 'right'; ctx.fillText(`${number.format(item.count)} 則`, x + w - 28, cy + 1); ctx.textAlign = 'left'; rounded(x + 84, cy + 13, w - 112, 7, 4, '#3a3c43'); rounded(x + 84, cy + 13, (w - 112) * item.count / max, 7, 4, C.blurple);
      });
    };
    const drawTrend = (x: number, y: number, w: number, h: number) => {
      rounded(x, y, w, h, 24, C.panel, C.line); ctx.fillStyle = C.text; font(24, 750); ctx.fillText('每月訊息趨勢', x + 28, y + 43); const items = derived.trend.slice(-12); const max = Math.max(1, ...items.map((item) => item.count)); const chartTop = y + 76; const chartH = h - 116; const gap = 9; const barW = (w - 56 - gap * Math.max(0, items.length - 1)) / Math.max(1, items.length);
      items.forEach((item, index) => { const barH = Math.max(8, chartH * item.count / max); const left = x + 28 + index * (barW + gap); rounded(left, chartTop + chartH - barH, barW, barH, Math.min(7, barW / 2), index === items.length - 1 ? C.green : C.blurple); if (index % 3 === 0) { ctx.fillStyle = C.dim; font(10, 550); ctx.textAlign = 'center'; ctx.fillText(item.key.slice(5), left + barW / 2, y + h - 20); ctx.textAlign = 'left'; } });
    };
    const drawVoice = (x: number, y: number, w: number, h: number) => {
      rounded(x, y, w, h, 24, C.panel, C.line); rounded(x + 27, y + 27, 52, 52, 16, 'rgba(35,165,89,.18)', 'rgba(35,165,89,.5)'); ctx.strokeStyle = C.green; ctx.lineWidth = 6; ctx.lineCap = 'round'; ctx.beginPath(); ctx.arc(x + 53, y + 52, 12, Math.PI, 0); ctx.stroke(); ctx.fillStyle = C.muted; font(15, 650); ctx.fillText('語音連線時間', x + 98, y + 43); ctx.fillStyle = C.text; font(31, 800); ctx.fillText(formatDuration(derived.voiceConnectedMs), x + 98, y + 78); ctx.fillStyle = C.dim; font(14, 550); ctx.fillText(`${number.format(derived.voiceCount)} 次通話  ·  發言 ${formatDuration(derived.voiceSpeakingMs)}`, x + 28, y + h - 25);
    };
    const drawFooter = () => { ctx.fillStyle = C.dim; font(14, 550); ctx.fillText('DISCORD LENS', exportPurpose === 'report' ? 80 : 70, height - 56); ctx.textAlign = 'right'; ctx.fillText('統計只包含本人送出的訊息', width - (exportPurpose === 'report' ? 80 : 70), height - 56); ctx.textAlign = 'left'; };

    drawBackground();
    if (exportPurpose === 'story') {
      const pad = 70; let y = drawHeader(pad);
      if (exportSections.summary) y += drawStats(pad, y, width - pad * 2, 132, 2) + 22;
      if (exportSections.people) { drawPeople(pad, y, width - pad * 2, 470, 6); y += 492; }
      if (exportSections.trend) { drawTrend(pad, y, width - pad * 2, 300); y += 322; }
      if (exportSections.voice && voiceStatus === 'done') drawVoice(pad, y, width - pad * 2, 150);
    } else if (exportPurpose === 'share') {
      const pad = 62; const start = drawHeader(pad, true); let y = start;
      if (exportSections.summary) y += drawStats(pad, y, width - pad * 2, 108, 4) + 20;
      const leftW = 650; const rightX = pad + leftW + 18; const rightW = width - pad - rightX;
      if (exportSections.people) drawPeople(pad, y, leftW, 500, 6);
      if (exportSections.trend) drawTrend(rightX, y, rightW, 300);
      if (exportSections.voice && voiceStatus === 'done') drawVoice(rightX, y + 318, rightW, 182);
    } else {
      const pad = 80; const start = drawHeader(pad, true); let y = start;
      if (exportSections.summary) y += drawStats(pad, y, width - pad * 2, 110, 4) + 20;
      const leftW = 880; const rightX = pad + leftW + 20; const rightW = width - pad - rightX;
      if (exportSections.people) drawPeople(pad, y, leftW, 600, 7);
      if (exportSections.trend) drawTrend(rightX, y, rightW, 360);
      if (exportSections.voice && voiceStatus === 'done') drawVoice(rightX, y + 380, rightW, 220);
    }
    drawFooter();
    return true;
  }

  function exportPng() {
    const canvas = document.createElement('canvas');
    if (!renderPngCanvas(canvas)) return;
    canvas.toBlob((blob) => { if (blob) downloadBlob(blob, `discord-lens-${exportPurpose}.png`); }, 'image/png');
  }

  function exportSelected() {
    if (exportFormat === 'excel') exportExcel();
    else if (exportFormat === 'html') exportHtml();
    else exportPng();
    setExportOpen(false);
  }

  useEffect(() => {
    type WebTool = { name: string; title: string; description: string; inputSchema: object; annotations: { readOnlyHint: boolean; untrustedContentHint: boolean }; execute: () => unknown };
    type ModelContext = { registerTool: (tool: WebTool, options?: { signal?: AbortSignal }) => void | Promise<void> };
    const context = (document as Document & { modelContext?: ModelContext }).modelContext;
    if (!context?.registerTool) return;
    const lifecycle = new AbortController();
    const register = (tool: WebTool) => { try { void Promise.resolve(context.registerTool(tool, { signal: lifecycle.signal })).catch(() => undefined); } catch { /* Unsupported preview contexts can ignore WebMCP. */ } };
    register({ name: 'start_discord_package_import', title: '選擇 Discord 資料包', description: '開啟資料夾選擇器，讓使用者選擇要在本機分析的 Discord Data Package。', inputSchema: { type: 'object', properties: {}, additionalProperties: false }, annotations: { readOnlyHint: false, untrustedContentHint: false }, execute: () => { chooseFolder(); return { status: 'folder_picker_opened' }; } });
    register({ name: 'start_discord_report_export', title: '建立 Discord 分享報告', description: '開啟匯出設定，選擇 Excel、HTML 或 PNG 以及要分享的內容。', inputSchema: { type: 'object', properties: {}, additionalProperties: false }, annotations: { readOnlyHint: false, untrustedContentHint: true }, execute: () => { if (!derived) throw new Error('尚未匯入 Discord 資料包'); setExportOpen(true); return { status: 'export_options_opened' }; } });
    return () => lifecycle.abort();
  }, [derived]);

  const input = <input ref={inputRef} className="sr-only" type="file" multiple onChange={(event) => handleFiles(event.target.files)} {...({ webkitdirectory: '', directory: '' } as React.InputHTMLAttributes<HTMLInputElement>)} />;
  if (!data) return <>{input}<EmptyState onChoose={chooseFolder} />{loading && <Loading progress={progress} label="正在讀取訊息" />}{error && <ErrorToast error={error} close={() => setError('')} />}</>;

  const ranking = rankingTab === 'people' ? (derived?.people || []).filter((item) => showUnknownParticipants || !isUnknownParticipant(item.name)) : rankingTab === 'servers' ? derived?.servers || [] : derived?.channels || [];
  const searched = ranking.filter((row) => row.name.toLowerCase().includes(query.toLowerCase())).slice(0, 12);
  const maxRank = Math.max(1, ...searched.map((row) => row.count));
  const maxTrend = Math.max(1, ...(derived?.trend.map((item) => item.count) || []));
  const maxHour = Math.max(1, ...(derived?.hours || []));
  const rankContent = (row: { name: string; count: number }, index: number) => {
    const recipientId = rankingTab === 'people' ? data.channels.find((channel) => channel.kind === 'DM' && channel.name === row.name && channel.recipientId)?.recipientId : undefined;
    const profile = recipientId ? participantProfiles[recipientId] : undefined;
    const rankMarker = rankingTab === 'people'
      ? <span className="rank-avatar">{profile?.avatarUrl ? <AvatarImage src={profile.avatarUrl} alt={`${row.name} 的 Discord 頭像`} /> : <span>{Array.from(row.name)[0]?.toUpperCase() || '?'}</span>}<i>{index + 1}</i></span>
      : <span className={`rank-number ${index < 3 ? 'top' : ''}`}>{index + 1}</span>;
    return <>{rankMarker}<div className="rank-main"><div className="rank-label"><div className="rank-person"><span>{row.name}</span>{recipientId && <small>ID: {recipientId}</small>}</div><b>{number.format(row.count)} 則</b></div><div className="rank-track"><span style={{ width: `${Math.max(3, (row.count / maxRank) * 100)}%` }} /></div></div>{rankingTab === 'people' && <MessageCircle className="rank-open-icon" size={16} />}</>;
  };

  return <main className="dashboard">
    {input}
    <header className="dashboard-header"><div className="brand"><span className="brand-mark"><DiscordMark /></span><span>Discord Lens</span></div><div className="header-actions"><span className="privacy-note"><LockKeyhole size={14} /> 本機分析</span><button className="ghost-button" onClick={chooseFolder}><FolderOpen size={16} /> 更換資料</button><button className="export-button" onClick={() => setExportOpen(true)}><Share2 size={16} /> 建立分享報告</button></div></header>
    <div className="dashboard-shell">
      <section className="welcome-row"><div><p className="eyebrow">{data.packageName} · {data.userName}</p><h1>你的 Discord 訊息總覽</h1><p>統計只包含你送出的訊息，所有資料都在瀏覽器內處理。</p></div><div className="date-chip"><CalendarDays size={18} /><span>{derived ? `${date.format(derived.earliest)} — ${date.format(derived.latest)}` : '—'}</span></div></section>
      <section className="filter-bar" aria-label="篩選條件">
        <div className="segmented">{([['all', '從最早到現在'], ['year', `${new Date().getFullYear()} 年`], ['lastyear', `${new Date().getFullYear() - 1} 年`], ['90days', '近 90 天'], ['custom', '自訂區間']] as [RangePreset, string][]).map(([value, label]) => <button key={value} className={preset === value ? 'active' : ''} onClick={() => setPreset(value)}>{label}</button>)}</div>
        {preset === 'custom' && <div className="custom-dates"><input type="date" value={customStart} onChange={(e) => setCustomStart(e.target.value)} aria-label="開始日期" /><span>至</span><input type="date" value={customEnd} onChange={(e) => setCustomEnd(e.target.value)} aria-label="結束日期" /></div>}
        <label className="select-wrap"><select value={channelFilter} onChange={(e) => setChannelFilter(e.target.value as ChannelFilter)}><option value="all">所有訊息類型</option><option value="dm">只看私人訊息</option><option value="server">只看伺服器／群組</option></select><ChevronDown size={16} /></label>
      </section>
      <section className="stats-grid">
        <StatCard icon={<MessageCircle size={20} />} label="送出的訊息" value={number.format(derived?.total || 0)} note={`${number.format(derived?.activeDays || 0)} 個活躍日`} />
        <StatCard icon={<Users size={20} />} label="私訊對象" value={number.format(derived?.people.length || 0)} note={derived?.people[0] ? `最多：${derived.people[0].name}` : '沒有私訊資料'} />
        <StatCard icon={<Hash size={20} />} label="活躍頻道" value={number.format(derived?.channels.length || 0)} note={`${number.format(derived?.servers.length || 0)} 個伺服器／群組`} />
        <StatCard icon={<Clock3 size={20} />} label="最常出沒" value={`${String(derived?.peakHour || 0).padStart(2, '0')}:00`} note={`星期${weekdays[derived?.peakDay || 0]}最活躍`} />
      </section>
      <section className="dashboard-grid">
        <article className="panel ranking-panel"><div className="panel-head"><div><p className="panel-kicker">訊息排行</p><h2>{rankingTab === 'people' ? '你最常聯絡誰？' : rankingTab === 'servers' ? '你最常待在哪裡？' : '最活躍的頻道'}</h2></div><div className="search-box"><Search size={16} /><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="搜尋名稱" aria-label="搜尋排行" /></div></div>
          <div className="ranking-tabs" role="tablist"><button className={rankingTab === 'people' ? 'active' : ''} onClick={() => setRankingTab('people')}>私訊對象</button><button className={rankingTab === 'servers' ? 'active' : ''} onClick={() => setRankingTab('servers')}>伺服器</button><button className={rankingTab === 'channels' ? 'active' : ''} onClick={() => setRankingTab('channels')}>頻道</button>{rankingTab === 'people' && <label className="unknown-toggle" htmlFor="show-unknown-ranking"><Checkbox id="show-unknown-ranking" checked={showUnknownParticipants} onCheckedChange={(checked) => setShowUnknownParticipants(checked === true)} />顯示 Unknown Participant</label>}</div>
          <div className="ranking-list">{searched.length ? searched.map((row, index) => rankingTab === 'people' ? <button type="button" className="rank-row conversation-trigger" key={row.name} onClick={() => openConversation(row.name)} aria-label={`查看與 ${row.name} 的訊息`}>{rankContent(row, index)}</button> : <div className="rank-row" key={row.name}>{rankContent(row, index)}</div>) : <div className="no-results">這個篩選條件下沒有資料</div>}</div>
        </article>
        <article className="panel trend-panel"><div className="panel-head"><div><p className="panel-kicker">時間軸</p><h2>每月訊息趨勢</h2></div><span className="metric-note">最近 {derived?.trend.length || 0} 個月</span></div><div className="bar-chart" aria-label="每月訊息數長條圖">{derived?.trend.map((item, index) => <div className="bar-column" key={item.key} title={`${item.key}: ${number.format(item.count)} 則`}><span className="bar-value">{item.count === maxTrend ? number.format(item.count) : ''}</span><div className="bar" style={{ height: `${Math.max(5, (item.count / maxTrend) * 100)}%` }} /><small>{index % Math.max(1, Math.ceil(derived.trend.length / 6)) === 0 ? monthLabel.format(new Date(`${item.key}-01T00:00:00Z`)) : ''}</small></div>)}</div></article>
        <article className="panel rhythm-panel"><div className="panel-head"><div><p className="panel-kicker">聊天節奏</p><h2>一天中的活躍時段</h2></div><span className="metric-note">依本機時區</span></div><div className="hour-chart">{derived?.hours.map((count, hour) => <div key={hour} className="hour-column" title={`${hour}:00 · ${number.format(count)} 則`}><span style={{ height: `${Math.max(4, (count / maxHour) * 100)}%` }} className={hour === derived.peakHour ? 'peak' : ''} /></div>)}</div><div className="hour-axis"><span>00:00</span><span>06:00</span><span>12:00</span><span>18:00</span><span>23:00</span></div><div className="insight"><Clock3 size={18} /><p>你的高峰時段是 <b>{String(derived?.peakHour || 0).padStart(2, '0')}:00–{String(((derived?.peakHour || 0) + 1) % 24).padStart(2, '0')}:00</b>，星期{weekdays[derived?.peakDay || 0]}最常發訊息。</p></div></article>
        <article className="panel details-panel"><div className="panel-head"><div><p className="panel-kicker">內容概況</p><h2>訊息裡有什麼？</h2></div></div><div className="detail-list"><div><FileJson size={19} /><span>文字字元</span><b>{number.format(derived?.chars || 0)}</b></div><div><FolderOpen size={19} /><span>附件</span><b>{number.format(derived?.attachments || 0)}</b></div><div><ArrowDownToLine size={19} /><span>連結</span><b>{number.format(derived?.links || 0)}</b></div><div><Activity size={19} /><span>平均每日</span><b>{number.format(Math.round((derived?.total || 0) / Math.max(1, derived?.activeDays || 1)))} 則</b></div></div></article>
        <article className="panel voice-panel">
          <div className="panel-head"><div><p className="panel-kicker">語音活動</p><h2>語音通話時間</h2></div><span className="metric-note">依活動紀錄估算</span></div>
          {voiceStatus === 'idle' && <div className="voice-empty"><div className="voice-orb"><Headphones size={25} /></div><p>正在準備自動分析語音紀錄。</p></div>}
          {voiceStatus === 'scanning' && <div className="voice-scanning"><div className="voice-scan-head"><span>正在掃描語音活動…</span><b>{voiceProgress}%</b></div><div className="progress-track"><span style={{ width: `${voiceProgress}%` }} /></div><small>請保持此頁開啟；只讀取本機檔案，不會上傳。</small></div>}
          {voiceStatus === 'done' && <div className="voice-results"><div className="voice-totals"><div><span>連線時間</span><b>{formatDuration(derived?.voiceConnectedMs || 0)}</b></div><div><span>實際發言</span><b>{formatDuration(derived?.voiceSpeakingMs || 0)}</b></div><div><span>通話場次</span><b>{number.format(derived?.voiceCount || 0)} 次</b></div></div>{derived?.topVoicePlaces.length ? <div className="voice-ranking">{derived.topVoicePlaces.map((row) => <div key={row.name}><span>{row.name}</span><b>{formatDuration(row.durationMs)}</b></div>)}</div> : <p className="voice-none">目前時間篩選內沒有語音活動。</p>}<small className="voice-disclaimer">Discord 活動資料可能因隱私設定或匯出範圍而不完整。</small></div>}
          {voiceStatus === 'unavailable' && <div className="voice-empty compact"><p>這份資料包沒有 Activity 事件檔，因此無法計算語音時數。只有頻道名稱不能推算停留時間。</p></div>}
          {voiceStatus === 'error' && <div className="voice-empty compact"><p>語音活動檔案無法讀取。可重新選擇完整的 package 資料夾後再試一次。</p><button className="voice-button" onClick={analyzeVoice}>重新分析</button></div>}
        </article>
      </section>
      <p className="data-footnote"><LockKeyhole size={14} /> 這份報告不會儲存訊息內容。重新整理頁面後，匯入資料即會清除。</p>
    </div>
    <Dialog open={exportOpen} onOpenChange={setExportOpen}>
      <DialogContent className="export-dialog">
        <DialogHeader><DialogTitle>建立分享報告</DialogTitle><DialogDescription>套用目前的「{rangeText}」篩選，選擇格式與要公開的內容。</DialogDescription></DialogHeader>
        <div className="export-layout">
          <div className="export-options">
            <fieldset><legend>匯出格式</legend><RadioGroup className="format-grid" value={exportFormat} onValueChange={(value) => setExportFormat(value as ExportFormat)}>
              <label htmlFor="format-excel" className={exportFormat === 'excel' ? 'selected' : ''}><RadioGroupItem id="format-excel" value="excel" /><FileSpreadsheet size={20} /><span><b>Excel</b><small>可編輯資料表</small></span></label>
              <label htmlFor="format-html" className={exportFormat === 'html' ? 'selected' : ''}><RadioGroupItem id="format-html" value="html" /><FileCode2 size={20} /><span><b>HTML</b><small>完整網頁報告</small></span></label>
              <label htmlFor="format-png" className={exportFormat === 'png' ? 'selected' : ''}><RadioGroupItem id="format-png" value="png" /><Image size={20} /><span><b>PNG</b><small>直接分享圖片</small></span></label>
            </RadioGroup></fieldset>
            {exportFormat === 'png' && <fieldset><legend>分享用途</legend><RadioGroup className="purpose-grid" value={exportPurpose} onValueChange={(value) => setExportPurpose(value as ExportPurpose)}>
              <label htmlFor="purpose-story" className={exportPurpose === 'story' ? 'selected' : ''}><RadioGroupItem id="purpose-story" value="story" /><span><b>限時動態</b><small>1080 × 1920</small></span></label>
              <label htmlFor="purpose-share" className={exportPurpose === 'share' ? 'selected' : ''}><RadioGroupItem id="purpose-share" value="share" /><span><b>一般分享</b><small>1200 × 1200</small></span></label>
              <label htmlFor="purpose-report" className={exportPurpose === 'report' ? 'selected' : ''}><RadioGroupItem id="purpose-report" value="report" /><span><b>橫式報告</b><small>1600 × 1200</small></span></label>
            </RadioGroup></fieldset>}
            <fieldset><legend>要分享的內容</legend><div className="section-checks">
              {([
                ['identity', '顯示帳號名稱', '關閉後使用匿名報告'],
                ['summary', '重點數據', '訊息數、活躍日與頻道數'],
                ['people', '私訊對象排行', '最多顯示前 10 名'],
                ['trend', '每月訊息趨勢', '套用目前日期篩選'],
                ['voice', '語音活動', voiceStatus === 'done' ? '連線、發言與場次' : '請先完成語音分析'],
              ] as [keyof ExportSections, string, string][]).map(([key, label, note]) => <label htmlFor={`section-${key}`} key={key} className={key === 'voice' && voiceStatus !== 'done' ? 'disabled' : ''}><Checkbox id={`section-${key}`} checked={exportSections[key]} disabled={key === 'voice' && voiceStatus !== 'done'} onCheckedChange={(checked) => setExportSections((current) => ({ ...current, [key]: checked === true }))} /><span><b>{label}</b><small>{note}</small></span></label>)}
            </div>{exportSections.people && <label className="export-unknown-toggle" htmlFor="show-unknown-export"><Checkbox id="show-unknown-export" checked={showUnknownParticipants} onCheckedChange={(checked) => setShowUnknownParticipants(checked === true)} /><span><b>顯示 Unknown Participant</b><small>關閉後會從排行、預覽和匯出檔排除</small></span></label>}</fieldset>
          </div>
          <aside className={`export-preview ${exportPurpose}`}>
            {exportFormat === 'png'
              ? <><div className="preview-label"><span>即時預覽</span><small>與匯出圖片完全相同</small></div><div className="preview-stage"><canvas key={`${exportPurpose}-${Object.values(exportSections).join('-')}-${rangeText}-${voiceStatus}-${showUnknownParticipants}-${Object.values(participantProfiles).filter((profile) => profile.avatar).length}`} ref={(canvas) => { if (canvas) renderPngCanvas(canvas); }} aria-label="PNG 匯出即時預覽" /></div></>
              : <div className="preview-unavailable"><FileCode2 size={28} /><b>{exportFormat === 'excel' ? 'Excel 資料表' : 'HTML 網頁報告'}</b><p>{exportFormat === 'excel' ? '下載後可在 Excel 開啟並繼續編輯。' : '下載後可直接用瀏覽器開啟完整報告。'}</p></div>}
          </aside>
        </div>
        <div className="export-footer"><p><LockKeyhole size={14} /> 只會匯出你勾選的統計，不含訊息原文。</p><button className="ghost-button" onClick={() => setExportOpen(false)}>取消</button><button className="export-button" disabled={!Object.values(exportSections).some(Boolean)} onClick={exportSelected}><ArrowDownToLine size={16} /> 產生檔案</button></div>
      </DialogContent>
    </Dialog>
    <Sheet open={Boolean(conversation)} onOpenChange={(open) => { if (!open) { conversationRequestRef.current += 1; setConversation(null); } }}>
      <SheetContent className="conversation-sheet">
        <SheetHeader className="conversation-header">
          <div className="conversation-avatar">{conversation?.recipientId && participantProfiles[conversation.recipientId]?.avatarUrl ? <AvatarImage src={participantProfiles[conversation.recipientId].avatarUrl!} alt={`${conversation.name} 的 Discord 頭像`} /> : Array.from(conversation?.name || '?')[0]?.toUpperCase()}</div>
          <div><SheetTitle>{conversation?.name || '私訊紀錄'}</SheetTitle>{conversation?.recipientId && <code className="conversation-id">ID: {conversation.recipientId}</code>}<SheetDescription>{rangeText} · 只顯示你送出的訊息</SheetDescription></div>
        </SheetHeader>
        <div className="conversation-notice"><LockKeyhole size={14} /> 訊息從本機 Data Package 讀取，不會上傳。</div>
        <div className="conversation-messages">
          {conversation?.loading && <div className="conversation-loading"><div className="spinner" /><span>正在讀取訊息…</span></div>}
          {conversation?.error && <div className="conversation-empty">{conversation.error}</div>}
          {conversation && !conversation.loading && !conversation.error && !conversation.messages.length && <div className="conversation-empty">目前篩選範圍內沒有可顯示的訊息。</div>}
          {conversation && !conversation.loading && conversation.messages.slice(0, visibleMessages).map((message, index) => <article className="chat-message" key={`${message.at}-${index}`}><div className="chat-meta"><b>{data.userName}</b><time>{messageTime.format(message.at)}</time></div>{message.content && <p>{message.content}</p>}{message.attachments > 0 && <span className="chat-attachment"><FolderOpen size={14} /> {message.attachments} 個附件</span>}</article>)}
        </div>
        {conversation && conversation.messages.length > visibleMessages && <SheetFooter className="conversation-footer"><button type="button" onClick={() => setVisibleMessages((count) => count + 300)}>載入更早的 300 則</button><small>已顯示最近 {number.format(Math.min(visibleMessages, conversation.messages.length))}／{number.format(conversation.messages.length)} 則</small></SheetFooter>}
      </SheetContent>
    </Sheet>
    {loading && <Loading progress={progress} label="正在重新分析" />}{error && <ErrorToast error={error} close={() => setError('')} />}
  </main>;
}

function Loading({ progress, label }: { progress: number; label: string }) { return <div className="loading-overlay"><div className="loader-box"><div className="spinner" /><b>{label}… {progress}%</b><div className="progress-track"><span style={{ width: `${progress}%` }} /></div></div></div>; }
function ErrorToast({ error, close }: { error: string; close: () => void }) { return <div className="error-toast"><X size={17} /><span>{error}</span><button onClick={close} aria-label="關閉"><X size={15} /></button></div>; }
