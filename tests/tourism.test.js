import test from 'node:test';
import assert from 'node:assert/strict';
import { deflateRawSync } from 'node:zlib';
import {
  unzip, parseJsonBuf, serviceTimesToOsm, feesText, isOperatingAttraction, compactAttraction, eventDate, compactEvent, buildTourism,
} from '../scripts/tourism-lib.js';
import { tileKey, tilesFor, classLabel, normalizeSpot, eventPhase, normalizeEvent } from '../js/tourism.js';
import { parseOpeningHours } from '../js/opening-hours.js';

// 欄位格式取自觀光署 v2.0 實際資料（2026-10-11，內容精簡）
const attraction = (over = {}) => ({
  AttractionID: 'Attraction_376580000A_000001',
  AttractionName: '七星潭風景區',
  Description: '  月牙形的礫石海灘，\n可以看日出與星空。  ',
  PositionLat: 24.0294123456789,
  PositionLon: 121.6260987654321,
  AttractionClasses: [11, 12],
  PostalAddress: { City: '花蓮縣', Town: '新城鄉', StreetAddress: '七星街' },
  Telephones: [{ Tel: '(03)8221166' }, { Tel: '0900000000' }],
  Images: [{ URL: 'http://insecure.example/a.jpg' }, { URL: 'https://img.example/b.jpg' }],
  ServiceStatus: 1,
  IsPublicAccess: 1,
  IsAccessibleForFree: 1,
  WebsiteURL: 'https://example.gov.tw/qixingtan',
  ParkingInfo: '',
  ...over,
});

function makeZip(entries) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const [name, content, method] of entries) {
    const data = method === 8 ? deflateRawSync(content) : content;
    const nameBuf = Buffer.from(name);
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(method, 8); lh.writeUInt32LE(data.length, 18); lh.writeUInt32LE(content.length, 22); lh.writeUInt16LE(nameBuf.length, 26);
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(method, 10); ch.writeUInt32LE(data.length, 20); ch.writeUInt32LE(content.length, 24); ch.writeUInt16LE(nameBuf.length, 28); ch.writeUInt32LE(offset, 42);
    locals.push(lh, nameBuf, data);
    centrals.push(ch, nameBuf);
    offset += 30 + nameBuf.length + data.length;
  }
  const cd = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0); eocd.writeUInt16LE(entries.length, 8); eocd.writeUInt16LE(entries.length, 10); eocd.writeUInt32LE(cd.length, 12); eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, eocd]);
}

test('unzip：支援 deflate 與 store，JSON 開頭的 BOM 會去掉', () => {
  const json = Buffer.from('﻿{"Attractions":[{"AttractionName":"測試"}]}');
  const files = unzip(makeZip([['AttractionList.json', json, 8], ['manifest.csv', Buffer.from('a,b'), 0]]));
  assert.equal(parseJsonBuf(files['AttractionList.json']).Attractions[0].AttractionName, '測試');
  assert.equal(files['manifest.csv'].toString(), 'a,b');
  assert.throws(() => unzip(Buffer.from('not a zip at all, definitely not')), /zip/);
});

test('serviceTimesToOsm：轉成 App 營業時間解析器看得懂的格式', () => {
  const times = [
    { ServiceDays: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'], StartTime: '06:00:00', EndTime: '20:00:00' },
    { ServiceDays: ['Saturday', 'Sunday'], StartTime: '04:00:00', EndTime: '20:00:00' },
  ];
  const s = serviceTimesToOsm(times, '2026-10-11');
  assert.equal(s, 'Mo,Tu,We,Th,Fr 06:00-20:00; Sa,Su 04:00-20:00');
  const p = parseOpeningHours(s);
  assert.deepEqual(p.week[0], [[240, 1200]]); // 星期日
  assert.deepEqual(p.week[3], [[360, 1200]]); // 星期三
  assert.equal(serviceTimesToOsm([{ ServiceDays: ['Monday'], StartTime: '00:00:00', EndTime: '23:59:00' }], '2026-10-11'), 'Mo 00:00-24:00');
});

test('serviceTimesToOsm：過期/未生效的時段略過；資料不完整回空字串', () => {
  const t = [
    { ServiceDays: ['Monday'], StartTime: '09:00:00', EndTime: '17:00:00', ExpireDate: '2025-12-31' },
    { ServiceDays: ['Tuesday'], StartTime: '09:00:00', EndTime: '17:00:00', EffectiveDate: '2026-01-01T00:00:00' },
  ];
  assert.equal(serviceTimesToOsm(t, '2026-10-11'), 'Tu 09:00-17:00');
  assert.equal(serviceTimesToOsm([{ ServiceDays: [], StartTime: '09:00:00', EndTime: '17:00:00' }], '2026-10-11'), '');
  assert.equal(serviceTimesToOsm(undefined, '2026-10-11'), '');
});

test('feesText', () => {
  assert.equal(feesText([{ Name: '免費', Price: 0 }]), '免費');
  assert.equal(feesText([{ Name: '全票', Price: 100 }, { Name: '半票', Price: 50 }]), '全票 100 元、半票 50 元');
  assert.equal(feesText([]), '');
});

test('isOperatingAttraction：只留正常營運（1）且對外開放；0、3 與不開放的排除', () => {
  assert.equal(isOperatingAttraction(attraction()), true);
  assert.equal(isOperatingAttraction(attraction({ ServiceStatus: 0 })), false);
  assert.equal(isOperatingAttraction(attraction({ ServiceStatus: 3 })), false);
  assert.equal(isOperatingAttraction(attraction({ ServiceStatus: 2 })), false);
  assert.equal(isOperatingAttraction(attraction({ IsPublicAccess: 0 })), false);
});

test('compactAttraction：精簡欄位、只取 https 圖片、簡介去空白並截斷、空欄位不輸出', () => {
  const s = compactAttraction(attraction({ Description: '很長'.repeat(400) }), { today: '2026-10-11' });
  assert.equal(s.id, '376580000A_000001');
  assert.equal(s.n, '七星潭風景區');
  assert.equal(s.lat, 24.029412);
  assert.equal(s.a, '花蓮縣新城鄉七星街');
  assert.equal(s.t, '(03)8221166');
  assert.equal(s.img, 'https://img.example/b.jpg');
  assert.equal(s.f, '免費');
  assert.equal(s.d.length, 301);
  assert.ok(!('p' in s) && !('h' in s));
  const short = compactAttraction(attraction(), { today: '2026-10-11' });
  assert.equal(short.d, '月牙形的礫石海灘， 可以看日出與星空。');
  assert.equal(compactAttraction(attraction({ PositionLat: null }), { today: '2026-10-11' }), null);
});

test('eventDate：UTC 誤標成 +08:00 的開始時間（16:00:00）要進一天；結束日照原日期', () => {
  assert.equal(eventDate('2025-10-04T16:00:00+08:00', true), '2025-10-05');
  assert.equal(eventDate('2026-03-01T15:59:59+08:00', false), '2026-03-01');
  assert.equal(eventDate('2026-08-08T00:00:00+08:00', true), '2026-08-08');
  assert.equal(eventDate('2026-12-31T16:00:00+08:00', true), '2027-01-01');
  assert.equal(eventDate('', true), null);
});

test('buildTourism：排除非營運景點與取消/已結束的活動、依格子分檔、活動依開始日排序', () => {
  const r = buildTourism({
    attractions: [attraction(), attraction({ AttractionID: 'Attraction_X_2', ServiceStatus: 3 }), attraction({ AttractionID: 'Attraction_X_3', PositionLat: 25.04, PositionLon: 121.51 })],
    serviceTimes: [{ AttractionID: 'Attraction_376580000A_000001', ServiceTimes: [{ ServiceDays: ['Monday'], StartTime: '08:00:00', EndTime: '17:00:00' }] }],
    fees: [],
    events: [
      { EventID: 'Event_A', EventName: '龍舟節', StartDateTime: '2026-11-06T00:00:00+08:00', EndDateTime: '2026-11-08T23:59:59+08:00', PositionLat: 23.9, PositionLon: 121.5, EventStatus: 'EventScheduled' },
      { EventID: 'Event_B', EventName: '藝術季', StartDateTime: '2026-07-01T00:00:00+08:00', EndDateTime: '2026-10-31T23:59:59+08:00', PositionLat: 23.97, PositionLon: 121.6, EventStatus: 'EventScheduled' },
      { EventID: 'Event_C', EventName: '已取消', StartDateTime: '2026-10-20T00:00:00+08:00', EndDateTime: '2026-10-21T00:00:00+08:00', PositionLat: 23.9, PositionLon: 121.5, EventStatus: 'EventCancelled' },
      { EventID: 'Event_D', EventName: '已結束', StartDateTime: '2026-08-08T00:00:00+08:00', EndDateTime: '2026-10-10T23:59:59+08:00', PositionLat: 23.9, PositionLon: 121.5, EventStatus: 'EventScheduled' },
    ],
    updateTime: '2026-10-11T02:30:04+08:00',
    today: '2026-10-11',
  });
  assert.equal(r.index.spots, 2);
  assert.equal(r.index.skippedNotOperating, 1);
  assert.deepEqual(r.index.tiles, [tileKey(24.029, 121.626), tileKey(25.04, 121.51)].sort());
  assert.equal(r.tiles[tileKey(24.029, 121.626)][0].h, 'Mo 08:00-17:00');
  assert.deepEqual(r.events.map((e) => e.n), ['藝術季', '龍舟節']);
  assert.equal(r.index.events, 2);
});

test('tilesFor：範圍跨格子時全部列出、只回傳存在的格子', () => {
  const c = { lat: 24.0, lng: 121.6 }; // 剛好在格線上
  const all = tilesFor(c, 2000);
  assert.ok(all.includes('95_486') && all.includes('96_486'), all.join());
  assert.deepEqual(tilesFor(c, 2000, ['96_486']), ['96_486']);
  assert.equal(tilesFor({ lat: 24.1, lng: 121.6 }, 500).length, 1);
});

test('normalizeSpot / classLabel：轉成清單用的地點格式', () => {
  const p = normalizeSpot({ id: 'X1', n: '七星潭', lat: 24.03, lng: 121.63, c: [11, 12, 99], d: '海灘', h: 'Mo 08:00-17:00' }, { lat: 23.99395, lng: 121.60093 });
  assert.equal(p.id, 'tw/X1');
  assert.equal(p.type, '自然風景・遊憩');
  assert.equal(p.source, 'tourism');
  assert.equal(p.openingHours, 'Mo 08:00-17:00');
  assert.equal(p.businessStatus, 'OPERATIONAL');
  assert.ok(p.distance > 4000 && p.distance < 6000);
  assert.equal(classLabel([99]), '');
});

test('eventPhase / normalizeEvent：進行中、即將開始、已結束與日期範圍', () => {
  const now = new Date('2026-10-11T04:00:00Z'); // 台灣 12:00
  assert.deepEqual(eventPhase({ s: '2026-07-01', e: '2026-10-31' }, now), { kind: 'open', label: '進行中・到 10/31' });
  assert.equal(eventPhase({ s: '2026-10-11', e: '2026-10-11' }, now).kind, 'open');
  assert.equal(eventPhase({ s: '2026-11-06', e: '2026-11-08' }, now).label, '11/6 開始');
  assert.equal(eventPhase({ s: '2026-10-14', e: '2026-10-15' }, now).label, '10/14 開始（3 天後）');
  assert.equal(eventPhase({ s: '2026-10-01', e: '2026-10-10' }, now).kind, 'closed');
  const ev = normalizeEvent({ id: 'E1', n: '龍舟節', lat: 23.9, lng: 121.55, s: '2026-11-06', e: '2026-11-08' }, { lat: 23.99, lng: 121.6 });
  assert.equal(ev.dateRange, '11/6–11/8');
  assert.equal(ev.source, 'event');
});
