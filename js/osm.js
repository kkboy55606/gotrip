// OpenStreetMap（免費）：Overpass 查附近地點、Nominatim 搜尋地名
// Overpass 公共伺服器實測不穩（會隨機回 500/504），所以依序換伺服器重試，結果再快取。
import { haversine } from './geo.js';
import { ApiError } from './errors.js';

// 順序依 2026-10-11 從瀏覽器實測：lz4 最快（約 2 秒）、主站約 12 秒、mail.ru 約 21 秒；
// private.coffee 在瀏覽器常被擋（錯誤頁沒有 CORS 標頭），放最後備用。
export const OVERPASS_ENDPOINTS = [
  'https://lz4.overpass-api.de/api/interpreter',
  'https://overpass-api.de/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
];
export const RESULT_LIMIT = 1000;

/** 選擇器 + 中心 + 半徑 → 單行 Overpass QL */
export function buildOverpassQuery(selectors, center, radius, limit = RESULT_LIMIT) {
  const around = `(around:${Math.round(radius)},${center.lat.toFixed(5)},${center.lng.toFixed(5)})`;
  return `[out:json][timeout:25];(${selectors.map((s) => `${s}${around};`).join('')});out center tags ${limit};`;
}

// ---------- 停業判斷（盡力而為：開放資料可能沒即時更新） ----------

const CLOSED_TEXT = /(停業|歇業|結束營業|已結束|永久關閉|暫停營業|暫停開放|已搬遷|搬遷至|已關閉|已拆除|已歇)/;

function endDatePassed(v, now) {
  const m = /^(\d{4})(?:-(\d{2}))?(?:-(\d{2}))?$/.exec(v ?? '');
  if (!m) return false;
  // 只寫到年或月時，取該年/月的最後一刻
  const end = m[3] ? new Date(+m[1], +m[2] - 1, +m[3] + 1) : m[2] ? new Date(+m[1], +m[2], 1) : new Date(+m[1] + 1, 0, 1);
  return end <= now;
}

/** 有任何「已停業 / 暫停營業 / 不對外開放」的標記 → true */
export function isClosedOsm(tags = {}, now = new Date()) {
  if (tags.disused === 'yes' || tags.abandoned === 'yes') return true;
  if (/^(closed|off)$/i.test((tags.opening_hours ?? '').trim())) return true;
  if (tags.shop === 'vacant') return true;
  if (endDatePassed(tags.end_date, now)) return true;
  if (tags.access === 'no' || tags.access === 'private') return true;
  return CLOSED_TEXT.test(`${tags.name ?? ''} ${tags.note ?? ''} ${tags.description ?? ''} ${tags.opening_hours ?? ''}`);
}

// ---------- 顯示用文字 ----------

const TYPE_LABELS = {
  tourism: {
    attraction: '景點', viewpoint: '觀景點', museum: '博物館', gallery: '藝廊', zoo: '動物園', aquarium: '水族館',
    theme_park: '主題樂園', hotel: '飯店', hostel: '青年旅館', guest_house: '民宿', motel: '汽車旅館',
    apartment: '公寓式住宿', camp_site: '露營區', information: '遊客資訊',
  },
  amenity: {
    restaurant: '餐廳', fast_food: '小吃・速食', food_court: '美食街', cafe: '咖啡・飲料', bar: '酒吧', pub: '酒館',
    biergarten: '啤酒花園', ice_cream: '冰品', marketplace: '市場', nightclub: '夜店', cinema: '電影院',
    karaoke_box: 'KTV', fuel: '加油站', parking: '停車場', motorcycle_parking: '機車停車場', toilets: '公廁',
    atm: 'ATM', bank: '銀行', pharmacy: '藥局', charging_station: '充電站', hospital: '醫院',
    place_of_worship: '廟宇・宗教場所',
  },
  shop: {
    bakery: '麵包・烘焙', pastry: '糕點', confectionery: '甜點', beverages: '飲料店', tea: '茶飲', convenience: '便利商店',
    mall: '購物中心', department_store: '百貨公司', chemist: '藥妝',
  },
  leisure: {
    park: '公園', nature_reserve: '自然保護區', beach_resort: '海水浴場', water_park: '水上樂園',
    bowling_alley: '保齡球館', amusement_arcade: '遊樂場',
  },
  natural: { beach: '海灘', peak: '山峰', hot_spring: '溫泉' },
  waterway: { waterfall: '瀑布' },
};

export function typeLabel(tags = {}) {
  for (const key of ['tourism', 'amenity', 'shop', 'leisure', 'natural', 'waterway']) {
    const label = TYPE_LABELS[key][tags[key]];
    if (label) return label;
  }
  if (tags.historic) return '古蹟';
  return '';
}

const CUISINE_LABELS = {
  chinese: '中式', taiwanese: '台式', local: '在地小吃', regional: '地方料理', japanese: '日式', korean: '韓式',
  noodle: '麵食', beef_noodle: '牛肉麵', dumplings: '水餃', dumpling: '水餃', breakfast: '早餐', brunch: '早午餐',
  coffee_shop: '咖啡', bubble_tea: '手搖飲', tea: '茶', juice: '果汁', burger: '漢堡', pizza: '披薩', hotpot: '火鍋',
  hot_pot: '火鍋', seafood: '海鮮', vegetarian: '素食', vegan: '純素', steak_house: '牛排', italian: '義式',
  american: '美式', thai: '泰式', sushi: '壽司', ramen: '拉麵', curry: '咖哩', cake: '蛋糕', dessert: '甜點',
  ice_cream: '冰品', sandwich: '三明治', chicken: '雞肉', barbecue: '燒烤', indian: '印度', vietnamese: '越式',
};

/** cuisine 標籤 → 中文（最多兩個；本來就是中文的照用） */
export function cuisineLabel(tags = {}) {
  return (tags.cuisine ?? '')
    .split(';')
    .map((c) => c.trim())
    .map((c) => CUISINE_LABELS[c] ?? (/[一-鿿]/.test(c) ? c : null))
    .filter(Boolean)
    .slice(0, 2)
    .join('・');
}

/** 地址：優先 addr:full，否則組 縣市+區+路+號 */
export function osmAddress(tags = {}) {
  if (tags['addr:full']) return tags['addr:full'];
  const hn = tags['addr:housenumber'] ?? '';
  const parts = [tags['addr:city'], tags['addr:district'], tags['addr:street'], hn && (/號$/.test(hn) ? hn : `${hn}號`)];
  return parts.filter(Boolean).join('');
}

/** Overpass element → App 內部格式；沒座標回 null */
export function normalizeElement(el, center, now = new Date()) {
  const lat = el?.lat ?? el?.center?.lat;
  const lng = el?.lon ?? el?.center?.lon;
  if (typeof lat !== 'number' || typeof lng !== 'number') return null;
  const t = el.tags ?? {};
  const type = typeLabel(t);
  return {
    id: `${el.type}/${el.id}`,
    name: t.name || t['name:zh'] || t['name:zh-Hant'] || '',
    displayName: t.name || t['name:zh'] || t['name:zh-Hant'] || type || '未命名地點',
    lat,
    lng,
    type,
    cuisine: cuisineLabel(t),
    address: osmAddress(t),
    phone: t.phone || t['contact:phone'] || '',
    website: t.website || t['contact:website'] || '',
    openingHours: t.opening_hours || '',
    checkDate: t.check_date || t['survey:date'] || '',
    businessStatus: isClosedOsm(t, now) ? 'CLOSED_PERMANENTLY' : 'OPERATIONAL',
    osmUrl: `https://www.openstreetmap.org/${el.type}/${el.id}`,
    distance: haversine(center, { lat, lng }),
  };
}

/**
 * Overpass 回應 → 地點清單：去重、（需要時）排除沒名字的、限制在半徑內、依距離排序
 * truncated：結果達上限，範圍內可能還有更多
 */
export function parseOverpass(json, center, radius, { named = true, limit = RESULT_LIMIT } = {}) {
  const elements = json?.elements ?? [];
  const seen = new Set();
  const places = [];
  for (const el of elements) {
    const p = normalizeElement(el, center);
    if (!p || seen.has(p.id)) continue;
    seen.add(p.id);
    if (named && !p.name) continue;
    if (p.distance > radius) continue;
    places.push(p);
  }
  places.sort((a, b) => a.distance - b.distance);
  return { places, truncated: elements.length >= limit };
}

async function postOverpass(endpoint, query, timeoutMs) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ data: query }),
      signal: ctrl.signal,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

/** 依序嘗試各伺服器，全部失敗才丟錯 */
export async function queryOverpass(query, { endpoints = OVERPASS_ENDPOINTS, timeoutMs = 25000 } = {}) {
  for (const ep of endpoints) {
    try {
      return await postOverpass(ep, query, timeoutMs);
    } catch {
      /* 換下一台 */
    }
  }
  throw new ApiError('開放地圖伺服器忙碌中，請稍後再試（或縮小範圍）。');
}

// ---------- Nominatim 地名搜尋 ----------

/** display_name「七星潭, 民心里, 花蓮市, 花蓮縣, 970, 臺灣」→「花蓮縣花蓮市民心里」 */
export function nominatimAddress(displayName = '') {
  const parts = displayName.split(/,\s*/).slice(1).filter((p) => p !== '臺灣' && p !== '台灣' && !/^\d{3,6}$/.test(p));
  return parts.reverse().join('');
}

export function parseNominatim(list) {
  return (Array.isArray(list) ? list : []).map((r) => ({
    name: r.name || (r.display_name ?? '').split(',')[0],
    address: nominatimAddress(r.display_name),
    lat: Number(r.lat),
    lng: Number(r.lon),
  })).filter((r) => Number.isFinite(r.lat) && Number.isFinite(r.lng));
}

export async function searchPlace(query, center) {
  const q = new URLSearchParams({ format: 'jsonv2', q: query, countrycodes: 'tw', 'accept-language': 'zh-TW', limit: '8' });
  if (center) {
    const d = 0.5;
    q.set('viewbox', `${center.lng - d},${center.lat + d},${center.lng + d},${center.lat - d}`);
  }
  let res;
  try {
    res = await fetch(`https://nominatim.openstreetmap.org/search?${q}`);
  } catch {
    throw new ApiError('連不上地名搜尋服務，請檢查網路。');
  }
  if (!res.ok) throw new ApiError(`地名搜尋失敗（${res.status}），請稍後再試。`);
  return parseNominatim(await res.json());
}
