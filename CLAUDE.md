# GoTrip 專案規則

台灣旅遊 PWA（純前端、無後端），預計部署在 GitHub Pages。開發守則依 dev-sop。

## 架構
- 純靜態：`index.html` + `css/` + `js/`（ES modules、無 build step、無 npm 依賴）
- 測試：`npm test`（Node 內建 test runner，只測 `js/` 裡的純函式與 fetch 包裝）
- 本機預覽：`npm start`（python http.server :8080）→ http://localhost:8080/
  - `?demo=1`：氣象署與 TDX 改用假資料（省額度、免授權碼）；附近地點、路線、地圖仍是真實服務
- 資料來源（全部免費，瀏覽器直接呼叫，皆已實測 CORS）：
  - 地點：OpenStreetMap / Overpass（`js/osm.js`，多台伺服器依序重試；公共伺服器不穩是常態）
  - 路線時間：OSRM（`js/osrm.js`；步行/自行車 FOSSGIS，汽車 project-osrm → FOSSGIS 備援）
  - 地圖：Leaflet 1.9.4（cdnjs）+ 國土測繪中心 EMAP 圖磚（`js/map.js`）
  - 地名搜尋：Nominatim
  - 天氣：中央氣象署（免費授權碼，放網址參數）
  - 台鐵/公車/公路事件：TDX（免費帳號；不填用免登入額度：每 IP 每天 20 次、瀏覽器限定）
  - 步道公告：林業保育署；省道長期封閉：公路局 bobe168 KML（`js/closures.js`）
- `js/google.js`：⏸ 未啟用（2026-10-11 改用免費資料），保留供日後切回，測試仍會跑

## 凍結契約（只能 additive，不得改名或改型別）
localStorage（使用者手機上的資料，改壞會讓使用者遺失收藏/金鑰）：
- `gotrip.settings.v1`：`{googleKey, cwaKey, tdxId, tdxSecret, mode, radius, openNowOnly, minRating, sort, lastCenter}`
  - `mode` ∈ `WALK | BIKE | DRIVE`（讀到其他值時 App 會改用 `DRIVE`）
  - `googleKey / minRating / sort`：目前未使用，保留
  - `lastCenter`：`{lat, lng, label, sub, gps}` 或 `null`
- `gotrip.favorites.v1`：`[{id, name, lat, lng, address, type, mapsUri, addedAt, refreshedAt?}]`（`id` 為 OSM id，例如 `node/123`）
- `gotrip.usage.v1`：Google 用量計數（目前未使用）
- `gotrip.tdxcache:*`、`gotrip.cache:*`：快取，可隨時清除，不屬契約

## 不可誤傷
- **標記停業 / 暫停營業 / 不對外開放的地點一律不顯示**（`osm.js` 的 `isClosedOsm` + `places-logic.js` 的 `filterPlaces`，有回歸測試）
- 金鑰只存使用者手機的 localStorage：**不得寫進程式碼、不得 commit、不得印到 console**
- 示範模式不得寫入持久快取（曾發生假資料留到正式模式，有回歸測試）
- 資料來源標示（OSM、國土測繪中心、OSRM）必須看得到；地圖高度要扣掉底部選單
- 外部資料（店名、公告）一律用 `textContent` 放進畫面（`dom.js` 的 `h()`），不用 innerHTML

## 進度與紀錄
- 進度：`PROGRESS.md`；變更：`CHANGELOG.md`；每次 commit 三者同步
