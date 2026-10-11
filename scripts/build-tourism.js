// 下載觀光署「觀光資訊資料庫」景點與活動，整理成 data/tourism/ 的小檔。
// 用法：node scripts/build-tourism.js            （從觀光署下載）
//      node scripts/build-tourism.js <資料夾>    （用已下載的 Attraction-json.zip / Event-json.zip）
// GitHub Actions 每天跑一次（.github/workflows/update-tourism.yml）。
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { unzip, parseJsonBuf, buildTourism } from './tourism-lib.js';

const SRC = 'https://media.taiwan.net.tw/XMLReleaseAll_public/v2.0/Zh_tw';
const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'data', 'tourism');

async function load(name, dir) {
  if (dir) return readFileSync(join(dir, `${name}-json.zip`));
  const res = await fetch(`${SRC}/${name}-json.zip`, { headers: { 'User-Agent': 'GoTrip data builder (+https://github.com/kkboy55606/gotrip)' } });
  if (!res.ok) throw new Error(`下載 ${name} 失敗：HTTP ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

const twToday = () => new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10);

async function main() {
  const dir = process.argv[2];
  const attr = unzip(await load('Attraction', dir));
  const evt = unzip(await load('Event', dir));
  const list = parseJsonBuf(attr['AttractionList.json']);
  const result = buildTourism({
    attractions: list.Attractions,
    serviceTimes: parseJsonBuf(attr['AttractionServiceTimeList.json']).AttractionServiceTimes,
    fees: parseJsonBuf(attr['AttractionFeeList.json']).AttractionFees,
    events: parseJsonBuf(evt['EventList.json']).Events,
    updateTime: list.UpdateTime,
    today: twToday(),
  });

  rmSync(OUT, { recursive: true, force: true });
  mkdirSync(join(OUT, 'spots'), { recursive: true });
  for (const [key, spots] of Object.entries(result.tiles)) {
    writeFileSync(join(OUT, 'spots', `${key}.json`), JSON.stringify(spots));
  }
  writeFileSync(join(OUT, 'events.json'), JSON.stringify({ updateTime: result.index.updateTime, events: result.events }));
  writeFileSync(join(OUT, 'index.json'), `${JSON.stringify(result.index, null, 1)}\n`);
  const { spots, skippedNotOperating, events, tiles } = result.index;
  console.log(`景點 ${spots}（排除非正常營運 ${skippedNotOperating}）、${tiles.length} 個格子；活動 ${events}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
