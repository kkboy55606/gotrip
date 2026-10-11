import test from 'node:test';
import assert from 'node:assert/strict';
import {
  countyFromAddress, parseStations, nearestStations, upcomingDepartures, parseLiveBoard, parseOdTrains,
  groupBusStops, parseBusEta, busEtaText, parseWktPoint, parseRoadEvents, filterHighwayNews, tdxUrl, CITY_CODES, createTdx,
} from '../js/tdx.js';

// 範例格式取自 TDX 實際回應（2026-10-11，已精簡）
const STATIONS = {
  UpdateTime: '2026-10-11T00:00:00+08:00',
  Stations: [
    { StationID: '7000', StationName: { Zh_tw: '花蓮', En: 'Hualien' }, StationPosition: { PositionLon: 121.60131, PositionLat: 23.99265 }, StationAddress: '970花蓮縣花蓮市國聯一路100號' },
    { StationID: '7010', StationName: { Zh_tw: '北埔' }, StationPosition: { PositionLon: 121.6026, PositionLat: 24.0326 }, StationAddress: '971花蓮縣新城鄉北埔村' },
    { StationID: '1000', StationName: { Zh_tw: '臺北' }, StationPosition: { PositionLon: 121.51711, PositionLat: 25.04772 }, StationAddress: '100台北市中正區北平西路3號' },
    { StationID: '9999', StationName: { Zh_tw: '沒座標' } },
  ],
};
const HUALIEN = { lat: 23.99395, lng: 121.60093 };

test('countyFromAddress：台/臺都認得，郵遞區號不影響', () => {
  assert.equal(countyFromAddress('970花蓮縣花蓮市國聯一路100號'), '花蓮縣');
  assert.equal(countyFromAddress('100台北市中正區北平西路3號'), '臺北市');
  assert.equal(countyFromAddress('台東縣台東市'), '臺東縣');
  assert.equal(countyFromAddress('某處'), null);
  assert.equal(countyFromAddress(undefined), null);
  assert.equal(CITY_CODES['花蓮縣'], 'HualienCounty');
});

test('parseStations + nearestStations：丟掉沒座標的、依距離排序', () => {
  const st = parseStations(STATIONS);
  assert.equal(st.length, 3);
  const near = nearestStations(st, HUALIEN, 2);
  assert.deepEqual(near.map((s) => s.name), ['花蓮', '北埔']);
  assert.ok(near[0].distance < 500);
});

const TIMETABLE = {
  TrainDate: '2026-10-12',
  StationTimetables: [
    {
      Direction: 0,
      TimeTables: [
        { TrainNo: '422', DestinationStationID: '4340', DestinationStationName: { Zh_tw: '新左營' }, TrainTypeName: { Zh_tw: '自強(3000)' }, ArrivalTime: '13:01', DepartureTime: '13:06', SuspendedFlag: 0 },
        { TrainNo: '100', DestinationStationID: '1000', DestinationStationName: { Zh_tw: '臺北' }, TrainTypeName: { Zh_tw: '普悠瑪' }, ArrivalTime: '12:50', DepartureTime: '12:55', SuspendedFlag: 0 },
        { TrainNo: '200', DestinationStationID: '7000', DestinationStationName: { Zh_tw: '花蓮' }, TrainTypeName: { Zh_tw: '區間' }, ArrivalTime: '13:20', DepartureTime: '13:20', SuspendedFlag: 0 },
      ],
    },
    {
      Direction: 1,
      TimeTables: [
        { TrainNo: '300', DestinationStationID: '6000', DestinationStationName: { Zh_tw: '臺東' }, TrainTypeName: { Zh_tw: '莒光' }, DepartureTime: '13:30', SuspendedFlag: 0 },
        { TrainNo: '301', DestinationStationID: '6000', DestinationStationName: { Zh_tw: '臺東' }, TrainTypeName: { Zh_tw: '區間' }, DepartureTime: '13:40', SuspendedFlag: 1 },
      ],
    },
  ],
};
const LIVE = {
  StationLiveBoards: [
    { TrainNo: '100', DelayTime: 10, RunningStatus: 1 },
    { TrainNo: '422', DelayTime: 0, RunningStatus: 0 },
    { TrainNo: '300', DelayTime: 0, RunningStatus: 2 },
  ],
};

test('upcomingDepartures：跨方向合併排序、排除終點站是本站與停駛、誤點車還沒開就列出', () => {
  const live = parseLiveBoard(LIVE);
  const now = 13 * 60; // 13:00
  const rows = upcomingDepartures(TIMETABLE, '7000', now, live);
  assert.deepEqual(rows.map((r) => r.trainNo), ['100', '422', '300']);
  assert.equal(rows[0].delay, 10); // 12:55 表定、誤點 10 分 → 13:05 實際，仍列出
  assert.equal(rows[2].cancelled, true);
  assert.equal(rows[1].to, '新左營');
  assert.equal(rows[1].dep, '13:06');
});

test('upcomingDepartures：沒有即時資料也能用', () => {
  const rows = upcomingDepartures(TIMETABLE, '7000', 13 * 60 + 10);
  assert.deepEqual(rows.map((r) => r.trainNo), ['300']);
  assert.equal(upcomingDepartures(null, '7000', 0).length, 0);
});

const OD = {
  TrainDate: '2026-10-12',
  TrainTimetables: [
    { TrainInfo: { TrainNo: '408', TrainTypeName: { Zh_tw: '普悠瑪' }, SuspendedFlag: 0 }, StopTimes: [{ StationID: '7000', DepartureTime: '16:50' }, { StationID: '1000', ArrivalTime: '19:02' }] },
    { TrainInfo: { TrainNo: '402', TrainTypeName: { Zh_tw: '太魯閣' }, SuspendedFlag: 0 }, StopTimes: [{ StationID: '7000', DepartureTime: '08:00' }, { StationID: '1000', ArrivalTime: '10:10' }] },
    { TrainInfo: { TrainNo: '9', TrainTypeName: { Zh_tw: '莒光' }, SuspendedFlag: 0 }, StopTimes: [{ StationID: '7000', DepartureTime: '23:30' }, { StationID: '1000', ArrivalTime: '02:10' }] },
    { TrainInfo: { TrainNo: '7', TrainTypeName: { Zh_tw: '自強' }, SuspendedFlag: 1 }, StopTimes: [{ StationID: '7000', DepartureTime: '17:00' }, { StationID: '1000', ArrivalTime: '19:30' }] },
  ],
};

test('parseOdTrains：只列現在之後、排除停駛、跨午夜的行車時間正確', () => {
  const rows = parseOdTrains(OD, 12 * 60);
  assert.deepEqual(rows.map((r) => r.trainNo), ['408', '9']);
  assert.equal(rows[0].minutes, 132);
  assert.equal(rows[1].minutes, 160);
  assert.equal(rows[1].arr, '02:10');
});

test('groupBusStops：同名站牌合併（市區 + 公路客運）、依距離排序', () => {
  const city = [
    { StopUID: 'HUA298840', StopName: { Zh_tw: '花蓮轉運站' }, StopPosition: { PositionLat: 23.993063, PositionLon: 121.603181 } },
    { StopUID: 'HUA298841', StopName: { Zh_tw: '花蓮轉運站' }, StopPosition: { PositionLat: 23.99310, PositionLon: 121.60330 } },
    { StopUID: 'HUA300650', StopName: { Zh_tw: '市立圖書館' }, StopPosition: { PositionLat: 23.9960, PositionLon: 121.6040 } },
  ];
  const inter = [{ StopUID: 'THB307559', StopName: { Zh_tw: '花蓮轉運站' }, StopPosition: { PositionLat: 23.9931, PositionLon: 121.6032 } }];
  const g = groupBusStops(city, inter, HUALIEN);
  assert.equal(g.length, 2);
  assert.equal(g[0].name, '花蓮轉運站');
  assert.deepEqual(g[0].city, ['HUA298840', 'HUA298841']);
  assert.deepEqual(g[0].inter, ['THB307559']);
  assert.deepEqual(groupBusStops(null, undefined, HUALIEN), []);
});

test('parseBusEta：同路線同方向只留最快一班、沒有 EstimateTime 的顯示狀態', () => {
  const rows = [
    { RouteName: { Zh_tw: '301' }, SubRouteUID: 'HUA030102', Direction: 1, EstimateTime: 575, StopStatus: 0, StopName: { Zh_tw: '花蓮轉運站' } },
    { RouteName: { Zh_tw: '301' }, SubRouteUID: 'HUA030102', Direction: 1, EstimateTime: 1800, StopStatus: 0 },
    { RouteName: { Zh_tw: '1133' }, SubRouteUID: 'THB113301', Direction: 0, StopStatus: 1 },
    { RouteName: { Zh_tw: '310' }, SubRouteUID: 'HUA031001', Direction: 0, EstimateTime: 30, StopStatus: 0 },
    { RouteName: { Zh_tw: '308' }, SubRouteUID: 'HUA030801', Direction: 0, StopStatus: 3 },
  ];
  const out = parseBusEta(rows);
  assert.equal(out.length, 4); // 301 兩班合併成一筆
  assert.deepEqual(out.slice(0, 2).map((r) => r.route), ['310', '301']);
  assert.equal(busEtaText(out[0]), '進站中');
  assert.equal(out[1].eta, 575);
  assert.equal(busEtaText(out[1]), '10 分');
  const statuses = out.slice(2).map((r) => busEtaText(r)).sort();
  assert.deepEqual(statuses, ['尚未發車', '末班車已過'].sort());
});

test('parseWktPoint：正常、經緯度顛倒、格式錯誤、台灣以外', () => {
  assert.deepEqual(parseWktPoint('POINT (120.208544443471 22.9947581983557)'), { lat: 22.9947581983557, lng: 120.208544443471 });
  assert.deepEqual(parseWktPoint('POINT (23.99 121.60)'), { lat: 23.99, lng: 121.6 });
  assert.equal(parseWktPoint('LINESTRING (1 2, 3 4)'), null);
  assert.equal(parseWktPoint('POINT (0 0)'), null);
  assert.equal(parseWktPoint(undefined), null);
});

test('parseRoadEvents：只留範圍內、依距離排序、帶路段', () => {
  const json = {
    LiveEvents: [
      { EventID: 'far', EventTitle: '交通事故', EventType: 1, Positions: 'POINT (120.2085 22.9947)', Location: { FreeExpressHighway: { Road: '台20', StartKM: '13K+500' } } },
      { EventID: 'near', EventTitle: '', EventType: 6, Description: '台9線 蘇花 落石', Positions: 'POINT (121.65 24.10)', EffectiveTime: '2026-10-11T10:00:00+08:00', Location: { FreeExpressHighway: { Road: '台9', StartKM: '175K' } } },
      { EventID: 'nopos', EventType: 2 },
    ],
  };
  const ev = parseRoadEvents(json, HUALIEN, 60000);
  assert.deepEqual(ev.map((e) => e.id), ['near']);
  assert.equal(ev[0].title, '災害');
  assert.equal(ev[0].road, '台9 175K');
});

test('filterHighwayNews：依關鍵字篩、新的在前', () => {
  const json = {
    Newses: [
      { NewsID: 'a', Title: '台9線蘇花路廊 單線雙向管制', NewsCategory: 1, PublishTime: '2026-10-10T08:00:00+08:00' },
      { NewsID: 'b', Title: '台3線 施工', Description: '苗栗', NewsCategory: 4, PublishTime: '2026-10-11T08:00:00+08:00' },
      { NewsID: 'c', Title: '台11線 施工', Description: '花蓮縣豐濱鄉', NewsCategory: 4, PublishTime: '2026-10-11T09:00:00+08:00' },
    ],
  };
  const out = filterHighwayNews(json, ['花蓮', '蘇花']);
  assert.deepEqual(out.map((n) => n.id), ['c', 'a']);
  assert.equal(out[0].category, '施工');
});

test('createTdx：有 storage 時車站清單寫入本機快取；storage=null（示範模式）不寫入、照常運作', async () => {
  const realFetch = globalThis.fetch;
  const fake = () => {
    const m = new Map();
    return { m, get length() { return m.size; }, key: (i) => [...m.keys()][i], getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, v), removeItem: (k) => m.delete(k) };
  };
  try {
    let calls = 0;
    globalThis.fetch = async () => { calls++; return new Response(JSON.stringify(STATIONS), { status: 200 }); };
    const st = fake();
    assert.equal((await createTdx({ storage: st }).stations()).length, 3);
    assert.equal([...st.m.keys()].filter((k) => k.startsWith('gotrip.tdxcache:')).length, 1);
    // 新的 client 讀得到快取，不再打 API
    assert.equal((await createTdx({ storage: st }).stations()).length, 3);
    assert.equal(calls, 1);

    assert.equal((await createTdx({ storage: null }).stations()).length, 3);
    assert.equal(calls, 2);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('createTdx：429 依有無帳號給不同的中文提示', async () => {
  const realFetch = globalThis.fetch;
  try {
    globalThis.fetch = async () => new Response('', { status: 429 });
    await assert.rejects(createTdx({ storage: null }).roadEvents(), /免登入額度/);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('tdxUrl：$ 參數保留、值做 URL 編碼、一定帶 $format=JSON', () => {
  const u = tdxUrl('/v2/Bus/EstimatedTimeOfArrival/InterCity', { $filter: "StopUID in ('THB1','THB2')" });
  assert.ok(u.startsWith('https://tdx.transportdata.tw/api/basic/v2/Bus/EstimatedTimeOfArrival/InterCity?$filter='));
  assert.ok(u.endsWith('&$format=JSON'));
  assert.ok(!u.includes(' '));
  assert.equal(new URL(u).searchParams.get('$filter'), "StopUID in ('THB1','THB2')");
});
