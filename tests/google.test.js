import test from 'node:test';
import assert from 'node:assert/strict';
// google.js 目前未啟用（改用免費資料），測試保留以便日後切回時確保仍可用
import {
  buildNearbyBody, buildTextPlacesBody, buildMatrixBody, normalizePlace, parseMatrix,
  googleErrorMessage, NEARBY_FIELDS,
} from '../js/google.js';

const center = { lat: 23.99395, lng: 121.60093 };

test('buildNearbyBody：最近 → DISTANCE、其他 → POPULARITY；座標與語系正確', () => {
  const b = buildNearbyBody({ center, radius: 2000, types: ['cafe'], sort: 'distance' });
  assert.equal(b.rankPreference, 'DISTANCE');
  assert.equal(b.maxResultCount, 20);
  assert.deepEqual(b.locationRestriction.circle, { center: { latitude: 23.99395, longitude: 121.60093 }, radius: 2000 });
  assert.equal(b.languageCode, 'zh-TW');
  assert.equal(buildNearbyBody({ center, radius: 1, types: [], sort: 'rating' }).rankPreference, 'POPULARITY');
});

test('buildTextPlacesBody：用 locationBias（Text Search 的 restriction 只吃矩形）', () => {
  const b = buildTextPlacesBody({ center, radius: 3000, text: '手搖飲', sort: 'popular' });
  assert.equal(b.textQuery, '手搖飲');
  assert.equal(b.rankPreference, 'RELEVANCE');
  assert.equal(b.locationBias.circle.radius, 3000);
  assert.equal('locationRestriction' in b, false);
});

test('NEARBY_FIELDS：一定要有 businessStatus（停業過濾靠它）', () => {
  assert.ok(NEARBY_FIELDS.split(',').includes('places.businessStatus'));
  assert.ok(!NEARBY_FIELDS.includes(' '));
});

test('normalizePlace：欄位轉換 + 算直線距離；沒座標回 null', () => {
  const raw = {
    id: 'ChIJabc',
    displayName: { text: '液香扁食店', languageCode: 'zh-TW' },
    location: { latitude: 23.9768, longitude: 121.6055 },
    businessStatus: 'OPERATIONAL',
    primaryTypeDisplayName: { text: '餐廳' },
    shortFormattedAddress: '花蓮市信義街42號',
    rating: 4.3,
    userRatingCount: 8123,
    priceLevel: 'PRICE_LEVEL_INEXPENSIVE',
    googleMapsUri: 'https://maps.google.com/?cid=1',
    currentOpeningHours: { openNow: true },
  };
  const p = normalizePlace(raw, center);
  assert.equal(p.name, '液香扁食店');
  assert.equal(p.type, '餐廳');
  assert.equal(p.rating, 4.3);
  assert.equal(p.ratingCount, 8123);
  assert.equal(p.businessStatus, 'OPERATIONAL');
  assert.ok(p.distance > 1500 && p.distance < 2500, `distance ${p.distance}`);
  assert.deepEqual(p.routes, {});
  assert.equal(normalizePlace({ id: 'x' }, center), null);
  assert.equal(normalizePlace({ id: 'y', location: { latitude: 24, longitude: 121.6 } }, center).name, '（未命名）');
});

test('buildMatrixBody：一個起點、多個目的地、travelMode', () => {
  const b = buildMatrixBody(center, [{ lat: 1, lng: 2 }, { lat: 3, lng: 4 }], 'TWO_WHEELER');
  assert.equal(b.origins.length, 1);
  assert.equal(b.destinations.length, 2);
  assert.deepEqual(b.destinations[1].waypoint.location.latLng, { latitude: 3, longitude: 4 });
  assert.equal(b.travelMode, 'TWO_WHEELER');
  assert.equal('routingPreference' in b, false); // 不開路況 → 不升級計費等級
});

test('parseMatrix：依 destinationIndex 對位（順序不保證），無路線/錯誤 → null', () => {
  const elements = [
    { originIndex: 0, destinationIndex: 2, status: {}, condition: 'ROUTE_EXISTS', distanceMeters: 3000, duration: '420s' },
    { originIndex: 0, destinationIndex: 0, status: {}, condition: 'ROUTE_EXISTS', distanceMeters: 800, duration: '160s' },
    { originIndex: 0, destinationIndex: 1, status: {}, condition: 'ROUTE_NOT_FOUND' },
    { originIndex: 0, destinationIndex: 3, status: { code: 5, message: 'not found' } },
  ];
  assert.deepEqual(parseMatrix(elements, 4), [
    { meters: 800, seconds: 160 },
    null,
    { meters: 3000, seconds: 420 },
    null,
  ]);
  assert.deepEqual(parseMatrix(null, 2), [null, null]);
  // destinationIndex 0 在 proto3 JSON 可能被省略
  assert.deepEqual(parseMatrix([{ condition: 'ROUTE_EXISTS', duration: '60s', distanceMeters: 100 }], 1), [{ meters: 100, seconds: 60 }]);
});

test('googleErrorMessage：常見錯誤轉成看得懂的中文', () => {
  const invalid = { error: { code: 400, message: 'API key not valid. Please pass a valid API key.', status: 'INVALID_ARGUMENT' } };
  assert.match(googleErrorMessage(400, invalid), /金鑰無效/);
  assert.match(googleErrorMessage(403, { error: { status: 'PERMISSION_DENIED', message: 'blocked' } }), /啟用 Places API/);
  assert.match(googleErrorMessage(429, null), /用量上限/);
  assert.match(googleErrorMessage(500, null), /500/);
});
