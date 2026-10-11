// 地點的過濾、營業狀態判斷、排序（純函式）
// 營業狀態一律以台灣時間（UTC+8，無日光節約）計算，不受手機時區影響。

const TW_OFFSET_MS = 8 * 3600 * 1000;

/** 停業、暫停營業 → 一律不列出 */
export const CLOSED_STATUSES = new Set(['CLOSED_PERMANENTLY', 'CLOSED_TEMPORARILY']);

export function isClosedBusiness(place) {
  return CLOSED_STATUSES.has(place.businessStatus);
}

/** Date → 台灣時間的 {weekday(0=日), hh, mm, ymd} */
export function twParts(date) {
  const t = new Date(date.getTime() + TW_OFFSET_MS);
  return {
    weekday: t.getUTCDay(),
    hh: t.getUTCHours(),
    mm: t.getUTCMinutes(),
    ymd: `${t.getUTCFullYear()}-${t.getUTCMonth() + 1}-${t.getUTCDate()}`,
  };
}

const pad2 = (n) => String(n).padStart(2, '0');
export const twClock = (date) => {
  const p = twParts(date);
  return `${pad2(p.hh)}:${pad2(p.mm)}`;
};

/** 台灣時間的日期 "YYYY-MM-DD" */
export function twDate(date) {
  const t = new Date(date.getTime() + TW_OFFSET_MS);
  return `${t.getUTCFullYear()}-${pad2(t.getUTCMonth() + 1)}-${pad2(t.getUTCDate())}`;
}

/** 台灣時間的「今天第幾分鐘」 */
export function twMinutes(date) {
  const p = twParts(date);
  return p.hh * 60 + p.mm;
}

/** 收藏是否超過 30 天沒更新（Google 條款：座標快取上限 30 天） */
export function isStale(fav, now = new Date(), days = 30) {
  const t = Date.parse(fav?.refreshedAt ?? fav?.addedAt ?? '');
  return Number.isNaN(t) || now - t > days * 24 * 3600 * 1000;
}

const validDate = (s) => {
  if (!s) return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
};

/**
 * 營業狀態。kind: open | closing | closed | unknown
 * hours 為 Google Places 的 currentOpeningHours。
 */
export function openStatus(hours, now = new Date()) {
  if (!hours || typeof hours.openNow !== 'boolean') {
    return { kind: 'unknown', label: '營業時間未提供' };
  }
  const today = twParts(now);

  if (hours.openNow) {
    const close = validDate(hours.nextCloseTime);
    const mins = close ? (close - now) / 60000 : Infinity;
    if (mins <= 60) {
      return { kind: 'closing', label: `快打烊・${Math.max(1, Math.round(mins))} 分鐘後` };
    }
    if (mins > 24 * 60) {
      const p = hours.periods;
      const allDay = Array.isArray(p) && p.length === 1 && !p[0].close;
      return { kind: 'open', label: allDay ? '24 小時營業' : '營業中' };
    }
    const sameDay = twParts(close).ymd === today.ymd;
    return { kind: 'open', label: `營業中・${sameDay ? '' : '明天 '}${twClock(close)} 打烊` };
  }

  const next = validDate(hours.nextOpenTime);
  if (next && twParts(next).ymd === today.ymd) {
    return { kind: 'closed', label: `休息中・${twClock(next)} 開門` };
  }
  const periods = Array.isArray(hours.periods) ? hours.periods : [];
  const opensToday = periods.some((p) => p?.open?.day === today.weekday);
  return { kind: 'closed', label: opensToday || periods.length === 0 ? '今日已打烊' : '今日公休' };
}

/** 今天（台灣時間）那一行營業時間文字；weekdayDescriptions 是星期一開頭 */
export function todayHoursText(hours, now = new Date()) {
  const list = hours?.weekdayDescriptions;
  if (!Array.isArray(list) || list.length !== 7) return null;
  return list[(twParts(now).weekday + 6) % 7];
}

/**
 * 依使用者條件過濾：
 * - 停業/暫停營業：永遠排除
 * - openNowOnly：排除「確定現在沒開」的；沒提供營業時間的（公園、步道）保留
 * - minRating：有設門檻時，沒評分的也排除（無法確認品質）
 */
export function filterPlaces(places, { openNowOnly = false, minRating = 0 } = {}) {
  return places.filter((p) => {
    if (isClosedBusiness(p)) return false;
    if (openNowOnly && p.hours?.openNow === false) return false;
    if (minRating > 0 && !(typeof p.rating === 'number' && p.rating >= minRating)) return false;
    return true;
  });
}

/**
 * 排序：
 * - distance：有路線時間就依交通時間，沒有就依直線距離；算不出路線的排最後
 * - rating：評分高→低，同分看評論數
 * - popular：維持 API 回傳順序（Google 熱門度）
 */
export function sortPlaces(places, by = 'distance', mode = null) {
  const list = [...places];
  if (by === 'popular') return list;
  if (by === 'rating') {
    return list.sort(
      (a, b) => (b.rating ?? -1) - (a.rating ?? -1) || (b.ratingCount ?? 0) - (a.ratingCount ?? 0),
    );
  }
  const secs = (p) => p.routes?.[mode]?.seconds ?? null;
  const anyRoute = mode && list.some((p) => secs(p) !== null);
  if (!anyRoute) return list.sort((a, b) => a.distance - b.distance);
  return list.sort((a, b) => {
    const sa = secs(a);
    const sb = secs(b);
    if (sa === null && sb === null) return a.distance - b.distance;
    if (sa === null) return 1;
    if (sb === null) return -1;
    return sa - sb || a.distance - b.distance;
  });
}

const PRICE_LABELS = {
  PRICE_LEVEL_FREE: '免費',
  PRICE_LEVEL_INEXPENSIVE: '$',
  PRICE_LEVEL_MODERATE: '$$',
  PRICE_LEVEL_EXPENSIVE: '$$$',
  PRICE_LEVEL_VERY_EXPENSIVE: '$$$$',
};
export const priceLabel = (level) => PRICE_LABELS[level] ?? null;
