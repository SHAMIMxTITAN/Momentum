// node --test src/store.test.ts
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  applyItemDrag,
  applyTodoDrag,
  buildItemRows,
  buildTodoRows,
  cleanTag,
  monthlySpend,
  parseItems,
  parseTodos,
  rowId,
  safeUrl,
  type Item,
  type Kind,
  type Todo,
  type Urgency,
  type When,
} from './store.ts'
import { decide, todosPath, upToDateBase, validRepo, type Remote } from './github.ts'

const mk = (id: string, urgency: Urgency, kind: Kind = 'Need', tag?: string): Item => ({
  id,
  title: id,
  kind,
  tag,
  urgency,
  bought: false,
})

const shape = (items: Item[]) => items.map((i) => `${i.urgency}:${i.id}`)
const at = (items: Item[], id: string) => buildItemRows(items).findIndex((r) => rowId(r) === id)

test('drag across a section boundary rewrites urgency', () => {
  const items = [mk('a', 'Now'), mk('b', 'Later')]
  const rows = buildItemRows(items)
  // drop 'b' onto 'a' -> b lands under the Now header
  const out = applyItemDrag(items, rows, at(items, 'b'), at(items, 'a'))
  assert.deepEqual(shape(out), ['Now:b', 'Now:a'])
})

test('drag into an empty section lands on that section, not the one above', () => {
  const items = [mk('a', 'Now'), mk('b', 'Now')]
  const rows = buildItemRows(items)
  const out = applyItemDrag(items, rows, at(items, 'b'), at(items, 'ghost:Later'))
  assert.deepEqual(shape(out), ['Now:a', 'Later:b'])
})

test('drag into Maybe, the last section, works', () => {
  const items = [mk('a', 'Now'), mk('b', 'Now')]
  const rows = buildItemRows(items)
  const out = applyItemDrag(items, rows, at(items, 'b'), at(items, 'ghost:Maybe'))
  assert.deepEqual(shape(out), ['Now:a', 'Maybe:b'])
})

test('reorder inside a section keeps urgency', () => {
  const items = [mk('a', 'Soon'), mk('b', 'Soon'), mk('c', 'Soon')]
  const rows = buildItemRows(items)
  const out = applyItemDrag(items, rows, at(items, 'c'), at(items, 'a'))
  assert.deepEqual(shape(out), ['Soon:c', 'Soon:a', 'Soon:b'])
})

test('items hidden by a filter keep their place', () => {
  const items = [mk('need1', 'Now'), mk('want1', 'Now', 'Want'), mk('need2', 'Now')]
  const visible = items.filter((i) => i.kind === 'Need') // the Want is filtered out
  const rows = buildItemRows(visible)
  const out = applyItemDrag(items, rows, at(visible, 'need2'), at(visible, 'need1'))
  // want1 must not move out of index 1, and must not be dropped
  assert.deepEqual(
    out.map((i) => i.id),
    ['need2', 'want1', 'need1'],
  )
  assert.equal(out.length, 3)
})

/* ----------------------------------------------------------------- to-dos */

const td = (id: string, when: When): Todo => ({ id, title: id, when, done: false })
const todoShape = (todos: Todo[]) => todos.map((t) => `${t.when}:${t.id}`)
const todoAt = (todos: Todo[], id: string) =>
  buildTodoRows(todos).findIndex((r) => rowId(r) === id)

test('dragging a task across a day boundary rewrites when', () => {
  const todos = [td('a', 'Today'), td('b', 'This week')]
  const rows = buildTodoRows(todos)
  const out = applyTodoDrag(todos, rows, todoAt(todos, 'b'), todoAt(todos, 'a'))
  assert.deepEqual(todoShape(out), ['Today:b', 'Today:a'])
})

test('parseTodos drops junk and fills defaults', () => {
  const out = parseTodos([{ title: 'call' }, { title: '  ' }, null, { title: 'x', when: 'Never' }])
  assert.equal(out.length, 2)
  assert.equal(out[0].when, 'Today')
  assert.equal(out[0].done, false)
  assert.equal(out[1].when, 'Today')
  assert.ok(out[0].id)
})

/* --------------------------------------------------------------- spending */

const boughtItem = (
  id: string,
  price: number,
  boughtAt: string | undefined,
  kind: Kind,
  tag?: string,
): Item => ({ id, title: id, kind, tag, urgency: 'Now', price, bought: true, boughtAt })

test('monthlySpend groups by month, newest first, and splits by kind', () => {
  const out = monthlySpend([
    boughtItem('a', 100, '2026-08-02T10:00:00.000Z', 'Need', 'Repair'),
    boughtItem('b', 50, '2026-08-20T10:00:00.000Z', 'Want', 'Lego'),
    boughtItem('c', 900, '2026-07-05T10:00:00.000Z', 'Need'),
    mk('unbought', 'Now'), // not bought -> must not count
  ])
  assert.equal(out.length, 2)
  assert.equal(out[0].key, '2026-08')
  assert.equal(out[0].total, 150)
  assert.equal(out[0].byKind.Need, 100)
  assert.equal(out[0].byKind.Want, 50)
  assert.equal(out[0].byKind.Both, 0)
  assert.equal(out[0].count, 2)
  assert.equal(out[1].key, '2026-07')
  assert.equal(out[1].total, 900)
})

test('monthlySpend counts Both in its own column, not folded into need or want', () => {
  const [m] = monthlySpend([
    boughtItem('boots', 4000, '2026-08-02T10:00:00.000Z', 'Both', 'Clothes'),
    boughtItem('milk', 60, '2026-08-03T10:00:00.000Z', 'Need'),
  ])
  assert.equal(m.byKind.Both, 4000)
  assert.equal(m.byKind.Need, 60)
  assert.equal(m.byKind.Want, 0)
  assert.equal(m.total, 4060) // every kind still rolls into the month total
})

test('monthlySpend breaks a month down by tag, biggest first', () => {
  const [aug] = monthlySpend([
    boughtItem('a', 100, '2026-08-02T10:00:00.000Z', 'Want', 'Lego'),
    boughtItem('b', 300, '2026-08-03T10:00:00.000Z', 'Want', 'Clothes'),
    boughtItem('c', 20, '2026-08-04T10:00:00.000Z', 'Need'),
  ])
  assert.deepEqual(
    aug.tags.map((t) => t.tag),
    ['Clothes', 'Lego', 'Untagged'],
  )
  assert.equal(aug.tags[0].total, 300)
})

test('monthlySpend keeps undated purchases in their own bucket at the end', () => {
  const out = monthlySpend([
    boughtItem('old', 40, undefined, 'Need'),
    boughtItem('new', 10, '2026-08-02T10:00:00.000Z', 'Need'),
  ])
  assert.equal(out.length, 2)
  assert.equal(out[0].key, '2026-08')
  assert.equal(out[1].key, 'undated')
  assert.equal(out[1].total, 40)
})

/* ------------------------------------------------------------------- sync */

const remote = (json: string, sha: string): Remote<Item> => ({ items: [], json, sha })

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

test('up-to-date always records a base, even when the repo file does not exist', () => {
  // Returning null here re-arms the debounce forever: sync -> "synced" -> sync, 1.5s apart.
  // That is exactly what an empty to-do list against a missing .todos.json used to do.
  const none = upToDateBase(null, '[]')
  assert.notEqual(none, null)
  assert.equal(none!.json, '[]')

  const withRemote = upToDateBase(remote('[1]', 'sha1'), '[1]')
  assert.equal(withRemote!.sha, 'sha1')
  assert.equal(withRemote!.json, '[1]')
})

test('todosPath sits beside the list file without colliding', () => {
  assert.equal(todosPath('list.json'), 'list.todos.json')
  assert.equal(todosPath('buy-next.json'), 'buy-next.todos.json')
  assert.equal(todosPath('data/list'), 'data/list.todos.json')
  assert.notEqual(todosPath('list.json'), 'list.json')
})

/* ------------------------------------------------------------- input trust */

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
    { title: 'weird', kind: 'Nope', urgency: 'Whenever', price: 'free' },
  ])
  assert.equal(out.length, 2)
  assert.equal(out[0].kind, 'Need')
  assert.equal(out[0].urgency, 'Later')
  assert.equal(out[1].price, undefined)
  assert.ok(out[0].id)
})

test('parseItems migrates old categories to need/want and keeps the name as a tag', () => {
  const out = parseItems([
    { title: 'brake pads', category: 'Repair' },
    { title: 'tripod', category: 'Gear' },
    { title: 'millennium falcon', category: 'Lego' },
    { title: 'jacket', category: 'Clothes' },
    { title: 'something', category: 'Want' },
  ])
  assert.deepEqual(
    out.map((i) => i.kind),
    ['Need', 'Need', 'Want', 'Want', 'Want'],
  )
  assert.deepEqual(
    out.map((i) => i.tag),
    ['Repair', 'Gear', 'Lego', 'Clothes', undefined],
  )
})

test('parseItems keeps Maybe now that it is a real urgency', () => {
  const [item] = parseItems([{ title: 'x', urgency: 'Maybe' }])
  assert.equal(item.urgency, 'Maybe')
})

test('cleanTag trims, collapses whitespace, and drops empties', () => {
  assert.equal(cleanTag('  Lego  '), 'Lego')
  assert.equal(cleanTag('winter   coat'), 'winter coat')
  assert.equal(cleanTag('   '), undefined)
  assert.equal(cleanTag(42), undefined)
  assert.equal(cleanTag('x'.repeat(50))?.length, 24)
})
