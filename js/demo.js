// 示範模式（網址加 ?demo=1）：攔截 fetch，對「需要帳號或有每日額度」的 API 回傳格式相同的假資料：
// 中央氣象署（需授權碼）、TDX（免登入每天只有 20 次）。附近地點、路線、地圖仍用真實的免費服務。
// 所有假資料都標「示範」。

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });

// ---------- TDX 假資料 ----------

const TRA_STATIONS = [
  ['7000', '花蓮', 23.99265, 121.60131, '970花蓮縣花蓮市國聯一路100號'],
  ['7010', '北埔', 24.0326, 121.6026, '971花蓮縣新城鄉'],
  ['6250', '吉安', 23.9653, 121.5889, '973花蓮縣吉安鄉'],
  ['1000', '臺北', 25.04772, 121.51711, '100台北市中正區北平西路3號'],
  ['7360', '宜蘭', 24.7546, 121.758, '260宜蘭縣宜蘭市光復路1號'],
  ['6000', '臺東', 22.7937, 121.123, '950台東縣台東市岩灣里'],
].map(([id, name, lat, lng, addr]) => ({
  StationID: id, StationName: { Zh_tw: name }, StationPosition: { PositionLat: lat, PositionLon: lng }, StationAddress: addr,
}));

const hm = (min) => `${String(Math.floor(min / 60) % 24).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;
const twNowMin = () => {
  const t = new Date(Date.now() + 8 * 3600e3);
  return t.getUTCHours() * 60 + t.getUTCMinutes();
};

function fakeTimetable(stationId) {
  const now = twNowMin();
  const mk = (i, dir, to, type) => ({
    TrainNo: String(400 + i), DestinationStationID: to.id, DestinationStationName: { Zh_tw: to.name },
    TrainTypeName: { Zh_tw: type }, DepartureTime: hm(now - 10 + i * 17), SuspendedFlag: 0,
  });
  return {
    TrainDate: '', StationTimetables: [
      { Direction: 0, TimeTables: [0, 2, 4, 6].map((i) => mk(i, 0, { id: '1000', name: '臺北' }, ['普悠瑪', '太魯閣', '自強(3000)', '區間'][i / 2])) },
      { Direction: 1, TimeTables: [1, 3, 5].map((i) => mk(i, 1, { id: '6000', name: '臺東' }, ['莒光', '區間快', '自強'][(i - 1) / 2])) },
    ].map((g) => ({ ...g, StationID: stationId })),
  };
}

function fakeOd() {
  const now = twNowMin();
  return {
    TrainTimetables: [0, 1, 2, 3].map((i) => ({
      TrainInfo: { TrainNo: String(410 + i * 2), TrainTypeName: { Zh_tw: ['普悠瑪', '自強(3000)', '太魯閣', '莒光'][i] }, SuspendedFlag: 0 },
      StopTimes: [{ DepartureTime: hm(now + 15 + i * 50) }, { ArrivalTime: hm(now + 15 + i * 50 + 125 + i * 20) }],
    })),
  };
}

function fakeBusStops(url, kind) {
  const m = /nearby\(([\d.]+),([\d.]+),/.exec(decodeURIComponent(url));
  if (!m) return [];
  const lat = Number(m[1]);
  const lng = Number(m[2]);
  const mk = (uid, name, dLat, dLng) => ({ StopUID: uid, StopName: { Zh_tw: name }, StopPosition: { PositionLat: lat + dLat, PositionLon: lng + dLng } });
  return kind === 'city'
    ? [mk('HUA1', '示範轉運站', 0.0008, 0.0012), mk('HUA2', '示範轉運站', 0.0009, 0.0013), mk('HUA3', '示範圖書館', 0.002, -0.001)]
    : [mk('THB1', '示範轉運站', 0.0008, 0.0011)];
}

function fakeEta(url) {
  const f = decodeURIComponent(url);
  const rows = [];
  const add = (uid, route, dir, extra) => f.includes(`'${uid}'`) && rows.push({ StopUID: uid, RouteName: { Zh_tw: route }, SubRouteUID: `${route}-${dir}`, Direction: dir, ...extra });
  add('HUA1', '301', 0, { EstimateTime: 45, StopStatus: 0 });
  add('HUA2', '310', 1, { EstimateTime: 640, StopStatus: 0 });
  add('HUA1', '308', 0, { StopStatus: 1 });
  add('HUA3', '303', 0, { EstimateTime: 1320, StopStatus: 0, IsLastBus: true });
  add('THB1', '1133', 0, { EstimateTime: 900, StopStatus: 0 });
  add('THB1', '1140', 1, { StopStatus: 3 });
  return rows;
}

function fakeRoadEvents(center) {
  const p = (dLat, dLng) => `POINT (${(center.lng + dLng).toFixed(5)} ${(center.lat + dLat).toFixed(5)})`;
  return {
    LiveEvents: [
      { EventID: 'demo-ev1', EventTitle: '落石', EventType: 6, Description: '示範：台9線 某處落石，單線雙向通行', Positions: p(0.12, 0.03), Location: { FreeExpressHighway: { Road: '台9', StartKM: '180K+200' } } },
      { EventID: 'demo-ev2', EventTitle: '道路施工', EventType: 2, Description: '示範：台11線 路面刨鋪，請減速慢行', Positions: p(-0.2, 0.05), Location: { FreeExpressHighway: { Road: '台11', StartKM: '12K' } } },
    ],
  };
}

const FAKE_NEWS = {
  Newses: [
    { NewsID: 'demo-n1', Title: '示範：台9線蘇花路廊 夜間單線管制', NewsCategory: 1, Description: '示範資料，非真實公告。', PublishTime: new Date().toISOString() },
  ],
};

// ---------- 中央氣象署假資料 ----------
// 由 weather.js 的 demo 介面提供（見 weather.js demoResponse）

export function installDemo() {
  const realFetch = window.fetch.bind(window);
  const lastCenter = () => {
    try {
      return JSON.parse(localStorage.getItem('gotrip.settings.v1')).lastCenter ?? { lat: 23.99395, lng: 121.60093 };
    } catch {
      return { lat: 23.99395, lng: 121.60093 };
    }
  };

  window.fetch = async (input, init = {}) => {
    const url = typeof input === 'string' ? input : input.url;
    if (!url.includes('tdx.transportdata.tw') && !url.includes('opendata.cwa.gov.tw')) return realFetch(input, init);
    await new Promise((r) => setTimeout(r, 250)); // 模擬網路延遲

    if (url.includes('tdx.transportdata.tw')) {
      if (url.includes('/token')) return json({ access_token: 'demo', expires_in: 86400, token_type: 'Bearer' });
      if (url.includes('/Rail/TRA/Station?')) return json({ Stations: TRA_STATIONS });
      if (url.includes('DailyStationTimetable')) return json(fakeTimetable(/Station\/(\d+)/.exec(url)[1]));
      if (url.includes('StationLiveBoard')) return json({ StationLiveBoards: [{ TrainNo: '400', DelayTime: 5, RunningStatus: 1 }, { TrainNo: '402', DelayTime: 0, RunningStatus: 0 }] });
      if (url.includes('DailyTrainTimetable/OD')) return json(fakeOd());
      if (url.includes('/Bus/Stop/City/')) return json(fakeBusStops(url, 'city'));
      if (url.includes('/Bus/Stop/InterCity')) return json(fakeBusStops(url, 'inter'));
      if (url.includes('EstimatedTimeOfArrival')) return json(fakeEta(url));
      if (url.includes('RoadEvent/LiveEvent')) return json(fakeRoadEvents(lastCenter()));
      if (url.includes('Live/News/Highway')) return json(FAKE_NEWS);
      return json({ message: 'demo: unknown TDX endpoint' }, 404);
    }

    if (url.includes('opendata.cwa.gov.tw')) {
      const { demoResponse } = await import('./weather.js');
      return json(demoResponse(url, lastCenter()));
    }

    return realFetch(input, init);
  };
}
