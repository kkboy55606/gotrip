// 交通部 TDX：台鐵、公車/客運、公路即時事件
// 不填帳號 → 免登入模式（瀏覽器限定、每 IP 每天 20 次）；填了帳號 → 免費方案每分鐘 5 次。
// 所以：能快取的都快取，呼叫一次只送一個（排隊）。
import { haversine } from './geo.js';
import { ApiError } from './errors.js';

const BASE = 'https://tdx.transportdata.tw/api/basic';
const TOKEN_URL = 'https://tdx.transportdata.tw/auth/realms/TDXConnect/protocol/openid-connect/token';

// ---------- 純函式：解析 ----------

export const CITY_CODES = {
  臺北市: 'Taipei', 新北市: 'NewTaipei', 桃園市: 'Taoyuan', 臺中市: 'Taichung', 臺南市: 'Tainan',
  高雄市: 'Kaohsiung', 基隆市: 'Keelung', 新竹市: 'Hsinchu', 新竹縣: 'HsinchuCounty', 苗栗縣: 'MiaoliCounty',
  彰化縣: 'ChanghuaCounty', 南投縣: 'NantouCounty', 雲林縣: 'YunlinCounty', 嘉義縣: 'ChiayiCounty', 嘉義市: 'Chiayi',
  屏東縣: 'PingtungCounty', 宜蘭縣: 'YilanCounty', 花蓮縣: 'HualienCounty', 臺東縣: 'TaitungCounty',
  金門縣: 'KinmenCounty', 澎湖縣: 'PenghuCounty', 連江縣: 'LienchiangCounty',
};

/** 地址 → 縣市（統一用「臺」）；找不到回 null */
export function countyFromAddress(address) {
  if (typeof address !== 'string') return null;
  const norm = address.replace(/台(?=[北中南東])/g, '臺');
  return Object.keys(CITY_CODES).find((c) => norm.includes(c)) ?? null;
}

export function parseStations(json) {
  return (json?.Stations ?? [])
    .filter((s) => s.StationPosition)
    .map((s) => ({
      id: s.StationID,
      name: s.StationName?.Zh_tw ?? s.StationID,
      lat: s.StationPosition.PositionLat,
      lng: s.StationPosition.PositionLon,
      address: s.StationAddress ?? '',
    }));
}

export function nearestStations(stations, center, n = 3) {
  return stations
    .map((s) => ({ ...s, distance: haversine(center, s) }))
    .sort((a, b) => a.distance - b.distance)
    .slice(0, n);
}

const hhmm = (t) => (typeof t === 'string' ? t.slice(0, 5) : '');
const toMin = (t) => {
  const m = /^(\d{1,2}):(\d{2})/.exec(t ?? '');
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
};

/**
 * 今日車站時刻表 → 現在之後出發的車（排除終點站是本站的），依時間排序。
 * live：StationLiveBoard 解析結果（以車次對應誤點）
 */
export function upcomingDepartures(timetableJson, stationId, nowMin, live = new Map(), limit = 12) {
  const rows = [];
  for (const group of timetableJson?.StationTimetables ?? []) {
    for (const t of group.TimeTables ?? []) {
      if (t.DestinationStationID === stationId) continue;
      if (t.SuspendedFlag === 1) continue;
      const dep = toMin(t.DepartureTime);
      if (dep === null) continue;
      const l = live.get(t.TrainNo);
      // 誤點的車：表定時間已過但實際還沒開，也要列出
      const effective = dep + (l?.delay ?? 0);
      if (effective < nowMin) continue;
      rows.push({
        trainNo: t.TrainNo,
        type: t.TrainTypeName?.Zh_tw ?? '',
        to: t.DestinationStationName?.Zh_tw ?? '',
        dep: hhmm(t.DepartureTime),
        depMin: dep,
        delay: l?.delay ?? null,
        cancelled: l?.cancelled ?? false,
      });
    }
  }
  return rows.sort((a, b) => a.depMin - b.depMin).slice(0, limit);
}

/** StationLiveBoard → Map(車次 → {delay 分鐘, cancelled}) */
export function parseLiveBoard(json) {
  const m = new Map();
  for (const b of json?.StationLiveBoards ?? []) {
    m.set(b.TrainNo, { delay: b.DelayTime ?? 0, cancelled: b.RunningStatus === 2 });
  }
  return m;
}

/** 起訖站時刻表 → 現在之後出發的班次 */
export function parseOdTrains(json, nowMin, limit = 15) {
  return (json?.TrainTimetables ?? [])
    .map(({ TrainInfo: i = {}, StopTimes: st = [] }) => {
      const from = st[0] ?? {};
      const to = st.at(-1) ?? {};
      const depMin = toMin(from.DepartureTime);
      let arrMin = toMin(to.ArrivalTime);
      if (arrMin !== null && depMin !== null && arrMin < depMin) arrMin += 24 * 60; // 跨午夜
      return {
        trainNo: i.TrainNo,
        type: i.TrainTypeName?.Zh_tw ?? '',
        dep: hhmm(from.DepartureTime),
        arr: hhmm(to.ArrivalTime),
        depMin,
        minutes: depMin !== null && arrMin !== null ? arrMin - depMin : null,
        suspended: i.SuspendedFlag === 1 || from.SuspendedFlag === 1,
      };
    })
    .filter((t) => t.depMin !== null && t.depMin >= nowMin && !t.suspended)
    .sort((a, b) => a.depMin - b.depMin)
    .slice(0, limit);
}

/** 公車站牌（市區 + 公路客運）→ 依站名合併、依距離排序 */
export function groupBusStops(cityStops, interStops, center, limit = 4) {
  const groups = new Map();
  const add = (list, kind) => {
    for (const s of Array.isArray(list) ? list : []) {
      const pos = s.StopPosition;
      if (!pos) continue;
      const name = s.StopName?.Zh_tw ?? s.StopUID;
      const d = haversine(center, { lat: pos.PositionLat, lng: pos.PositionLon });
      const g = groups.get(name) ?? { name, distance: d, city: [], inter: [] };
      g.distance = Math.min(g.distance, d);
      g[kind].push(s.StopUID);
      groups.set(name, g);
    }
  };
  add(cityStops, 'city');
  add(interStops, 'inter');
  return [...groups.values()].sort((a, b) => a.distance - b.distance).slice(0, limit);
}

const STOP_STATUS = { 1: '尚未發車', 2: '交管不停靠', 3: '末班車已過', 4: '今日未營運' };
const DIRECTION = { 0: '去程', 1: '返程', 2: '迴圈', 10: '循環' };

/** 到站預估 → 每條路線/方向只留最快一班；有時間的排前面 */
export function parseBusEta(rows) {
  const best = new Map();
  for (const r of Array.isArray(rows) ? rows : []) {
    const key = `${r.SubRouteUID ?? r.RouteUID}|${r.Direction}`;
    const eta = typeof r.EstimateTime === 'number' && r.StopStatus === 0 ? r.EstimateTime : null;
    const item = {
      route: r.RouteName?.Zh_tw ?? r.RouteID ?? '',
      stop: r.StopName?.Zh_tw ?? '',
      direction: DIRECTION[r.Direction] ?? '',
      eta,
      status: eta !== null ? null : STOP_STATUS[r.StopStatus] ?? '暫無資料',
      isLast: r.IsLastBus === true,
    };
    const prev = best.get(key);
    if (!prev || (item.eta !== null && (prev.eta === null || item.eta < prev.eta))) best.set(key, item);
  }
  return [...best.values()].sort((a, b) => (a.eta ?? Infinity) - (b.eta ?? Infinity) || a.route.localeCompare(b.route, 'zh-Hant', { numeric: true }));
}

export function busEtaText(item) {
  if (item.eta === null) return item.status;
  if (item.eta < 60) return '進站中';
  return `${Math.round(item.eta / 60)} 分`;
}

/** WKT "POINT (lon lat)" → {lat, lng}；遇到經緯度顛倒（實測有）會自動對調 */
export function parseWktPoint(wkt) {
  const m = /POINT\s*\(\s*(-?[\d.]+)\s+(-?[\d.]+)\s*\)/i.exec(wkt ?? '');
  if (!m) return null;
  let lng = Number(m[1]);
  let lat = Number(m[2]);
  const inTw = (la, ln) => la >= 21 && la <= 26.5 && ln >= 118 && ln <= 123;
  if (!inTw(lat, lng) && inTw(lng, lat)) [lat, lng] = [lng, lat];
  return inTw(lat, lng) ? { lat, lng } : null;
}

const EVENT_TYPES = { 1: '交通事故', 2: '施工', 3: '壅塞', 4: '特殊管制', 5: '天氣', 6: '災害', 7: '活動', 8: '其他' };

/** 公路即時事件 → 範圍內的事件，依距離排序 */
export function parseRoadEvents(json, center, radiusM = 60000) {
  return (json?.LiveEvents ?? [])
    .map((e) => {
      const pos = parseWktPoint(e.Positions);
      const road = e.Location?.FreeExpressHighway;
      return {
        id: e.EventID,
        title: e.EventTitle || EVENT_TYPES[e.EventType] || '道路事件',
        type: EVENT_TYPES[e.EventType] ?? '其他',
        description: e.Description ?? '',
        road: road ? `${road.Road ?? ''} ${road.StartKM ?? ''}`.trim() : '',
        time: e.EffectiveTime ?? e.PublishTime ?? '',
        distance: pos ? haversine(center, pos) : null,
      };
    })
    .filter((e) => e.distance !== null && e.distance <= radiusM)
    .sort((a, b) => a.distance - b.distance);
}

const NEWS_CATEGORY = { 1: '交管措施', 2: '事故', 3: '壅塞', 4: '施工', 99: '其他' };

/** 公路局最新消息（沒有座標）→ 標題或內容提到關鍵字（例：花蓮、蘇花）的 */
export function filterHighwayNews(json, keywords, limit = 10) {
  const kw = keywords.filter(Boolean);
  return (json?.Newses ?? [])
    .filter((n) => kw.some((k) => `${n.Title ?? ''}${n.Description ?? ''}`.includes(k)))
    .map((n) => ({
      id: n.NewsID,
      title: n.Title ?? '',
      category: NEWS_CATEGORY[n.NewsCategory] ?? '其他',
      description: n.Description ?? '',
      url: n.NewsURL || '',
      time: n.PublishTime ?? '',
    }))
    .sort((a, b) => String(b.time).localeCompare(String(a.time)))
    .slice(0, limit);
}

// ---------- 網路呼叫 ----------

/** 組 OData 查詢字串（$ 保持原樣，值做 URL 編碼） */
export function tdxUrl(path, params = {}) {
  const q = Object.entries({ ...params, $format: 'JSON' })
    .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
    .join('&');
  return `${BASE}${path}?${q}`;
}

export function createTdx({ id = '', secret = '', storage = globalThis.localStorage } = {}) {
  const hasKey = Boolean(id && secret);
  let token = null;
  let tokenExp = 0;
  let queue = Promise.resolve();
  const mem = new Map();
  const DAY = 24 * 3600 * 1000;

  // 清掉超過一天的本機快取（時刻表每天一份，不清會越積越多）
  try {
    for (let i = (storage?.length ?? 0) - 1; i >= 0; i--) {
      const k = storage.key(i);
      if (!k?.startsWith('gotrip.tdxcache:')) continue;
      const e = JSON.parse(storage.getItem(k) ?? 'null');
      if (!e || Date.now() - e.at > DAY) storage.removeItem(k);
    }
  } catch { /* 儲存被封鎖就略過 */ }

  async function getToken() {
    if (!hasKey) return null;
    if (token && Date.now() < tokenExp - 60_000) return token;
    let res;
    try {
      res = await fetch(TOKEN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ grant_type: 'client_credentials', client_id: id, client_secret: secret }),
      });
    } catch {
      throw new ApiError('連不上 TDX，請檢查網路。');
    }
    if (!res.ok) throw new ApiError('TDX 帳號驗證失敗，請到「設定」確認 Client Id 與 Client Secret。');
    const d = await res.json();
    token = d.access_token;
    tokenExp = Date.now() + (d.expires_in ?? 86400) * 1000;
    return token;
  }

  async function rawGet(url) {
    const t = await getToken();
    let res;
    try {
      res = await fetch(url, { headers: t ? { Authorization: `Bearer ${t}` } : {} });
    } catch {
      throw new ApiError('連不上 TDX，請檢查網路。');
    }
    if (res.status === 429) {
      throw new ApiError(hasKey
        ? 'TDX 呼叫太頻繁（免費方案每分鐘 5 次），請等一分鐘再試。'
        : '今天的 TDX 免登入額度（每天 20 次）用完了，到「設定」填 TDX 帳號就能繼續用。');
    }
    if (res.status === 401) throw new ApiError(hasKey ? 'TDX 授權失敗，請確認帳號。' : 'TDX 拒絕免登入呼叫，請到「設定」填 TDX 帳號。');
    if (!res.ok) throw new ApiError(`TDX 回應錯誤 ${res.status}`);
    return res.json();
  }

  /** 快取讀取：ttlMs 內重用；persist=true 時存到 localStorage（例如車站清單） */
  function get(path, params, { ttlMs = 30_000, persist = false, tag = '' } = {}) {
    const url = tdxUrl(path, params);
    const key = tag ? `${url}#${tag}` : url;
    const hit = mem.get(key);
    if (hit && Date.now() - hit.at < ttlMs) return Promise.resolve(hit.data);
    if (persist) {
      try {
        const saved = JSON.parse(storage?.getItem(`gotrip.tdxcache:${key}`) ?? 'null');
        if (saved && Date.now() - saved.at < ttlMs) {
          mem.set(key, saved);
          return Promise.resolve(saved.data);
        }
      } catch { /* 快取壞了就重抓 */ }
    }
    const run = queue.then(() => rawGet(url));
    queue = run.catch(() => {});
    return run.then((data) => {
      const entry = { at: Date.now(), data };
      mem.set(key, entry);
      if (persist) {
        try { storage?.setItem(`gotrip.tdxcache:${key}`, JSON.stringify(entry)); } catch { /* 空間不足就算了 */ }
      }
      return data;
    });
  }

  return {
    hasKey,
    stations: () => get('/v3/Rail/TRA/Station', {}, { ttlMs: DAY, persist: true }).then(parseStations),
    stationTimetable: (stationId, ymd) =>
      get('/v3/Rail/TRA/DailyStationTimetable/Today/Station/' + stationId, {}, { ttlMs: DAY, persist: true, tag: ymd }),
    liveBoard: (stationId) => get('/v3/Rail/TRA/StationLiveBoard/Station/' + stationId, {}, { ttlMs: 30_000 }).then(parseLiveBoard),
    odTimetable: (from, to, ymd) =>
      get(`/v3/Rail/TRA/DailyTrainTimetable/OD/${from}/to/${to}/${ymd}`, {}, { ttlMs: DAY, persist: true }),
    busStopsCity: (city, c, r = 400) =>
      get('/v2/Bus/Stop/City/' + city, { $spatialFilter: `nearby(${c.lat.toFixed(5)},${c.lng.toFixed(5)},${r})` }, { ttlMs: DAY }),
    busStopsInterCity: (c, r = 400) =>
      get('/v2/Bus/Stop/InterCity', { $spatialFilter: `nearby(${c.lat.toFixed(5)},${c.lng.toFixed(5)},${r})` }, { ttlMs: DAY }),
    busEtaCity: (city, uids) =>
      get('/v2/Bus/EstimatedTimeOfArrival/City/' + city, { $filter: `StopUID in (${uids.map((u) => `'${u}'`).join(',')})` }),
    busEtaInterCity: (uids) =>
      get('/v2/Bus/EstimatedTimeOfArrival/InterCity', { $filter: `StopUID in (${uids.map((u) => `'${u}'`).join(',')})` }),
    roadEvents: () => get('/v1/Traffic/RoadEvent/LiveEvent/Highway', {}, { ttlMs: 60_000 }),
    highwayNews: () => get('/v2/Road/Traffic/Live/News/Highway', {}, { ttlMs: 5 * 60_000 }),
  };
}
