# Discord Lens

Discord Lens 是一個本機優先的 Discord Data Package 分析工具。選擇 Discord 官方匯出的 `package` 資料夾後，應用程式會直接在瀏覽器中解析訊息與活動資料，整理成可互動的統計儀表板，並可匯出 Excel、HTML 或社群分享圖片。

> 訊息與 Activity 內容只在目前瀏覽器分頁及本機記憶體中處理，不會上傳到專案伺服器。若設定選用的 Bot Token，本機伺服器只會把 DM 對象的 User ID 傳給 Discord 官方 API，以取得公開帳號名稱與頭像。重新整理頁面後，已匯入的資料會清除。

## 功能

- 統計自己送出的訊息數、活躍日、附件、連結與文字字元數
- 查看最常聯絡的私訊對象、最活躍的伺服器與頻道
- 顯示每月訊息趨勢、星期分布與一天中的活躍時段
- 支援從最早到現在、今年、去年、近 90 天與自訂日期範圍
- 可依全部、私人訊息或伺服器／群組訊息篩選
- 自動在背景分析 Discord Activity 語音事件
- 顯示語音連線時間、實際發言時間、通話場次與常用語音頻道
- 點擊私訊排行即可查看該對象的本機訊息紀錄
- 從私訊 `channel.json` 顯示對方 Discord User ID
- 可用伺服器端 Bot Token 自動取得前 20 名私訊對象的 Discord 頭像
- 可選擇顯示或隱藏 `Unknown Participant`
- 匯出 Excel、獨立 HTML 報告或 PNG 分享圖片
- PNG 提供限時動態、方形分享與橫式報告三種比例
- PNG 設定視窗提供與下載結果相同的即時 Canvas 預覽
- 深色 Discord 風格介面

## 重要限制

### 訊息紀錄不是完整的雙向聊天

Discord 官方 Data Package 的 `Messages` 資料只包含帳號本人送出的訊息。因此聊天側欄可以顯示你曾傳給對方的內容，但無法還原對方的回覆、已刪除訊息，以及未包含在資料包中的內容。

### 對方頭像

官方資料包通常會提供帳號本人的 `Account/avatar.png`，但一對一私訊不會提供對方的頭像檔案或 avatar hash。未設定 Bot Token 時，Discord Lens 會使用本機產生的首字頭像；設定後，本機 API 會依 `channel.json` 裡的 User ID 向 Discord 官方 API 查詢公開頭像。Token 只存在伺服器端，瀏覽器不會收到 Token。

請勿在專案中使用 Discord 使用者 Token。以一般使用者 Token 自動存取 Discord 屬於 self-bot 行為，可能違反 Discord 規範並導致帳號遭停權。

### 語音時間是估算值

語音統計來自 Data Package 的 Activity 事件，例如 `voice_disconnect`、`duration_connected_ms` 與 `duration_speaking_ms`。結果可能受到 Discord 隱私設定、資料保留政策、匯出範圍或事件缺漏影響，不能視為完整且精確的通話帳單。

Activity 檔案可能非常大。應用程式使用串流方式讀取，並在儀表板顯示進度；分析期間請保持分頁開啟。

## 取得 Discord Data Package

Discord 桌面版或瀏覽器版目前可由以下位置提出申請：

1. 開啟「使用者設定」。
2. 前往「資料與隱私」。
3. 找到「申請你的資料」並按下申請按鈕。
4. 選擇要包含的資料後送出申請。
5. Discord 會把下載連結寄到帳號綁定的電子郵件。

資料準備可能需要一段時間。最新步驟請參考 [Discord 官方 Data Package 說明](https://support.discord.com/hc/en-us/articles/360004957991-Your-Discord-Data-Package)。

下載完成後，請先解壓縮 ZIP。Discord Lens 要選擇的是解壓縮後、內含 `Messages` 與 `Account` 等目錄的 `package` 資料夾，不是 ZIP 檔本身。

## 支援的資料結構

基本訊息分析至少需要：

```text
package/
├─ Account/
│  ├─ user.json
│  └─ avatar.png                 # 選用
├─ Messages/
│  ├─ index.json
│  └─ c<channel-id>/
│     ├─ channel.json
│     └─ messages.json
├─ Servers/                     # 選用，用於補充伺服器與頻道名稱
└─ Activity/
   └─ <category>/
      └─ events-*.json          # 選用，用於語音活動估算
```

不同時間匯出的 Data Package 可能具有不同檔名或欄位。缺少選用資料時，相關功能會顯示無法分析，而不會阻止基本訊息統計。

## 本機使用

### 系統需求

- Node.js 22.13 或更新版本
- npm
- Chrome 或 Edge 桌面版

資料夾選擇使用瀏覽器的目錄上傳能力。其他瀏覽器若不支援 `webkitdirectory`，可能無法選取完整資料夾。

### 安裝與啟動

```bash
git clone https://github.com/wu-zuan/discord-user-data.git
cd discord-user-data
npm install
npm run dev
```

若要顯示私訊對象的真實頭像，複製範例環境檔並填入 Discord Bot Token：

```bash
copy .env.example .env
```

```dotenv
DISCORD_BOT_TOKEN=你的_Bot_Token
```

這是選用功能；不設定仍可使用所有基本統計、聊天紀錄與匯出功能。修改 `.env` 後需要重新啟動開發伺服器。

啟動後開啟終端顯示的本機網址，通常是：

```text
http://localhost:3000
```

按下「選擇資料夾」，選取解壓縮後的 Discord `package` 目錄即可開始分析。

### 建置正式版本

```bash
npm run build
npm run start
```

### 程式檢查

```bash
npm run lint
```

## 使用方式

1. 選擇 Discord `package` 資料夾。
2. 等候訊息索引完成；若找到 Activity 事件，語音分析會自動在背景開始。
3. 使用頁面上方按鈕切換年份、近 90 天或自訂日期。
4. 在排行區切換私訊對象、伺服器或頻道。
5. 點擊私訊對象，可查看目前日期範圍內最近 300 則本人送出的訊息。
6. 需要更早紀錄時，按下「載入更早的 300 則」。
7. 按下「建立分享報告」設定格式、用途與要公開的統計內容。

## 匯出格式

### Excel

輸出 Excel 可讀取的 SpreadsheetML `.xls`，依選項包含摘要、私訊排行、每月趨勢與語音排行。適合後續排序、篩選或製作自己的圖表。

### HTML

輸出單一、自包含的 `.html` 報告，可直接用瀏覽器開啟。報告只會包含匯出時勾選的統計區塊。

### PNG

PNG 使用瀏覽器 Canvas 在本機產生，提供：

| 用途 | 尺寸 | 適合情境 |
| --- | ---: | --- |
| 限時動態 | 1080 × 1920 | Instagram、Facebook 等直式限動 |
| 一般分享 | 1200 × 1200 | 方形社群貼文或聊天分享 |
| 橫式報告 | 1600 × 1200 | 簡報、文章或桌面瀏覽 |

右側即時預覽與最後下載的 PNG 使用同一套 Canvas 渲染器。日期範圍、身分資訊、排行、趨勢、語音內容及 `Unknown Participant` 顯示設定都會同步更新。

## 統計口徑

- 訊息數：`messages.json` 中具有有效時間戳記的訊息筆數
- 活躍日：至少送出一則訊息的不同日期數
- 私訊對象：類型為 `DM` 的頻道，依對象名稱彙總
- 活躍頻道：目前日期與訊息類型篩選後仍有訊息的頻道
- 伺服器排行：非私人訊息頻道依伺服器名稱彙總
- 附件數：依訊息 `Attachments` 欄位估算
- 連結數：依訊息文字中的 HTTP／HTTPS 網址估算
- 對方 ID：從 DM `channel.json` 的 `recipients` 排除本人帳號 ID 後取得
- 語音連線：Activity 事件中的連線持續時間加總
- 實際發言：Activity 事件中的發言持續時間加總

所有日期篩選都會套用到儀表板、聊天紀錄與匯出結果。

## 隱私與安全

- 基本分析不需要 Discord Token、Bot 或帳號密碼
- 真實對方頭像為選用功能，只接受 Bot Token；請勿使用 Discord User Token
- 不應把 Discord User Token、Bot Token 或其他密鑰提交到 Repository
- `.gitignore` 已排除 `.env*`，只保留不含密鑰的 `.env.example`
- 不會儲存或上傳訊息原文
- 啟用頭像功能時，只把最多前 20 名 DM 對象的 User ID 傳給 Discord 官方 API
- Bot Token 只由 `app/api/discord-users/route.ts` 在本機伺服器端讀取，不會傳給前端
- 聊天內容只在使用者點擊對象時，從對應的本機檔案讀取
- 匯出檔只包含使用者主動勾選的內容
- 分享報告前仍應檢查名稱、User ID、訊息統計等資訊是否適合公開

## 技術架構

- React 19
- Vinext / Vite
- TypeScript
- Shadcn 與 Base UI 互動元件
- Lucide 圖示
- Canvas PNG 渲染
- File API、Streams API 與 `createImageBitmap`

主要程式位於：

```text
app/page.tsx       # 資料解析、統計、互動與匯出
app/api/discord-users/route.ts # 使用 Bot Token 查詢公開帳號資料與頭像
app/globals.css    # Discord 風格與響應式版面
components/ui/     # 介面元件
```

## 疑難排解

### 找不到訊息資料

確認選擇的是解壓縮後的 `package` 資料夾，且其中存在 `Messages/index.json` 和至少一個 `Messages/c.../messages.json`。

### 沒有語音統計

Data Package 可能沒有 Activity 事件檔，或事件內沒有可辨識的語音斷線與持續時間欄位。只有語音頻道名稱無法推算停留時間。

### 語音分析很久

Activity JSON 可能達到數 GB。請保持頁面開啟，並等待進度完成。分析速度取決於檔案大小、儲存裝置與瀏覽器效能。

### 看不到對方回覆

這是 Discord Data Package 的資料範圍限制。官方匯出只包含帳號本人送出的訊息。

### 看不到對方頭像

確認專案根目錄的 `.env` 已設定有效的 `DISCORD_BOT_TOKEN`，並在修改後重新啟動 `npm run dev`。接著重新選擇 Data Package；有 User ID 的前 20 名私訊對象會自動向 Discord 官方 API 查詢頭像。

若仍只顯示首字頭像，請確認：

- `.env` 與 `package.json` 位於同一層目錄
- 使用的是 Discord Developer Portal 建立的 Bot Token，而不是 User Token
- 本機可以連線至 `discord.com` 與 `cdn.discordapp.com`
- 該排行項目能從 `Messages/.../channel.json` 解析出對方 User ID

## 授權

目前 Repository 尚未附加開源授權。除非之後加入明確的 `LICENSE`，否則預設保留所有權利。
