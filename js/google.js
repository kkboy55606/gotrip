// Google Maps Platform：Places API (New) 與 Routes API（瀏覽器直接呼叫，已確認支援 CORS）
// ⏸ 目前未啟用：2026-10-11 決定先改用免費的開放資料（見 PROGRESS.md D5）。保留供日後切回 Google。
import { haversine, parseGoogleDuration } from './geo.js';
import { ApiError } from './errors.js';

export { ApiError };

const NEARBY_URL = 'https://places.googleapis.com/v1/places:searchNearby';
const TEXT_URL = 'https://places.googleapis.com/v1/places:searchText';
const MATRIX_URL = 'https://routes.googleapis.com/distanceMatrix/v2:computeRouteMatrix';

// 欄位決定計費等級：rating / currentOpeningHours / priceLevel 屬 Enterprise。
// 這些是「只看營業中」「評分門檻」必需的欄位，所以保留。
export const NEARBY_FIELDS = [
  'places.id',
  'places.displayName',
  'places.location',
  'places.businessStatus',
  'places.primaryTypeDisplayName',
  'places.shortFormattedAddress',
  'places.rating',
  'places.userRatingCount',
  'places.priceLevel',
  'places.currentOpeningHours',
  'places.googleMapsUri',
].join(',');

const TEXT_FIELDS = 'places.id,places.displayName,places.formattedAddress,places.location';
const MATRIX_FIELDS = 'originIndex,destinationIndex,status,condition,distanceMeters,duration';

export function googleErrorMessage(status, data) {
  const err = data?.error ?? {};
  const raw = err.message ?? '';
  if (/API key not valid/i.test(raw)) return 'Google 金鑰無效，請到「設定」重新貼上。';
  if (err.status === 'PERMISSION_DENIED' || status === 403) {
    return `Google 拒絕請求：請確認已啟用 Places API (New)、Routes API，且金鑰的網址限制包含這個網站。（${raw}）`;
  }
  if (err.status === 'RESOURCE_EXHAUSTED' || status === 429) return '已達 Google 用量上限，請稍後再試或到 Google Cloud 調整配額。';
  return `Google 回應錯誤 ${status}${raw ? `：${raw}` : ''}`;
}

async function googlePost(url, key, fieldMask, body) {
  let res;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': key, 'X-Goog-FieldMask': fieldMask },
      body: JSON.stringify(body),
    });
  } catch {
    throw new ApiError('連不上 Google，請檢查網路。');
  }
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new ApiError(googleErrorMessage(res.status, data));
  return data;
}

const latLng = (p) => ({ latitude: p.lat, longitude: p.lng });

export function buildNearbyBody({ center, radius, types, sort }) {
  return {
    includedTypes: types,
    maxResultCount: 20,
    // 「評分」排序：先抓熱門的 20 家再依評分排，比抓最近 20 家更有意義
    rankPreference: sort === 'distance' ? 'DISTANCE' : 'POPULARITY',
    locationRestriction: { circle: { center: latLng(center), radius } },
    languageCode: 'zh-TW',
    regionCode: 'TW',
  };
}

/** Google 回傳的 place → App 內部格式；沒有座標的丟掉 */
export function normalizePlace(raw, center) {
  const lat = raw?.location?.latitude;
  const lng = raw?.location?.longitude;
  if (typeof lat !== 'number' || typeof lng !== 'number') return null;
  return {
    id: raw.id,
    name: raw.displayName?.text || '（未命名）',
    lat,
    lng,
    address: raw.shortFormattedAddress || raw.formattedAddress || '',
    type: raw.primaryTypeDisplayName?.text || '',
    rating: typeof raw.rating === 'number' ? raw.rating : null,
    ratingCount: raw.userRatingCount ?? 0,
    priceLevel: raw.priceLevel ?? null,
    mapsUri: raw.googleMapsUri || '',
    hours: raw.currentOpeningHours ?? null,
    businessStatus: raw.businessStatus ?? null,
    distance: haversine(center, { lat, lng }),
    routes: {},
  };
}

export async function searchNearby(key, opts) {
  const data = await googlePost(NEARBY_URL, key, NEARBY_FIELDS, buildNearbyBody(opts));
  return (data?.places ?? []).map((p) => normalizePlace(p, opts.center)).filter(Boolean);
}

export function buildTextPlacesBody({ center, radius, text, sort }) {
  return {
    textQuery: text,
    pageSize: 20,
    rankPreference: sort === 'distance' ? 'DISTANCE' : 'RELEVANCE',
    locationBias: { circle: { center: latLng(center), radius } },
    languageCode: 'zh-TW',
    regionCode: 'TW',
  };
}

/** 關鍵字找店（手搖飲、夜市）：locationBias 只是偏好，所以再自己濾掉範圍外的 */
export async function searchPlacesByText(key, opts) {
  const data = await googlePost(TEXT_URL, key, NEARBY_FIELDS, buildTextPlacesBody(opts));
  return (data?.places ?? [])
    .map((p) => normalizePlace(p, opts.center))
    .filter((p) => p && p.distance <= opts.radius);
}

/** 收藏超過 30 天時更新名稱與座標（Google 條款：座標快取不得超過 30 天） */
export async function placeDetails(key, id) {
  let res;
  try {
    res = await fetch(`https://places.googleapis.com/v1/places/${encodeURIComponent(id)}?languageCode=zh-TW`, {
      headers: { 'X-Goog-Api-Key': key, 'X-Goog-FieldMask': 'id,displayName,location' },
    });
  } catch {
    throw new ApiError('連不上 Google，請檢查網路。');
  }
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new ApiError(googleErrorMessage(res.status, data));
  return { id: data.id, name: data.displayName?.text, lat: data.location?.latitude, lng: data.location?.longitude };
}

export async function searchText(key, query, center) {
  const body = { textQuery: query, languageCode: 'zh-TW', regionCode: 'TW', pageSize: 8 };
  if (center) body.locationBias = { circle: { center: latLng(center), radius: 50000 } };
  const data = await googlePost(TEXT_URL, key, TEXT_FIELDS, body);
  return (data?.places ?? [])
    .filter((p) => p.location)
    .map((p) => ({
      name: p.displayName?.text ?? '',
      address: p.formattedAddress ?? '',
      lat: p.location.latitude,
      lng: p.location.longitude,
    }));
}

export function buildMatrixBody(origin, destinations, mode) {
  const wp = (p) => ({ waypoint: { location: { latLng: latLng(p) } } });
  return {
    origins: [wp(origin)],
    destinations: destinations.map(wp),
    travelMode: mode,
    languageCode: 'zh-TW',
    regionCode: 'TW',
  };
}

/** 回傳長度 = 目的地數量的陣列，每格 {meters, seconds} 或 null（無路線） */
export function parseMatrix(elements, count) {
  const out = new Array(count).fill(null);
  for (const el of Array.isArray(elements) ? elements : []) {
    const i = el?.destinationIndex ?? 0;
    if (i < 0 || i >= count) continue;
    if (el.status?.code) continue;
    if (el.condition && el.condition !== 'ROUTE_EXISTS') continue;
    const seconds = parseGoogleDuration(el.duration);
    if (seconds === null) continue;
    out[i] = { meters: el.distanceMeters ?? null, seconds };
  }
  return out;
}

export async function computeMatrix(key, origin, destinations, mode) {
  if (!destinations.length) return [];
  const data = await googlePost(MATRIX_URL, key, MATRIX_FIELDS, buildMatrixBody(origin, destinations, mode));
  return parseMatrix(data, destinations.length);
}
