# GoTrip 出遊

出門玩的時候打開，馬上知道附近有什麼吃喝玩樂、離多遠、走路／騎車／開車要多久。
做成手機網頁（PWA），可以「加到主畫面」像 App 一樣用。**全部使用免費的開放資料，不用綁信用卡。**

## 功能

| 分頁 | 內容 |
|---|---|
| 📍 附近 | 吃・喝・玩・樂・住・設施（便利商店、加油站、停車場、廁所、ATM、藥局、充電站、醫院），依交通時間排序；步行／自行車／機車・汽車時間；只看營業中；一鍵開 Google 地圖導航 |
| 🗺️ 地圖 | 國土測繪中心中文底圖，標出清單上的地點 |
| 🚆 交通 | 最近的台鐵站與下一班車（含誤點）、起訖站班次查詢；附近公車／客運站牌與到站時間 |
| ⭐ 收藏 | 想去清單，一鍵「排順路」並用 Google 地圖走整條路線 |
| 🚧 路況 | 天氣預報與特報、附近道路即時事件、公路局消息、省道長期封閉路段、國家步道封閉公告、太魯閣步道與中橫/蘇花官方連結 |

位置可以用 GPS、搜尋地名，或選預設地點（花蓮車站、七星潭、太魯閣…及各縣市車站）。

## 已停業的店怎麼處理

地點資料來自 OpenStreetMap（開放街圖，由志工維護）。App 會排除下列地點：

- 標記為停業、廢棄的（`disused=yes`、`opening_hours=closed`、`end_date` 已過期等）
- 名稱或備註寫著「停業、歇業、暫停營業、已搬遷」的
- 不對外開放的（`access=private` / `no`）

**限制**：開放資料不一定即時更新，仍可能出現已經收掉的店。詳情頁有「在 Google 地圖查評論」按鈕可以出發前再確認；發現停業也可以按「到 OpenStreetMap 回報」幫忙更新。

## 選填的免費帳號（在 App 的「設定」填）

| 帳號 | 用途 | 不填會怎樣 | 申請 |
|---|---|---|---|
| 中央氣象署授權碼 | 天氣、豪雨／颱風特報 | 看不到天氣 | https://opendata.cwa.gov.tw/user/authkey |
| 交通部 TDX | 台鐵、公車、道路事件 | 仍可用，但每天只有約 20 次 | https://tdx.transportdata.tw/register |

金鑰只存在你手機的瀏覽器裡，不會上傳到任何伺服器。

## 在電腦上試用

需要 Python 3（只是用來開本機網頁伺服器）：

```bash
npm start
```

打開 http://localhost:8080/ 。網址加 `?demo=1` 會讓天氣和台鐵／公車改用假資料（不用帳號、不耗額度）。

## 放到網路上給手機用（GitHub Pages，免費）

手機要定位，網址必須是 HTTPS，GitHub Pages 剛好符合：

1. 在 GitHub 建一個 repository，把這個資料夾推上去
2. Repository → Settings → Pages → Source 選 `main` 分支、根目錄 `/`
3. 等一兩分鐘，用手機打開 `https://<你的帳號>.github.io/<repo 名稱>/`
4. 瀏覽器選單 →「加到主畫面」

## 開發

```bash
npm test
```

- 純前端、沒有 build step、沒有 npm 套件；程式在 `js/`，測試在 `tests/`
- 專案規則與凍結的資料格式：`CLAUDE.md`；進度：`PROGRESS.md`；變更紀錄：`CHANGELOG.md`

## 資料來源與授權

- 地點：© [OpenStreetMap](https://www.openstreetmap.org/copyright) 貢獻者（ODbL）
- 地圖底圖：內政部國土測繪中心 臺灣通用電子地圖
- 路線：[OSRM](https://project-osrm.org/)、FOSSGIS routing.openstreetmap.de
- 地名搜尋：Nominatim
- 天氣：中央氣象署開放資料；交通：交通部 TDX；步道：林業及自然保育署；省道管制：交通部公路局
