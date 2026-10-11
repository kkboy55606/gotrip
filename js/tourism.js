// 交通部觀光署 官方景點與活動（資料由 scripts/build-tourism.js 每天整理成小檔，放在 data/tourism/）
// 景點依 0.25° 格子切檔，App 只下載搜尋範圍碰到的格子；活動是一個檔。
import { haversine } from './geo.js';
import { ApiError } from './errors.js';

export const TILE_DEG = 0.25;
const BASE = 'data/tourism';

export const tileKey = (lat, lng) => `${Math.floor(lat / TILE_DEG)}_${Math.floor(lng / TILE_DEG)}`;

/** 圓形範圍碰到的所有格子（只回傳 index 裡存在的） */
export function tilesFor(center, radius, existing) {
  const dLat = radius / 111320;
  const dLng = radius / (111320 * Math.cos((center.lat * Math.PI) / 180));
  const keys = [];
  for (let a = Math.floor((center.lat - dLat) / TILE_DEG); a <= Math.floor((center.lat + dLat) / TILE_DEG); a++) {
    for (let b = Math.floor((center.lng - dLng) / TILE_DEG); b <= Math.floor((center.lng + dLng) / TILE_DEG); b++) {
      const k = `${a}_${b}`;
      if (!existing || existing.includes(k)) keys.push(k);
    }
  }
  return keys;
}

// 觀光資料標準 景點分類代碼：1–18 與舊版一致；26、27 由資料內容可確定；其餘未確認的不標示
const CLASS_LABELS = {
  1: '文化', 2: '生態', 3: '古蹟', 4: '廟宇', 5: '藝術', 6: '小吃特產', 7: '國家公園', 8: '國家風景區',
  9: '休閒農業', 10: '溫泉', 11: '自然風景', 12: '遊憩', 13: '體育健身', 14: '觀光工廠', 15: '都會公園',
  16: '森林遊樂區', 17: '林場', 18: '其他', 26: '自然教育中心', 27: '共融遊戲場',
};
export const classLabel = (classes = []) => classes.map((c) => CLASS_LABELS[c]).filter(Boolean).slice(0, 2).join('・');

/** 整理後的景點 → App 內部地點格式（與 osm.js normalizeElement 相同欄位，另加 description 等） */
export function normalizeSpot(s, center) {
  return {
    id: `tw/${s.id}`,
    name: s.n,
    displayName: s.n,
    lat: s.lat,
    lng: s.lng,
    type: classLabel(s.c) || '觀光景點',
    cuisine: '',
    address: s.a ?? '',
    phone: s.t ?? '',
    website: s.w ?? '',
    openingHours: s.h ?? '',
    checkDate: '',
    businessStatus: 'OPERATIONAL', // 非正常營運的在整理時就排除了
    osmUrl: '',
    distance: haversine(center, s),
    source: 'tourism',
    description: s.d ?? '',
    image: s.img ?? '',
    fee: s.f ?? '',
    parking: s.p ?? '',
  };
}

const pad2 = (n) => String(n).padStart(2, '0');
const md = (ymd) => {
  const [, m, d] = ymd.split('-').map(Number);
  return `${m}/${d}`;
};
const todayTw = (now) => {
  const t = new Date(now.getTime() + 8 * 3600e3);
  return `${t.getUTCFullYear()}-${pad2(t.getUTCMonth() + 1)}-${pad2(t.getUTCDate())}`;
};

/** 活動狀態：進行中 / 即將開始 / 已結束（日期皆為台灣日期 YYYY-MM-DD，含頭含尾） */
export function eventPhase(ev, now = new Date()) {
  const today = todayTw(now);
  if (ev.e < today) return { kind: 'closed', label: '已結束' };
  if (ev.s > today) {
    const days = Math.round((Date.parse(ev.s) - Date.parse(today)) / 86400e3);
    return { kind: 'unknown', label: `${md(ev.s)} 開始${days <= 7 ? `（${days} 天後）` : ''}` };
  }
  return { kind: 'open', label: `進行中・到 ${md(ev.e)}` };
}

export function normalizeEvent(ev, center) {
  return {
    id: `tw/${ev.id}`,
    name: ev.n,
    displayName: ev.n,
    lat: ev.lat,
    lng: ev.lng,
    type: '觀光署活動',
    cuisine: '',
    address: ev.a ?? '',
    phone: ev.t ?? '',
    website: ev.w ?? '',
    openingHours: '',
    checkDate: '',
    businessStatus: 'OPERATIONAL',
    osmUrl: '',
    distance: haversine(center, ev),
    source: 'event',
    description: ev.d ?? '',
    image: ev.img ?? '',
    fee: ev.f ?? '',
    parking: '',
    start: ev.s,
    end: ev.e,
    dateRange: ev.s === ev.e ? md(ev.s) : `${md(ev.s)}–${md(ev.e)}`,
  };
}

async function getJson(path) {
  let res;
  try {
    res = await fetch(`${BASE}/${path}`);
  } catch {
    throw new ApiError('讀不到觀光署資料，請檢查網路。');
  }
  if (!res.ok) throw new ApiError(`觀光署資料讀取失敗（${res.status}）`);
  return res.json();
}

let indexPromise = null;
const tileCache = new Map();
let eventsPromise = null;

/** 範圍內的正常營運景點（依距離排序） */
export async function loadSpots(center, radius) {
  indexPromise ??= getJson('index.json').catch((e) => {
    indexPromise = null;
    throw e;
  });
  const index = await indexPromise;
  const keys = tilesFor(center, radius, index.tiles);
  const tiles = await Promise.all(keys.map((k) => {
    if (!tileCache.has(k)) tileCache.set(k, getJson(`spots/${k}.json`).catch((e) => { tileCache.delete(k); throw e; }));
    return tileCache.get(k);
  }));
  return tiles.flat().map((s) => normalizeSpot(s, center)).filter((p) => p.distance <= radius).sort((a, b) => a.distance - b.distance);
}

/** 範圍內、還沒結束的活動（依距離排序） */
export async function loadEvents(center, radius, now = new Date()) {
  eventsPromise ??= getJson('events.json').catch((e) => {
    eventsPromise = null;
    throw e;
  });
  const { events } = await eventsPromise;
  const today = todayTw(now);
  return events
    .filter((ev) => ev.e >= today)
    .map((ev) => normalizeEvent(ev, center))
    .filter((p) => p.distance <= radius)
    .sort((a, b) => a.distance - b.distance);
}
