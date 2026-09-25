import { useEffect, useRef, useState } from 'react'
import { arrayMove } from '@dnd-kit/sortable'

// Ordered as a spectrum, essential -> discretionary. 'Both' is the thing you genuinely
// need but are also buying a nicer version of than strictly required.
export const KINDS = ['Need', 'Both', 'Want'] as const
export const URGENCIES = ['Now', 'Soon', 'Later', 'Maybe'] as const
export const WHENS = ['Today', 'Tomorrow', 'This week'] as const

export type Kind = (typeof KINDS)[number]
export type Urgency = (typeof URGENCIES)[number]
export type When = (typeof WHENS)[number]

export type Item = {
  id: string
  title: string
  kind: Kind
  /** Free text the user types — "Lego", "Shoes". Not a fixed list. */
  tag?: string
  urgency: Urgency
  price?: number
  note?: string
  link?: string
  bought: boolean
  boughtAt?: string
}

export type Todo = {
  id: string
  title: string
  when: When
  done: boolean
  doneAt?: string
  /** Starred by hand. Always outranks anything the text heuristic infers. */
  important?: boolean
  /**
   * A standing task — Namaz, an English lesson. It lives in Today permanently and comes
   * back open every morning. Deliberately a flag rather than a second list: a one-off has
   * to be orderable *between* two dailies ("before Fajr"), which only works if they share
   * one ordered list.
   */
  daily?: boolean
  /**
   * The day the task landed in its current bucket. Today never re-anchors itself, so an
   * undone one-off just sits there — this is what lets it say it has been sitting since
   * an earlier day instead of looking freshly added.
   */
  since?: string
  /**
   * Only meaningful on a daily. A stack of standing tasks all in one accent reads as one
   * undifferentiated block — this is what lets the five prayers be one colour and the
   * English lesson another. One-offs have no accent at all and never get one.
   */
  color?: string
  /**
   * Which band of standing tasks this belongs to. Only meaningful on a daily: the prayers
   * are fixed and non-negotiable, everything else is a habit, and reading them as one
   * undifferentiated stack was the complaint. A one-off has no group.
   */
  group?: DailyGroup
}

/**
 * The two bands of standing tasks. A closed set rather than free text: there are exactly
 * two kinds of thing here and a segmented control beats a text field on a phone. Adding a
 * third later is one string.
 */
export const DAILY_GROUPS = ['Namaz', 'Daily'] as const
export type DailyGroup = (typeof DAILY_GROUPS)[number]

/**
 * The five daily prayers, in the order they fall. Used only to sort an existing list into
 * its two bands on first read, so eight tasks do not have to be retyped — spellings vary,
 * so the common ones are all here.
 */
const PRAYERS = /^(fajr|fajar|zuhar|zuhr|dhuhr|duhur|asr|asar|maghrib|magrib|isha|esha|isha'a)$/i

/** Namaz if the title is a prayer, otherwise a habit. Only ever applied to a daily. */
const groupFor = (title: string): DailyGroup => (PRAYERS.test(title.trim()) ? 'Namaz' : 'Daily')

/**
 * A closed set, not a free colour field: it is a whitelist at the trust boundary (an
 * imported file must not put arbitrary text into a style), and six distinguishable
 * choices beat a colour wheel nobody wants to operate on a phone.
 *
 * Green and red are deliberately absent — green already means "done" on the circle and
 * red already means overdue, so neither can be spent on decoration.
 */
export const DAILY_COLORS = [
  '#5E5CE6', // indigo — the default
  '#007AFF', // blue
  '#30B0C7', // teal
  '#AF52DE', // purple
  '#FF2D55', // pink
  '#FF9500', // orange
] as const

export const DEFAULT_DAILY_COLOR = DAILY_COLORS[0]

/**
 * A recurring monthly commitment — subscriptions, rent, an EMI. Unlike an Item these are
 * never "bought": they come round again every month, so they are a floor under the budget
 * rather than anything that appears in the buy list.
 */
export type Payment = {
  id: string
  name: string
  amount: number
  /** Free text, same idea as an item's tag: "Work", "Entertainment". */
  group?: string
  /** Kept but not counted — for something cancelled or on hold. */
  paused?: boolean
  /**
   * The date the subscription started, as a calendar date. Asked for instead of a bare
   * day number because "what day of the month does this bill?" is a question you have to
   * work out, while "when did you start it?" is one you can just answer off the receipt.
   * The billing day is the day-of-month of this date; the year and month are only kept so
   * the answer stays checkable later.
   */
  startedOn?: string
  /**
   * The due date most recently ticked off. A cycle that has been paid drops out of what
   * is coming up and returns on the next one, rather than sitting there looking unpaid
   * until the date passes.
   */
  paidThrough?: string
}

/** A renewal this close counts as urgent: enough warning to move money, not enough to ignore. */
export const URGENT_DAYS = 3

// `order` is the array index — the list is the order. Export/import carries it implicitly.

const ITEMS_KEY = 'buy-next.v1'
const TODOS_KEY = 'buy-next.todos.v1'
const PAYMENTS_KEY = 'buy-next.payments.v1'

/**
 * Links get rendered into an href, so anything but http(s) is a script-injection
 * vector — `javascript:` in an imported file would run on click. Bare hosts are
 * assumed https so typing "amazon.in/x" still works.
 */
export function safeUrl(u: unknown): string | undefined {
  if (typeof u !== 'string' || !u.trim()) return undefined
  const s = u.trim()
  try {
    const url = new URL(/^[a-z][a-z0-9+.-]*:/i.test(s) ? s : `https://${s}`)
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : undefined
  } catch {
    return undefined
  }
}

/**
 * v1 stored a fixed `category`. v2 splits that into need-vs-want plus a free tag,
 * so old files (and whatever the other machine last pushed) keep their meaning:
 * the old category name survives as the tag.
 */
const LEGACY_CATEGORY: Record<string, { kind: Kind; tag?: string }> = {
  Repair: { kind: 'Need', tag: 'Repair' },
  Gear: { kind: 'Need', tag: 'Gear' },
  Lego: { kind: 'Want', tag: 'Lego' },
  Clothes: { kind: 'Want', tag: 'Clothes' },
  Want: { kind: 'Want' },
}

export const cleanTag = (v: unknown): string | undefined => {
  if (typeof v !== 'string') return undefined
  return v.trim().replace(/\s+/g, ' ').slice(0, 24) || undefined
}

/** Trust boundary: localStorage and imported files are both untrusted input. */
export function parseItems(raw: unknown): Item[] {
  if (!Array.isArray(raw)) return []
  return raw.flatMap((r): Item[] => {
    if (!r || typeof r !== 'object') return []
    const o = r as Record<string, unknown>
    const title = typeof o.title === 'string' ? o.title.trim() : ''
    if (!title) return []
    const price = typeof o.price === 'number' && isFinite(o.price) ? o.price : undefined
    const legacy = typeof o.category === 'string' ? LEGACY_CATEGORY[o.category] : undefined
    return [
      {
        id: typeof o.id === 'string' && o.id ? o.id : crypto.randomUUID(),
        title,
        kind: (KINDS as readonly string[]).includes(o.kind as string)
          ? (o.kind as Kind)
          : (legacy?.kind ?? 'Need'),
        tag: cleanTag(o.tag) ?? legacy?.tag,
        urgency: (URGENCIES as readonly string[]).includes(o.urgency as string)
          ? (o.urgency as Urgency)
          : 'Later',
        price,
        note: typeof o.note === 'string' && o.note ? o.note : undefined,
        link: safeUrl(o.link),
        bought: o.bought === true,
        boughtAt: typeof o.boughtAt === 'string' ? o.boughtAt : undefined,
      },
    ]
  })
}

export function parseTodos(raw: unknown): Todo[] {
  if (!Array.isArray(raw)) return []
  return raw.flatMap((r): Todo[] => {
    if (!r || typeof r !== 'object') return []
    const o = r as Record<string, unknown>
    const title = typeof o.title === 'string' ? o.title.trim() : ''
    if (!title) return []
    return [
      {
        id: typeof o.id === 'string' && o.id ? o.id : crypto.randomUUID(),
        title,
        // A daily is pinned to Today, whatever the file claims.
        when:
          o.daily === true
            ? 'Today'
            : (WHENS as readonly string[]).includes(o.when as string)
              ? (o.when as When)
              : 'Today',
        done: o.done === true,
        doneAt: typeof o.doneAt === 'string' ? o.doneAt : undefined,
        important: o.important === true ? true : undefined,
        daily: o.daily === true ? true : undefined,
        // A daily always lands in a band. An existing list has none, so the prayers are
        // recognised by name once and everything else becomes a habit.
        group:
          o.daily !== true
            ? undefined
            : (DAILY_GROUPS as readonly string[]).includes(o.group as string)
              ? (o.group as DailyGroup)
              : groupFor(title),
        since: typeof o.since === 'string' ? o.since : undefined,
        // Whitelisted, and only kept on a daily — a one-off has no accent to colour.
        color:
          o.daily === true && (DAILY_COLORS as readonly string[]).includes(o.color as string)
            ? (o.color as string)
            : undefined,
      },
    ]
  })
}

/**
 * The start date out of a stored row. A file written before start dates existed carries a
 * bare `dueDay`, so that becomes the most recent occurrence of that day — the same billing
 * day, expressed as a real date, with nothing for the user to re-enter.
 */
function startedOnFrom(o: Record<string, unknown>, now: Date = new Date()): string | undefined {
  if (typeof o.startedOn === 'string') {
    const d = new Date(o.startedOn)
    if (isFinite(d.getTime())) return o.startedOn
  }
  const legacy = o.dueDay
  if (typeof legacy !== 'number' || !isFinite(legacy) || legacy < 1 || legacy > 31) return undefined
  const day = Math.round(legacy)
  const thisMonth = new Date(now.getFullYear(), now.getMonth(), day)
  const back = thisMonth <= now ? thisMonth : new Date(now.getFullYear(), now.getMonth() - 1, day)
  return back.toISOString()
}

export function parsePayments(raw: unknown): Payment[] {
  if (!Array.isArray(raw)) return []
  return raw.flatMap((r): Payment[] => {
    if (!r || typeof r !== 'object') return []
    const o = r as Record<string, unknown>
    const name = typeof o.name === 'string' ? o.name.trim() : ''
    if (!name) return []
    const amount = typeof o.amount === 'number' && isFinite(o.amount) ? o.amount : 0
    return [
      {
        id: typeof o.id === 'string' && o.id ? o.id : crypto.randomUUID(),
        name,
        amount: amount < 0 ? 0 : amount,
        group: cleanTag(o.group),
        paused: o.paused === true ? true : undefined,
        startedOn: startedOnFrom(o),
        paidThrough: typeof o.paidThrough === 'string' ? o.paidThrough : undefined,
      },
    ]
  })
}

export const UNGROUPED = 'Other'

const daysInMonth = (y: number, m: number) => new Date(y, m + 1, 0).getDate()
const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate())

/**
 * The next time a monthly due-day comes round. Today counts as due today, not next month —
 * the day you have to have the money is the day itself.
 *
 * A day past the end of a short month falls back to that month's last day, so a 31st
 * subscription bills on the 28th in February rather than silently skipping it.
 */
export function nextDue(dueDay: number, now: Date = new Date()): Date {
  const day = Math.min(Math.max(Math.round(dueDay), 1), 31)
  const on = (y: number, m: number) => new Date(y, m, Math.min(day, daysInMonth(y, m)))
  const thisMonth = on(now.getFullYear(), now.getMonth())
  return thisMonth >= startOfDay(now) ? thisMonth : on(now.getFullYear(), now.getMonth() + 1)
}

/** Whole days from today to the next renewal. 0 means it is due today. */
export const daysUntilDue = (dueDay: number, now: Date = new Date()): number =>
  Math.round((nextDue(dueDay, now).getTime() - startOfDay(now).getTime()) / 86400000)

/** The day of the month a subscription bills on, taken from the date it started. */
export const billingDay = (p: Payment): number | undefined => {
  if (!p.startedOn) return undefined
  const d = new Date(p.startedOn)
  return isFinite(d.getTime()) ? d.getDate() : undefined
}

/** True when this cycle has already been ticked off and is not owed again until the next. */
export function isSettled(p: Payment, now: Date = new Date()): boolean {
  const day = billingDay(p)
  if (!day || !p.paidThrough) return false
  const paid = new Date(p.paidThrough)
  return isFinite(paid.getTime()) && dayStart(paid) >= dayStart(nextDue(day, now))
}

/**
 * When this actually leaves the account next. A settled cycle skips to the following
 * month, so ticking one off clears it until it comes round again rather than for good.
 */
export function nextDueFor(p: Payment, now: Date = new Date()): Date | null {
  const day = billingDay(p)
  if (!day) return null
  const due = nextDue(day, now)
  if (!isSettled(p, now)) return due
  // The day after this cycle's date is inside the next cycle, so asking from there
  // gives the following occurrence without any month arithmetic here.
  return nextDue(day, new Date(due.getFullYear(), due.getMonth(), due.getDate() + 1))
}

/** Tick this cycle off. Idempotent: settling an already-settled cycle changes nothing. */
export const settle = (p: Payment, now: Date = new Date()): Payment => {
  const day = billingDay(p)
  if (!day) return p
  return { ...p, paidThrough: nextDue(day, now).toISOString() }
}

/** Undo a tick, putting the cycle back on the list. */
export const unsettle = (p: Payment): Payment => ({ ...p, paidThrough: undefined })

export type Upcoming = { payment: Payment; due: Date; days: number }

/**
 * Every dated, unpaused commitment in the order it will actually hit the account. A
 * payment with no date cannot be planned around, so it is not in this list — it still
 * counts toward the monthly floor.
 */
export function upcomingPayments(payments: Payment[], now: Date = new Date()): Upcoming[] {
  return payments
    .flatMap((payment) => {
      if (payment.paused) return []
      const due = nextDueFor(payment, now)
      if (!due) return []
      return [{ payment, due, days: Math.round((dayStart(due) - dayStart(now)) / 86400000) }]
    })
    .sort((a, b) => a.days - b.days || b.payment.amount - a.payment.amount)
}

/** What is about to leave the account, and how much of it. Drives the launch tab. */
export function dueSoon(
  payments: Payment[],
  now: Date = new Date(),
  within: number = URGENT_DAYS,
): { rows: Upcoming[]; total: number } {
  const rows = upcomingPayments(payments, now).filter((u) => u.days <= within)
  return { rows, total: rows.reduce((s, u) => s + u.payment.amount, 0) }
}

export type PaymentGroup = { group: string; total: number; rows: Payment[] }

/**
 * Group the commitments and total what actually leaves the account each month.
 * Paused rows stay visible but are excluded from every total — the point of the
 * figure is what you are really committed to, not what you once signed up for.
 */
export function groupPayments(payments: Payment[]): {
  groups: PaymentGroup[]
  monthly: number
  activeCount: number
} {
  const byGroup = new Map<string, Payment[]>()
  for (const p of payments) {
    const key = p.group ?? UNGROUPED
    byGroup.set(key, [...(byGroup.get(key) ?? []), p])
  }

  const groups = [...byGroup.entries()]
    .map(([group, rows]): PaymentGroup => ({
      group,
      rows,
      total: rows.reduce((s, p) => s + (p.paused ? 0 : p.amount), 0),
    }))
    .sort((a, b) => b.total - a.total || a.group.localeCompare(b.group))

  const active = payments.filter((p) => !p.paused)
  return {
    groups,
    monthly: active.reduce((s, p) => s + p.amount, 0),
    activeCount: active.length,
  }
}

/** A rendered line: the section headers take part in the sort so a drag can cross sections. */
export type Row<T> =
  | { kind: 'header'; section: string }
  | { kind: 'ghost'; section: string }
  | { kind: 'item'; item: T }

export const rowId = <T extends { id: string }>(r: Row<T>) =>
  r.kind === 'item' ? r.item.id : `${r.kind}:${r.section}`

export function buildRows<T extends { id: string }>(
  visible: T[],
  sections: readonly string[],
  sectionOf: (t: T) => string,
): Row<T>[] {
  return sections.flatMap((section): Row<T>[] => {
    const group = visible.filter((t) => sectionOf(t) === section)
    return [
      { kind: 'header', section },
      ...(group.length
        ? group.map((item): Row<T> => ({ kind: 'item', item }))
        : [{ kind: 'ghost', section } as Row<T>]),
    ]
  })
}

/**
 * Move row `from` to `to`, then re-read each entry's section from the header above it,
 * and write the result back over the slots the visible entries occupied in `all`.
 * Entries hidden by a filter keep their positions.
 */
export function applyDrag<T extends { id: string }>(
  all: T[],
  rows: Row<T>[],
  from: number,
  to: number,
  sections: readonly string[],
  withSection: (t: T, section: string) => T,
): T[] {
  let section = sections[0]
  const ordered: T[] = []
  for (const r of arrayMove(rows, from, to)) {
    if (r.kind === 'header') section = r.section
    else if (r.kind === 'item') ordered.push(withSection(r.item, section))
  }
  const shown = new Set(rows.flatMap((r) => (r.kind === 'item' ? [r.item.id] : [])))
  const slots = all.flatMap((t, i) => (shown.has(t.id) ? [i] : []))
  const next = all.slice()
  ordered.forEach((t, k) => (next[slots[k]] = t))
  return next
}

export const buildItemRows = (visible: Item[]) => buildRows(visible, URGENCIES, (i) => i.urgency)

export const applyItemDrag = (items: Item[], rows: Row<Item>[], from: number, to: number) =>
  applyDrag(items, rows, from, to, URGENCIES, (i, s) => ({ ...i, urgency: s as Urgency }))

/**
 * Reorder within the slice currently on screen, leaving everything else where it sits.
 * The day views show one bucket at a time, so a drag must not disturb the other days.
 */
export function reorderVisible<T extends { id: string }>(
  all: T[],
  visible: T[],
  from: number,
  to: number,
): T[] {
  const ordered = arrayMove(visible, from, to)
  const shown = new Set(visible.map((v) => v.id))
  const slots = all.flatMap((t, i) => (shown.has(t.id) ? [i] : []))
  const next = all.slice()
  ordered.forEach((t, k) => (next[slots[k]] = t))
  return next
}

/**
 * Rough "does this look like it matters" score, used only to pick which task to surface
 * as the preview of a day you aren't looking at. Deliberately dumb and readable: a
 * hand-starred task always wins, then wording, then shouting. Never reorders the list —
 * position stays the user's call.
 */
const SIGNALS: [RegExp, number][] = [
  [/\b(urgent|asap|immediately|emergency)\b/i, 40],
  [/\b(deadline|due|expir\w*|last day)\b/i, 30],
  [/\b(pay|bill|rent|fee|fine|invoice|tax|emi)\b/i, 25],
  [/\b(doctor|dentist|hospital|medicine|appointment)\b/i, 25],
  [/\b(exam|test|submit|assignment|interview|deliver)\b/i, 20],
  [/\b(call|email|reply|book|renew|cancel|collect)\b/i, 10],
]

export function importance(todo: Todo): number {
  if (todo.important) return 1000
  let score = 0
  for (const [re, weight] of SIGNALS) if (re.test(todo.title)) score += weight
  score += Math.min((todo.title.match(/!/g) ?? []).length, 3) * 15
  if (/\b[A-Z]{3,}\b/.test(todo.title)) score += 10
  return score
}

/** The one task worth showing from a day you're not looking at, plus how many it hides. */
/**
 * A daily is only ever done *for today* — yesterday's tick does not carry over, so it comes
 * back open every morning. Derived from `doneAt` on purpose: no reset pass, no timer, and
 * no stored "last reset" date to drift or to disagree between two machines. A one-off is
 * just `done`. Local calendar day, which is the one the user is actually living in.
 */
export function isDone(t: Todo, now: Date = new Date()): boolean {
  if (!t.daily) return t.done
  if (!t.done || !t.doneAt) return false
  return new Date(t.doneAt).toDateString() === now.toDateString()
}

const dayStart = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()

/** Milliseconds from `now` to the next local midnight. Local, so it lands at 12 AM here. */
export const msUntilMidnight = (now: Date = new Date()): number =>
  new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1).getTime() - now.getTime()

/**
 * Re-render when the local day changes.
 *
 * `isDone` is evaluated during render, so without this the day rolling over is invisible
 * until something *else* causes a render — a tap, or a sync pull on window focus. That is
 * what made the reset look like it happened at a random time in the morning rather than
 * at midnight.
 *
 * The timer alone is not enough: phones suspend timers for a backgrounded app, so a
 * wake-up also re-checks. State is the day string, so a re-render only happens when the
 * day genuinely changed.
 */
export function useDayTick(): string {
  const [day, setDay] = useState(() => new Date().toDateString())

  useEffect(() => {
    let timer = 0
    const check = () => setDay(new Date().toDateString())
    const schedule = () => {
      timer = window.setTimeout(() => {
        check()
        schedule()
      }, msUntilMidnight() + 1000) // a second past, so the clock has definitely ticked over
    }
    schedule()
    document.addEventListener('visibilitychange', check)
    window.addEventListener('focus', check)
    return () => {
      clearTimeout(timer)
      document.removeEventListener('visibilitychange', check)
      window.removeEventListener('focus', check)
    }
  }, [])

  return day
}

/** How long a task may sit in This week before it counts as ignored rather than planned. */
export const WEEK_MS = 7 * 86400000

/**
 * A task that has outstayed its bucket. Dailies are exempt: coming back every morning is
 * the point, not a failure.
 *
 * Today means "arrived on an earlier day and still is not done". This week is a window
 * rather than a day, so it only counts once the whole week has gone by — which is what was
 * missing when two tasks sat there for a fortnight without a word. Tomorrow is never
 * overdue; it rolls into Today instead.
 */
export function isOverdue(t: Todo, now: Date = new Date()): boolean {
  if (t.daily || t.done || !t.since) return false
  const age = dayStart(now) - dayStart(new Date(t.since))
  if (t.when === 'Today') return age > 0
  if (t.when === 'This week') return age >= WEEK_MS
  return false
}

/**
 * Tomorrow becomes Today once tomorrow has actually arrived.
 *
 * `when` is a relative label with no date inside it, so `since` — the day the task landed
 * in its bucket — is the only thing that can say whether the day it was written for has
 * been and gone. A task written for tomorrow *today* has today's stamp and stays put.
 *
 * Only Tomorrow rolls: This week is a window, not a day, and dailies already live in Today.
 * A row with no stamp at all (written before `since` existed) gets one instead of moving,
 * so it rolls a day later rather than jumping the moment it is first read.
 *
 * Returns the original array when nothing moved, so the caller can save unconditionally
 * without writing on every render.
 */
export function rollOver(todos: Todo[], now: Date = new Date()): Todo[] {
  const today = dayStart(now)
  let changed = false
  const next = todos.map((t) => {
    if (t.when !== 'Tomorrow' || t.done) return t
    if (!t.since) {
      changed = true
      return { ...t, since: now.toISOString() }
    }
    if (dayStart(new Date(t.since)) >= today) return t
    changed = true
    return { ...t, when: 'Today' as When, since: now.toISOString() }
  })
  return changed ? next : todos
}

/**
 * Finished one-offs bucketed by the calendar day they were ticked, newest day first. A daily
 * never lands here — it stays in Today and turns green, so the log reads as "what I got done
 * on this date" rather than the same six chores repeated forever.
 */
export function doneByDay(todos: Todo[]): { day: string; todos: Todo[] }[] {
  const groups = new Map<string, Todo[]>()
  for (const t of todos) {
    if (t.daily || !t.done) continue
    const day = t.doneAt ? new Date(t.doneAt).toDateString() : ''
    const list = groups.get(day)
    if (list) list.push(t)
    else groups.set(day, [t])
  }
  // Undated ones parse to NaN, so `|| 0` sinks them to the bottom instead of scrambling the sort.
  return [...groups]
    .sort((a, b) => (Date.parse(b[0]) || 0) - (Date.parse(a[0]) || 0))
    .map(([day, todos]) => ({ day, todos }))
}

/**
 * The peek deliberately ignores Namaz. It is a reminder of what might be forgotten, and
 * the prayers have their own fixed times — listing them there is noise that pushes the
 * one thing you actually might forget out of the slot.
 */
export function glimpse(todos: Todo[], when: When): { top: Todo | null; more: number } {
  const open = todos.filter((t) => !isDone(t) && t.when === when && t.group !== 'Namaz')
  if (!open.length) return { top: null, more: 0 }
  // Ties fall back to list position, which is the user's own ordering.
  const top = open.reduce((best, t) => (importance(t) > importance(best) ? t : best), open[0])
  return { top, more: open.length - 1 }
}

export const UNTAGGED = 'Untagged'

export type MonthSpend = {
  key: string
  label: string
  total: number
  byKind: Record<Kind, number>
  count: number
  tags: { tag: string; total: number }[]
}

const monthKey = (iso: string | undefined): string => {
  if (!iso) return 'undated'
  const d = new Date(iso)
  if (isNaN(d.getTime())) return 'undated'
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

const monthLabel = (key: string): string => {
  if (key === 'undated') return 'No date'
  const [y, m] = key.split('-').map(Number)
  return new Date(y, m - 1, 1).toLocaleDateString(undefined, { month: 'long', year: 'numeric' })
}

/**
 * What actually got spent, bucketed by the month the item was marked bought.
 * Newest first; anything bought before dates were recorded lands in "No date" at the end.
 */
export function monthlySpend(items: Item[]): MonthSpend[] {
  const buckets = new Map<string, Item[]>()
  for (const i of items) {
    if (!i.bought) continue
    const key = monthKey(i.boughtAt)
    buckets.set(key, [...(buckets.get(key) ?? []), i])
  }

  const months = [...buckets.entries()].map(([key, group]): MonthSpend => {
    const byKind = Object.fromEntries(KINDS.map((k) => [k, 0])) as Record<Kind, number>
    const byTag = new Map<string, number>()
    for (const i of group) {
      const price = i.price ?? 0
      byKind[i.kind] += price
      const tag = i.tag ?? UNTAGGED
      byTag.set(tag, (byTag.get(tag) ?? 0) + price)
    }

    return {
      key,
      label: monthLabel(key),
      total: group.reduce((s, i) => s + (i.price ?? 0), 0),
      byKind,
      count: group.length,
      tags: [...byTag.entries()]
        .map(([tag, total]) => ({ tag, total }))
        .filter((t) => t.total > 0)
        .sort((a, b) => b.total - a.total),
    }
  })

  return months.sort((a, b) => {
    if (a.key === 'undated') return 1
    if (b.key === 'undated') return -1
    return b.key.localeCompare(a.key)
  })
}

/** A band of standing tasks as Home shows it: the rows in list order, and the first still open. */
export type HomeBand = { rows: Todo[]; done: number; next: Todo | null }

export type HomeSummary = {
  /** Everything that belongs to today, done or not — the ring on the Today card. */
  today: { done: number; total: number }
  /** Today's one-offs still open, in the user's own order. */
  tasks: { open: Todo[]; overdue: number }
  namaz: HomeBand
  daily: HomeBand
  buy: { now: Item[]; soon: Item[]; nowTotal: number }
  bills: { upcoming: Upcoming[]; urgent: number; urgentTotal: number }
  /** This calendar month's spending, or undefined if nothing was bought yet. */
  spent: MonthSpend | undefined
}

/**
 * Every figure the Home boxes show, read off the three lists in one place so the screen
 * is a dumb view and the numbers are testable. Nothing is stored — this is what the lists
 * say at `now`, so it cannot drift from them.
 *
 * The ring counts a one-off ticked today even though it has left the Today list for the
 * done log: finishing it is exactly what the ring is for, and dropping it from the total
 * would make a productive day read as a smaller one.
 */
export function homeSummary(
  items: Item[],
  todos: Todo[],
  payments: Payment[],
  now: Date = new Date(),
): HomeSummary {
  const band = (rows: Todo[]): HomeBand => ({
    rows,
    done: rows.filter((t) => isDone(t, now)).length,
    next: rows.find((t) => !isDone(t, now)) ?? null,
  })
  const namaz = band(todos.filter((t) => t.daily && t.group === 'Namaz'))
  const daily = band(todos.filter((t) => t.daily && t.group !== 'Namaz'))

  const open = todos.filter((t) => !t.daily && t.when === 'Today' && !t.done)
  const today = now.toDateString()
  const doneToday = todos.filter(
    (t) => !t.daily && t.done && t.doneAt && new Date(t.doneAt).toDateString() === today,
  ).length

  const unbought = items.filter((i) => !i.bought)
  const nowItems = unbought.filter((i) => i.urgency === 'Now')
  const urgent = dueSoon(payments, now)

  return {
    today: {
      done: namaz.done + daily.done + doneToday,
      total: namaz.rows.length + daily.rows.length + open.length + doneToday,
    },
    tasks: { open, overdue: open.filter((t) => isOverdue(t, now)).length },
    namaz,
    daily,
    buy: {
      now: nowItems,
      soon: unbought.filter((i) => i.urgency === 'Soon'),
      nowTotal: nowItems.reduce((s, i) => s + (i.price ?? 0), 0),
    },
    bills: {
      upcoming: upcomingPayments(payments, now),
      urgent: urgent.rows.length,
      urgentTotal: urgent.total,
    },
    spent: monthlySpend(items).find((m) => m.key === monthKey(now.toISOString())),
  }
}

function useStored<T>(key: string, parse: (raw: unknown) => T[]) {
  const [value, setValue] = useState<T[]>(() => {
    try {
      return parse(JSON.parse(localStorage.getItem(key) ?? '[]'))
    } catch {
      return []
    }
  })
  useEffect(() => {
    localStorage.setItem(key, JSON.stringify(value))
  }, [key, value])
  return [value, setValue] as const
}

export function useItems() {
  const [items, setRaw] = useStored(ITEMS_KEY, parseItems)

  // Undo stack: snapshot the whole list before destructive actions. Cheap at this size.
  // ponytail: full snapshots, switch to patches if the list ever gets huge.
  const undoStack = useRef<{ items: Item[]; label: string }[]>([])
  const [toast, setToast] = useState<string | null>(null)

  const commit = (next: Item[], undoLabel?: string) => {
    if (undoLabel) {
      undoStack.current = [...undoStack.current.slice(-19), { items, label: undoLabel }]
      setToast(undoLabel)
    }
    setRaw(next)
  }

  const undo = () => {
    const last = undoStack.current.pop()
    if (!last) return
    setRaw(last.items)
    setToast(null)
  }

  return { items, commit, replaceAll: setRaw, undo, toast, setToast }
}

export function useTodos() {
  const [todos, setTodos] = useStored(TODOS_KEY, parseTodos)
  return { todos, setTodos, replaceAll: setTodos }
}

export function usePayments() {
  const [payments, setPayments] = useStored(PAYMENTS_KEY, parsePayments)
  return { payments, setPayments }
}

const BUDGET_KEY = 'buy-next.budget'

/**
 * An optional ceiling for a month's spending. Spending has no natural limit, so without
 * one a "filling up" gauge has nothing to fill toward — 0 means unset, and the month
 * gauge is simply hidden rather than guessing a number on the user's behalf.
 */
export function useBudget() {
  // NaN (junk) and negatives both collapse to 0, which is "unset".
  const [budget, setBudget] = useState(() =>
    Math.max(0, Number(localStorage.getItem(BUDGET_KEY)) || 0),
  )
  useEffect(() => {
    localStorage.setItem(BUDGET_KEY, String(budget))
  }, [budget])
  return { budget, setBudget }
}

/** 0..1, and how far past the line if it went over. Guards a zero or missing limit. */
export function fillRatio(value: number, limit: number): number {
  if (!(limit > 0) || !(value > 0)) return 0
  return Math.min(value / limit, 1)
}

