import test from 'node:test';
import assert from 'node:assert/strict';
import { buildTableUrl, parseTable, computeTable, OSRM_SERVERS } from '../js/osrm.js';

const origin = { lat: 23.99395, lng: 121.60093 };
const dests = [{ lat: 23.9725, lng: 121.6113 }, { lat: 24.0258, lng: 121.6323 }];

test('buildTableUrl：經度在前、起點為 sources=0、要求時間與距離', () => {
  assert.equal(
    buildTableUrl('https://router.project-osrm.org', origin, dests),
    'https://router.project-osrm.org/table/v1/driving/121.600930,23.993950;121.611300,23.972500;121.632300,24.025800?sources=0&annotations=duration,distance',
  );
});

test('parseTable：跳過起點自己、到不了的回 null（格式取自實際回應）', () => {
  const json = { code: 'Ok', durations: [[0, 412.3, null]], distances: [[0, 3228.2, null]] };
  assert.deepEqual(parseTable(json, 2), [{ seconds: 412.3, meters: 3228.2 }, null]);
});

test('parseTable：code 不是 Ok 時丟錯', () => {
  assert.throws(() => parseTable({ code: 'InvalidQuery', message: 'bad' }, 1), /bad/);
  assert.throws(() => parseTable(null, 1), /路線服務/);
});

test('三種交通方式都有伺服器，汽車有備援', () => {
  assert.ok(OSRM_SERVERS.WALK[0].includes('routed-foot'));
  assert.ok(OSRM_SERVERS.BIKE[0].includes('routed-bike'));
  assert.equal(OSRM_SERVERS.DRIVE.length, 2);
});

test('computeTable：超過 50 個目的地會分批，結果依原順序接起來；第一台失敗換備援', async () => {
  const realFetch = globalThis.fetch;
  const urls = [];
  try {
    globalThis.fetch = async (url) => {
      urls.push(url);
      if (url.startsWith('https://router.project-osrm.org')) return new Response('down', { status: 502 });
      const n = url.split('/driving/')[1].split('?')[0].split(';').length - 1;
      return new Response(JSON.stringify({ code: 'Ok', durations: [[0, ...Array.from({ length: n }, (_, i) => i + 1)]], distances: [[0, ...Array(n).fill(100)]] }));
    };
    const many = Array.from({ length: 60 }, (_, i) => ({ lat: 24 + i * 0.001, lng: 121.6 }));
    const out = await computeTable('DRIVE', origin, many);
    assert.equal(out.length, 60);
    assert.equal(out[0].seconds, 1);
    assert.equal(out[50].seconds, 1); // 第二批重新從 1 開始
    assert.equal(urls.filter((u) => u.includes('routed-car')).length, 2);
  } finally {
    globalThis.fetch = realFetch;
  }
});
