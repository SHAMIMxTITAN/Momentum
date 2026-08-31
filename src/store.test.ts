// node --test src/store.test.ts
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  applyItemDrag,
  glimpse,
  groupPayments,
  buildItemRows,
  importance,
  isDone,
  isOverdue,
  doneByDay,
  cleanTag,
  fillRatio,
  monthlySpend,
  reorderVisible,
  parseItems,
  parseScripts,
  parseBlocks,
  spanText,
  sliceSpans,
  normalizeSpans,
  concatSpans,
  applyMark,
  hasMark,
  flattenBlocks,
  indentBlock,
  outdentBlock,
  moveBlock,
  removeBlock,
  insertAfter,
  duplicateBlock,
  blockAbove,
  type Block,
  type Span,
  wordCount,
  readingMinutes,
  relativeTime,
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


/* ------------------------------------------------------------ daily tasks */

test('a daily task comes back open the next day; a one-off stays done', () => {
  const now = new Date('2026-08-29T09:00:00')
  const base = { id: 'x', title: 'Fajr', when: 'Today' as const }
  const at = (iso: string) => ({ ...base, daily: true, done: true, doneAt: iso })

  // ticked earlier today -> still done
  assert.equal(isDone(at('2026-08-29T05:30:00'), now), true)
  // ticked yesterday -> open again, without anything having reset it
  assert.equal(isDone(at('2026-08-28T05:30:00'), now), false)
  // never ticked
  assert.equal(isDone({ ...base, daily: true, done: false }, now), false)
  // done flag with no timestamp is not trusted
  assert.equal(isDone({ ...base, daily: true, done: true }, now), false)
  // junk timestamp must not read as "today"
  assert.equal(isDone({ ...base, daily: true, done: true, doneAt: 'nonsense' }, now), false)
  // a one-off ignores the date entirely
  assert.equal(isDone({ ...base, done: true, doneAt: '2020-01-01T00:00:00' }, now), true)
  assert.equal(isDone({ ...base, done: false }, now), false)
})

test('parseTodos pins a daily to Today and drops a non-true daily flag', () => {
  const [a] = parseTodos([{ title: 'Namaz', when: 'This week', daily: true }])
  assert.equal(a.when, 'Today')
  assert.equal(a.daily, true)
  const [b] = parseTodos([{ title: 'Once', when: 'Tomorrow', daily: 'yes' }])
  assert.equal(b.when, 'Tomorrow')
  assert.equal(b.daily, undefined)
})

test('isOverdue flags a one-off left in Today since an earlier day', () => {
  const now = new Date('2026-08-29T09:00:00')
  const base = { id: 'x', title: 'Pay bill', when: 'Today' as const, done: false }

  // sat there since yesterday -> due
  assert.equal(isOverdue({ ...base, since: '2026-08-28T20:00:00' }, now), true)
  // added today -> not due yet, however early
  assert.equal(isOverdue({ ...base, since: '2026-08-29T00:05:00' }, now), false)
  // a daily is meant to come back; never due
  assert.equal(isOverdue({ ...base, daily: true, since: '2026-08-01T00:00:00' }, now), false)
  // already done, or parked in another bucket
  assert.equal(isOverdue({ ...base, done: true, since: '2026-08-01T00:00:00' }, now), false)
  assert.equal(isOverdue({ ...base, when: 'Tomorrow', since: '2026-08-01T00:00:00' }, now), false)
  // nothing to compare against
  assert.equal(isOverdue(base, now), false)
})

test('doneByDay groups finished one-offs newest first and leaves dailies out', () => {
  const t = (id: string, doneAt?: string, daily?: true) => ({
    id, title: id, when: 'Today' as const, done: true, doneAt, daily,
  })
  const groups = doneByDay([
    t('old', '2026-08-27T10:00:00'),
    t('new', '2026-08-29T10:00:00'),
    t('newer', '2026-08-29T18:00:00'),
    t('namaz', '2026-08-29T05:00:00', true),
    t('undated'),
    { id: 'open', title: 'open', when: 'Today' as const, done: false },
  ])

  assert.deepEqual(
    groups.map((g) => g.todos.map((x) => x.id)),
    [['new', 'newer'], ['old'], ['undated']],
  )
  // the daily never enters the log, and neither does anything still open
  assert.equal(groups.flatMap((g) => g.todos).some((x) => x.id === 'namaz' || x.id === 'open'), false)
})

test('a daily keeps a whitelisted colour; junk and one-offs get none', () => {
  const [ok] = parseTodos([{ title: 'Fajr', daily: true, color: '#FF2D55' }])
  assert.equal(ok.color, '#FF2D55')

  // not in the palette -> dropped, so an imported file cannot inject a style value
  const [bad] = parseTodos([{ title: 'Fajr', daily: true, color: 'red; content:evil' }])
  assert.equal(bad.color, undefined)
  const [green] = parseTodos([{ title: 'Fajr', daily: true, color: '#34C759' }])
  assert.equal(green.color, undefined, 'green means done, it is not a choice')

  // a one-off has no accent to colour
  const [once] = parseTodos([{ title: 'Call the bank', color: '#007AFF' }])
  assert.equal(once.color, undefined)
})

/* --------------------------------------------------------------- scripts */

test('parseScripts fills defaults and never leaves a script with nowhere to type', () => {
  const [s] = parseScripts([{ title: '  Intro hook  ' }])
  assert.equal(s.title, 'Intro hook')
  assert.equal(s.status, 'Idea')
  assert.equal(s.blocks.length, 1, 'an empty script still gets one block')
  assert.equal(s.blocks[0].type, 'paragraph')
  assert.ok(s.updatedAt)

  const [bad] = parseScripts([{ title: 'x', status: 'Publishing' }])
  assert.equal(bad.status, 'Idea', 'an unknown status falls back')
  assert.equal(parseScripts('nope').length, 0)
  assert.equal(parseScripts([null, 5, 'x']).length, 0)
})


test('relativeTime', () => {
  const now = new Date('2026-08-29T12:00:00')
  assert.equal(relativeTime('2026-08-29T11:59:40', now), 'just now')
  assert.equal(relativeTime('2026-08-29T10:00:00', now), '2 hours ago')
  assert.equal(relativeTime('2026-08-28T12:00:00', now), 'yesterday')
  assert.equal(relativeTime('nonsense', now), '', 'a junk timestamp renders nothing')
})

/* ------------------------------------------------------------ span algebra */

const plain = (t: string): Span[] => [{ text: t }]

test('sliceSpans cuts across runs and keeps each run its marks', () => {
  const c: Span[] = [{ text: 'Hello ' }, { text: 'brave', bold: true }, { text: ' world' }]
  assert.equal(spanText(c), 'Hello brave world')
  assert.equal(spanText(sliceSpans(c, 0, 5)), 'Hello')
  assert.equal(spanText(sliceSpans(c, 6)), 'brave world')

  // a cut through the middle of the bold run keeps only that part bold
  const mid = sliceSpans(c, 4, 9)
  assert.equal(spanText(mid), 'o bra')
  assert.deepEqual(
    mid.map((s) => [s.text, s.bold ?? false]),
    [
      ['o ', false],
      ['bra', true],
    ],
  )
  assert.equal(spanText(sliceSpans(c, 5, 5)), '', 'an empty range is empty')
})

test('normalizeSpans drops empties and coalesces identical neighbours', () => {
  const out = normalizeSpans([
    { text: 'a' },
    { text: '' },
    { text: 'b' },
    { text: 'c', bold: true },
    { text: 'd', bold: true },
  ])
  assert.equal(out.length, 2, 'ab + cd')
  assert.deepEqual(out[0], { text: 'ab' })
  assert.equal(out[1].text, 'cd')
  assert.equal(out[1].bold, true)
})

test('applyMark splits runs at the boundaries and can clear again', () => {
  const c = plain('Hello world')
  const bolded = applyMark(c, 0, 5, 'bold', true)
  assert.deepEqual(
    bolded.map((s) => [s.text, s.bold ?? false]),
    [
      ['Hello', true],
      [' world', false],
    ],
  )
  assert.equal(spanText(bolded), 'Hello world', 'marking never changes the text')

  const cleared = applyMark(bolded, 0, 5, 'bold', false)
  assert.equal(cleared.length, 1, 'clearing lets the runs merge back into one')
  assert.equal(cleared[0].bold, undefined)

  // a highlight over a bold run keeps both marks
  const both = applyMark(bolded, 0, 5, 'bg', 'yellow')
  assert.equal(both[0].bold, true)
  assert.equal(both[0].bg, 'yellow')
})

test('hasMark is true only when the whole range carries it', () => {
  const c = applyMark(plain('Hello world'), 0, 5, 'bold', true)
  assert.equal(hasMark(c, 0, 5, 'bold'), true)
  assert.equal(hasMark(c, 0, 7, 'bold'), false, 'part of the range is unbold')
  assert.equal(hasMark(c, 6, 11, 'bold'), false)
  assert.equal(hasMark(c, 3, 3, 'bold'), false, 'an empty range is not "all marked"')
})

test('concatSpans joins and coalesces — the Backspace merge case', () => {
  const a = applyMark(plain('one'), 0, 3, 'bold', true)
  const b = applyMark(plain('two'), 0, 3, 'bold', true)
  const joined = concatSpans(a, b)
  assert.equal(spanText(joined), 'onetwo')
  assert.equal(joined.length, 1, 'same marks either side means one run, not two')
})

/* --------------------------------------------------- v1 migration + parsing */

test('parseBlocks turns v1 flat text and indents into a tree of spans', () => {
  const v1 = [
    { id: 'a', type: 'h1', text: 'Hook' },
    { id: 'b', type: 'bullet', text: 'top', indent: 0 },
    { id: 'c', type: 'bullet', text: 'nested', indent: 1 },
    { id: 'd', type: 'bullet', text: 'deeper', indent: 2 },
    { id: 'e', type: 'p', text: 'back to root', indent: 0 },
  ]
  const tree = parseBlocks(v1)
  assert.equal(tree.length, 3, 'h1, the top bullet, and the paragraph')
  assert.equal(tree[0].type, 'h1')
  assert.deepEqual(tree[0].content, [{ text: 'Hook' }], 'v1 text becomes one span')
  assert.equal(tree[1].children.length, 1, 'indent 1 nests under the bullet above')
  assert.equal(tree[1].children[0].children.length, 1, 'indent 2 nests one deeper')
  assert.equal(spanText(tree[1].children[0].children[0].content), 'deeper')
  assert.equal(tree[2].type, 'paragraph', 'v1 "p" is renamed')
})

test('parseBlocks renames v1 types and turns checklists into bullets', () => {
  const tree = parseBlocks([
    { type: 'p', text: 'a' },
    { type: 'bullet', text: 'b' },
    { type: 'number', text: 'c' },
    { type: 'todo', text: 'd', checked: true },
    { type: 'nonsense', text: 'e' },
  ])
  assert.deepEqual(
    tree.map((b) => b.type),
    ['paragraph', 'bulleted', 'numbered', 'bulleted', 'paragraph'],
  )
})

test('parseBlocks clamps an indent jump so a corrupt file cannot make a hole', () => {
  const tree = parseBlocks([
    { type: 'bulleted', text: 'root' },
    { type: 'bulleted', text: 'jumps to 3', indent: 3 },
  ])
  assert.equal(tree.length, 1)
  assert.equal(tree[0].children.length, 1, 'a jump of three levels lands one level in')
})

test('parseBlocks reads the new shape and rejects junk spans', () => {
  const tree = parseBlocks([
    {
      id: 'x',
      type: 'h2',
      content: [{ text: 'kept', bold: true }, { text: '' }, { nope: 1 }, 'string'],
      children: [{ type: 'bulleted', content: [{ text: 'child' }] }],
    },
  ])
  assert.equal(tree[0].type, 'h2')
  assert.deepEqual(tree[0].content, [{ text: 'kept', bold: true }])
  assert.equal(tree[0].children.length, 1)
  assert.equal(spanText(tree[0].children[0].content), 'child')
})

test('wordCount and flattenBlocks walk into children', () => {
  const tree = parseBlocks([
    { type: 'h1', text: 'one two' },
    { type: 'bulleted', text: 'three', indent: 0 },
    { type: 'bulleted', text: 'four five', indent: 1 },
    { type: 'divider', text: '' },
  ])
  assert.equal(flattenBlocks(tree).length, 4, 'the nested child is in the flat walk')
  assert.deepEqual(
    flattenBlocks(tree).map((f) => f.depth),
    [0, 0, 1, 0],
  )
  assert.equal(wordCount(tree), 5)
  assert.equal(readingMinutes(0), 0)
  assert.equal(readingMinutes(10), 1)
  assert.equal(readingMinutes(450), 3)
})

/* --------------------------------------------------------- block tree ops */

const tree3 = () =>
  parseBlocks([
    { id: 'a', type: 'bulleted', content: [{ text: 'a' }] },
    { id: 'b', type: 'bulleted', content: [{ text: 'b' }] },
    { id: 'c', type: 'bulleted', content: [{ text: 'c' }] },
  ])

const outline = (t: Block[]): string =>
  flattenBlocks(t)
    .map((f) => '  '.repeat(f.depth) + spanText(f.block.content))
    .join('\n')

test('indentBlock nests under the sibling above; the first child cannot indent', () => {
  const t = indentBlock(tree3(), 'b')
  assert.equal(outline(t), 'a\n  b\nc')
  assert.equal(outline(indentBlock(t, 'a')), outline(t), 'nothing above a, so it stays put')
  // b is now the only child of a, so it has no sibling above it either
  assert.equal(outline(indentBlock(t, 'b')), outline(t))
})

test('indent twice nests two deep, and outdent walks back out', () => {
  let t = indentBlock(tree3(), 'b')
  t = indentBlock(t, 'c')
  assert.equal(outline(t), 'a\n  b\n  c', 'c joins b under a')
  t = indentBlock(t, 'c')
  assert.equal(outline(t), 'a\n  b\n    c', 'now under b')
  t = outdentBlock(t, 'c')
  assert.equal(outline(t), 'a\n  b\n  c')
  t = outdentBlock(t, 'c')
  assert.equal(outline(t), 'a\n  b\nc')
  assert.equal(outline(outdentBlock(t, 'a')), outline(t), 'a root block has nowhere to go')
})

test('indent carries children along', () => {
  let t = indentBlock(tree3(), 'c') // c under b
  t = indentBlock(t, 'b') // b (with c) under a
  assert.equal(outline(t), 'a\n  b\n    c')
})

test('moveBlock swaps with a sibling and stops at the ends', () => {
  assert.equal(outline(moveBlock(tree3(), 'a', 1)), 'b\na\nc')
  assert.equal(outline(moveBlock(tree3(), 'c', -1)), 'a\nc\nb')
  assert.equal(outline(moveBlock(tree3(), 'a', -1)), 'a\nb\nc', 'already at the top')
  assert.equal(outline(moveBlock(tree3(), 'c', 1)), 'a\nb\nc', 'already at the bottom')
})

test('moveBlock reorders inside a nested list, not the root', () => {
  let t = indentBlock(tree3(), 'b')
  t = indentBlock(t, 'c')
  assert.equal(outline(t), 'a\n  b\n  c')
  assert.equal(outline(moveBlock(t, 'c', -1)), 'a\n  c\n  b')
})

test('remove, insertAfter and duplicate', () => {
  assert.equal(outline(removeBlock(tree3(), 'b')), 'a\nc')
  const one = parseBlocks([{ id: 'z', type: 'paragraph', content: [{ text: 'z' }] }])
  assert.equal(outline(insertAfter(tree3(), 'a', one)), 'a\nz\nb\nc')

  const dup = duplicateBlock(indentBlock(tree3(), 'b'), 'a')
  assert.equal(
    outline(dup),
    ['a', '  b', 'a', '  b', 'c'].join('\n'),
    'a copy brings its children',
  )
  const ids = flattenBlocks(dup).map((f) => f.block.id)
  assert.equal(new Set(ids).size, ids.length, 'every copied block gets a fresh id')
})

test('blockAbove follows what is on screen, not the sibling order', () => {
  const t = indentBlock(tree3(), 'b')
  assert.equal(blockAbove(t, 'b')?.id, 'a')
  assert.equal(blockAbove(t, 'c')?.id, 'b', 'the nested child is directly above c')
  assert.equal(blockAbove(t, 'a'), null)
})
