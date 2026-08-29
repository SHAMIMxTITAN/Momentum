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
}

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
}

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
        since: typeof o.since === 'string' ? o.since : undefined,
      },
    ]
  })
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
      },
    ]
  })
}

export const UNGROUPED = 'Other'

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

/**
 * A one-off still open in Today that arrived on an earlier day — it rolled over rather than
 * being done. Dailies are exempt: coming back every morning is the point, not a failure.
 */
export function isOverdue(t: Todo, now: Date = new Date()): boolean {
  if (t.daily || t.done || t.when !== 'Today' || !t.since) return false
  return dayStart(new Date(t.since)) < dayStart(now)
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

export function glimpse(todos: Todo[], when: When): { top: Todo | null; more: number } {
  const open = todos.filter((t) => !isDone(t) && t.when === when)
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

