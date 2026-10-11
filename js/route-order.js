// 收藏清單「排順路」：從出發點走完所有點、不必回到原點的最短順序（近似解）
// 用直線距離估算：最近鄰居先排出初始順序，再用 2-opt 反覆消除交叉。純前端計算、不花 API 費用。

import { haversine } from './geo.js';

/** 路徑總長（公尺）：start → points[0] → points[1] … */
export function pathLength(start, points) {
  let total = 0;
  let prev = start;
  for (const p of points) {
    total += haversine(prev, p);
    prev = p;
  }
  return total;
}

function nearestNeighbor(start, points) {
  const left = [...points];
  const order = [];
  let cur = start;
  while (left.length) {
    let best = 0;
    let bestD = Infinity;
    left.forEach((p, i) => {
      const d = haversine(cur, p);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    });
    cur = left.splice(best, 1)[0];
    order.push(cur);
  }
  return order;
}

/** 回傳新的排序陣列與總長，不修改輸入 */
export function orderStops(start, points) {
  if (points.length < 2) return { order: [...points], meters: pathLength(start, points) };
  let order = nearestNeighbor(start, points);
  let best = pathLength(start, order);
  let improved = true;
  while (improved) {
    improved = false;
    for (let i = 0; i < order.length - 1; i++) {
      for (let k = i + 1; k < order.length; k++) {
        const candidate = [...order.slice(0, i), ...order.slice(i, k + 1).reverse(), ...order.slice(k + 1)];
        const len = pathLength(start, candidate);
        if (len + 1e-6 < best) {
          order = candidate;
          best = len;
          improved = true;
        }
      }
    }
  }
  return { order, meters: best };
}
