// 封閉資訊（免費、免金鑰、實測支援 CORS）：
// 1. 林業保育署 自然步道路況（暫停開放 / 部分封閉 / 注意）— data.gov.tw 71522
// 2. 公路局 省道管制路段（長期封閉，KML 約 1.5MB）— data.gov.tw 107483
// 太魯閣國家公園步道的官方資料不允許跨網域讀取，只能提供官方連結。
import { haversine } from './geo.js';
import { ApiError } from './errors.js';

export const FOREST_URL = 'https://data.moa.gov.tw/Service/OpenData/ForestRtOpen.aspx?IsTransData=1&UnitId=D50';
export const THB_CONTROL_URL = 'https://bobe168.tw/api/motcthb/opendata/getControlEvent';

// 縣市 → 林業保育署分署（DEP_NAME 開頭）
const FOREST_BRANCH = {
  臺北市: '羅東', 新北市: '羅東', 基隆市: '羅東', 宜蘭縣: '羅東',
  桃園市: '新竹', 新竹市: '新竹', 新竹縣: '新竹', 苗栗縣: '新竹',
  臺中市: '臺中', 彰化縣: '臺中', 南投縣: '南投', 雲林縣: '南投',
  嘉義縣: '嘉義', 嘉義市: '嘉義', 臺南市: '嘉義', 高雄市: '屏東', 屏東縣: '屏東',
  臺東縣: '臺東', 花蓮縣: '花蓮',
};

const TRAIL_ORDER = { 暫停開放: 0, 部分封閉: 1, 注意: 2 };

/** 步道公告 → 該縣市所屬分署的公告（找不到分署就全部），嚴重的在前、新的在前 */
export function filterTrailNotices(list, county) {
  const branch = FOREST_BRANCH[county];
  return (Array.isArray(list) ? list : [])
    .filter((n) => !branch || (n.DEP_NAME ?? '').startsWith(branch))
    .map((n) => ({
      id: n.TRAILID,
      trail: n.TR_CNAME ?? '',
      status: n.TR_TYP ?? '',
      title: n.Title ?? '',
      date: n.ANN_DATE ?? '',
      branch: n.DEP_NAME ?? '',
      url: n.TRAILID ? `https://recreation.forest.gov.tw/Trail/RT?tr_id=${encodeURIComponent(n.TRAILID)}` : 'https://recreation.forest.gov.tw/',
    }))
    .sort((a, b) => (TRAIL_ORDER[a.status] ?? 9) - (TRAIL_ORDER[b.status] ?? 9) || b.date.localeCompare(a.date));
}

const xmlText = (s) => s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&')
  .trim();

/**
 * 省道管制 KML → 事件清單。座標點太多（一條上萬點），每條抽樣到最多 200 點，夠算距離即可。
 * 用正規式解析（格式固定：Placemark / SimpleData / coordinates），在 Node 測試也能跑。
 */
export function parseControlKml(text) {
  const events = [];
  for (const pm of String(text ?? '').match(/<Placemark[\s\S]*?<\/Placemark>/g) ?? []) {
    const f = {};
    for (const [, k, v] of pm.matchAll(/<SimpleData name="(\w+)">([\s\S]*?)<\/SimpleData>/g)) f[k] = xmlText(v);
    const pts = [];
    for (const [, c] of pm.matchAll(/<coordinates>([\s\S]*?)<\/coordinates>/g)) {
      for (const pair of c.trim().split(/\s+/)) {
        const [lng, lat] = pair.split(',').map(Number);
        if (Number.isFinite(lat) && Number.isFinite(lng)) pts.push({ lat, lng });
      }
    }
    const step = Math.max(1, Math.ceil(pts.length / 200));
    const sampled = pts.filter((_, i) => i % step === 0);
    if (pts.length && sampled.at(-1) !== pts.at(-1)) sampled.push(pts.at(-1));
    events.push({
      route: f.ROUTE ?? '',
      event: f.EVENT_NAME ?? '',
      kind: f.DISASTER_KIND ?? '',
      status: f.STATUS ?? '',
      implement: f.IMPLEMENT ?? '',
      alternative: f.ALTERNATIVE_ROUTE ?? '',
      release: f.RELEASE_TIME ?? '',
      points: sampled,
    });
  }
  return events;
}

/** 距離中心 radius 公尺內的管制路段（以路段上最近的點計），依距離排序 */
export function nearControlEvents(events, center, radius = 80000) {
  return events
    .map((e) => ({ ...e, distance: e.points.length ? Math.min(...e.points.map((p) => haversine(center, p))) : null }))
    .filter((e) => e.distance !== null && e.distance <= radius)
    .sort((a, b) => a.distance - b.distance);
}

function cached(key, ttlMs, loader, storage = globalThis.localStorage) {
  try {
    const hit = JSON.parse(storage?.getItem(key) ?? 'null');
    if (hit && Date.now() - hit.at < ttlMs) return Promise.resolve(hit.data);
  } catch { /* 快取壞了就重抓 */ }
  return loader().then((data) => {
    try { storage?.setItem(key, JSON.stringify({ at: Date.now(), data })); } catch { /* 空間不足就算了 */ }
    return data;
  });
}

async function fetchOk(url, what) {
  let res;
  try {
    res = await fetch(url);
  } catch {
    throw new ApiError(`連不上${what}，請稍後再試。`);
  }
  if (!res.ok) throw new ApiError(`${what}暫時無法使用（${res.status}）`);
  return res;
}

export const fetchTrailNotices = () =>
  cached('gotrip.cache:forest', 30 * 60e3, async () => (await fetchOk(FOREST_URL, '林業保育署步道資訊')).json());

export const fetchControlEvents = () =>
  cached('gotrip.cache:thbControl', 60 * 60e3, async () => parseControlKml(await (await fetchOk(THB_CONTROL_URL, '公路局管制資訊')).text()));
