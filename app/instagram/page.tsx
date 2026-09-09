'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import {
  ArrowDownToLine,
  CalendarDays,
  ChevronDown,
  Clock3,
  FileCode2,
  FileSpreadsheet,
  FolderOpen,
  Heart,
  Image as ImageIcon,
  LockKeyhole,
  MessageCircle,
  Search,
  Send,
  Share2,
  Sparkles,
  Users,
  X,
} from 'lucide-react';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';

type RangePreset = 'all' | 'year' | 'lastyear' | '90days' | 'custom';
type MessageScope = 'all' | 'mine' | 'theirs';
type RankingMetric = 'messages' | 'characters' | 'average';
type ExportFormat = 'excel' | 'html' | 'png';
type ExportPurpose = 'story' | 'share' | 'report';
type InstagramExportSections = {
  summary: boolean;
  ranking: boolean;
  trend: boolean;
  relations: boolean;
};
type AvatarResponse = {
  avatarUrl?: string | null;
  source?: string;
  status?: number;
  reason?: string;
};
type InstagramMessage = {
  at: number;
  sender: string;
  body: string;
  media: number;
};
type InstagramConversation = {
  id: string;
  name: string;
  handle?: string;
  bucket: string;
  messages: InstagramMessage[];
};
type InstagramData = {
  packageName: string;
  selfName: string;
  senders: string[];
  conversations: InstagramConversation[];
  followers: number;
  following: number;
  mutuals: number;
};

const number = new Intl.NumberFormat('zh-TW');
const date = new Intl.DateTimeFormat('zh-TW', {
  year: 'numeric',
  month: 'short',
  day: 'numeric',
});
const month = new Intl.DateTimeFormat('zh-TW', {
  year: 'numeric',
  month: 'short',
});
const messageTime = new Intl.DateTimeFormat('zh-TW', {
  year: 'numeric',
  month: 'short',
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});

function normalize(value: string | null | undefined) {
  return (value || '')
    .replace(/\u00a0/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizePath(value: string) {
  return value.replace(/\\/g, '/');
}

function isInstagramPlaceholder(value: string) {
  return /^instagram\s*(?:用戶|用户|user|ユーザー|사용자)$/i.test(
    normalize(value),
  );
}

function cleanInstagramHandle(value: string | null | undefined) {
  const handle = normalize(value)
    .replace(/^@+/, '')
    .toLowerCase();
  return /^[a-z0-9._]{1,30}$/i.test(handle) && !/^\d+$/.test(handle)
    ? handle
    : '';
}

function inferHandleFromThreadSlug(value: string) {
  const withoutThreadId = value.replace(/_\d{8,}$/, '');
  return cleanInstagramHandle(withoutThreadId);
}

function parseInstagramTime(value: string) {
  const text = normalize(value);
  const zh = text.match(
    /(\d{1,2})\s*月\s*(\d{1,2}),\s*(\d{4})\s+(\d{1,2}):(\d{2})\s*(上午|下午)/,
  );
  if (zh) {
    let hour = Number(zh[4]);
    if (zh[6] === '上午') hour = hour === 12 ? 0 : hour;
    else hour = hour === 12 ? 12 : hour + 12;
    return new Date(
      Number(zh[3]),
      Number(zh[1]) - 1,
      Number(zh[2]),
      hour,
      Number(zh[5]),
    ).getTime();
  }
  const parsed = Date.parse(text.replace(/\bat\b/i, ''));
  return Number.isFinite(parsed) ? parsed : NaN;
}

function instagramHandle(document: Document) {
  const handles = new Set<string>();
  document.querySelectorAll<HTMLAnchorElement>('a[href]').forEach((anchor) => {
    const match = anchor.href.match(/instagram\.com\/([^/?#]+)/i);
    if (match?.[1]) handles.add(decodeURIComponent(match[1]).toLowerCase());
    else if (normalize(anchor.textContent))
      handles.add(normalize(anchor.textContent).toLowerCase());
  });
  return handles;
}

async function readLocalText(file: File) {
  try {
    return await file.text();
  } catch (reason) {
    if (
      reason instanceof DOMException &&
      (reason.name === 'NotFoundError' || reason.name === 'NotReadableError')
    )
      return null;
    throw reason;
  }
}

async function importInstagram(
  files: FileList,
  onProgress: (value: number) => void,
): Promise<InstagramData> {
  const all = Array.from(files);
  const messageFiles = all.filter((file) =>
    /your_instagram_activity\/messages\/(inbox|message_requests|hidden_threads)\/[^/]+\/message_\d+\.html$/i.test(
      normalizePath(file.webkitRelativePath || file.name),
    ),
  );
  if (!messageFiles.length)
    throw new Error(
      '找不到 Instagram 私訊資料。請選擇解壓縮後、包含 your_instagram_activity/messages 的資料夾。',
    );

  const threads = new Map<string, InstagramConversation>();
  const senderThreads = new Map<string, Set<string>>();
  const senderCounts = new Map<string, number>();
  let unreadableMessages = 0;
  for (let index = 0; index < messageFiles.length; index += 1) {
    const file = messageFiles[index];
    const path = normalizePath(file.webkitRelativePath || file.name);
    const match = path.match(
      /messages\/(inbox|message_requests|hidden_threads)\/([^/]+)\/message_\d+\.html$/i,
    );
    if (!match) continue;
    const html = await readLocalText(file);
    if (html === null) {
      unreadableMessages += 1;
      onProgress(Math.round(((index + 1) / messageFiles.length) * 92));
      continue;
    }
    const document = new DOMParser().parseFromString(
      html,
      'text/html',
    );
    const id = `${match[1].toLowerCase()}/${match[2]}`;
    const conversation = threads.get(id) || {
      id,
      name: normalize(document.title) || match[2],
      handle: inferHandleFromThreadSlug(match[2]),
      bucket: match[1].toLowerCase(),
      messages: [],
    };
    document
      .querySelectorAll<HTMLElement>('div.pam._a6-g.uiBoxWhite.noborder')
      .forEach((card) => {
        const sender = normalize(card.querySelector('h2._a6-h')?.textContent);
        const bodyNode = card.querySelector<HTMLElement>('div._a6-p');
        const body = normalize(bodyNode?.textContent);
        const at = parseInstagramTime(
          normalize(card.querySelector('div._a6-o')?.textContent),
        );
        if (!sender || !Number.isFinite(at)) return;
        const mediaLinks =
          bodyNode?.querySelectorAll(
            'img, video, audio, a[href*="/photos/"], a[href*="/videos/"], a[href*="/audio/"]',
          ).length || 0;
        conversation.messages.push({ at, sender, body, media: mediaLinks });
        if (!senderThreads.has(sender)) senderThreads.set(sender, new Set());
        senderThreads.get(sender)?.add(id);
        senderCounts.set(sender, (senderCounts.get(sender) || 0) + 1);
      });
    threads.set(id, conversation);
    if (index % 8 === 0 || index === messageFiles.length - 1)
      onProgress(Math.round(((index + 1) / messageFiles.length) * 92));
  }

  const rankedSenders = [...senderThreads.keys()].sort(
    (a, b) =>
      (senderThreads.get(b)?.size || 0) - (senderThreads.get(a)?.size || 0) ||
      (senderCounts.get(b) || 0) - (senderCounts.get(a) || 0),
  );
  const selfName = rankedSenders[0] || 'Instagram 使用者';
  const parser = new DOMParser();
  const followerHandles = new Set<string>();
  const followingHandles = new Set<string>();
  for (const file of all.filter((item) =>
    /connections\/followers_and_following\/followers_\d+\.html$/i.test(
      normalizePath(item.webkitRelativePath),
    ),
  )) {
    const html = await readLocalText(file);
    if (html === null) continue;
    instagramHandle(
      parser.parseFromString(html, 'text/html'),
    ).forEach((handle) => followerHandles.add(handle));
  }
  const followingFile = all.find((item) =>
    /connections\/followers_and_following\/following\.html$/i.test(
      normalizePath(item.webkitRelativePath),
    ),
  );
  if (followingFile) {
    const html = await readLocalText(followingFile);
    if (html !== null)
    instagramHandle(
      parser.parseFromString(html, 'text/html'),
    ).forEach((handle) => followingHandles.add(handle));
  }
  const mutuals = [...followerHandles].filter((handle) =>
    followingHandles.has(handle),
  ).length;
  const conversations = [...threads.values()]
    .filter((item) => item.messages.length)
    .map((item) => ({
      ...item,
      messages: item.messages.sort((a, b) => a.at - b.at),
    }));
  if (!conversations.length) {
    if (unreadableMessages === messageFiles.length)
      throw new Error(
        '瀏覽器已失去這個資料夾的讀取權限，或檔案已被移動。請確認資料夾仍在原位，重新選擇一次；若位於雲端同步資料夾，請先完整下載到本機。',
      );
    throw new Error('找到訊息檔，但無法辨識訊息卡片或時間格式。');
  }
  onProgress(100);
  const samplePath = normalizePath(
    messageFiles[0].webkitRelativePath || 'instagram-package',
  );
  const packageName =
    samplePath.split('/your_instagram_activity/')[0].split('/').pop() ||
    'Instagram package';
  return {
    packageName,
    selfName,
    senders: rankedSenders.slice(0, 30),
    conversations,
    followers: followerHandles.size,
    following: followingHandles.size,
    mutuals,
  };
}

function getBounds(
  preset: RangePreset,
  latest: number,
  customStart: string,
  customEnd: string,
) {
  const currentYear = new Date().getFullYear();
  if (preset === 'year')
    return {
      start: new Date(currentYear, 0, 1).getTime(),
      end: new Date(currentYear + 1, 0, 1).getTime() - 1,
    };
  if (preset === 'lastyear')
    return {
      start: new Date(currentYear - 1, 0, 1).getTime(),
      end: new Date(currentYear, 0, 1).getTime() - 1,
    };
  if (preset === '90days')
    return { start: latest - 90 * 86400000, end: Infinity };
  if (preset === 'custom')
    return {
      start: customStart
        ? new Date(`${customStart}T00:00:00`).getTime()
        : -Infinity,
      end: customEnd
        ? new Date(`${customEnd}T23:59:59.999`).getTime()
        : Infinity,
    };
  return { start: -Infinity, end: Infinity };
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function escapeXml(value: string | number) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function escapeHtml(value: string | number) {
  return escapeXml(value).replace(/'/g, '&#39;');
}

function InstagramMark({ size = 21 }: { size?: number }) {
  return (
    <span className="ig-mark">
      <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
        <rect
          x="3"
          y="3"
          width="18"
          height="18"
          rx="5"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        />
        <circle
          cx="12"
          cy="12"
          r="4"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        />
        <circle cx="17.5" cy="6.5" r="1.2" fill="currentColor" />
      </svg>
    </span>
  );
}

function avatarInitial(value: string) {
  return Array.from(value)[0]?.toUpperCase() || '?';
}

function InstagramAvatar({
  name,
  handle,
  avatarUrl,
  rank,
  large = false,
}: {
  name: string;
  handle?: string;
  avatarUrl?: string;
  rank?: number;
  large?: boolean;
}) {
  return (
    <span className={`ig-avatar${large ? ' large' : ''}`}>
      {avatarUrl ? (
        // oxlint-disable-next-line next/no-img-element
        <img
          src={avatarUrl}
          alt=""
          loading="lazy"
          referrerPolicy="no-referrer"
        />
      ) : (
        <i>{avatarInitial(handle || name)}</i>
      )}
      {rank ? <b>{rank}</b> : null}
    </span>
  );
}

export default function InstagramPage() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [data, setData] = useState<InstagramData | null>(null);
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState('');
  const [preset, setPreset] = useState<RangePreset>('all');
  const [scope, setScope] = useState<MessageScope>('all');
  const [customStart, setCustomStart] = useState('');
  const [customEnd, setCustomEnd] = useState('');
  const [query, setQuery] = useState('');
  const [selfName, setSelfName] = useState('');
  const [rankingMetric, setRankingMetric] =
    useState<RankingMetric>('messages');
  const [hideInstagramUsers, setHideInstagramUsers] = useState(true);
  const [loadPublicAvatars, setLoadPublicAvatars] = useState(true);
  const [avatarUrls, setAvatarUrls] = useState<Record<string, string>>({});
  const [avatarFailures, setAvatarFailures] = useState<Record<string, string>>(
    {},
  );
  const [exportOpen, setExportOpen] = useState(false);
  const [exportFormat, setExportFormat] = useState<ExportFormat>('png');
  const [exportPurpose, setExportPurpose] = useState<ExportPurpose>('story');
  const [exportSections, setExportSections] =
    useState<InstagramExportSections>({
      summary: true,
      ranking: true,
      trend: true,
      relations: true,
    });
  const [openThread, setOpenThread] = useState<string | null>(null);
  const [visibleMessages, setVisibleMessages] = useState(250);

  async function handleFiles(files: FileList | null) {
    if (!files?.length) return;
    setLoading(true);
    setProgress(1);
    setError('');
    try {
      const imported = await importInstagram(files, setProgress);
      setData(imported);
      setSelfName(imported.selfName);
      setPreset('all');
      setScope('all');
      setQuery('');
      setRankingMetric('messages');
      setLoadPublicAvatars(true);
      setAvatarUrls({});
      setAvatarFailures({});
    } catch (reason) {
      const fileAccessError =
        reason instanceof DOMException &&
        (reason.name === 'NotFoundError' || reason.name === 'NotReadableError');
      setError(
        fileAccessError
          ? '瀏覽器讀取資料夾時發現檔案已移動或無法存取。請確認資料夾仍在原位，重新選擇一次；若資料在雲端同步資料夾，請先完整下載到本機。'
          : reason instanceof Error
          ? reason.message
          : '讀取失敗，請確認 Instagram 資料包格式。',
      );
    } finally {
      setLoading(false);
    }
  }

  const derived = useMemo(() => {
    if (!data) return null;
    const everyMessage = data.conversations.flatMap(
      (conversation) => conversation.messages,
    );
    let earliest = Infinity;
    let latest = -Infinity;
    everyMessage.forEach((item) => {
      if (item.at < earliest) earliest = item.at;
      if (item.at > latest) latest = item.at;
    });
    const { start, end } = getBounds(preset, latest, customStart, customEnd);
    const matchesScope = (message: InstagramMessage) =>
      scope === 'all' ||
      (scope === 'mine'
        ? message.sender === selfName
        : message.sender !== selfName);
    const conversations = data.conversations
      .map((conversation) => ({
        ...conversation,
        messages: conversation.messages.filter(
          (message) =>
            message.at >= start && message.at <= end && matchesScope(message),
        ),
      }))
      .filter((conversation) => conversation.messages.length);
    const messages = conversations.flatMap(
      (conversation) => conversation.messages,
    );
    const sent = messages.filter(
      (message) => message.sender === selfName,
    ).length;
    const received = messages.length - sent;
    const media = messages.reduce((sum, message) => sum + message.media, 0);
    const activeDays = new Set(
      messages.map((message) =>
        new Date(message.at).toISOString().slice(0, 10),
      ),
    ).size;
    const months = new Map<string, number>();
    const hours = Array.from({ length: 24 }, () => 0);
    messages.forEach((message) => {
      const day = new Date(message.at);
      const key = `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}`;
      months.set(key, (months.get(key) || 0) + 1);
      hours[day.getHours()] += 1;
    });
    const trend = [...months.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .slice(-18)
      .map(([key, count]) => ({ key, count }));
    const ranking = conversations
      .filter(
        (conversation) =>
          !hideInstagramUsers || !isInstagramPlaceholder(conversation.name),
      )
      .map((conversation) => ({
        ...conversation,
        count: conversation.messages.length,
        characters: conversation.messages.reduce(
          (sum, message) => sum + Array.from(message.body).length,
          0,
        ),
        lastAt: conversation.messages.at(-1)?.at || 0,
      }))
      .map((conversation) => ({
        ...conversation,
        average:
          conversation.count > 0
            ? conversation.characters / conversation.count
            : 0,
        metricValue:
          rankingMetric === 'characters'
            ? conversation.characters
            : rankingMetric === 'average'
              ? conversation.count > 0
                ? conversation.characters / conversation.count
                : 0
              : conversation.count,
      }))
      .sort((a, b) => b.metricValue - a.metricValue || b.count - a.count);
    return {
      earliest,
      latest,
      start,
      end,
      conversations,
      messages,
      sent,
      received,
      media,
      activeDays,
      trend,
      hours,
      peakHour: hours.indexOf(Math.max(...hours)),
      ranking,
    };
  }, [
    data,
    preset,
    scope,
    customStart,
    customEnd,
    selfName,
    rankingMetric,
    hideInstagramUsers,
  ]);

  const selected = data?.conversations.find(
    (conversation) => conversation.id === openThread,
  );
  const selectedMessages =
    selected?.messages.filter(
      (message) =>
        !derived ||
        (message.at >= derived.start &&
          message.at <= derived.end &&
          (scope === 'all' ||
            (scope === 'mine'
              ? message.sender === selfName
              : message.sender !== selfName))),
    ) || [];
  const ranking = (derived?.ranking || [])
    .filter((item) => item.name.toLowerCase().includes(query.toLowerCase()))
    .slice(0, 12);
  const avatarHandles = [
    ...new Set(ranking.map((item) => item.handle).filter(Boolean)),
  ] as string[];
  const loadedAvatarCount = avatarHandles.filter(
    (handle) => avatarUrls[handle],
  ).length;
  const failedAvatarCount = avatarHandles.filter(
    (handle) => avatarFailures[handle],
  ).length;
  const pendingAvatarCount = Math.max(
    0,
    avatarHandles.length - loadedAvatarCount - failedAvatarCount,
  );
  const avatarStatus = !loadPublicAvatars
    ? '已關閉'
    : !avatarHandles.length
      ? '沒有可辨識帳號'
      : loadedAvatarCount > 0
        ? `已載入 ${loadedAvatarCount}/${avatarHandles.length}`
        : pendingAvatarCount > 0
          ? `正在抓 ${pendingAvatarCount} 個公開頭像`
          : Object.values(avatarFailures)[0] || '公開來源暫時擋住';

  useEffect(() => {
    if (!loadPublicAvatars || !ranking.length) return;
    const controller = new AbortController();
    const missing = ranking
      .map((item) => item.handle)
      .filter(
        (handle): handle is string =>
          typeof handle === 'string' &&
          handle.length > 0 &&
          !avatarUrls[handle] &&
          !avatarFailures[handle],
      )
      .slice(0, 8);
    if (!missing.length) return;

    missing.forEach((handle) => {
      fetch(`/api/instagram-avatar?handle=${encodeURIComponent(handle)}`, {
        signal: controller.signal,
      })
        .then(async (response) =>
          response.ok
            ? ((await response.json()) as AvatarResponse | null)
            : null,
        )
        .then((payload) => {
          if (!payload?.avatarUrl) {
            const status = payload?.status ? `HTTP ${payload.status}` : '';
            const source = payload?.source ? `${payload.source}` : 'unknown';
            setAvatarFailures((current) => ({
              ...current,
              [handle]:
                payload?.reason ||
                [source, status].filter(Boolean).join(' · ') ||
                '公開來源暫時擋住',
            }));
            return;
          }
          setAvatarUrls((current) => ({
            ...current,
            [handle]: payload.avatarUrl || '',
          }));
        })
        .catch((reason) => {
          if (reason instanceof DOMException && reason.name === 'AbortError')
            return;
          setAvatarFailures((current) => ({
            ...current,
            [handle]: '本機端點請求失敗',
          }));
        });
    });

    return () => controller.abort();
  }, [avatarFailures, avatarUrls, loadPublicAvatars, ranking]);

  const maxRank = Math.max(1, ...ranking.map((item) => item.metricValue));
  const rankingUnit =
    rankingMetric === 'characters'
      ? '字'
      : rankingMetric === 'average'
        ? '字／則'
        : '則';
  const maxTrend = Math.max(
    1,
    ...(derived?.trend.map((item) => item.count) || []),
  );
  const maxHour = Math.max(1, ...(derived?.hours || []));
  const rangeText = !derived
    ? ''
    : preset === 'year'
      ? `${new Date().getFullYear()} 年`
      : preset === 'lastyear'
        ? `${new Date().getFullYear() - 1} 年`
        : preset === '90days'
          ? '近 90 天'
          : preset === 'custom'
          ? `${customStart || '最早'} 至 ${customEnd || '現在'}`
          : `${date.format(derived.earliest)} 至 ${date.format(derived.latest)}`;

  function exportExcel() {
    if (!data || !derived) return;
    const row = (cells: (string | number)[], header = false) =>
      `<Row>${cells
        .map(
          (cell) =>
            `<Cell${header ? ' ss:StyleID="Header"' : ''}><Data ss:Type="${typeof cell === 'number' ? 'Number' : 'String'}">${escapeXml(cell)}</Data></Cell>`,
        )
        .join('')}</Row>`;
    const sheets: string[] = [];
    const summaryRows = [
      row(['Instagram Lens 匯出報告'], true),
      row(['篩選範圍', rangeText]),
      row(['訊息方向', scope === 'mine' ? '我送出的' : scope === 'theirs' ? '對方傳的' : '全部訊息']),
    ];
    if (exportSections.summary)
      summaryRows.push(
        row(['總訊息', derived.messages.length]),
        row(['你送出的', derived.sent]),
        row(['對方傳的', derived.received]),
        row(['活躍日', derived.activeDays]),
        row(['對話數', derived.conversations.length]),
        row(['媒體附件', derived.media]),
      );
    if (exportSections.relations)
      summaryRows.push(
        row(['追蹤者', data.followers]),
        row(['追蹤中', data.following]),
        row(['互相關注', data.mutuals]),
      );
    sheets.push(`<Worksheet ss:Name="摘要"><Table>${summaryRows.join('')}</Table></Worksheet>`);
    if (exportSections.ranking)
      sheets.push(
        `<Worksheet ss:Name="私訊排行"><Table>${row(
          ['排名', '對話', '帳號', '訊息數', '文字數', '平均字數', '最近訊息'],
          true,
        )}${derived.ranking
          .slice(0, 50)
          .map((item, index) =>
            row([
              index + 1,
              item.name,
              item.handle ? `@${item.handle}` : '',
              item.count,
              item.characters,
              Number(item.average.toFixed(1)),
              item.lastAt ? messageTime.format(item.lastAt) : '',
            ]),
          )
          .join('')}</Table></Worksheet>`,
      );
    if (exportSections.trend)
      sheets.push(
        `<Worksheet ss:Name="每月趨勢"><Table>${row(['月份', '訊息數'], true)}${derived.trend
          .map((item) => row([item.key, item.count]))
          .join('')}</Table></Worksheet>`,
      );
    const workbook = `<?xml version="1.0"?><Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet"><Styles><Style ss:ID="Header"><Font ss:Color="#FFFFFF" ss:Bold="1"/><Interior ss:Color="#E1306C" ss:Pattern="Solid"/></Style></Styles>${sheets.join('')}</Workbook>`;
    downloadBlob(
      new Blob([`\uFEFF${workbook}`], {
        type: 'application/vnd.ms-excel;charset=utf-8',
      }),
      'instagram-lens-report.xls',
    );
  }

  function exportHtml() {
    if (!data || !derived) return;
    const top = derived.ranking.slice(0, 12);
    const trendMax = Math.max(1, ...derived.trend.map((item) => item.count));
    const sections = [
      exportSections.summary
        ? `<section><h2>重點數據</h2><div class="cards"><div><span>總訊息</span><b>${number.format(derived.messages.length)}</b></div><div><span>你送出的</span><b>${number.format(derived.sent)}</b></div><div><span>對方傳的</span><b>${number.format(derived.received)}</b></div><div><span>活躍日</span><b>${number.format(derived.activeDays)}</b></div></div></section>`
        : '',
      exportSections.ranking
        ? `<section><h2>私訊排行</h2><ol>${top
            .map(
              (item) =>
                `<li><span>${escapeHtml(item.name)}${item.handle ? `<small>@${escapeHtml(item.handle)}</small>` : ''}</span><b>${number.format(item.count)} 則</b></li>`,
            )
            .join('')}</ol></section>`
        : '',
      exportSections.trend
        ? `<section><h2>每月趨勢</h2><div class="trend">${derived.trend
            .map(
              (item) =>
                `<div><span style="height:${Math.max(5, (item.count / trendMax) * 100)}%"></span><small>${escapeHtml(item.key)}</small></div>`,
            )
            .join('')}</div></section>`
        : '',
      exportSections.relations
        ? `<section><h2>追蹤資訊</h2><div class="cards"><div><span>追蹤者</span><b>${number.format(data.followers)}</b></div><div><span>追蹤中</span><b>${number.format(data.following)}</b></div><div><span>互相關注</span><b>${number.format(data.mutuals)}</b></div></div></section>`
        : '',
    ].join('');
    const documentHtml = `<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Instagram Lens 報告</title><style>*{box-sizing:border-box}body{margin:0;background:#08070a;color:#f7f5f8;font-family:Arial,"Noto Sans TC",sans-serif}.page{width:min(100% - 40px,900px);margin:auto;padding:64px 0}.brand{color:#ff7b9e;font-weight:800}h1{font-size:42px;margin:14px 0 8px}header p{margin:5px 0;color:#948e9c}section{margin-top:20px;padding:24px;border:1px solid #2d2931;border-radius:18px;background:#141219}h2{margin:0 0 18px;font-size:20px}.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px}.cards div{padding:16px;border-radius:12px;background:#0e0d11}.cards span{display:block;color:#8b8590;font-size:12px}.cards b{display:block;margin-top:7px;font-size:22px}ol{margin:0;padding:0;list-style:none}li{display:flex;justify-content:space-between;gap:18px;padding:10px 0;border-bottom:1px solid #29252d}li span{color:#ded9e1}li small{display:block;margin-top:3px;color:#8b7684}.trend{height:220px;display:flex;align-items:end;gap:8px}.trend div{height:100%;flex:1;display:flex;align-items:center;justify-content:end;flex-direction:column}.trend div span{width:70%;border-radius:5px 5px 0 0;background:linear-gradient(#ff789f,#d82e6c)}.trend small{margin-top:7px;color:#6f6975;font-size:9px}footer{margin-top:24px;color:#6f6975;font-size:12px}</style></head><body><main class="page"><header><div class="brand">INSTAGRAM LENS</div><h1>Instagram 活動報告</h1><p>${escapeHtml(rangeText)}</p></header>${sections}<footer>由 Instagram 匯出資料在本機產生 · 不含訊息原文</footer></main></body></html>`;
    downloadBlob(
      new Blob([documentHtml], { type: 'text/html;charset=utf-8' }),
      'instagram-lens-report.html',
    );
  }

  function renderPngCanvas(canvas: HTMLCanvasElement) {
    if (!data || !derived) return false;
    const sizes = {
      story: [1080, 1920],
      share: [1200, 1200],
      report: [1600, 1200],
    } as const;
    const [width, height] = sizes[exportPurpose];
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return false;
    const C = {
      bg: '#08070a',
      panel: '#141219',
      panel2: '#1d1921',
      line: '#322d35',
      text: '#f7f5f8',
      muted: '#bdb5c2',
      dim: '#7d7582',
      pink: '#e1306c',
      purple: '#833ab4',
      orange: '#f77737',
      yellow: '#fcb045',
    };
    const rounded = (
      x: number,
      y: number,
      w: number,
      h: number,
      r: number,
      fill: string | CanvasGradient,
      stroke?: string,
    ) => {
      ctx.beginPath();
      ctx.roundRect(x, y, w, h, r);
      ctx.fillStyle = fill;
      ctx.fill();
      if (stroke) {
        ctx.strokeStyle = stroke;
        ctx.lineWidth = 2;
        ctx.stroke();
      }
    };
    const font = (size: number, weight = 650) => {
      ctx.font = `${weight} ${size}px "Segoe UI", Arial, sans-serif`;
    };
    const fitText = (value: string, maxWidth: number) => {
      let result = value;
      while (result.length > 2 && ctx.measureText(result).width > maxWidth)
        result = `${result.slice(0, -2)}…`;
      return result;
    };
    const drawBackground = () => {
      ctx.fillStyle = C.bg;
      ctx.fillRect(0, 0, width, height);
      const g1 = ctx.createRadialGradient(width * 0.18, height * 0.12, 0, width * 0.18, height * 0.12, width * 0.7);
      g1.addColorStop(0, 'rgba(225,48,108,.30)');
      g1.addColorStop(1, 'rgba(225,48,108,0)');
      ctx.fillStyle = g1;
      ctx.fillRect(0, 0, width, height);
      const g2 = ctx.createRadialGradient(width * 0.86, height * 0.18, 0, width * 0.86, height * 0.18, width * 0.55);
      g2.addColorStop(0, 'rgba(131,58,180,.32)');
      g2.addColorStop(1, 'rgba(131,58,180,0)');
      ctx.fillStyle = g2;
      ctx.fillRect(0, 0, width, height);
    };
    const drawBrand = (x: number, y: number, size: number) => {
      const gradient = ctx.createLinearGradient(x, y, x + size, y + size);
      gradient.addColorStop(0, C.purple);
      gradient.addColorStop(0.58, C.pink);
      gradient.addColorStop(1, C.yellow);
      rounded(x, y, size, size, size * 0.3, gradient);
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = Math.max(3, size * 0.07);
      ctx.beginPath();
      ctx.roundRect(x + size * 0.24, y + size * 0.24, size * 0.52, size * 0.52, size * 0.14);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(x + size * 0.5, y + size * 0.5, size * 0.15, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = '#fff';
      ctx.beginPath();
      ctx.arc(x + size * 0.66, y + size * 0.34, size * 0.045, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = C.text;
      font(size * 0.34, 850);
      ctx.fillText('Instagram Lens', x + size * 1.28, y + size * 0.66);
    };
    const drawHeader = (pad: number, compact = false) => {
      drawBrand(pad, compact ? 54 : 70, compact ? 50 : 62);
      ctx.fillStyle = C.pink;
      font(compact ? 13 : 15, 850);
      ctx.fillText('LOCAL DATA REPORT', pad, compact ? 150 : 178);
      ctx.fillStyle = C.text;
      font(compact ? 46 : 64, 850);
      ctx.fillText(
        exportPurpose === 'story' ? 'Instagram 活動足跡' : 'Instagram 活動報告',
        pad,
        compact ? 205 : 252,
      );
      ctx.fillStyle = C.muted;
      font(compact ? 17 : 21, 550);
      ctx.fillText(fitText(rangeText, width - pad * 2), pad, compact ? 244 : 300);
      return compact ? 292 : 365;
    };
    const drawStats = (x: number, y: number, w: number, h: number, columns: number) => {
      const items = [
        ['總訊息', number.format(derived.messages.length), C.pink],
        ['你送出的', number.format(derived.sent), C.purple],
        ['對方傳的', number.format(derived.received), C.orange],
        ['活躍日', number.format(derived.activeDays), C.yellow],
      ];
      const gap = 14;
      const cardW = (w - gap * (columns - 1)) / columns;
      items.forEach(([label, value, color], index) => {
        const col = index % columns;
        const row = Math.floor(index / columns);
        const left = x + col * (cardW + gap);
        const top = y + row * (h + gap);
        rounded(left, top, cardW, h, 20, C.panel, C.line);
        rounded(left + 20, top + 20, 9, 42, 5, color);
        ctx.fillStyle = C.muted;
        font(16, 650);
        ctx.fillText(label, left + 46, top + 38);
        ctx.fillStyle = C.text;
        font(columns === 4 ? 30 : 38, 850);
        ctx.fillText(value, left + 46, top + 86);
      });
      return Math.ceil(items.length / columns) * h + (Math.ceil(items.length / columns) - 1) * gap;
    };
    const drawRanking = (x: number, y: number, w: number, h: number, count: number) => {
      rounded(x, y, w, h, 24, C.panel, C.line);
      ctx.fillStyle = C.text;
      font(25, 800);
      ctx.fillText('私訊排行', x + 28, y + 44);
      const top = derived.ranking.slice(0, count);
      const max = Math.max(1, ...top.map((item) => item.metricValue));
      const rowH = (h - 82) / Math.max(1, top.length);
      top.forEach((item, index) => {
        const cy = y + 82 + index * rowH;
        const gradient = ctx.createLinearGradient(x + 28, cy - 19, x + 66, cy + 19);
        gradient.addColorStop(0, C.purple);
        gradient.addColorStop(0.62, C.pink);
        gradient.addColorStop(1, C.orange);
        ctx.fillStyle = gradient;
        ctx.beginPath();
        ctx.arc(x + 47, cy, 19, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#fff';
        font(13, 850);
        ctx.textAlign = 'center';
        ctx.fillText(avatarInitial(item.handle || item.name), x + 47, cy + 5);
        ctx.textAlign = 'left';
        ctx.fillStyle = C.text;
        font(16, 750);
        ctx.fillText(fitText(`${index + 1}. ${item.name}`, w * 0.48), x + 78, cy - 2);
        if (item.handle) {
          ctx.fillStyle = C.dim;
          font(11, 650);
          ctx.fillText(`@${fitText(item.handle, w * 0.34)}`, x + 78, cy + 16);
        }
        const metric =
          rankingMetric === 'average'
            ? item.metricValue.toFixed(1)
            : number.format(Math.round(item.metricValue));
        ctx.fillStyle = C.muted;
        font(15, 750);
        ctx.textAlign = 'right';
        ctx.fillText(`${metric} ${rankingUnit}`, x + w - 28, cy + 2);
        ctx.textAlign = 'left';
        rounded(x + 78, cy + 26, w - 106, 7, 4, '#2a252d');
        rounded(x + 78, cy + 26, ((w - 106) * item.metricValue) / max, 7, 4, C.pink);
      });
    };
    const drawTrend = (x: number, y: number, w: number, h: number) => {
      rounded(x, y, w, h, 24, C.panel, C.line);
      ctx.fillStyle = C.text;
      font(24, 800);
      ctx.fillText('每月趨勢', x + 28, y + 43);
      const items = derived.trend.slice(-12);
      const max = Math.max(1, ...items.map((item) => item.count));
      const chartTop = y + 74;
      const chartH = h - 112;
      const gap = 8;
      const barW = (w - 56 - gap * Math.max(0, items.length - 1)) / Math.max(1, items.length);
      items.forEach((item, index) => {
        const barH = Math.max(8, (chartH * item.count) / max);
        const left = x + 28 + index * (barW + gap);
        rounded(left, chartTop + chartH - barH, barW, barH, Math.min(7, barW / 2), index === items.length - 1 ? C.yellow : C.pink);
        if (index % 3 === 0) {
          ctx.fillStyle = C.dim;
          font(10, 600);
          ctx.textAlign = 'center';
          ctx.fillText(item.key.slice(5), left + barW / 2, y + h - 19);
          ctx.textAlign = 'left';
        }
      });
    };
    const drawRelations = (x: number, y: number, w: number, h: number) => {
      rounded(x, y, w, h, 24, C.panel, C.line);
      ctx.fillStyle = C.text;
      font(24, 800);
      ctx.fillText('追蹤資訊', x + 28, y + 43);
      const items = [
        ['追蹤者', data.followers],
        ['追蹤中', data.following],
        ['互相關注', data.mutuals],
      ];
      items.forEach(([label, value], index) => {
        const top = y + 72 + index * 58;
        rounded(x + 28, top, w - 56, 43, 12, C.panel2);
        ctx.fillStyle = C.dim;
        font(13, 650);
        ctx.fillText(String(label), x + 44, top + 27);
        ctx.fillStyle = C.text;
        font(21, 850);
        ctx.textAlign = 'right';
        ctx.fillText(number.format(Number(value)), x + w - 44, top + 29);
        ctx.textAlign = 'left';
      });
    };
    const drawFooter = () => {
      ctx.fillStyle = C.dim;
      font(14, 600);
      ctx.fillText('INSTAGRAM LENS', exportPurpose === 'report' ? 80 : 70, height - 56);
      ctx.textAlign = 'right';
      ctx.fillText('本機資料產生 · 不含訊息原文', width - (exportPurpose === 'report' ? 80 : 70), height - 56);
      ctx.textAlign = 'left';
    };

    drawBackground();
    if (exportPurpose === 'story') {
      const pad = 70;
      let y = drawHeader(pad);
      if (exportSections.summary)
        y += drawStats(pad, y, width - pad * 2, 132, 2) + 22;
      if (exportSections.ranking) {
        drawRanking(pad, y, width - pad * 2, 500, 6);
        y += 522;
      }
      if (exportSections.trend) {
        drawTrend(pad, y, width - pad * 2, 300);
        y += 322;
      }
      if (exportSections.relations)
        drawRelations(pad, y, width - pad * 2, 240);
    } else if (exportPurpose === 'share') {
      const pad = 62;
      let y = drawHeader(pad, true);
      if (exportSections.summary)
        y += drawStats(pad, y, width - pad * 2, 108, 4) + 20;
      const leftW = 650;
      const rightX = pad + leftW + 18;
      const rightW = width - pad - rightX;
      if (exportSections.ranking) drawRanking(pad, y, leftW, 500, 6);
      if (exportSections.trend) drawTrend(rightX, y, rightW, 285);
      if (exportSections.relations) drawRelations(rightX, y + 303, rightW, 197);
    } else {
      const pad = 80;
      let y = drawHeader(pad, true);
      if (exportSections.summary)
        y += drawStats(pad, y, width - pad * 2, 110, 4) + 20;
      const leftW = 880;
      const rightX = pad + leftW + 20;
      const rightW = width - pad - rightX;
      if (exportSections.ranking) drawRanking(pad, y, leftW, 600, 8);
      if (exportSections.trend) drawTrend(rightX, y, rightW, 360);
      if (exportSections.relations) drawRelations(rightX, y + 380, rightW, 220);
    }
    drawFooter();
    return true;
  }

  function exportPng() {
    const canvas = document.createElement('canvas');
    if (!renderPngCanvas(canvas)) return;
    canvas.toBlob((blob) => {
      if (blob) downloadBlob(blob, `instagram-lens-${exportPurpose}.png`);
    }, 'image/png');
  }

  function exportSelected() {
    if (exportFormat === 'excel') exportExcel();
    else if (exportFormat === 'html') exportHtml();
    else exportPng();
    setExportOpen(false);
  }

  const input = (
    <input
      ref={inputRef}
      className="sr-only"
      type="file"
      multiple
      onChange={(event) => {
        const element = event.currentTarget;
        void handleFiles(element.files).finally(() => {
          element.value = '';
        });
      }}
      {...({
        webkitdirectory: '',
        directory: '',
      } as React.InputHTMLAttributes<HTMLInputElement>)}
    />
  );

  if (!data)
    return (
      <main className="ig-import-page">
        {input}
        <nav className="ig-nav">
          <Link className="ig-brand" href="/instagram">
            <InstagramMark /> Instagram Lens
          </Link>
          <Link className="ig-platform-link" href="/">
            Discord Lens
          </Link>
        </nav>
        <section className="ig-import-shell">
          <div className="ig-intro">
            <p className="ig-eyebrow">
              <Sparkles size={16} /> Instagram 資料下載分析器
            </p>
            <h1>
              你的私訊、關係與活躍節奏，<span>一次看懂。</span>
            </h1>
            <p>
              選擇 Instagram
              解壓縮後的資料夾。訊息、追蹤者與追蹤中資料會直接在瀏覽器分析。
            </p>
            <div className="ig-trust">
              <LockKeyhole size={18} />
              <span>
                <b>原始資料不上傳</b>重新整理後即清除
              </span>
            </div>
          </div>
          <div className="ig-drop">
            <div className="ig-folder">
              <InstagramMark size={34} />
            </div>
            <h2>選擇 Instagram 資料夾</h2>
            <p>
              支援 Meta 匯出的 HTML 格式，需要包含{' '}
              <code>your_instagram_activity/messages</code>
            </p>
            <button onClick={() => inputRef.current?.click()}>
              <FolderOpen size={18} /> 選擇資料夾
            </button>
            <ul>
              <li>自動辨識你的名稱</li>
              <li>支援 inbox、訊息邀請與隱藏對話</li>
              <li>可直接套用其他人的資料包</li>
            </ul>
          </div>
        </section>
        {loading && (
          <div className="ig-loading">
            <div>
              <InstagramMark size={30} />
              <b>正在整理 Instagram 資料</b>
              <span>{progress}%</span>
              <i>
                <span style={{ width: `${progress}%` }} />
              </i>
            </div>
          </div>
        )}
        {error && (
          <div className="ig-error">
            <span>{error}</span>
            <button onClick={() => setError('')} aria-label="關閉錯誤">
              <X size={16} />
            </button>
          </div>
        )}
      </main>
    );

  return (
    <main className="ig-dashboard">
      {input}
      <header className="ig-header">
        <Link className="ig-brand" href="/instagram">
          <InstagramMark /> Instagram Lens
        </Link>
        <div>
          <Link className="ig-platform-link" href="/">
            Discord Lens
          </Link>
          <span className="ig-local">
            <LockKeyhole size={14} /> 本機分析
          </span>
          <button
            className="ig-ghost"
            onClick={() => inputRef.current?.click()}
          >
            <FolderOpen size={16} /> 更換資料
          </button>
          <button
            className="ig-export"
            onClick={() => setExportOpen(true)}
          >
            <Share2 size={16} /> 建立分享報告
          </button>
        </div>
      </header>
      <div className="ig-shell">
        <section className="ig-welcome">
          <div>
            <p className="ig-eyebrow">{data.packageName}</p>
            <h1>Instagram 活動總覽</h1>
            <p>私訊內容留在你的裝置上，統計會跟著日期與訊息方向更新。</p>
          </div>
          <div className="ig-range">
            <CalendarDays size={18} /> {rangeText}
          </div>
        </section>
        <section className="ig-controls">
          <div className="ig-segments">
            {(
              [
                ['all', '從最早到現在'],
                ['year', `${new Date().getFullYear()} 年`],
                ['lastyear', `${new Date().getFullYear() - 1} 年`],
                ['90days', '近 90 天'],
                ['custom', '自訂區間'],
              ] as [RangePreset, string][]
            ).map(([value, label]) => (
              <button
                className={preset === value ? 'active' : ''}
                key={value}
                onClick={() => setPreset(value)}
              >
                {label}
              </button>
            ))}
          </div>
          {preset === 'custom' && (
            <div className="ig-dates">
              <input
                type="date"
                value={customStart}
                onChange={(event) => setCustomStart(event.target.value)}
                aria-label="開始日期"
              />
              <span>至</span>
              <input
                type="date"
                value={customEnd}
                onChange={(event) => setCustomEnd(event.target.value)}
                aria-label="結束日期"
              />
            </div>
          )}
          <label className="ig-select">
            <span>我是</span>
            <select
              value={selfName}
              onChange={(event) => setSelfName(event.target.value)}
            >
              {data.senders.map((sender) => (
                <option key={sender}>{sender}</option>
              ))}
            </select>
            <ChevronDown size={15} />
          </label>
        </section>
        <section className="ig-stats">
          <article>
            <span>
              <MessageCircle size={20} />
            </span>
            <p>總訊息</p>
            <strong>{number.format(derived?.messages.length || 0)}</strong>
            <small>{number.format(derived?.activeDays || 0)} 個活躍日</small>
          </article>
          <article>
            <span>
              <Send size={20} />
            </span>
            <p>你送出的</p>
            <strong>{number.format(derived?.sent || 0)}</strong>
            <small>收到 {number.format(derived?.received || 0)} 則</small>
          </article>
          <article>
            <span>
              <Users size={20} />
            </span>
            <p>對話數</p>
            <strong>{number.format(derived?.conversations.length || 0)}</strong>
            <small>
              {data.mutuals
                ? `${number.format(data.mutuals)} 位互相關注`
                : '依訊息資料統計'}
            </small>
          </article>
          <article>
            <span>
              <ImageIcon size={20} />
            </span>
            <p>媒體附件</p>
            <strong>{number.format(derived?.media || 0)}</strong>
            <small>圖片、影片與語音</small>
          </article>
        </section>
        <section className="ig-grid">
          <article className="ig-panel ig-ranking">
            <div className="ig-panel-head">
              <div>
                <p>私訊排行</p>
                <h2>你最常和誰聊天？</h2>
              </div>
              <label className="ig-search">
                <Search size={16} />
                <input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="搜尋對話"
                  aria-label="搜尋對話"
                />
              </label>
            </div>
            <div className="ig-scope">
              {(
                [
                  ['all', '全部訊息'],
                  ['mine', '我送出的'],
                  ['theirs', '對方傳的'],
                ] as [MessageScope, string][]
              ).map(([value, label]) => (
                <button
                  className={scope === value ? 'active' : ''}
                  key={value}
                  onClick={() => setScope(value)}
                >
                  {label}
                </button>
              ))}
            </div>
            <div className="ig-ranking-tools">
              <div className="ig-metric" aria-label="排行依據">
                {(
                  [
                    ['messages', '訊息則數'],
                    ['characters', '文字數量'],
                    ['average', '平均字數'],
                  ] as [RankingMetric, string][]
                ).map(([value, label]) => (
                  <button
                    className={rankingMetric === value ? 'active' : ''}
                    key={value}
                    onClick={() => setRankingMetric(value)}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <label className="ig-check">
                <input
                  type="checkbox"
                  checked={hideInstagramUsers}
                  onChange={(event) =>
                    setHideInstagramUsers(event.target.checked)
                  }
                />
                忽略 Instagram 用戶
              </label>
              <label className="ig-check">
                <input
                  type="checkbox"
                  checked={loadPublicAvatars}
                  onChange={(event) =>
                    setLoadPublicAvatars(event.target.checked)
                  }
                />
                載入公開頭像
              </label>
              <span
                className={
                  loadedAvatarCount > 0
                    ? 'ig-avatar-status ok'
                    : failedAvatarCount > 0
                      ? 'ig-avatar-status blocked'
                      : 'ig-avatar-status'
                }
              >
                {avatarStatus}
              </span>
            </div>
            <div className="ig-rank-list">
              {ranking.map((item, index) => (
                <button
                  key={item.id}
                  className="ig-rank-row"
                  aria-label={`查看與 ${item.name} 的 Instagram 對話`}
                  onClick={() => {
                    setOpenThread(item.id);
                    setVisibleMessages(250);
                  }}
                >
                  <InstagramAvatar
                    name={item.name}
                    handle={item.handle}
                    avatarUrl={
                      item.handle ? avatarUrls[item.handle] : undefined
                    }
                    rank={index + 1}
                  />
                  <span className="ig-rank-main">
                    <span>
                      <strong>
                        {item.name}
                        {item.handle ? <small>@{item.handle}</small> : null}
                      </strong>
                      <em>
                        {rankingMetric === 'average'
                          ? item.metricValue.toFixed(1)
                          : number.format(Math.round(item.metricValue))}{' '}
                        {rankingUnit}
                      </em>
                    </span>
                    <i>
                      <b
                        style={{
                          width: `${Math.max(3, (item.metricValue / maxRank) * 100)}%`,
                        }}
                      />
                    </i>
                  </span>
                </button>
              ))}
            </div>
          </article>
          <article className="ig-panel ig-trend">
            <div className="ig-panel-head">
              <div>
                <p>時間軸</p>
                <h2>每月訊息趨勢</h2>
              </div>
              <small>最近 {derived?.trend.length || 0} 個月</small>
            </div>
            <div className="ig-bars">
              {derived?.trend.map((item) => (
                <div
                  key={item.key}
                  title={`${item.key} · ${number.format(item.count)} 則`}
                >
                  <span
                    style={{
                      height: `${Math.max(6, (item.count / maxTrend) * 100)}%`,
                    }}
                  />
                  <small>
                    {month.format(new Date(`${item.key}-01T00:00:00`))}
                  </small>
                </div>
              ))}
            </div>
          </article>
          <article className="ig-panel ig-relations">
            <div className="ig-panel-head">
              <div>
                <p>關係網路</p>
                <h2>追蹤狀態</h2>
              </div>
              <Heart size={20} />
            </div>
            <div className="ig-relation-ring">
              <div>
                <strong>{number.format(data.mutuals)}</strong>
                <span>互相關注</span>
              </div>
            </div>
            <div className="ig-relation-stats">
              <div>
                <span>追蹤者</span>
                <b>{number.format(data.followers)}</b>
              </div>
              <div>
                <span>追蹤中</span>
                <b>{number.format(data.following)}</b>
              </div>
            </div>
            <small>僅在資料包包含 followers_and_following 時顯示。</small>
          </article>
          <article className="ig-panel ig-hours">
            <div className="ig-panel-head">
              <div>
                <p>聊天節奏</p>
                <h2>一天中的活躍時段</h2>
              </div>
              <Clock3 size={20} />
            </div>
            <div className="ig-hour-chart">
              {derived?.hours.map((count, hour) => (
                <span
                  key={hour}
                  title={`${hour}:00 · ${number.format(count)} 則`}
                >
                  <i
                    className={hour === derived.peakHour ? 'peak' : ''}
                    style={{
                      height: `${Math.max(4, (count / maxHour) * 100)}%`,
                    }}
                  />
                </span>
              ))}
            </div>
            <div className="ig-hour-axis">
              <span>00</span>
              <span>06</span>
              <span>12</span>
              <span>18</span>
              <span>23</span>
            </div>
            <p>
              最活躍時段是{' '}
              <b>
                {String(derived?.peakHour || 0).padStart(2, '0')}:00–
                {String(((derived?.peakHour || 0) + 1) % 24).padStart(2, '0')}
                :00
              </b>
            </p>
          </article>
        </section>
        <footer className="ig-footer">
          <LockKeyhole size={14} /> 所有 HTML
          都在瀏覽器內解析；不會儲存訊息內容。
        </footer>
      </div>
      <Dialog open={exportOpen} onOpenChange={setExportOpen}>
        <DialogContent className="export-dialog">
          <DialogHeader>
            <DialogTitle>建立 Instagram 分享報告</DialogTitle>
            <DialogDescription>
              套用目前的「{rangeText}」篩選，選擇格式、用途和公開內容。
            </DialogDescription>
          </DialogHeader>
          <div className="export-layout">
            <div className="export-options">
              <fieldset>
                <legend>匯出格式</legend>
                <RadioGroup
                  className="format-grid"
                  value={exportFormat}
                  onValueChange={(value) => setExportFormat(value as ExportFormat)}
                >
                  <label
                    htmlFor="ig-format-excel"
                    className={exportFormat === 'excel' ? 'selected' : ''}
                  >
                    <RadioGroupItem id="ig-format-excel" value="excel" />
                    <FileSpreadsheet size={20} />
                    <span>
                      <b>Excel</b>
                      <small>可編輯資料表</small>
                    </span>
                  </label>
                  <label
                    htmlFor="ig-format-html"
                    className={exportFormat === 'html' ? 'selected' : ''}
                  >
                    <RadioGroupItem id="ig-format-html" value="html" />
                    <FileCode2 size={20} />
                    <span>
                      <b>HTML</b>
                      <small>完整網頁報告</small>
                    </span>
                  </label>
                  <label
                    htmlFor="ig-format-png"
                    className={exportFormat === 'png' ? 'selected' : ''}
                  >
                    <RadioGroupItem id="ig-format-png" value="png" />
                    <ImageIcon size={20} />
                    <span>
                      <b>PNG</b>
                      <small>直接分享圖片</small>
                    </span>
                  </label>
                </RadioGroup>
              </fieldset>
              {exportFormat === 'png' && (
                <fieldset>
                  <legend>分享用途</legend>
                  <RadioGroup
                    className="purpose-grid"
                    value={exportPurpose}
                    onValueChange={(value) =>
                      setExportPurpose(value as ExportPurpose)
                    }
                  >
                    <label
                      htmlFor="ig-purpose-story"
                      className={exportPurpose === 'story' ? 'selected' : ''}
                    >
                      <RadioGroupItem id="ig-purpose-story" value="story" />
                      <span>
                        <b>限時動態</b>
                        <small>1080 × 1920</small>
                      </span>
                    </label>
                    <label
                      htmlFor="ig-purpose-share"
                      className={exportPurpose === 'share' ? 'selected' : ''}
                    >
                      <RadioGroupItem id="ig-purpose-share" value="share" />
                      <span>
                        <b>一般分享</b>
                        <small>1200 × 1200</small>
                      </span>
                    </label>
                    <label
                      htmlFor="ig-purpose-report"
                      className={exportPurpose === 'report' ? 'selected' : ''}
                    >
                      <RadioGroupItem id="ig-purpose-report" value="report" />
                      <span>
                        <b>橫式報告</b>
                        <small>1600 × 1200</small>
                      </span>
                    </label>
                  </RadioGroup>
                </fieldset>
              )}
              <fieldset>
                <legend>要分享的內容</legend>
                <div className="section-checks">
                  {(
                    [
                      ['summary', '重點數據', '總訊息、收發與活躍日'],
                      ['ranking', '私訊排行', '依目前排行依據排序'],
                      ['trend', '每月趨勢', '最近月份分布'],
                      ['relations', '追蹤資訊', '追蹤者、追蹤中、互關'],
                    ] as [keyof InstagramExportSections, string, string][]
                  ).map(([key, label, note]) => (
                    <label htmlFor={`ig-section-${key}`} key={key}>
                      <Checkbox
                        id={`ig-section-${key}`}
                        checked={exportSections[key]}
                        onCheckedChange={(checked) =>
                          setExportSections((current) => ({
                            ...current,
                            [key]: checked === true,
                          }))
                        }
                      />
                      <span>
                        <b>{label}</b>
                        <small>{note}</small>
                      </span>
                    </label>
                  ))}
                </div>
              </fieldset>
            </div>
            <aside className={`export-preview ${exportPurpose}`}>
              {exportFormat === 'png' ? (
                <>
                  <div className="preview-label">
                    <span>即時預覽</span>
                    <small>與匯出圖片完全相同</small>
                  </div>
                  <div className="preview-stage">
                    <canvas
                      key={`${exportPurpose}-${Object.values(exportSections).join('-')}-${rangeText}-${rankingMetric}-${scope}`}
                      ref={(canvas) => {
                        if (canvas) renderPngCanvas(canvas);
                      }}
                      aria-label="Instagram PNG 匯出即時預覽"
                    />
                  </div>
                </>
              ) : (
                <div className="preview-unavailable">
                  <FileCode2 size={28} />
                  <b>{exportFormat === 'excel' ? 'Excel 資料表' : 'HTML 網頁報告'}</b>
                  <p>
                    {exportFormat === 'excel'
                      ? '下載後可在 Excel 開啟並繼續整理。'
                      : '下載後可直接用瀏覽器開啟完整報告。'}
                  </p>
                </div>
              )}
            </aside>
          </div>
          <div className="export-footer">
            <p>
              <LockKeyhole size={14} /> 只匯出你勾選的統計，不含訊息原文。
            </p>
            <button className="ghost-button" onClick={() => setExportOpen(false)}>
              取消
            </button>
            <button
              className="export-button"
              disabled={!Object.values(exportSections).some(Boolean)}
              onClick={exportSelected}
            >
              <ArrowDownToLine size={16} /> 產生檔案
            </button>
          </div>
        </DialogContent>
      </Dialog>
      <Sheet
        open={Boolean(openThread)}
        onOpenChange={(open) => {
          if (!open) setOpenThread(null);
        }}
      >
        <SheetContent className="ig-conversation">
          <SheetHeader className="ig-conversation-head">
            <InstagramAvatar
              name={selected?.name || 'Instagram 對話'}
              handle={selected?.handle}
              avatarUrl={
                selected?.handle ? avatarUrls[selected.handle] : undefined
              }
              large
            />
            <div>
              <SheetTitle>{selected?.name || 'Instagram 對話'}</SheetTitle>
              <SheetDescription>
                {selected?.handle ? `@${selected.handle} · ` : ''}
                {rangeText} · {selectedMessages.length} 則訊息
              </SheetDescription>
            </div>
          </SheetHeader>
          <div className="ig-message-list">
            {selectedMessages.slice(-visibleMessages).map((message, index) => (
              <article
                className={message.sender === selfName ? 'mine' : ''}
                key={`${message.at}-${index}`}
              >
                <div>
                  <b>{message.sender}</b>
                  <time>{messageTime.format(message.at)}</time>
                </div>
                {message.body && <p>{message.body}</p>}
                {message.media > 0 && (
                  <span>
                    <ImageIcon size={13} /> {message.media} 個媒體附件
                  </span>
                )}
              </article>
            ))}
          </div>
          <SheetFooter className="ig-conversation-footer">
            {selectedMessages.length > visibleMessages && (
              <button
                onClick={() => setVisibleMessages((current) => current + 250)}
              >
                載入更早訊息
              </button>
            )}
            <small>訊息只從本機匯出檔讀取</small>
          </SheetFooter>
        </SheetContent>
      </Sheet>
      {loading && (
        <div className="ig-loading">
          <div>
            <InstagramMark size={30} />
            <b>正在整理 Instagram 資料</b>
            <span>{progress}%</span>
            <i>
              <span style={{ width: `${progress}%` }} />
            </i>
          </div>
        </div>
      )}
      {error && (
        <div className="ig-error">
          <span>{error}</span>
          <button onClick={() => setError('')} aria-label="關閉錯誤">
            <X size={16} />
          </button>
        </div>
      )}
    </main>
  );
}
