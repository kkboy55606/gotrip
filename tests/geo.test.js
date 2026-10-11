import test from 'node:test';
import assert from 'node:assert/strict';
import { haversine, formatDistance, formatDuration, parseGoogleDuration, roundCoordKey } from '../js/geo.js';

const HUALIEN_STATION = { lat: 23.9927, lng: 121.6011 };
const TAIPEI_STATION = { lat: 25.0478, lng: 121.517 };

test('haversine：花蓮車站到台北車站約 117 公里', () => {
  const d = haversine(HUALIEN_STATION, TAIPEI_STATION);
  assert.ok(d > 115000 && d < 120000, `got ${d}`);
});

test('haversine：同一點為 0', () => {
  assert.equal(haversine(HUALIEN_STATION, HUALIEN_STATION), 0);
});

test('formatDistance：公尺/公里切換與無效值', () => {
  assert.equal(formatDistance(0), '0 公尺');
  assert.equal(formatDistance(846), '850 公尺');
  assert.equal(formatDistance(1234), '1.2 公里');
  assert.equal(formatDistance(35400), '35 公里');
  assert.equal(formatDistance(NaN), '—');
  assert.equal(formatDistance(null), '—');
  assert.equal(formatDistance(-5), '—');
  assert.equal(formatDistance(Infinity), '—');
});

test('formatDuration：分鐘/小時與無效值，不顯示 0 分', () => {
  assert.equal(formatDuration(10), '1 分');
  assert.equal(formatDuration(1500), '25 分');
  assert.equal(formatDuration(3600), '1 小時');
  assert.equal(formatDuration(3900), '1 小時 5 分');
  assert.equal(formatDuration(undefined), '—');
  assert.equal(formatDuration(NaN), '—');
});

test('parseGoogleDuration："754s" → 754，格式錯回 null', () => {
  assert.equal(parseGoogleDuration('754s'), 754);
  assert.equal(parseGoogleDuration('0s'), 0);
  assert.equal(parseGoogleDuration('12.5s'), 12.5);
  assert.equal(parseGoogleDuration('abc'), null);
  assert.equal(parseGoogleDuration(undefined), null);
});

test('roundCoordKey：附近的點共用同一快取 key', () => {
  assert.equal(roundCoordKey({ lat: 23.99271, lng: 121.60112 }), '23.993,121.601');
  assert.equal(roundCoordKey({ lat: 23.99268, lng: 121.60108 }), '23.993,121.601');
});
