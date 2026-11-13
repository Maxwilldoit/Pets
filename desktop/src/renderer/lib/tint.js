// 从立绘像素里取一个代表色，给格子/舞台做淡色底。纯函数：像素由调用方用 canvas 采样。

/**
 * 取不透明像素的主色（按饱和度加权的量化直方图）。
 * 跳过近白与近黑的像素：白衬衫、黑头发这类大面积中性色会把底色染脏，
 * 让饱和度高的主体色（红发、橘壳、紫甲）胜出。全透明时返回 null。
 * @param {Uint8ClampedArray|number[]} data RGBA 像素
 * @returns {{r:number,g:number,b:number}|null}
 */
export function dominantColor(data) {
  const buckets = new Map();
  for (let i = 0; i < data.length; i += 4) {
    const a = data[i + 3];
    if (a < 128) continue;
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const sat = max - min;
    if (min > 235 && sat < 30) continue; // 近白
    if (max < 48) continue; // 近黑
    const weight = a * (0.25 + sat / 255);
    const key = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4);
    let e = buckets.get(key);
    if (!e) buckets.set(key, (e = { w: 0, r: 0, g: 0, b: 0 }));
    e.w += weight;
    e.r += r * weight;
    e.g += g * weight;
    e.b += b * weight;
  }
  let best = null;
  for (const e of buckets.values()) if (!best || e.w > best.w) best = e;
  if (!best) return null;
  return { r: Math.round(best.r / best.w), g: Math.round(best.g / best.w), b: Math.round(best.b / best.w) };
}
