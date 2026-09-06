'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity, ArrowDownToLine, CalendarDays, Check, ChevronDown, Clock3,
  FileJson, FolderOpen, Hash, LockKeyhole, MessageCircle, Search, Server,
  Sparkles, Users, X,
} from 'lucide-react';

type RawMessage = { Timestamp?: string; Contents?: string; Attachments?: string };
type MessagePoint = { at: number; chars: number; attachments: number; links: number };
type Channel = {
  id: string;
  kind: 'DM' | 'GROUP_DM' | 'GUILD_TEXT' | 'OTHER';
  name: string;
  server: string;
  points: MessagePoint[];
};
type ImportedData = { userName: string; packageName: string; channels: Channel[] };
type RangePreset = 'all' | 'year' | '90days' | 'custom';
type ChannelFilter = 'all' | 'dm' | 'server';

const number = new Intl.NumberFormat('zh-TW');
const date = new Intl.DateTimeFormat('zh-TW', { year: 'numeric', month: 'short', day: 'numeric' });
const monthLabel = new Intl.DateTimeFormat('zh-TW', { year: 'numeric', month: 'short' });
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
  if (accountFile) {
    try {
      const account = JSON.parse(await accountFile.text()) as { global_name?: string; username?: string };
      userName = account.global_name || account.username || userName;
    } catch { /* Account data is optional. */ }
  }

  const channels: Channel[] = [];
  for (let i = 0; i < messageFiles.length; i += 1) {
    const messageFile = messageFiles[i];
    const path = normalizePath(messageFile.webkitRelativePath);
    const channelFile = byPath.get(path.replace(/messages\.json$/i, 'channel.json'));
    let channelJson: { id?: string; type?: string } = {};
    try { if (channelFile) channelJson = JSON.parse(await channelFile.text()); } catch { /* Keep going. */ }
    const folderMatch = path.match(/\/c?(\d+)\/messages\.json$/i);
    const id = String(channelJson.id || folderMatch?.[1] || `channel-${i}`);
    const rawType = String(channelJson.type || 'OTHER');
    const kind: Channel['kind'] = rawType === 'DM' || rawType === 'GROUP_DM' || rawType === 'GUILD_TEXT' ? rawType : 'OTHER';
    const identity = channelIdentity(index[id], kind, id);
    try {
      const parsed = JSON.parse(await messageFile.text()) as RawMessage[] | RawMessage;
      const messages = Array.isArray(parsed) ? parsed : [parsed];
      const points = messages.map((message) => {
        const at = parseTimestamp(message.Timestamp);
        const contents = message.Contents || '';
        return { at, chars: [...contents].length, attachments: countAttachments(message.Attachments), links: (contents.match(/https?:\/\/\S+/gi) || []).length };
      }).filter((point) => Number.isFinite(point.at));
      if (points.length) channels.push({ id, kind, ...identity, points });
    } catch { /* Skip only malformed channels. */ }
    if (i % 12 === 0 || i === messageFiles.length - 1) onProgress(Math.round(((i + 1) / messageFiles.length) * 100));
  }
  if (!channels.length) throw new Error('訊息檔案存在，但沒有可讀取的時間資料。');
  const root = normalizePath(indexFile.webkitRelativePath).split('/Messages/')[0] || 'package';
  return { userName, packageName: root.split('/').pop() || 'package', channels };
}

function getPresetStart(preset: RangePreset, latest: number) {
  if (preset === 'year') return new Date(new Date(latest).getUTCFullYear(), 0, 1).getTime();
  if (preset === '90days') return latest - 90 * 86400000;
  return -Infinity;
}

function StatCard({ icon, label, value, note }: { icon: React.ReactNode; label: string; value: string; note: string }) {
  return <article className="stat-card"><div className="stat-icon">{icon}</div><p>{label}</p><strong>{value}</strong><span>{note}</span></article>;
}

function EmptyState({ onChoose }: { onChoose: () => void }) {
  return <main className="import-page">
    <nav className="brand-bar"><div className="brand"><span className="brand-mark"><MessageCircle size={21} /></span><span>Discord Lens</span></div><div className="local-pill"><LockKeyhole size={14} /> 只在你的裝置處理</div></nav>
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
        <div className="requirements"><div><Check size={16} /><span><b>不需要</b> Discord Token 或 Bot</span></div><div><Check size={16} /><span>可直接套用任何人的官方資料包</span></div><div><Check size={16} /><span>Chrome、Edge 桌面版效果最佳</span></div></div>
      </div>
    </section>
    <section className="feature-strip" aria-label="可用統計"><div><Users size={20} /><span><b>私訊排行</b>最常聯絡的人</span></div><div><Activity size={20} /><span><b>活躍趨勢</b>月份、星期與時段</span></div><div><Server size={20} /><span><b>社群排行</b>伺服器與頻道分布</span></div></section>
    <footer>資料不會離開瀏覽器 · 支援 Discord 官方 JSON Data Package</footer>
  </main>;
}

export default function Home() {
  const inputRef = useRef<HTMLInputElement>(null);
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
  const chooseFolder = () => inputRef.current?.click();

  async function handleFiles(files: FileList | null) {
    if (!files?.length) return;
    setLoading(true); setProgress(1); setError('');
    try { setData(await importPackage(files, setProgress)); setPreset('all'); setQuery(''); }
    catch (reason) { setError(reason instanceof Error ? reason.message : '讀取失敗，請確認資料夾內容。'); }
    finally { setLoading(false); }
  }

  const derived = useMemo(() => {
    if (!data) return null;
    const allPoints = data.channels.flatMap((channel) => channel.points);
    const earliest = Math.min(...allPoints.map((point) => point.at));
    const latest = Math.max(...allPoints.map((point) => point.at));
    let start = getPresetStart(preset, latest); let end = Infinity;
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
    return { earliest, latest, total, attachments, links, chars, activeDays, people, servers, channels, trend, hours, days, peakHour: hours.indexOf(Math.max(...hours)), peakDay: days.indexOf(Math.max(...days)) };
  }, [data, preset, channelFilter, customStart, customEnd]);

  function exportCsv() {
    if (!derived) return;
    const rows = [['類型', '名稱', '訊息數'], ...derived.people.map((row) => ['私訊對象', row.name, String(row.count)]), ...derived.servers.map((row) => ['伺服器', row.name, String(row.count)]), ...derived.channels.map((row) => ['頻道', row.name, String(row.count)])];
    const csv = `\uFEFF${rows.map((row) => row.map((cell) => `"${cell.replace(/"/g, '""')}"`).join(',')).join('\n')}`;
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const anchor = document.createElement('a'); anchor.href = url; anchor.download = 'discord-lens-summary.csv'; anchor.click(); URL.revokeObjectURL(url);
  }

  useEffect(() => {
    type WebTool = { name: string; title: string; description: string; inputSchema: object; annotations: { readOnlyHint: boolean; untrustedContentHint: boolean }; execute: () => unknown };
    type ModelContext = { registerTool: (tool: WebTool, options?: { signal?: AbortSignal }) => void | Promise<void> };
    const context = (document as Document & { modelContext?: ModelContext }).modelContext;
    if (!context?.registerTool) return;
    const lifecycle = new AbortController();
    const register = (tool: WebTool) => { try { void Promise.resolve(context.registerTool(tool, { signal: lifecycle.signal })).catch(() => undefined); } catch { /* Unsupported preview contexts can ignore WebMCP. */ } };
    register({ name: 'start_discord_package_import', title: '選擇 Discord 資料包', description: '開啟資料夾選擇器，讓使用者選擇要在本機分析的 Discord Data Package。', inputSchema: { type: 'object', properties: {}, additionalProperties: false }, annotations: { readOnlyHint: false, untrustedContentHint: false }, execute: () => { chooseFolder(); return { status: 'folder_picker_opened' }; } });
    register({ name: 'export_discord_summary', title: '匯出 Discord 統計', description: '將目前畫面篩選後的私訊、伺服器與頻道排行匯出為 CSV。', inputSchema: { type: 'object', properties: {}, additionalProperties: false }, annotations: { readOnlyHint: false, untrustedContentHint: true }, execute: () => { if (!derived) throw new Error('尚未匯入 Discord 資料包'); exportCsv(); return { status: 'download_started', filename: 'discord-lens-summary.csv' }; } });
    return () => lifecycle.abort();
  }, [derived]);

  const input = <input ref={inputRef} className="sr-only" type="file" multiple onChange={(event) => handleFiles(event.target.files)} {...({ webkitdirectory: '', directory: '' } as React.InputHTMLAttributes<HTMLInputElement>)} />;
  if (!data) return <>{input}<EmptyState onChoose={chooseFolder} />{loading && <Loading progress={progress} label="正在讀取訊息" />}{error && <ErrorToast error={error} close={() => setError('')} />}</>;

  const ranking = rankingTab === 'people' ? derived?.people || [] : rankingTab === 'servers' ? derived?.servers || [] : derived?.channels || [];
  const searched = ranking.filter((row) => row.name.toLowerCase().includes(query.toLowerCase())).slice(0, 12);
  const maxRank = Math.max(1, ...searched.map((row) => row.count));
  const maxTrend = Math.max(1, ...(derived?.trend.map((item) => item.count) || []));
  const maxHour = Math.max(1, ...(derived?.hours || []));

  return <main className="dashboard">
    {input}
    <header className="dashboard-header"><div className="brand"><span className="brand-mark"><MessageCircle size={21} /></span><span>Discord Lens</span></div><div className="header-actions"><span className="privacy-note"><LockKeyhole size={14} /> 本機分析</span><button className="ghost-button" onClick={chooseFolder}><FolderOpen size={16} /> 更換資料</button><button className="export-button" onClick={exportCsv}><ArrowDownToLine size={16} /> 匯出 CSV</button></div></header>
    <div className="dashboard-shell">
      <section className="welcome-row"><div><p className="eyebrow">{data.packageName} · {data.userName}</p><h1>你的 Discord 訊息總覽</h1><p>統計只包含你送出的訊息，所有資料都在瀏覽器內處理。</p></div><div className="date-chip"><CalendarDays size={18} /><span>{derived ? `${date.format(derived.earliest)} — ${date.format(derived.latest)}` : '—'}</span></div></section>
      <section className="filter-bar" aria-label="篩選條件">
        <div className="segmented">{([['all', '全部時間'], ['year', '今年'], ['90days', '近 90 天'], ['custom', '自訂']] as [RangePreset, string][]).map(([value, label]) => <button key={value} className={preset === value ? 'active' : ''} onClick={() => setPreset(value)}>{label}</button>)}</div>
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
          <div className="ranking-tabs" role="tablist"><button className={rankingTab === 'people' ? 'active' : ''} onClick={() => setRankingTab('people')}>私訊對象</button><button className={rankingTab === 'servers' ? 'active' : ''} onClick={() => setRankingTab('servers')}>伺服器</button><button className={rankingTab === 'channels' ? 'active' : ''} onClick={() => setRankingTab('channels')}>頻道</button></div>
          <div className="ranking-list">{searched.length ? searched.map((row, index) => <div className="rank-row" key={row.name}><span className={`rank-number ${index < 3 ? 'top' : ''}`}>{index + 1}</span><div className="rank-main"><div className="rank-label"><span>{row.name}</span><b>{number.format(row.count)} 則</b></div><div className="rank-track"><span style={{ width: `${Math.max(3, (row.count / maxRank) * 100)}%` }} /></div></div></div>) : <div className="no-results">這個篩選條件下沒有資料</div>}</div>
        </article>
        <article className="panel trend-panel"><div className="panel-head"><div><p className="panel-kicker">時間軸</p><h2>每月訊息趨勢</h2></div><span className="metric-note">最近 {derived?.trend.length || 0} 個月</span></div><div className="bar-chart" aria-label="每月訊息數長條圖">{derived?.trend.map((item, index) => <div className="bar-column" key={item.key} title={`${item.key}: ${number.format(item.count)} 則`}><span className="bar-value">{item.count === maxTrend ? number.format(item.count) : ''}</span><div className="bar" style={{ height: `${Math.max(5, (item.count / maxTrend) * 100)}%` }} /><small>{index % Math.max(1, Math.ceil(derived.trend.length / 6)) === 0 ? monthLabel.format(new Date(`${item.key}-01T00:00:00Z`)) : ''}</small></div>)}</div></article>
        <article className="panel rhythm-panel"><div className="panel-head"><div><p className="panel-kicker">聊天節奏</p><h2>一天中的活躍時段</h2></div><span className="metric-note">依本機時區</span></div><div className="hour-chart">{derived?.hours.map((count, hour) => <div key={hour} className="hour-column" title={`${hour}:00 · ${number.format(count)} 則`}><span style={{ height: `${Math.max(4, (count / maxHour) * 100)}%` }} className={hour === derived.peakHour ? 'peak' : ''} /></div>)}</div><div className="hour-axis"><span>00:00</span><span>06:00</span><span>12:00</span><span>18:00</span><span>23:00</span></div><div className="insight"><Clock3 size={18} /><p>你的高峰時段是 <b>{String(derived?.peakHour || 0).padStart(2, '0')}:00–{String(((derived?.peakHour || 0) + 1) % 24).padStart(2, '0')}:00</b>，星期{weekdays[derived?.peakDay || 0]}最常發訊息。</p></div></article>
        <article className="panel details-panel"><div className="panel-head"><div><p className="panel-kicker">內容概況</p><h2>訊息裡有什麼？</h2></div></div><div className="detail-list"><div><FileJson size={19} /><span>文字字元</span><b>{number.format(derived?.chars || 0)}</b></div><div><FolderOpen size={19} /><span>附件</span><b>{number.format(derived?.attachments || 0)}</b></div><div><ArrowDownToLine size={19} /><span>連結</span><b>{number.format(derived?.links || 0)}</b></div><div><Activity size={19} /><span>平均每日</span><b>{number.format(Math.round((derived?.total || 0) / Math.max(1, derived?.activeDays || 1)))} 則</b></div></div></article>
      </section>
      <p className="data-footnote"><LockKeyhole size={14} /> 這份報告不會儲存訊息內容。重新整理頁面後，匯入資料即會清除。</p>
    </div>
    {loading && <Loading progress={progress} label="正在重新分析" />}{error && <ErrorToast error={error} close={() => setError('')} />}
  </main>;
}

function Loading({ progress, label }: { progress: number; label: string }) { return <div className="loading-overlay"><div className="loader-box"><div className="spinner" /><b>{label}… {progress}%</b><div className="progress-track"><span style={{ width: `${progress}%` }} /></div></div></div>; }
function ErrorToast({ error, close }: { error: string; close: () => void }) { return <div className="error-toast"><X size={17} /><span>{error}</span><button onClick={close} aria-label="關閉"><X size={15} /></button></div>; }
