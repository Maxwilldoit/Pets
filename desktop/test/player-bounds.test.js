// 窗口尺寸回归：布局必须按「每一帧真实的不透明区域」算，而不是都按第 0 帧量。
// 动图（DecodedAnim）布局时只缓存第 0 帧，source(i) 会退回第 0 帧——
// 所以解码时就要把每帧包围盒量好存在 frame.bounds 上，布局直接用。
// 这里用假 ImageDecoder / OffscreenCanvas 走真实的 loadAnimation → computeLayout 路径。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeLayout, loadAnimation, opaqueBounds } from '../src/renderer/lib/player.js';

// 假图：__rects 是不透明矩形 [x0, y0, x1, y1, alpha?]，默认 alpha 255。
class FakeImage {
  constructor(w, h, rects) {
    this.naturalWidth = w;
    this.naturalHeight = h;
    this.displayWidth = w;
    this.displayHeight = h;
    this.__rects = rects;
  }
  close() {}
}

// player.js 用 OffscreenCanvas 量像素。drawImage 兼容 5 参（整帧）与 9 参（精灵表单元格）。
globalThis.OffscreenCanvas = class {
  constructor(w, h) {
    this.width = w;
    this.height = h;
  }
  getContext() {
    const self = this;
    return {
      drawImage(img, ...args) {
        self.__img = img;
        self.__sx = args.length >= 8 ? args[0] : 0;
        self.__sy = args.length >= 8 ? args[1] : 0;
      },
      getImageData(_x, _y, w, h) {
        const data = new Uint8ClampedArray(w * h * 4);
        for (const [x0, y0, x1, y1, alpha = 255] of self.__img?.__rects ?? []) {
          for (let y = Math.max(0, y0 - self.__sy); y < Math.min(h, y1 - self.__sy); y++) {
            for (let x = Math.max(0, x0 - self.__sx); x < Math.min(w, x1 - self.__sx); x++) {
              data[(y * w + x) * 4 + 3] = alpha;
            }
          }
        }
        return { data };
      },
    };
  }
};

// 假 ImageDecoder：按 frameIndex 返回假图，并记录解码次数。
let pendingFrames = [];
let lastDecoder = null;
globalThis.ImageDecoder = class {
  static async isTypeSupported() { return true; }
  constructor({ data }) {
    this.__frames = data.__frames;
    this.decodeCalls = 0;
    this.tracks = { ready: Promise.resolve(), selectedTrack: { frameCount: this.__frames.length } };
    this.completed = Promise.resolve();
    lastDecoder = this;
  }
  async decode({ frameIndex }) {
    this.decodeCalls++;
    return { image: this.__frames[frameIndex] };
  }
  close() {}
};
globalThis.fetch = async () => ({ ok: true, arrayBuffer: async () => ({ __frames: pendingFrames }) });

// 序列帧 / 精灵表走 loadImage(new Image())，按 URL 查假图。
const imagesByUrl = new Map();
globalThis.Image = class {
  set src(url) {
    const img = imagesByUrl.get(url);
    if (!img) throw new Error('no fake image for ' + url);
    this.naturalWidth = img.naturalWidth;
    this.naturalHeight = img.naturalHeight;
    this.__rects = img.__rects;
  }
  async decode() {}
};

/** 按 drawFrame 的几何关系断言：每个动画的每一帧都完整落在舞台里。 */
function assertCoversAllFrames(layout, anims, scale) {
  for (const [name, a] of Object.entries(anims)) {
    const [ax, ay] = layout.anchors[name];
    for (let i = 0; i < a.frames.length; i++) {
      const b = a.frames[i].bounds ?? opaqueBounds(a, i);
      const left = layout.stage.ax + (b.x0 - ax) * scale;
      const right = layout.stage.ax + (b.x1 - ax) * scale;
      const top = layout.stage.ay + (b.y0 - ay) * scale;
      const bottom = layout.stage.ay + (b.y1 - ay) * scale;
      assert.ok(left >= 0 && right <= layout.stage.w, `${name} 帧 ${i} 水平被裁：[${left}, ${right}] 超出 [0, ${layout.stage.w}]`);
      assert.ok(top >= 0 && bottom <= layout.stage.h, `${name} 帧 ${i} 垂直被裁：[${top}, ${bottom}] 超出 [0, ${layout.stage.h}]`);
    }
  }
}

test('动图逐帧量边界：首帧小、后续帧向上向侧面伸出，舞台仍装得下每一帧', async () => {
  const f0 = new FakeImage(64, 64, [[24, 40, 40, 60]]); // 首帧：中间一小块
  const f1 = new FakeImage(64, 64, [[4, 8, 60, 60]]); // 第二帧：向上、向两侧伸出
  pendingFrames = [f0, f1];
  const idle = await loadAnimation({ src: 'pet.gif' }, 'base/');
  assert.deepEqual(idle.frames[0].bounds, { x0: 24, y0: 40, x1: 40, y1: 60 });
  assert.deepEqual(idle.frames[1].bounds, { x0: 4, y0: 8, x1: 60, y1: 60 });

  const pet = { animations: { idle: {} } };
  const decodesAfterLoad = lastDecoder.decodeCalls;
  for (const scale of [1, 1.5, 0.75]) {
    assertCoversAllFrames(computeLayout(pet, { idle }, scale), { idle }, scale);
  }
  assert.equal(lastDecoder.decodeCalls, decodesAfterLoad, '布局不应触发额外解码');

  // 若所有帧都按第 0 帧量，舞台只有 18px 宽；按最大帧量应是 56 + 2px 余量。
  const layout = computeLayout(pet, { idle }, 1);
  assert.deepEqual(layout.stage, { w: 58, h: 54, ax: 29, ay: 53 });
});

test('低透明度边缘（光晕/影子）算进布局，不被裁掉', async () => {
  const core = [10, 10, 30, 30, 255];
  const f0 = new FakeImage(40, 40, [core]);
  const f1 = new FakeImage(40, 40, [[2, 2, 38, 38, 12], core]); // 外圈 alpha=12 的光晕
  pendingFrames = [f0, f1];
  const idle = await loadAnimation({ src: 'pet.gif' }, 'base/');
  assert.deepEqual(idle.frames[1].bounds, { x0: 2, y0: 2, x1: 38, y1: 38 });
  assertCoversAllFrames(computeLayout({ animations: { idle: {} } }, { idle }, 1), { idle }, 1);
});

test('opaqueBounds 用 alpha > 0：只有低透明度像素的帧也有边界', () => {
  const img = new FakeImage(20, 20, [[4, 4, 16, 16, 10]]);
  const a = {
    box: { w: 20, h: 20 },
    frames: [{ img, w: 20, h: 20, x: 0, y: 0 }],
    source: () => ({ image: img, sx: 0, sy: 0 }),
  };
  assert.deepEqual(opaqueBounds(a, 0), { x0: 4, y0: 4, x1: 16, y1: 16 });
});

test('精灵表路径仍按每个单元格量边界', async () => {
  imagesByUrl.set('base/sheet.png', new FakeImage(40, 20, [[2, 2, 18, 18], [20, 0, 40, 20]]));
  const idle = await loadAnimation({ kind: 'sheet', sheet: { src: 'sheet.png', cell: [20, 20], row: 0, col: 0, count: 2 }, frameMs: 100 }, 'base/');
  assert.deepEqual(opaqueBounds(idle, 1), { x0: 0, y0: 0, x1: 20, y1: 20 });
  assertCoversAllFrames(computeLayout({ animations: { idle: {} } }, { idle }, 1), { idle }, 1);
});

test('序列帧路径仍按每帧实际图像量边界', async () => {
  imagesByUrl.set('base/a.png', new FakeImage(20, 30, [[5, 10, 15, 30]]));
  imagesByUrl.set('base/b.png', new FakeImage(20, 30, [[0, 0, 20, 20]]));
  const idle = await loadAnimation({
    kind: 'frames',
    frames: [
      { src: 'a.png', duration: 100, offset: [0, 0] },
      { src: 'b.png', duration: 100, offset: [0, 0] },
    ],
  }, 'base/');
  assertCoversAllFrames(computeLayout({ animations: { idle: {} } }, { idle }, 1), { idle }, 1);
});
