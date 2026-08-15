// node --test src/store.test.ts
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  applyDrag,
  buildRows,
  parseItems,
  rowId,
  safeUrl,
  type Category,
  type Item,
  type Urgency,
} from './store.ts'
import { decide, validRepo, type Remote } from './github.ts'

const mk = (id: string, urgency: Urgency, category: Category = 'Gear'): Item => ({
  id,
  title: id,
  category,
  urgency,
  bought: false,
})

const shape = (items: Item[]) => items.map((i) => `${i.urgency}:${i.id}`)
const at = (items: Item[], id: string) => buildRows(items).findIndex((r) => rowId(r) === id)

test('drag across a section boundary rewrites urgency', () => {
  const items = [mk('a', 'Now'), mk('b', 'Later')]
  const rows = buildRows(items)
  // drop 'b' onto 'a' -> b lands under the Now header
  const out = applyDrag(items, rows, at(items, 'b'), at(items, 'a'))
  assert.deepEqual(shape(out), ['Now:b', 'Now:a'])
})

test('drag into an empty section lands on that section, not the one above', () => {
  const items = [mk('a', 'Now'), mk('b', 'Now')]
  const rows = buildRows(items)
  const out = applyDrag(items, rows, at(items, 'b'), at(items, 'ghost:Later'))
  assert.deepEqual(shape(out), ['Now:a', 'Later:b'])
})

test('reorder inside a section keeps urgency', () => {
  const items = [mk('a', 'Soon'), mk('b', 'Soon'), mk('c', 'Soon')]
  const rows = buildRows(items)
  const out = applyDrag(items, rows, at(items, 'c'), at(items, 'a'))
  assert.deepEqual(shape(out), ['Soon:c', 'Soon:a', 'Soon:b'])
})

test('items hidden by a category filter keep their place', () => {
  const items = [mk('gear1', 'Now'), mk('lego1', 'Now', 'Lego'), mk('gear2', 'Now')]
  const visible = items.filter((i) => i.category === 'Gear') // Lego filtered out
  const rows = buildRows(visible)
  const out = applyDrag(items, rows, at(visible, 'gear2'), at(visible, 'gear1'))
  // lego1 must not move out of index 1, and must not be dropped
  assert.deepEqual(
    out.map((i) => i.id),
    ['gear2', 'lego1', 'gear1'],
  )
  assert.equal(out.length, 3)
})

const remote = (json: string, sha: string): Remote => ({ items: [], json, sha })

test('decide: only this machine changed -> push', () => {
  assert.equal(decide('[2]', remote('[1]', 'sha1'), { sha: 'sha1', json: '[1]' }), 'push-local')
})

test('decide: only the other machine changed -> take remote', () => {
  assert.equal(decide('[1]', remote('[2]', 'sha2'), { sha: 'sha1', json: '[1]' }), 'take-remote')
})

test('decide: both changed -> conflict, never a silent overwrite', () => {
  assert.equal(decide('[3]', remote('[2]', 'sha2'), { sha: 'sha1', json: '[1]' }), 'conflict')
})

test('decide: identical content is never a conflict', () => {
  assert.equal(decide('[9]', remote('[9]', 'sha2'), { sha: 'sha1', json: '[1]' }), 'up-to-date')
})

test('decide: first run on a fresh machine pulls instead of wiping the repo', () => {
  assert.equal(decide('[]', remote('[1]', 'sha1'), null), 'take-remote')
  // but a non-empty local list with no sync history must still ask
  assert.equal(decide('[2]', remote('[1]', 'sha1'), null), 'conflict')
})

test('decide: missing file in repo gets created, empty list stays quiet', () => {
  assert.equal(decide('[1]', null, null), 'push-local')
  assert.equal(decide('[]', null, null), 'up-to-date')
})

test('validRepo', () => {
  assert.ok(validRepo('blake/buy-next'))
  assert.ok(!validRepo('buy-next'))
  assert.ok(!validRepo('a/b/c'))
  assert.ok(!validRepo('a b/c'))
})

test('safeUrl blocks script URLs, keeps http(s), assumes https', () => {
  assert.equal(safeUrl('javascript:alert(1)'), undefined)
  assert.equal(safeUrl('  JavaScript:alert(1)'), undefined)
  assert.equal(safeUrl('data:text/html,<script>'), undefined)
  assert.equal(safeUrl('https://amazon.in/x'), 'https://amazon.in/x')
  assert.equal(safeUrl('amazon.in/x'), 'https://amazon.in/x')
  assert.equal(safeUrl(''), undefined)
})

test('parseItems strips a javascript: link from an imported file', () => {
  const [item] = parseItems([{ title: 'trap', link: 'javascript:fetch(evil)' }])
  assert.equal(item.link, undefined)
})

test('parseItems drops junk and fills defaults', () => {
  const out = parseItems([
    { title: 'ok' },
    { title: '   ' },
    null,
    'nope',
    { title: 'weird', category: 'Nope', urgency: 'Whenever', price: 'free' },
  ])
  assert.equal(out.length, 2)
  assert.equal(out[0].category, 'Gear')
  assert.equal(out[0].urgency, 'Later')
  assert.equal(out[1].price, undefined)
  assert.ok(out[0].id)
})
