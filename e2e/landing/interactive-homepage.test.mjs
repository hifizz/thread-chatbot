import assert from 'node:assert/strict'
import test from 'node:test'
import { scenarios } from '../../constants/landing-demo.ts'
import { viewAt } from '../../components/landing/hero-demo/use-demo-sequence.ts'

test('all six scripts can branch twice without missing source questions', () => {
  assert.equal(scenarios.length, 6)
  for (const scenario of scenarios) {
    assert.equal(scenario.lanes.length, 3)
    for (const time of [0, 5000, 7000, 9999, 10000, 16000, 18000, 20999, 21000, 28000, 32000, 42000]) {
      const view = viewAt(scenario, time)
      assert.ok(view.visible >= 1 && view.visible <= scenario.lanes.length)
      if (view.overlay !== 'none') {
        assert.ok(scenario.lanes[view.source].anchor)
        assert.ok(scenario.lanes[view.source + 1].question)
      }
    }
    const final = viewAt(scenario, 42000)
    assert.equal(final.visible, 3)
    assert.ok(final.ready.every(Boolean))
    assert.deepEqual(final.texts, scenario.lanes.map(lane => lane.text))
  }
})

test('technical script creates the artifact before selection and main-thread reuse', () => {
  const scenario = scenarios.find(s => s.id === 'technical')
  assert.ok(scenario?.artifact)
  assert.equal(viewAt(scenario, 32000).artifactReady, false)
  const picker = viewAt(scenario, 35000)
  assert.equal(picker.artifactReady, true)
  assert.equal(picker.mentionOpen, true)
  assert.equal(picker.returned, false)
  const selected = viewAt(scenario, 37000)
  assert.equal(selected.referenceSelected, true)
  assert.equal(selected.mentionOpen, false)
  assert.equal(selected.returned, false)
  assert.equal(viewAt(scenario, 40000).returned, true)
  assert.equal(viewAt(scenario, 0).referenceSelected, false)
})

test('homepage renders public content and real entry without a repository link or fake signup', async () => {
  const { createElement } = await import('react')
  const { renderToStaticMarkup } = await import('react-dom/server')
  const { default: Landing } = await import('../../components/landing/landing.tsx')
  const html = renderToStaticMarkup(createElement(Landing))
  assert.ok(html.includes('能开分叉'))
  assert.ok(html.includes('href="/start-chat"'))
  assert.ok(html.includes('href="/privacy"'))
  assert.ok(html.includes('href="/terms"'))
  assert.ok(!html.includes('github.com/hifizz'))
  assert.ok(!html.includes('GitHub'))
  assert.ok(!html.includes('type="email"'))
})
