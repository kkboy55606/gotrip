import test from 'node:test';
import assert from 'node:assert/strict';
import { directionsUrl, googleSearchUrl, multiStopUrl, routeLinks } from '../js/links.js';

const center = { lat: 23.99395, lng: 121.60093 };

test('directionsUrl：帶目的地座標與交通方式', () => {
  const u = new URL(directionsUrl({ id: 'node/1', lat: 24, lng: 121.6 }, 'two-wheeler'));
  assert.equal(u.origin + u.pathname, 'https://www.google.com/maps/dir/');
  assert.equal(u.searchParams.get('api'), '1');
  assert.equal(u.searchParams.get('destination'), '24,121.6');
  assert.equal(u.searchParams.get('travelmode'), 'two-wheeler');
  assert.equal(u.searchParams.get('destination_place_id'), null);
  assert.equal(new URL(directionsUrl({ lat: 1, lng: 2 }, null)).searchParams.get('travelmode'), null);
});

test('googleSearchUrl：用店名 + 地址搜尋，沒名字時用座標', () => {
  const u = new URL(googleSearchUrl({ name: '液香扁食', address: '花蓮市信義街42號', lat: 1, lng: 2 }));
  assert.equal(u.searchParams.get('query'), '液香扁食 花蓮市信義街42號');
  assert.equal(new URL(googleSearchUrl({ name: '', address: '', lat: 1, lng: 2 })).searchParams.get('query'), '1,2');
});

test('multiStopUrl：最後一點是終點，其餘是 waypoints（用 | 分隔）', () => {
  const stops = [{ lat: 1, lng: 1 }, { lat: 2, lng: 2 }, { lat: 3, lng: 3 }];
  const u = new URL(multiStopUrl(center, stops, 'driving'));
  assert.equal(u.searchParams.get('origin'), '23.99395,121.60093');
  assert.equal(u.searchParams.get('destination'), '3,3');
  assert.equal(u.searchParams.get('waypoints'), '1,1|2,2');
  assert.equal(multiStopUrl(center, [], 'driving'), null);
  assert.equal(new URL(multiStopUrl(center, [{ lat: 5, lng: 5 }], 'driving')).searchParams.get('waypoints'), null);
});

test('routeLinks：手機版最多 3 個途經點 → 9 站切成 3 段，下一段從上一段終點出發', () => {
  const stops = Array.from({ length: 9 }, (_, i) => ({ lat: i + 1, lng: i + 1 }));
  const links = routeLinks(center, stops, 'walking').map((s) => new URL(s).searchParams);
  assert.equal(links.length, 3);
  assert.equal(links[0].get('waypoints').split('|').length, 3);
  assert.equal(links[0].get('destination'), '4,4');
  assert.equal(links[1].get('origin'), '4,4');
  assert.equal(links[2].get('origin'), '8,8');
  assert.equal(links[2].get('destination'), '9,9');
  assert.equal(links[2].get('waypoints'), null);
  assert.deepEqual(routeLinks(center, [], 'walking'), []);
});
