import test from 'node:test';
import assert from 'node:assert/strict';
import { orderStops, pathLength } from '../js/route-order.js';

const start = { lat: 23.9927, lng: 121.6011 }; // 花蓮車站
// 由南到北沿海岸的幾個點，故意打亂順序
const south = { id: 's', lat: 23.93, lng: 121.51 }; // 鯉魚潭方向
const mid = { id: 'm', lat: 23.9725, lng: 121.6113 }; // 東大門夜市
const north1 = { id: 'n1', lat: 24.0258, lng: 121.6323 }; // 七星潭
const north2 = { id: 'n2', lat: 24.1577, lng: 121.6222 }; // 太魯閣

test('orderStops：0 或 1 個點原樣回傳', () => {
  assert.deepEqual(orderStops(start, []).order, []);
  assert.deepEqual(orderStops(start, [mid]).order, [mid]);
});

test('orderStops：結果是輸入的重新排列，不遺漏、不重複、不改輸入', () => {
  const input = [north2, south, north1, mid];
  const copy = [...input];
  const { order } = orderStops(start, input);
  assert.deepEqual(input, copy);
  assert.equal(order.length, 4);
  assert.deepEqual(new Set(order.map((p) => p.id)), new Set(['s', 'm', 'n1', 'n2']));
});

test('orderStops：不比輸入順序更長，且北邊兩點相鄰（不會來回跑）', () => {
  const input = [north2, south, north1, mid];
  const { order, meters } = orderStops(start, input);
  assert.ok(meters <= pathLength(start, input));
  const ids = order.map((p) => p.id);
  assert.equal(Math.abs(ids.indexOf('n1') - ids.indexOf('n2')), 1);
  assert.equal(ids.at(-1) === 'n2' || ids.at(-1) === 's', true);
});
