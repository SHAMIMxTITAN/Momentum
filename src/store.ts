import { useEffect, useRef, useState } from 'react'
import { arrayMove } from '@dnd-kit/sortable'

export const CATEGORIES = ['Repair', 'Gear', 'Lego', 'Clothes', 'Want'] as const
export const URGENCIES = ['Now', 'Soon', 'Later'] as const

export type Category = (typeof CATEGORIES)[number]
export type Urgency = (typeof URGENCIES)[number]

export type Item = {
  id: string
  title: string
  category: Category
  urgency: Urgency
  price?: number
  note?: string
  link?: string
  bought: boolean
  boughtAt?: string
}

// `order` is the array index — the list is the order. Export/import carries it implicitly.

const KEY = 'buy-next.v1'

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

/** Trust boundary: localStorage and imported files are both untrusted input. */
export function parseItems(raw: unknown): Item[] {
  if (!Array.isArray(raw)) return []
  return raw.flatMap((r): Item[] => {
    if (!r || typeof r !== 'object') return []
    const o = r as Record<string, unknown>
    const title = typeof o.title === 'string' ? o.title.trim() : ''
    if (!title) return []
    const price = typeof o.price === 'number' && isFinite(o.price) ? o.price : undefined
    return [
      {
        id: typeof o.id === 'string' && o.id ? o.id : crypto.randomUUID(),
        title,
        category: (CATEGORIES as readonly string[]).includes(o.category as string)
          ? (o.category as Category)
          : 'Gear',
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

/** A rendered line: the section headers take part in the sort so a drag can cross sections. */
export type Row =
  | { kind: 'header'; urgency: Urgency }
  | { kind: 'ghost'; urgency: Urgency }
  | { kind: 'item'; item: Item }

export const rowId = (r: Row) => (r.kind === 'item' ? r.item.id : `${r.kind}:${r.urgency}`)

export function buildRows(visible: Item[]): Row[] {
  return URGENCIES.flatMap((urgency): Row[] => {
    const group = visible.filter((i) => i.urgency === urgency)
    return [
      { kind: 'header', urgency },
      ...(group.length
        ? group.map((item): Row => ({ kind: 'item', item }))
        : [{ kind: 'ghost', urgency } as Row]),
    ]
  })
}

/**
 * Move row `from` to `to`, then re-read each item's urgency from the header above it,
 * and write the result back over the slots the visible items occupied in `items`.
 * Items hidden by a category filter keep their positions.
 */
export function applyDrag(items: Item[], rows: Row[], from: number, to: number): Item[] {
  let urgency: Urgency = 'Now'
  const ordered: Item[] = []
  for (const r of arrayMove(rows, from, to)) {
    if (r.kind === 'header') urgency = r.urgency
    else if (r.kind === 'item') ordered.push({ ...r.item, urgency })
  }
  const shown = new Set(rows.flatMap((r) => (r.kind === 'item' ? [r.item.id] : [])))
  const slots = items.flatMap((it, i) => (shown.has(it.id) ? [i] : []))
  const next = items.slice()
  ordered.forEach((it, k) => (next[slots[k]] = it))
  return next
}

export function useItems() {
  const [items, setRaw] = useState<Item[]>(() => {
    try {
      return parseItems(JSON.parse(localStorage.getItem(KEY) ?? '[]'))
    } catch {
      return []
    }
  })

  useEffect(() => {
    localStorage.setItem(KEY, JSON.stringify(items))
  }, [items])

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
