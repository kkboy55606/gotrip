// 距離與時間的計算、格式化（純函式，瀏覽器與 Node 測試共用）

const EARTH_RADIUS_M = 6371008.8;
const toRad = (deg) => (deg * Math.PI) / 180;

/** 兩點直線距離（公尺），a/b 為 {lat, lng} */
export function haversine(a, b) {
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

/** 公尺 → 「850 公尺」「1.2 公里」「35 公里」；無效值回「—」 */
export function formatDistance(meters) {
  if (!isNum(meters) || meters < 0) return '—';
  if (meters < 1000) return `${Math.round(meters / 10) * 10} 公尺`;
  if (meters < 10000) return `${(meters / 1000).toFixed(1)} 公里`;
  return `${Math.round(meters / 1000)} 公里`;
}

/** 秒 → 「1 分」「25 分」「1 小時 5 分」；無效值回「—」 */
export function formatDuration(seconds) {
  if (!isNum(seconds) || seconds < 0) return '—';
  const totalMin = Math.max(1, Math.round(seconds / 60));
  if (totalMin < 60) return `${totalMin} 分`;
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return m ? `${h} 小時 ${m} 分` : `${h} 小時`;
}

/** Google 的 duration 字串 "754s" → 754；格式不符回 null */
export function parseGoogleDuration(str) {
  if (typeof str !== 'string') return null;
  const m = /^(\d+(?:\.\d+)?)s$/.exec(str.trim());
  return m ? Number(m[1]) : null;
}

/** 座標四捨五入成快取用的 key（約 110 公尺精度） */
export function roundCoordKey({ lat, lng }, digits = 3) {
  return `${lat.toFixed(digits)},${lng.toFixed(digits)}`;
}
