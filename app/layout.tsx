import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Discord Lens｜聊天紀錄分析器',
  description: '在瀏覽器本機分析 Discord Data Package，查看私訊、頻道與活躍時間排行。',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="zh-Hant"><body>{children}</body></html>;
}
