// 运行：node --import tsx e2e/thread-chat/mermaid-viewport.test.mjs
import assert from "node:assert/strict"
import { test } from "node:test"
import { automaticDiagramScale, constrainDiagram, fitDiagram, zoomDiagram } from "../../lib/markdown/mermaid-viewport.ts"

test("普通图自动完整显示，小图不自动放大", () => {
  const image = { width: 400, height: 300 }
  const canvas = { width: 342, height: 400 }
  const scale = automaticDiagramScale(image, canvas)
  assert.ok(image.width * scale <= canvas.width - 32)
  assert.ok(image.height * scale <= canvas.height - 32)
  assert.equal(automaticDiagramScale({ width: 100, height: 80 }, canvas), 1)
})

test("极端横图和竖图默认不低于 70%，主动适应时完整显示", () => {
  const canvas = { width: 342, height: 480 }
  for (const image of [{ width: 10000, height: 120 }, { width: 120, height: 10000 }]) {
    assert.equal(automaticDiagramScale(image, canvas), 0.7)
    const fit = fitDiagram(image, canvas)
    assert.ok(fit < 0.1, "显式适应应支持超过十倍宽高差")
    const view = constrainDiagram({ scale: fit, x: -9999, y: 9999 }, image, canvas)
    assert.ok(view.x >= 15.999 && view.y >= 15.999)
    assert.ok(view.x + image.width * fit <= canvas.width - 15.999)
    assert.ok(view.y + image.height * fit <= canvas.height - 15.999)
  }
})

test("任意拖动不会丢失整张图，两端可到达", () => {
  const image = { width: 2400, height: 1800 }
  const canvas = { width: 342, height: 480 }
  const start = constrainDiagram({ scale: 0.7, x: 1e6, y: 1e6 }, image, canvas)
  const end = constrainDiagram({ scale: 0.7, x: -1e6, y: -1e6 }, image, canvas)
  assert.equal(start.x, 16)
  assert.equal(start.y, 16)
  assert.equal(end.x + image.width * end.scale, canvas.width - 16)
  assert.equal(end.y + image.height * end.scale, canvas.height - 16)
})

test("连续缩放保留手指或画布中心对应的图中位置", () => {
  const anchor = { x: 172, y: 200 }
  let view = { scale: 0.7, x: -100, y: -50 }
  const imagePoint = { x: (anchor.x - view.x) / view.scale, y: (anchor.y - view.y) / view.scale }
  for (const scale of [1, 2, 4, 0.2, 0.7]) {
    view = zoomDiagram(view, scale, anchor)
    assert.ok(Math.abs((anchor.x - view.x) / scale - imagePoint.x) < 1e-9)
    assert.ok(Math.abs((anchor.y - view.y) / scale - imagePoint.y) < 1e-9)
  }
})

test("分栏变窄只约束位置，不重置用户缩放", () => {
  const image = { width: 800, height: 600 }
  const view = constrainDiagram({ scale: 1.75, x: -300, y: -200 }, image, { width: 320, height: 400 })
  assert.equal(view.scale, 1.75)
  assert.equal(view.x, -300)
  assert.equal(view.y, -200)
})
