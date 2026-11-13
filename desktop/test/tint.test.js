import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dominantColor } from '../src/renderer/lib/tint.js';

/** 铺一块纯色（带 alpha）。 */
function fill(data, x0, y0, x1, y1, w, [r, g, b, a = 255]) {
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const i = (y * w + x) * 4;
      data[i] = r;
      data[i + 1] = g;
      data[i + 2] = b;
      data[i + 3] = a;
    }
  }
}

test('全透明返回 null', () => {
  assert.equal(dominantColor(new Uint8ClampedArray(16 * 16 * 4)), null);
});

test('取面积最大的饱和色，透明像素不参与', () => {
  const w = 32;
  const data = new Uint8ClampedArray(w * w * 4);
  fill(data, 0, 0, 20, 20, w, [234, 88, 12]); // 橘色主体
  fill(data, 20, 0, 26, 20, w, [40, 40, 200]); // 少量蓝色
  const c = dominantColor(data);
  assert.ok(c.r > 200 && c.g < 120 && c.b < 60, JSON.stringify(c));
});

test('近白与近黑的大面积中性色不会胜出', () => {
  const w = 32;
  const data = new Uint8ClampedArray(w * w * 4);
  fill(data, 0, 0, 32, 24, w, [250, 250, 250]); // 白衬衫
  fill(data, 0, 24, 32, 30, w, [10, 10, 10]); // 黑裤子
  fill(data, 8, 4, 16, 12, w, [190, 40, 40]); // 红发
  const c = dominantColor(data);
  assert.ok(c.r > 150 && c.g < 90 && c.b < 90, JSON.stringify(c));
});

test('半透明像素按 alpha 加权，低于阈值的忽略', () => {
  const w = 8;
  const data = new Uint8ClampedArray(w * w * 4);
  fill(data, 0, 0, 8, 8, w, [0, 150, 0, 100]); // 低于 alpha 阈值
  assert.equal(dominantColor(data), null);
  fill(data, 0, 0, 8, 8, w, [0, 150, 0, 255]);
  const c = dominantColor(data);
  assert.deepEqual(c, { r: 0, g: 150, b: 0 });
});
