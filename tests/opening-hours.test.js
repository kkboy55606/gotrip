import test from 'node:test';
import assert from 'node:assert/strict';
import { parseOpeningHours, hoursFromOsm } from '../js/opening-hours.js';
import { openStatus } from '../js/places-logic.js';

// 測試用的寫法取自花蓮市區 OSM 實際資料（2026-10）
const tw = (s) => new Date(`${s}+08:00`);
// 2026-10-12 是星期一
const MON_1800 = tw('2026-10-12T18:00:00');

test('24/7', () => {
  const h = hoursFromOsm('24/7', MON_1800);
  assert.equal(h.openNow, true);
  assert.equal(openStatus(h, MON_1800).label, '24 小時營業');
});

test('Mo-Su 10:00-22:00：營業中、22:00 打烊', () => {
  const h = hoursFromOsm('Mo-Su 10:00-22:00', MON_1800);
  assert.equal(h.openNow, true);
  assert.equal(openStatus(h, MON_1800).label, '營業中・22:00 打烊');
});

test('沒有星期的時間 = 每天（09:30-18:00）', () => {
  const h = hoursFromOsm('09:30-18:00', MON_1800);
  assert.equal(h.openNow, false);
  assert.equal(openStatus(h, MON_1800).label, '今日已打烊');
});

test('跨午夜：Mo-Su 17:00-03:00，星期二凌晨 01:00 仍營業（屬於星期一的時段）', () => {
  const tue0100 = tw('2026-10-13T01:00:00');
  const h = hoursFromOsm('Mo-Su 17:00-03:00', tue0100);
  assert.equal(h.openNow, true);
  assert.equal(openStatus(h, tue0100).kind, 'open');
  assert.equal(openStatus(h, tue0100).label, '營業中・03:00 打烊');
});

test('24:30 視為隔天 00:30', () => {
  const p = parseOpeningHours('11:00-24:30');
  assert.deepEqual(p.week[1], [[660, 1470]]);
});

test('跨週星期範圍：Th-Tu（星期三公休）', () => {
  const p = parseOpeningHours('Th-Tu 06:00-23:00');
  assert.deepEqual(p.week[3], []); // 星期三
  assert.deepEqual(p.week[4], [[360, 1380]]); // 星期四
  assert.deepEqual(p.week[1], [[360, 1380]]); // 星期一
  const wed = tw('2026-10-14T12:00:00');
  assert.equal(openStatus(hoursFromOsm('Th-Tu 06:00-23:00', wed), wed).label, '今日公休');
});

test('「; Th off」覆蓋前面的規則', () => {
  const p = parseOpeningHours('Mo-Su 11:00-20:30; Th off');
  assert.deepEqual(p.week[4], []);
  assert.deepEqual(p.week[5], [[660, 1230]]);
});

test('多段時間（午休）：休息中、今天稍晚開門', () => {
  const at1500 = tw('2026-10-12T15:00:00');
  const h = hoursFromOsm('Mo-Su 10:30-14:00, 16:30-21:00', at1500);
  assert.equal(h.openNow, false);
  assert.equal(openStatus(h, at1500).label, '休息中・16:30 開門');
});

test('逗號附加規則：Mo 17:00-00:00, Tu-Fr 11:30-14:30,17:00-00:00', () => {
  const p = parseOpeningHours('Mo 17:00-00:00, Tu-Fr 11:30-14:30,17:00-00:00');
  assert.deepEqual(p.week[1], [[1020, 1440]]);
  assert.deepEqual(p.week[2], [[690, 870], [1020, 1440]]);
  assert.deepEqual(p.week[6], []); // 星期六沒列 → 休息
});

test('PH 忽略，只套用到星期六日', () => {
  const p = parseOpeningHours('Mo-Fr 10:00-23:00;Sa-Su, PH 10:00-24:00');
  assert.deepEqual(p.week[6], [[600, 1440]]);
  assert.deepEqual(p.week[1], [[600, 1380]]);
});

test('只寫 PH 的規則不影響平日', () => {
  const p = parseOpeningHours('Mo-Su 09:00-18:00; PH off');
  assert.deepEqual(p.week[1], [[540, 1080]]);
});

test('看不懂的寫法回 null（不亂猜）', () => {
  for (const s of ['PM 09:30 - AM 04:00', 'sunrise-sunset', '週一公休', 'Mo-Fr 11:00-22:00; Sa-Su', '10:00+', 'Jan-Mar 10:00-18:00', '', null, undefined]) {
    assert.equal(parseOpeningHours(s), null, `應為 null：${s}`);
    assert.equal(hoursFromOsm(s), null);
  }
});

test('時間前後有空白也可以：09:30 - 18:00', () => {
  assert.deepEqual(parseOpeningHours('09:30 - 18:00').week[0], [[570, 1080]]);
});

test('每週營業時間文字：星期一開頭、公休顯示休息、跨午夜顯示隔天時間', () => {
  const h = hoursFromOsm('Tu-Su 17:00-02:00', MON_1800);
  assert.equal(h.weekdayDescriptions.length, 7);
  assert.equal(h.weekdayDescriptions[0], '星期一: 休息');
  assert.equal(h.weekdayDescriptions[1], '星期二: 17:00–02:00');
  assert.equal(h.weekdayDescriptions[6], '星期日: 17:00–02:00');
});

test('今天公休、明天才開：休息中標成今日公休', () => {
  const h = hoursFromOsm('Tu-Su 11:00-20:00', MON_1800);
  assert.equal(h.openNow, false);
  assert.equal(openStatus(h, MON_1800).label, '今日公休');
  assert.ok(h.nextOpenTime.startsWith('2026-10-13T03:00')); // 台灣 11:00 = UTC 03:00
});
