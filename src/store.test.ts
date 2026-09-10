// node --test src/store.test.ts
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  applyItemDrag,
  glimpse,
  groupPayments,
  billingDay,
  nextDueFor,
  isSettled,
  settle,
  unsettle,
  upcomingPayments,
  dueSoon,
  buildItemRows,
  importance,
  isDone,
  msUntilMidnight,
  isOverdue,
  rollOver,
  doneByDay,
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

test('msUntilMidnight counts to the next LOCAL midnight, not UTC', () => {
  const at = (s: string) => msUntilMidnight(new Date(s))
  const mins = (ms: number) => Math.round(ms / 60000)

  assert.equal(mins(at('2026-08-29T23:00:00')), 60, 'an hour before midnight')
  assert.equal(mins(at('2026-08-29T00:00:00')), 24 * 60, 'a full day at midnight itself')
  assert.equal(mins(at('2026-08-29T05:30:00')), 18 * 60 + 30, 'the 5:30am case, ~18.5h to go')
  assert.ok(at('2026-08-29T23:59:59') > 0, 'never zero or negative')

  // month and year rollovers
  assert.equal(mins(at('2026-08-31T23:30:00')), 30)
  assert.equal(mins(at('2026-12-31T23:30:00')), 30)
})

/* ------------------------------------------------------ renewal dates */

/** Started on a real date, the way the form now asks for it. */
const sub = (id: string, amount: number, startedOn?: string, extra: Partial<Payment> = {}): Payment => ({
  id,
  name: id,
  amount,
  startedOn,
  ...extra,
})

const on = (iso: string) => new Date(iso + 'T00:00:00').toISOString()

test('the billing day comes from the date the subscription started', () => {
  const now = new Date('2026-09-10T14:00:00')
  // started 3 September, so this month has been and gone -> next is 3 October
  assert.equal(billingDay(sub('n', 1, on('2026-09-03'))), 3)
  assert.equal(nextDueFor(sub('n', 1, on('2026-09-03')), now)?.toDateString(), new Date('2026-10-03').toDateString())
  // started back in January, still bills on the 24th
  assert.equal(nextDueFor(sub('c', 1, on('2026-01-24')), now)?.toDateString(), new Date('2026-09-24').toDateString())
  // today counts as due today, not next month
  assert.equal(nextDueFor(sub('t', 1, on('2026-05-10')), now)?.toDateString(), new Date('2026-09-10').toDateString())
  assert.equal(nextDueFor(sub('none', 1), now), null, 'no start date, no schedule')
})

test('a 31st subscription bills on the last day of a short month', () => {
  assert.equal(
    nextDueFor(sub('x', 1, on('2026-01-31')), new Date('2027-02-10'))?.toDateString(),
    new Date('2027-02-28').toDateString(),
  )
  assert.equal(
    nextDueFor(sub('x', 1, on('2026-01-31')), new Date('2028-02-10'))?.toDateString(),
    new Date('2028-02-29').toDateString(),
    'and 29 in a leap year',
  )
})

test('ticking a cycle off moves it to next month rather than clearing it', () => {
  const now = new Date('2026-09-10T09:00:00')
  const netflix = sub('netflix', 650, on('2026-09-03')) // next due 3 October
  assert.equal(isSettled(netflix, now), false)

  const paid = settle(netflix, now)
  assert.equal(isSettled(paid, now), true)
  assert.equal(
    nextDueFor(paid, now)?.toDateString(),
    new Date('2026-11-03').toDateString(),
    'October is settled, so November is what is owed',
  )

  // idempotent, and undoable
  assert.equal(isSettled(settle(paid, now), now), true)
  assert.equal(isSettled(unsettle(paid), now), false)
})

test('a settled cycle drops out of what is due soon', () => {
  const now = new Date('2026-09-10T09:00:00')
  const due = sub('claude', 2200, on('2026-08-12')) // 12 September, two days away
  assert.equal(dueSoon([due], now, 3).rows.length, 1)
  assert.equal(dueSoon([settle(due, now)], now, 3).rows.length, 0, 'paid, so nothing to keep in the account')
})

test('upcomingPayments orders by what hits the account first, and skips undated and paused', () => {
  const now = new Date('2026-09-10T09:00:00')
  const rows = upcomingPayments(
    [
      sub('later', 100, on('2026-01-20')),
      sub('today', 200, on('2026-01-10')),
      sub('soon', 50, on('2026-01-12')),
      sub('undated', 999),
      sub('paused', 999, on('2026-01-11'), { paused: true }),
    ],
    now,
  )
  assert.deepEqual(rows.map((r) => r.payment.id), ['today', 'soon', 'later'])
  assert.deepEqual(rows.map((r) => r.days), [0, 2, 10])
})

test('dueSoon totals only what lands inside the window', () => {
  const now = new Date('2026-09-10T09:00:00')
  const list = [
    sub('a', 500, on('2026-01-10')), // today
    sub('b', 300, on('2026-01-12')), // in 2
    sub('c', 900, on('2026-01-25')), // in 15
  ]
  const { rows, total } = dueSoon(list, now, 3)
  assert.deepEqual(rows.map((r) => r.payment.id), ['a', 'b'])
  assert.equal(total, 800)
  assert.equal(dueSoon(list, now, 0).total, 500, 'a zero-day window is just today')
})

test('an old dueDay becomes a real start date with the same billing day', () => {
  const now = new Date('2026-09-10T12:00:00')
  // the shape actually in the data repo before this change
  const [claude] = parsePayments([{ name: 'Claude', amount: 2200, group: 'Work', dueDay: 24 }])
  assert.equal(billingDay(claude), 24, 'same day, nothing to re-enter')
  assert.equal(
    nextDueFor(claude, now)?.toDateString(),
    new Date('2026-09-24').toDateString(),
  )
  // junk and missing both mean "no schedule", never a wrong one
  assert.equal(parsePayments([{ name: 'x', amount: 1, dueDay: 0 }])[0].startedOn, undefined)
  assert.equal(parsePayments([{ name: 'x', amount: 1, dueDay: 32 }])[0].startedOn, undefined)
  assert.equal(parsePayments([{ name: 'x', amount: 1, startedOn: 'nonsense' }])[0].startedOn, undefined)
  assert.equal(parsePayments([{ name: 'x', amount: 1 }])[0].startedOn, undefined)
})

/* ------------------------------------------------------- daily task bands */

test('an existing list sorts itself into Namaz and Daily by name, once', () => {
  const out = parseTodos([
    { title: 'Fajr', daily: true },
    { title: 'Zuhar', daily: true },
    { title: 'Asr', daily: true },
    { title: 'Maghrib', daily: true },
    { title: 'Isha', daily: true },
    { title: 'Gym', daily: true },
    { title: 'Keyboard practice 30min', daily: true },
    { title: 'English Practice', daily: true },
    { title: 'Organise pc file' }, // a one-off gets no band at all
  ])
  assert.deepEqual(
    out.map((t) => `${t.title}:${t.group ?? '-'}`),
    [
      'Fajr:Namaz',
      'Zuhar:Namaz',
      'Asr:Namaz',
      'Maghrib:Namaz',
      'Isha:Namaz',
      'Gym:Daily',
      'Keyboard practice 30min:Daily',
      'English Practice:Daily',
      'Organise pc file:-',
    ],
  )
})

test('spelling variants and casing still land in Namaz', () => {
  const out = parseTodos(
    ['fajar', 'ZUHR', 'Dhuhr', ' asar ', 'Magrib', 'Esha'].map((title) => ({ title, daily: true })),
  )
  assert.ok(out.every((t) => t.group === 'Namaz'), out.map((t) => `${t.title}:${t.group}`).join(', '))
})

test('a band already chosen by hand is never re-guessed from the title', () => {
  // "Gym" would guess Daily; an explicit Namaz must survive, and vice versa
  const [gym] = parseTodos([{ title: 'Gym', daily: true, group: 'Namaz' }])
  assert.equal(gym.group, 'Namaz')
  const [fajr] = parseTodos([{ title: 'Fajr', daily: true, group: 'Daily' }])
  assert.equal(fajr.group, 'Daily')
  const [junk] = parseTodos([{ title: 'Fajr', daily: true, group: 'Nonsense' }])
  assert.equal(junk.group, 'Namaz', 'an unknown band falls back to the guess')
})

test('a one-off carries no band even if a file claims one', () => {
  const [t] = parseTodos([{ title: 'Call the bank', group: 'Namaz' }])
  assert.equal(t.group, undefined)
})

/* ------------------------------------------------- rollover and staleness */

const dayAgo = (n: number) => new Date(Date.now() - n * 86400000).toISOString()

test('Tomorrow rolls into Today once tomorrow has arrived', () => {
  const now = new Date('2026-09-10T09:00:00')
  const yesterday = new Date('2026-09-09T20:00:00').toISOString()
  const todayStamp = new Date('2026-09-10T08:00:00').toISOString()

  const out = rollOver(
    [
      { id: 'a', title: 'PE checking', when: 'Tomorrow', done: false, since: yesterday },
      { id: 'b', title: 'written today for tomorrow', when: 'Tomorrow', done: false, since: todayStamp },
      { id: 'c', title: 'a week thing', when: 'This week', done: false, since: yesterday },
      { id: 'd', title: 'already done', when: 'Tomorrow', done: true, since: yesterday },
    ],
    now,
  )
  assert.equal(out[0].when, 'Today', 'yesterday\u2019s tomorrow is today')
  assert.equal(out[1].when, 'Tomorrow', 'written today, still for tomorrow')
  assert.equal(out[2].when, 'This week', 'a window does not roll')
  assert.equal(out[3].when, 'Tomorrow', 'a finished task is left alone')
  assert.notEqual(out[0].since, yesterday, 'it re-anchors, so it is not instantly overdue')
})

test('rollOver returns the same array when nothing moved', () => {
  const list: Todo[] = [{ id: 'a', title: 'x', when: 'Today', done: false, since: dayAgo(3) }]
  assert.equal(rollOver(list, new Date()), list, 'identity, so saving it is not a write loop')
})

test('a Tomorrow row with no stamp gets one instead of jumping straight to Today', () => {
  const [t] = rollOver([{ id: 'a', title: 'legacy', when: 'Tomorrow', done: false }], new Date())
  assert.equal(t.when, 'Tomorrow')
  assert.ok(t.since, 'stamped now, so it rolls tomorrow rather than the instant it is read')
})

test('This week only flags once the whole week has gone', () => {
  const now = new Date('2026-09-10T12:00:00')
  const week = (days: number): Todo => ({
    id: String(days), title: 'x', when: 'This week', done: false,
    since: new Date(now.getTime() - days * 86400000).toISOString(),
  })
  assert.equal(isOverdue(week(3), now), false, 'mid-week is still planned, not late')
  assert.equal(isOverdue(week(6), now), false)
  assert.equal(isOverdue(week(7), now), true, 'the week is up')
  assert.equal(isOverdue(week(20), now), true, 'the case that went unflagged for a fortnight')
})

test('Tomorrow is never overdue, and a daily never is either', () => {
  const now = new Date('2026-09-10T12:00:00')
  assert.equal(
    isOverdue({ id: 'a', title: 'x', when: 'Tomorrow', done: false, since: dayAgo(9) }, now),
    false,
    'it rolls instead of being scolded',
  )
  assert.equal(
    isOverdue({ id: 'b', title: 'Fajr', when: 'Today', done: false, daily: true, since: dayAgo(9) }, now),
    false,
  )
})

test('the peek ignores Namaz but still surfaces habits and one-offs', () => {
  const todos: Todo[] = [
    { id: 'n1', title: 'Fajr', when: 'Today', done: false, daily: true, group: 'Namaz' },
    { id: 'n2', title: 'Isha', when: 'Today', done: false, daily: true, group: 'Namaz' },
    { id: 'd1', title: 'Gym', when: 'Today', done: false, daily: true, group: 'Daily' },
    { id: 't1', title: 'pay the rent', when: 'Today', done: false },
  ]
  const { top, more } = glimpse(todos, 'Today')
  assert.equal(top?.id, 't1', 'the errand wins on wording')
  assert.equal(more, 1, 'only Gym is left; the two prayers are not counted')

  // a day of nothing but prayers has nothing worth peeking at
  assert.deepEqual(glimpse(todos.slice(0, 2), 'Today'), { top: null, more: 0 })
})
