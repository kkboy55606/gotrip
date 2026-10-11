import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildOverpassQuery, isClosedOsm, typeLabel, cuisineLabel, osmAddress, normalizeElement, parseOverpass,
  nominatimAddress, parseNominatim, queryOverpass,
} from '../js/osm.js';
import { CATEGORIES } from '../js/config.js';

const center = { lat: 23.99395, lng: 121.60093 };
const NOW = new Date('2026-10-12T10:00:00Z');

test('buildOverpassQuery：單行、timeout 25、每個選擇器都加上 around', () => {
  const q = buildOverpassQuery(['nwr["amenity"="cafe"]', 'nwr["shop"="tea"]'], center, 2000.4, 500);
  assert.equal(q, '[out:json][timeout:25];(nwr["amenity"="cafe"](around:2000,23.99395,121.60093);nwr["shop"="tea"](around:2000,23.99395,121.60093););out center tags 500;');
  assert.ok(!q.includes('\n'));
});

test('config：每個分類都有 Overpass 選擇器，且語法括號成對', () => {
  for (const c of CATEGORIES) {
    for (const s of c.subs) {
      assert.ok(Array.isArray(s.q) && s.q.length, `${c.id}/${s.id} 缺少 q`);
      for (const sel of s.q) {
        assert.match(sel, /^(nwr|node|way)\[/);
        assert.equal((sel.match(/\[/g) ?? []).length, (sel.match(/\]/g) ?? []).length, sel);
        assert.equal((sel.match(/"/g) ?? []).length % 2, 0, sel);
      }
    }
  }
});

test('isClosedOsm：各種停業標記都會被排除', () => {
  assert.equal(isClosedOsm({ amenity: 'restaurant', name: '好吃麵店' }, NOW), false);
  assert.equal(isClosedOsm({ amenity: 'restaurant', disused: 'yes' }, NOW), true);
  assert.equal(isClosedOsm({ amenity: 'restaurant', opening_hours: 'closed' }, NOW), true);
  assert.equal(isClosedOsm({ amenity: 'restaurant', opening_hours: 'off' }, NOW), true);
  assert.equal(isClosedOsm({ shop: 'vacant' }, NOW), true);
  assert.equal(isClosedOsm({ amenity: 'cafe', end_date: '2025-06' }, NOW), true);
  assert.equal(isClosedOsm({ amenity: 'cafe', end_date: '2027' }, NOW), false);
  assert.equal(isClosedOsm({ amenity: 'cafe', name: '小咖啡（已停業）' }, NOW), true);
  assert.equal(isClosedOsm({ tourism: 'attraction', name: '某步道', note: '地震後暫停開放' }, NOW), true);
  assert.equal(isClosedOsm({ amenity: 'restaurant', description: '已搬遷至中山路' }, NOW), true);
  assert.equal(isClosedOsm({ amenity: 'parking', access: 'private' }, NOW), true);
});

test('isClosedOsm：只有前身標記（was:/disused:xxx）不算停業，因為現在的標籤仍有效', () => {
  assert.equal(isClosedOsm({ amenity: 'cafe', 'was:shop': 'clothes', 'disused:amenity': 'restaurant' }, NOW), false);
});

test('typeLabel / cuisineLabel', () => {
  assert.equal(typeLabel({ amenity: 'restaurant' }), '餐廳');
  assert.equal(typeLabel({ shop: 'beverages' }), '飲料店');
  assert.equal(typeLabel({ tourism: 'hotel', amenity: 'restaurant' }), '飯店');
  assert.equal(typeLabel({ historic: 'memorial' }), '古蹟');
  assert.equal(typeLabel({ foo: 'bar' }), '');
  assert.equal(cuisineLabel({ cuisine: 'noodle;dumplings;pizza' }), '麵食・水餃');
  assert.equal(cuisineLabel({ cuisine: '扁食' }), '扁食');
  assert.equal(cuisineLabel({ cuisine: 'unknown_x' }), '');
  assert.equal(cuisineLabel({}), '');
});

test('osmAddress：addr:full 優先；組合時自動補「號」', () => {
  assert.equal(osmAddress({ 'addr:full': '花蓮縣花蓮市信義街42號', 'addr:street': 'x' }), '花蓮縣花蓮市信義街42號');
  assert.equal(osmAddress({ 'addr:city': '花蓮縣', 'addr:district': '花蓮市', 'addr:street': '中山路', 'addr:housenumber': '50' }), '花蓮縣花蓮市中山路50號');
  assert.equal(osmAddress({ 'addr:street': '中山路', 'addr:housenumber': '50號' }), '中山路50號');
  assert.equal(osmAddress({}), '');
});

test('normalizeElement：node 用 lat/lon、way 用 center；沒座標回 null', () => {
  const node = normalizeElement({ type: 'node', id: 1, lat: 23.9768, lon: 121.6055, tags: { amenity: 'restaurant', name: '扁食店', cuisine: 'dumplings', opening_hours: 'Mo-Su 09:00-21:00', phone: '03-1234567' } }, center, NOW);
  assert.equal(node.id, 'node/1');
  assert.equal(node.name, '扁食店');
  assert.equal(node.type, '餐廳');
  assert.equal(node.cuisine, '水餃');
  assert.equal(node.openingHours, 'Mo-Su 09:00-21:00');
  assert.equal(node.businessStatus, 'OPERATIONAL');
  assert.equal(node.osmUrl, 'https://www.openstreetmap.org/node/1');
  assert.ok(node.distance > 1500 && node.distance < 2500);
  const way = normalizeElement({ type: 'way', id: 2, center: { lat: 24, lon: 121.6 }, tags: { amenity: 'toilets' } }, center, NOW);
  assert.equal(way.name, '');
  assert.equal(way.displayName, '公廁');
  assert.equal(normalizeElement({ type: 'relation', id: 3, tags: {} }, center), null);
});

test('parseOverpass：去重、排除沒名字（可關閉）、半徑外排除、依距離排序、標記是否達上限', () => {
  const json = {
    elements: [
      { type: 'node', id: 1, lat: 23.999, lon: 121.601, tags: { amenity: 'cafe', name: '遠一點' } },
      { type: 'node', id: 2, lat: 23.9940, lon: 121.6010, tags: { amenity: 'cafe', name: '最近' } },
      { type: 'node', id: 2, lat: 23.9940, lon: 121.6010, tags: { amenity: 'cafe', name: '最近' } },
      { type: 'node', id: 3, lat: 23.9945, lon: 121.6012, tags: { amenity: 'toilets' } },
      { type: 'node', id: 4, lat: 24.2, lon: 121.6, tags: { amenity: 'cafe', name: '太遠' } },
    ],
  };
  const named = parseOverpass(json, center, 2000);
  assert.deepEqual(named.places.map((p) => p.name), ['最近', '遠一點']);
  assert.equal(named.truncated, false);
  const all = parseOverpass(json, center, 2000, { named: false });
  assert.equal(all.places.length, 3);
  assert.equal(parseOverpass(json, center, 2000, { limit: 5 }).truncated, true);
  assert.deepEqual(parseOverpass(null, center, 1).places, []);
});

test('nominatim：地址從大到小排列，去掉國名與郵遞區號', () => {
  assert.equal(nominatimAddress('七星潭, 民心里, 花蓮市, 花蓮縣, 970, 臺灣'), '花蓮縣花蓮市民心里');
  const r = parseNominatim([{ name: '七星潭', display_name: '七星潭, 民心里, 花蓮市, 花蓮縣, 970, 臺灣', lat: '24.0258', lon: '121.6322' }, { display_name: 'x', lat: 'bad', lon: '1' }]);
  assert.equal(r.length, 1);
  assert.deepEqual(r[0], { name: '七星潭', address: '花蓮縣花蓮市民心里', lat: 24.0258, lng: 121.6322 });
});

test('queryOverpass：第一台失敗會換下一台；全部失敗丟出中文錯誤', async () => {
  const realFetch = globalThis.fetch;
  const calls = [];
  try {
    globalThis.fetch = async (url) => {
      calls.push(url);
      if (url === 'https://a') return new Response('busy', { status: 504 });
      return new Response(JSON.stringify({ elements: [{ type: 'node', id: 9 }] }), { status: 200 });
    };
    const data = await queryOverpass('q', { endpoints: ['https://a', 'https://b'] });
    assert.deepEqual(calls, ['https://a', 'https://b']);
    assert.equal(data.elements[0].id, 9);

    globalThis.fetch = async () => { throw new TypeError('network'); };
    await assert.rejects(queryOverpass('q', { endpoints: ['https://a', 'https://b'] }), /伺服器忙碌/);
  } finally {
    globalThis.fetch = realFetch;
  }
});
