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
}

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
}

// `order` is the array index — the list is the order. Export/import carries it implicitly.

const ITEMS_KEY = 'buy-next.v1'
const TODOS_KEY = 'buy-next.todos.v1'
const PAYMENTS_KEY = 'buy-next.payments.v1'
const SCRIPTS_KEY = 'buy-next.scripts.v1'

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
        // Whitelisted, and only kept on a daily — a one-off has no accent to colour.
        color:
          o.daily === true && (DAILY_COLORS as readonly string[]).includes(o.color as string)
            ? (o.color as string)
            : undefined,
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

/* ------------------------------------------------------------------ scripts */

export const SCRIPT_STATUSES = ['Idea', 'Writing', 'Ready', 'Recorded'] as const
export type ScriptStatus = (typeof SCRIPT_STATUSES)[number]

export const BLOCK_TYPES = [
  'paragraph',
  'h1',
  'h2',
  'h3',
  'bulleted',
  'numbered',
  'quote',
  'code',
  'divider',
  'toggle',
  'callout',
] as const
export type BlockType = (typeof BLOCK_TYPES)[number]

/**
 * Marks are flags on a run of text, never nested tags — that is what lets bold and a
 * highlight combine without the DOM deciding which one wraps the other, and what makes a
 * Markdown serialiser a fold over an array rather than a tree walk.
 */
export type Span = {
  text: string
  bold?: boolean
  italic?: boolean
  underline?: boolean
  strike?: boolean
  code?: boolean
  color?: string
  bg?: string
  link?: string
}

export type BlockProps = {
  collapsed?: boolean
  color?: string
  emoji?: string
  language?: string
}

export type Block = {
  id: string
  type: BlockType
  content: Span[]
  children: Block[]
  props?: BlockProps
}

/** The mark keys, so a toggle can be applied generically. `text` is not one of them. */
export const MARKS = ['bold', 'italic', 'underline', 'strike', 'code'] as const
export type Mark = (typeof MARKS)[number]

export const emptyBlock = (type: BlockType = 'paragraph'): Block => ({
  id: crypto.randomUUID(),
  type,
  content: [],
  children: [],
})

export const spanText = (content: Span[]): string => content.map((s) => s.text).join('')

const sameMarks = (a: Span, b: Span): boolean =>
  a.bold === b.bold &&
  a.italic === b.italic &&
  a.underline === b.underline &&
  a.strike === b.strike &&
  a.code === b.code &&
  a.color === b.color &&
  a.bg === b.bg &&
  a.link === b.link

/**
 * Drops empty runs and coalesces neighbours carrying the same marks. Everything below
 * returns through here, so a block never accumulates fragmented spans as it is edited.
 */
export function normalizeSpans(content: Span[]): Span[] {
  const out: Span[] = []
  for (const s of content) {
    if (!s.text) continue
    const last = out[out.length - 1]
    if (last && sameMarks(last, s)) last.text += s.text
    else out.push({ ...s })
  }
  return out
}

/** Characters [from, to) as spans, with marks preserved across the cut. */
export function sliceSpans(content: Span[], from: number, to: number = Infinity): Span[] {
  const out: Span[] = []
  let at = 0
  for (const s of content) {
    const start = at
    const end = at + s.text.length
    at = end
    if (end <= from || start >= to) continue
    out.push({
      ...s,
      text: s.text.slice(Math.max(from - start, 0), Math.min(to - start, s.text.length)),
    })
  }
  return normalizeSpans(out)
}

export const concatSpans = (...parts: Span[][]): Span[] => normalizeSpans(parts.flat())

/**
 * Set or clear one mark over [from, to). Runs split at the boundaries so a mark can cover
 * part of a span. `on` is passed in rather than toggled per-run: a selection across mixed
 * formatting would otherwise invert itself piece by piece instead of picking one answer.
 */
export function applyMark(
  content: Span[],
  from: number,
  to: number,
  mark: Mark | 'color' | 'bg',
  on: boolean | string | undefined,
): Span[] {
  if (from >= to) return content
  const before = sliceSpans(content, 0, from)
  const middle = sliceSpans(content, from, to).map((s) => ({ ...s, [mark]: on || undefined }))
  const after = sliceSpans(content, to)
  return concatSpans(before, middle, after)
}

/**
 * True when every character in the range already carries the mark. That is what makes a
 * toolbar button a toggle rather than a one-way switch.
 */
export function hasMark(content: Span[], from: number, to: number, mark: Mark): boolean {
  const run = sliceSpans(content, from, to)
  return run.length > 0 && run.every((s) => s[mark] === true)
}

/** v1 stored a flat list of `{type, text, indent}`; the indents become real nesting. */
const LEGACY_TYPE: Record<string, BlockType> = {
  p: 'paragraph',
  bullet: 'bulleted',
  number: 'numbered',
  // Scripts do not need checklists — the To-do tab covers that — so an old one becomes a bullet.
  todo: 'bulleted',
  h1: 'h1',
  h2: 'h2',
  h3: 'h3',
  quote: 'quote',
  code: 'code',
  divider: 'divider',
}

function parseSpans(raw: unknown, fallbackText: unknown): Span[] {
  if (Array.isArray(raw)) {
    return normalizeSpans(
      raw.flatMap((r): Span[] => {
        if (!r || typeof r !== 'object') return []
        const o = r as Record<string, unknown>
        if (typeof o.text !== 'string' || !o.text) return []
        // Keys are only set when they are true, so a plain run is exactly `{ text }` —
        // undefined-valued keys would survive a deepEqual and bloat every comparison.
        const span: Span = { text: o.text }
        for (const m of MARKS) if (o[m] === true) span[m] = true
        if (typeof o.color === 'string') span.color = o.color
        if (typeof o.bg === 'string') span.bg = o.bg
        const link = safeUrl(o.link)
        if (link) span.link = link
        return [span]
      }),
    )
  }
  return typeof fallbackText === 'string' && fallbackText ? [{ text: fallbackText }] : []
}

export function parseBlocks(raw: unknown): Block[] {
  const flat = (Array.isArray(raw) ? raw : []).flatMap((r): { block: Block; indent: number }[] => {
    if (!r || typeof r !== 'object') return []
    const o = r as Record<string, unknown>
    const named = typeof o.type === 'string' ? o.type : ''
    const type: BlockType = (BLOCK_TYPES as readonly string[]).includes(named)
      ? (named as BlockType)
      : (LEGACY_TYPE[named] ?? 'paragraph')
    const indentRaw = typeof o.indent === 'number' && isFinite(o.indent) ? Math.round(o.indent) : 0
    const props = o.props && typeof o.props === 'object' ? (o.props as BlockProps) : undefined
    return [
      {
        indent: Math.min(Math.max(indentRaw, 0), 3),
        block: {
          id: typeof o.id === 'string' && o.id ? o.id : crypto.randomUUID(),
          type,
          content: parseSpans(o.content, o.text),
          children: parseBlocks(o.children),
          props: props && Object.keys(props).length ? props : undefined,
        },
      },
    ]
  })

  // A jump of more than one level clamps to one, so a corrupt file cannot make a hole.
  const roots: Block[] = []
  const stack: Block[] = []
  for (const { block, indent } of flat) {
    const depth = Math.min(indent, stack.length)
    stack.length = depth
    const parent = stack[depth - 1]
    if (parent) parent.children.push(block)
    else roots.push(block)
    stack.push(block)
  }
  return roots
}

/** Depth-first, so callers can treat the tree as the list that is actually on screen. */
export function flattenBlocks(blocks: Block[]): { block: Block; depth: number }[] {
  const out: { block: Block; depth: number }[] = []
  const walk = (list: Block[], depth: number) => {
    for (const b of list) {
      out.push({ block: b, depth })
      if (b.children.length) walk(b.children, depth + 1)
    }
  }
  walk(blocks, 0)
  return out
}

/** Words across every block, children included. A divider has no text. */
export const wordCount = (blocks: Block[]): number =>
  flattenBlocks(blocks).reduce((n, { block }) => {
    const t = spanText(block.content).trim()
    return n + (t ? t.split(/\s+/).length : 0)
  }, 0)


/* ---------------------------------------------------------- block tree ops */

/** Replace one block in place, leaving the rest of the tree identical. */
export function mapBlock(tree: Block[], id: string, fn: (b: Block) => Block): Block[] {
  return tree.map((b) =>
    b.id === id ? fn(b) : b.children.length ? { ...b, children: mapBlock(b.children, id, fn) } : b,
  )
}

export function findBlock(tree: Block[], id: string): Block | null {
  for (const b of tree) {
    if (b.id === id) return b
    const hit = findBlock(b.children, id)
    if (hit) return hit
  }
  return null
}

/** Drop a block (and its children) out of the tree. */
export function removeBlock(tree: Block[], id: string): Block[] {
  return tree.flatMap((b) =>
    b.id === id ? [] : [b.children.length ? { ...b, children: removeBlock(b.children, id) } : b],
  )
}

export function insertAfter(tree: Block[], id: string, blocks: Block[]): Block[] {
  const out: Block[] = []
  for (const b of tree) {
    const next = b.children.length ? { ...b, children: insertAfter(b.children, id, blocks) } : b
    out.push(next)
    if (b.id === id) out.push(...blocks)
  }
  return out
}

/** The list a block lives in, plus its index there. */
function locate(tree: Block[], id: string): { siblings: Block[]; index: number } | null {
  const index = tree.findIndex((b) => b.id === id)
  if (index >= 0) return { siblings: tree, index }
  for (const b of tree) {
    const hit = locate(b.children, id)
    if (hit) return hit
  }
  return null
}

export const blockDepth = (tree: Block[], id: string): number => {
  const walk = (list: Block[], depth: number): number => {
    for (const b of list) {
      if (b.id === id) return depth
      const hit = walk(b.children, depth + 1)
      if (hit >= 0) return hit
    }
    return -1
  }
  return walk(tree, 0)
}

/**
 * Nest under the sibling above. A first child has nothing to nest under, so it stays put
 * — that is the rule that stops Tab opening a hole in the tree.
 */
export function indentBlock(tree: Block[], id: string): Block[] {
  const at = locate(tree, id)
  if (!at || at.index === 0) return tree
  const block = at.siblings[at.index]
  const above = at.siblings[at.index - 1]
  return mapBlock(removeBlock(tree, id), above.id, (b) => ({
    ...b,
    children: [...b.children, block],
  }))
}

/** Become the next sibling of the parent. A root block has nowhere to go. */
export function outdentBlock(tree: Block[], id: string): Block[] {
  const parent = findParent(tree, id)
  if (!parent) return tree
  const block = findBlock(tree, id)
  if (!block) return tree
  return insertAfter(removeBlock(tree, id), parent.id, [block])
}

export function findParent(tree: Block[], id: string): Block | null {
  for (const b of tree) {
    if (b.children.some((c) => c.id === id)) return b
    const hit = findParent(b.children, id)
    if (hit) return hit
  }
  return null
}

/** Swap with the sibling above or below, carrying children along. */
export function moveBlock(tree: Block[], id: string, dir: -1 | 1): Block[] {
  const at = locate(tree, id)
  if (!at) return tree
  const to = at.index + dir
  if (to < 0 || to >= at.siblings.length) return tree
  const reordered = [...at.siblings]
  const [held] = reordered.splice(at.index, 1)
  reordered.splice(to, 0, held)
  // Rebuild by replacing that sibling list wherever it sits.
  const swap = (list: Block[]): Block[] =>
    list === at.siblings
      ? reordered
      : list.map((b) => (b.children.length ? { ...b, children: swap(b.children) } : b))
  return swap(tree)
}

const reid = (b: Block): Block => ({
  ...b,
  id: crypto.randomUUID(),
  children: b.children.map(reid),
})

export function duplicateBlock(tree: Block[], id: string): Block[] {
  const block = findBlock(tree, id)
  return block ? insertAfter(tree, id, [reid(block)]) : tree
}

/** The block visually above `id` in the flattened order, or null at the top. */
export function blockAbove(tree: Block[], id: string): Block | null {
  const flat = flattenBlocks(tree)
  const i = flat.findIndex((f) => f.block.id === id)
  return i > 0 ? flat[i - 1].block : null
}

export type Script = {
  id: string
  title: string
  status: ScriptStatus
  blocks: Block[]
  updatedAt: string
}

export function parseScripts(raw: unknown): Script[] {
  if (!Array.isArray(raw)) return []
  return raw.flatMap((r): Script[] => {
    if (!r || typeof r !== 'object') return []
    const o = r as Record<string, unknown>
    const blocks = parseBlocks(o.blocks)
    return [
      {
        id: typeof o.id === 'string' && o.id ? o.id : crypto.randomUUID(),
        title: typeof o.title === 'string' ? o.title.trim() : '',
        status: (SCRIPT_STATUSES as readonly string[]).includes(o.status as string)
          ? (o.status as ScriptStatus)
          : 'Idea',
        // A script always has somewhere to type.
        blocks: blocks.length ? blocks : [emptyBlock()],
        updatedAt: typeof o.updatedAt === 'string' ? o.updatedAt : new Date().toISOString(),
      },
    ]
  })
}

/** Rounded up, and never "0 min" for a script that has words in it. */
export const readingMinutes = (words: number): number => (words ? Math.max(1, Math.round(words / 150)) : 0)

const rtf = new Intl.RelativeTimeFormat('en', { numeric: 'auto' })
const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ['year', 31536000],
  ['month', 2592000],
  ['week', 604800],
  ['day', 86400],
  ['hour', 3600],
  ['minute', 60],
]

/** "2 hours ago", "yesterday". Intl does the wording and the pluralising. */
export function relativeTime(iso: string, now: Date = new Date()): string {
  const then = new Date(iso).getTime()
  if (!isFinite(then)) return ''
  const secs = Math.round((then - now.getTime()) / 1000)
  const abs = Math.abs(secs)
  if (abs < 45) return 'just now'
  for (const [unit, size] of UNITS) {
    if (abs >= size) return rtf.format(Math.round(secs / size), unit)
  }
  return 'just now'
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

export function useScripts() {
  const [scripts, setScripts] = useStored(SCRIPTS_KEY, parseScripts)
  return { scripts, setScripts }
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

