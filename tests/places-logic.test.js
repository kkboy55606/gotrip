import test from 'node:test';
import assert from 'node:assert/strict';
import { filterPlaces, isClosedBusiness, openStatus, sortPlaces, todayHoursText, twParts, priceLabel } from '../js/places-logic.js';

// 2026-10-12（星期一）台灣時間 18:00 = UTC 10:00
const NOW = new Date('2026-10-12T10:00:00Z');
const tw = (iso) => new Date(iso + '+08:00').toISOString();

test('twParts：以台灣時間計算星期與時刻', () => {
  const p = twParts(NOW);
  assert.equal(p.weekday, 1);
  assert.equal(p.hh, 18);
  assert.equal(p.ymd, '2026-10-12');
});

test('isClosedBusiness：停業、暫停營業視為關閉；營業中與沒資料的不算', () => {
  assert.equal(isClosedBusiness({ businessStatus: 'CLOSED_PERMANENTLY' }), true);
  assert.equal(isClosedBusiness({ businessStatus: 'CLOSED_TEMPORARILY' }), true);
  assert.equal(isClosedBusiness({ businessStatus: 'OPERATIONAL' }), false);
  assert.equal(isClosedBusiness({}), false);
});

test('filterPlaces：停業/暫停營業永遠不列出（就算其他條件全關）', () => {
  const list = [
    { id: 'a', businessStatus: 'OPERATIONAL' },
    { id: 'b', businessStatus: 'CLOSED_PERMANENTLY' },
    { id: 'c', businessStatus: 'CLOSED_TEMPORARILY' },
    { id: 'd' },
  ];
  assert.deepEqual(filterPlaces(list).map((p) => p.id), ['a', 'd']);
});

test('filterPlaces：只看營業中 → 排除確定沒開的，保留沒提供營業時間的', () => {
  const list = [
    { id: 'open', hours: { openNow: true } },
    { id: 'shut', hours: { openNow: false } },
    { id: 'park' },
  ];
  assert.deepEqual(filterPlaces(list, { openNowOnly: true }).map((p) => p.id), ['open', 'park']);
  assert.equal(filterPlaces(list, { openNowOnly: false }).length, 3);
});

test('filterPlaces：評分門檻，沒評分的也排除', () => {
  const list = [{ id: 'a', rating: 4.6 }, { id: 'b', rating: 3.9 }, { id: 'c' }];
  assert.deepEqual(filterPlaces(list, { minRating: 4 }).map((p) => p.id), ['a']);
});

test('openStatus：沒有營業時間資料 → unknown', () => {
  assert.equal(openStatus(undefined, NOW).kind, 'unknown');
  assert.equal(openStatus({}, NOW).kind, 'unknown');
});

test('openStatus：營業中、顯示打烊時間', () => {
  const s = openStatus({ openNow: true, nextCloseTime: tw('2026-10-12T21:30:00') }, NOW);
  assert.equal(s.kind, 'open');
  assert.equal(s.label, '營業中・21:30 打烊');
});

test('openStatus：一小時內打烊 → 快打烊', () => {
  const s = openStatus({ openNow: true, nextCloseTime: tw('2026-10-12T18:40:00') }, NOW);
  assert.equal(s.kind, 'closing');
  assert.equal(s.label, '快打烊・40 分鐘後');
});

test('openStatus：營業到隔天凌晨', () => {
  const s = openStatus({ openNow: true, nextCloseTime: tw('2026-10-13T02:00:00') }, NOW);
  assert.equal(s.label, '營業中・明天 02:00 打烊');
});

test('openStatus：24 小時營業', () => {
  const s = openStatus({ openNow: true, periods: [{ open: { day: 0, hour: 0, minute: 0 } }] }, NOW);
  assert.equal(s.label, '24 小時營業');
});

test('openStatus：今天稍晚才開門', () => {
  const s = openStatus({ openNow: false, nextOpenTime: tw('2026-10-12T19:00:00') }, NOW);
  assert.equal(s.kind, 'closed');
  assert.equal(s.label, '休息中・19:00 開門');
});

test('openStatus：今天（星期一）沒有營業時段 → 今日公休', () => {
  const hours = {
    openNow: false,
    nextOpenTime: tw('2026-10-13T11:00:00'),
    periods: [{ open: { day: 2, hour: 11, minute: 0 }, close: { day: 2, hour: 20, minute: 0 } }],
  };
  assert.equal(openStatus(hours, NOW).label, '今日公休');
});

test('openStatus：今天有營業但已打烊', () => {
  const hours = {
    openNow: false,
    nextOpenTime: tw('2026-10-13T07:00:00'),
    periods: [{ open: { day: 1, hour: 7, minute: 0 }, close: { day: 1, hour: 14, minute: 0 } }],
  };
  assert.equal(openStatus(hours, NOW).label, '今日已打烊');
});

test('todayHoursText：星期一取第 0 行、星期日取第 6 行', () => {
  const lines = ['一', '二', '三', '四', '五', '六', '日'].map((d) => `星期${d}: 11:00–20:00`);
  assert.equal(todayHoursText({ weekdayDescriptions: lines }, NOW), '星期一: 11:00–20:00');
  const sunday = new Date('2026-10-18T03:00:00Z');
  assert.equal(todayHoursText({ weekdayDescriptions: lines }, sunday), '星期日: 11:00–20:00');
  assert.equal(todayHoursText(undefined, NOW), null);
});

test('sortPlaces：有交通時間時依時間排，算不出路線的排最後', () => {
  const list = [
    { id: 'far', distance: 900, routes: { WALK: { seconds: 700 } } },
    { id: 'none', distance: 100, routes: {} },
    { id: 'near', distance: 1000, routes: { WALK: { seconds: 300 } } },
  ];
  assert.deepEqual(sortPlaces(list, 'distance', 'WALK').map((p) => p.id), ['near', 'far', 'none']);
});

test('sortPlaces：還沒有交通時間時依直線距離', () => {
  const list = [{ id: 'b', distance: 500 }, { id: 'a', distance: 100 }];
  assert.deepEqual(sortPlaces(list, 'distance', 'WALK').map((p) => p.id), ['a', 'b']);
});

test('sortPlaces：評分排序同分比評論數；popular 保持原順序；不修改輸入', () => {
  const list = [
    { id: 'x', rating: 4.5, ratingCount: 10, distance: 1 },
    { id: 'y', rating: 4.8, ratingCount: 5, distance: 2 },
    { id: 'z', rating: 4.5, ratingCount: 900, distance: 3 },
  ];
  assert.deepEqual(sortPlaces(list, 'rating').map((p) => p.id), ['y', 'z', 'x']);
  assert.deepEqual(sortPlaces(list, 'popular').map((p) => p.id), ['x', 'y', 'z']);
  assert.deepEqual(list.map((p) => p.id), ['x', 'y', 'z']);
});

test('priceLabel', () => {
  assert.equal(priceLabel('PRICE_LEVEL_MODERATE'), '$$');
  assert.equal(priceLabel(undefined), null);
});
