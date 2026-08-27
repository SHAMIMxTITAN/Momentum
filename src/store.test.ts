// node --test src/store.test.ts
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  applyItemDrag,
  glimpse,
  groupPayments,
  buildItemRows,
  importance,
  cleanTag,
  fillRatio,
  monthlySpend,
  reorderVisible,
  parseItems,
  parsePayments,
  parseTodos,
  rowId,
  safeUrl,
  type Item,
  type Kind,
  type Payment,
  type Todo,
  type Urgency,
  type When,
} from './store.ts'
import {
  decide,
  paymentsPath,
  todosPath,
  upToDateBase,
  validRepo,
  type Remote,
} from './github.ts'

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

const td = (id: string, when: When, title = id): Todo => ({ id, title, when, done: false })

test('reordering one day leaves the other days untouched', () => {
  const todos = [td('a', 'Today'), td('week1', 'This week'), td('b', 'Today'), td('c', 'Today')]
  const shown = todos.filter((t) => t.when === 'Today') // [a, b, c]
  const out = reorderVisible(todos, shown, 2, 0) // c to the front of Today
  assert.deepEqual(
    out.map((t) => t.id),
    ['c', 'week1', 'a', 'b'],
  )
  // the untouched day must keep both its position and its day
  assert.equal(out[1].id, 'week1')
  assert.equal(out[1].when, 'This week')
})

test('importance: a starred task beats anything the wording implies', () => {
  const starred: Todo = { ...td('s', 'Today', 'water the plants'), important: true }
  const shouty = td('u', 'Today', 'URGENT pay the rent deadline!!!')
  assert.ok(importance(starred) > importance(shouty))
})

test('importance: wording separates a real errand from a vague one', () => {
  assert.ok(importance(td('a', 'Today', 'pay electricity bill')) > importance(td('b', 'Today', 'maybe tidy up')))
  assert.ok(importance(td('c', 'Today', 'doctor appointment')) > importance(td('d', 'Today', 'watch a film')))
  assert.equal(importance(td('e', 'Today', 'water the plants')), 0)
})

test('glimpse surfaces the most important task of a day and counts the rest', () => {
  const todos = [
    td('a', 'Tomorrow', 'tidy the desk'),
    td('b', 'Tomorrow', 'pay the rent'),
    td('c', 'Tomorrow', 'read a bit'),
    td('d', 'Today', 'URGENT thing today'), // different day -> ignored
    { ...td('e', 'Tomorrow', 'done already'), done: true }, // finished -> ignored
  ]
  const { top, more } = glimpse(todos, 'Tomorrow')
  assert.equal(top?.id, 'b')
  assert.equal(more, 2)
})

test('glimpse on an empty day shows nothing rather than guessing', () => {
  assert.deepEqual(glimpse([td('a', 'Today')], 'Tomorrow'), { top: null, more: 0 })
})

test('glimpse falls back to list order when nothing stands out', () => {
  const todos = [td('first', 'Today', 'thing one'), td('second', 'Today', 'thing two')]
  assert.equal(glimpse(todos, 'Today').top?.id, 'first')
})

test('parseTodos keeps the important flag and ignores junk values', () => {
  const out = parseTodos([
    { title: 'starred', important: true },
    { title: 'plain' },
    { title: 'junk flag', important: 'yes' },
  ])
  assert.equal(out[0].important, true)
  assert.equal(out[1].important, undefined)
  assert.equal(out[2].important, undefined)
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

/* --------------------------------------------------------- must payments */

const pay = (name: string, amount: number, group?: string, paused?: boolean): Payment => ({
  id: name,
  name,
  amount,
  group,
  paused,
})

test('groupPayments totals the monthly floor and buckets by group', () => {
  const { groups, monthly, activeCount } = groupPayments([
    pay('Claude', 1700, 'Work'),
    pay('Claude second account', 1700, 'Work'),
    pay('Netflix', 649, 'Entertainment'),
  ])
  assert.equal(monthly, 4049)
  assert.equal(activeCount, 3)
  assert.deepEqual(
    groups.map((g) => g.group),
    ['Work', 'Entertainment'], // biggest group first
  )
  assert.equal(groups[0].total, 3400)
  assert.equal(groups[1].total, 649)
})

test('a paused payment stays listed but is excluded from every total', () => {
  const { groups, monthly, activeCount } = groupPayments([
    pay('Netflix', 649, 'Entertainment'),
    pay('Prime', 299, 'Entertainment', true),
  ])
  assert.equal(monthly, 649)
  assert.equal(activeCount, 1)
  assert.equal(groups[0].rows.length, 2) // still visible
  assert.equal(groups[0].total, 649) // but not counted
})

test('payments with no group fall into Other rather than vanishing', () => {
  const { groups, monthly } = groupPayments([pay('Rent', 15000)])
  assert.equal(groups[0].group, 'Other')
  assert.equal(monthly, 15000)
})

test('parsePayments drops junk, defaults a bad amount to zero, never goes negative', () => {
  const out = parsePayments([
    { name: 'Netflix', amount: 649, group: 'Entertainment' },
    { name: '   ', amount: 100 },
    null,
    { name: 'weird', amount: 'free' },
    { name: 'refund', amount: -50 },
  ])
  assert.equal(out.length, 3)
  assert.equal(out[0].group, 'Entertainment')
  assert.equal(out[1].amount, 0)
  assert.equal(out[2].amount, 0)
  assert.ok(out[0].id)
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

test('sibling files sit beside the list file without colliding', () => {
  assert.equal(todosPath('list.json'), 'list.todos.json')
  assert.equal(todosPath('buy-next.json'), 'buy-next.todos.json')
  assert.equal(todosPath('data/list'), 'data/list.todos.json')
  assert.equal(paymentsPath('list.json'), 'list.payments.json')
  assert.equal(paymentsPath('data/list'), 'data/list.payments.json')
  // all three must be distinct or one list would overwrite another
  const paths = ['list.json', todosPath('list.json'), paymentsPath('list.json')]
  assert.equal(new Set(paths).size, 3)
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

/* ------------------------------------------------------------- wave gauges */

test('fillRatio clamps at full and refuses to divide by a missing limit', () => {
  assert.equal(fillRatio(50, 100), 0.5)
  assert.equal(fillRatio(100, 100), 1)
  assert.equal(fillRatio(250, 100), 1) // over budget still fills exactly one box
  assert.equal(fillRatio(50, 0), 0) // no budget set -> nothing to fill toward
  assert.equal(fillRatio(0, 100), 0)
  assert.ok(Number.isFinite(fillRatio(10, -5)))
  assert.equal(fillRatio(10, -5), 0)
})
