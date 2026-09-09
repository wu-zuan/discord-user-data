import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Social Lens｜Discord 與 Instagram 資料分析器',
  description:
    '在瀏覽器本機分析 Discord 與 Instagram 官方資料包，查看私訊排行、互動關係與活躍趨勢。',
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-Hant">
      <body>{children}</body>
    </html>
  );
}
