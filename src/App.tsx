import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import { restrictToVerticalAxis } from '@dnd-kit/modifiers'
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { AnimatePresence, MotionConfig, motion } from 'framer-motion'
import {
  Check,
  ChevronLeft,
  ChevronRight,
  GripVertical,
  Moon,
  Repeat,
  Sun,
  Star,
  X,
} from 'lucide-react'
import {
  KINDS,
  UNTAGGED,
  WHENS,
  applyItemDrag,
  buildItemRows,
  buildRows,
  applyDrag,
  cleanTag,
  doneByDay,
  fillRatio,
  glimpse,
  isOverdue,
  groupPayments,
  monthlySpend,
  isDone,
  SCRIPT_STATUSES,
  emptyBlock,
  wordCount,
  readingMinutes,
  relativeTime,
  useScripts,
  DAILY_COLORS,
  DEFAULT_DAILY_COLOR,
  reorderVisible,
  rowId,
  safeUrl,
  useBudget,
  useItems,
  usePayments,
  useTodos,
  parseItems,
  parseTodos,
  parsePayments,
  parseScripts,
  type Item,
  type Kind,
  type Payment,
  type Todo,
  type Urgency,
  type Script,
  type ScriptStatus,
  type Block,
  type BlockType,
  type When,
} from './store'
import { useTheme } from './theme'
import { useGitHubSync, validRepo, type Status, type SyncConfig } from './github'

const KIND_COLOR: Record<Kind, string> = {
  Need: '#007AFF',
  Both: '#30B0C7',
  Want: '#AF52DE',
}

const URGENCY_COLOR: Record<Urgency, string> = {
  Now: '#FF3B30',
  Soon: '#FF9500',
  Later: '#8E8E93',
  Maybe: '#5E5CE6',
}

const WHEN_COLOR: Record<string, string> = {
  Today: '#FF3B30',
  Tomorrow: '#FF9500',
  'This week': '#8E8E93',
}

const SPRING = { type: 'spring' as const, stiffness: 520, damping: 36, mass: 0.7 }

// Grows the tap area to a thumb-sized box without changing the icon's footprint.
const TAP = "relative after:absolute after:-inset-x-1.5 after:-inset-y-3 after:content-['']"

// dnd-kit auto-scrolls every scrollable ancestor you drag near the edge of, and the tab pager
// is one of them — with the grip 20px from the left, every drag sat inside the pager's own
// scroll zone and slid it into the previous tab, or fought scroll-snap into a flicker. Rows
// only ever move vertically, so vertical scrollers are the only ones worth auto-scrolling.
const AUTO_SCROLL_Y = { canScroll: (el: Element) => el.scrollHeight > el.clientHeight }

const inr = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 })
const money = (n: number) => `₹${inr.format(n)}`

const FIELD =
  'rounded-lg bg-[var(--field)] px-2.5 py-1.5 text-[14px] tracking-tight outline-none'

type Tab = 'Buy' | 'To-do' | 'Spending' | 'Scripts'
const TABS: Tab[] = ['Buy', 'To-do', 'Spending', 'Scripts']

export default function App() {
  const { items, commit, replaceAll, undo, toast, setToast } = useItems()
  const { todos, setTodos } = useTodos()
  const { payments, setPayments } = usePayments()
  const { scripts, setScripts } = useScripts()
  // Lifted out of ScriptsView because the pager has to know: a swipe inside the editor
  // would fight text selection, so paging is switched off while a script is open.
  const [openScript, setOpenScript] = useState<string | null>(null)
  const theme = useTheme()
  // To-do opens first: it is the tab with something to do *today*. It also sits in the
  // middle, so the first swipe works in either direction.
  const [tab, setTab] = useState<Tab>('To-do')
  const sync = useGitHubSync(
    items,
    replaceAll,
    todos,
    setTodos,
    payments,
    setPayments,
    scripts,
    setScripts,
  )

  const pager = useRef<HTMLDivElement>(null)

  // The scroll position is the source of truth for which tab is showing; this only
  // mirrors it into state so the header can highlight one.
  const onScroll = () => {
    const el = pager.current
    if (!el) return
    const next = TABS[Math.round(el.scrollLeft / el.clientWidth)]
    if (next && next !== tab) setTab(next)
  }

  const goTo = (t: Tab) => {
    const el = pager.current
    el?.scrollTo({ left: TABS.indexOf(t) * el.clientWidth, behavior: 'smooth' })
  }

  // Open on To-do. Jumps rather than scrolls, and before paint, so the first frame is
  // already the right page — a smooth scroll here would look like a glitch on load.
  useLayoutEffect(() => {
    const el = pager.current
    if (el) el.scrollLeft = TABS.indexOf('To-do') * el.clientWidth
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null
      if (el && (el.tagName === 'INPUT' || el.isContentEditable)) return // let the field undo itself
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault()
        undo()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [undo])

  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(null), 5000)
    return () => clearTimeout(t)
  }, [toast, setToast])

  // Export used to be a bare array of items. It is now the whole app, because scripts are
  // too much work to lose to a half-backup.
  const exportJson = () => {
    const dump = { version: 2, items, todos, payments, scripts }
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(dump, null, 2)], { type: 'application/json' }),
    )
    const a = document.createElement('a')
    a.href = url
    a.download = `momentum-${new Date().toISOString().slice(0, 10)}.json`
    a.click()
    URL.revokeObjectURL(url)
  }

  /**
   * Reads both shapes: the old bare array (items only) and the object. A key that is
   * absent leaves that list alone rather than emptying it — importing a pre-Scripts
   * backup must not wipe the scripts it predates.
   */
  const importJson = async (file: File) => {
    try {
      const raw: unknown = JSON.parse(await file.text())
      if (Array.isArray(raw)) {
        const parsed = parseItems(raw)
        if (!parsed.length) return setToast('Nothing usable in that file')
        replaceAll(parsed)
        return setToast(`Imported ${parsed.length} items`)
      }
      if (!raw || typeof raw !== 'object') return setToast('Nothing usable in that file')
      const o = raw as Record<string, unknown>
      const counts: string[] = []
      if ('items' in o) {
        const v = parseItems(o.items)
        replaceAll(v)
        counts.push(`${v.length} items`)
      }
      if ('todos' in o) {
        const v = parseTodos(o.todos)
        setTodos(v)
        counts.push(`${v.length} tasks`)
      }
      if ('payments' in o) {
        const v = parsePayments(o.payments)
        setPayments(v)
        counts.push(`${v.length} payments`)
      }
      if ('scripts' in o) {
        const v = parseScripts(o.scripts)
        setScripts(v)
        counts.push(`${v.length} scripts`)
      }
      setToast(counts.length ? `Imported ${counts.join(', ')}` : 'Nothing usable in that file')
    } catch {
      setToast(`Couldn't read that file`)
    }
  }

  return (
    <MotionConfig reducedMotion="user" transition={SPRING}>
      {/* Column: a fixed header over a pager that owns all the scrolling. The pager has to
          be a real height for its pages to scroll on their own, hence h-dvh + min-h-0. */}
      <div className="flex h-dvh flex-col bg-[var(--bg)]">
        <div className="mx-auto w-full max-w-2xl shrink-0 px-3 pt-4 pb-2 sm:px-6">
          <div className="flex items-center justify-between pb-3">
            <div className="flex gap-1">
              {TABS.map((t) => (
                <button
                  key={t}
                  onClick={() => goTo(t)}
                  className="rounded-full px-3 py-1.5 text-[14px] font-semibold tracking-tight transition-colors"
                  style={
                    tab === t
                      ? { background: 'var(--card-2)', color: 'var(--text)' }
                      : { color: 'var(--muted)' }
                  }
                >
                  {t}
                </button>
              ))}
            </div>
            <ThemeToggle resolved={theme.resolved} cycle={theme.cycle} />
          </div>
          <ConflictBars sync={sync} />
        </div>

        {/* Native scroll-snap does the paging: the page tracks the finger, keeps its
            throw velocity and snaps, all without a line of animation code. It also
            fixes swipes on inner scrollers (the tag chip row) for free — nested
            scroll containers consume their own gesture instead of paging the parent. */}
        <div
          ref={pager}
          onScroll={onScroll}
          className={`flex min-h-0 flex-1 overscroll-x-contain [scrollbar-width:none] [&::-webkit-scrollbar]:hidden ${
            // Paging off inside the editor: a horizontal swipe there is a text selection.
            openScript ? 'overflow-x-hidden' : 'snap-x snap-mandatory overflow-x-auto'
          }`}
        >
          {TABS.map((t) => (
            <section
              key={t}
              className="w-full shrink-0 snap-start overflow-y-auto overscroll-y-contain"
            >
              <div className="mx-auto max-w-2xl px-3 pb-32 sm:px-6">
                {t === 'Buy' && (
                  <BuyView
                    items={items}
                    commit={commit}
                    replaceAll={replaceAll}
                    setToast={setToast}
                    sync={sync}
                    onExport={exportJson}
                    onImport={importJson}
                  />
                )}
                {t === 'To-do' && <TodoView todos={todos} setTodos={setTodos} />}
                {t === 'Spending' && (
                  <SpendView items={items} payments={payments} setPayments={setPayments} />
                )}
                {t === 'Scripts' && (
                  <ScriptsView
                    scripts={scripts}
                    setScripts={setScripts}
                    openId={openScript}
                    setOpenId={setOpenScript}
                  />
                )}
              </div>
            </section>
          ))}
        </div>

        <AnimatePresence>
          {toast && (
            <motion.div
              initial={{ y: 60, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: 60, opacity: 0 }}
              className="fixed inset-x-0 bottom-6 z-30 flex justify-center px-4"
            >
              <div className="flex items-center gap-4 rounded-full bg-[#1D1D1F] py-3 pr-3 pl-5 text-[15px] text-white dark:bg-[#2C2C2E]">
                <span className="max-w-[60vw] truncate">{toast}</span>
                <button
                  onClick={undo}
                  className="rounded-full bg-white/15 px-3 py-1 font-semibold text-white"
                >
                  Undo
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </MotionConfig>
  )
}

function ThemeToggle({ resolved, cycle }: { resolved: 'light' | 'dark'; cycle: () => void }) {
  const Icon = resolved === 'dark' ? Moon : Sun
  return (
    <button
      onClick={cycle}
      aria-label={`${resolved} mode. Tap to switch.`}
      title={`${resolved} mode`}
      className="grid size-9 place-items-center rounded-full bg-[var(--card)] text-[var(--muted)] transition-colors hover:text-[var(--text)]"
    >
      <Icon size={16} />
    </button>
  )
}

type Sync = ReturnType<typeof useGitHubSync>

function ConflictBars({ sync }: { sync: Sync }) {
  return (
    <>
      {sync.items.conflict && (
        <ConflictBar
          what="list"
          count={sync.items.conflict.items.length}
          resolve={sync.items.resolve}
        />
      )}
      {sync.todos.conflict && (
        <ConflictBar
          what="to-do list"
          count={sync.todos.conflict.items.length}
          resolve={sync.todos.resolve}
        />
      )}
      {sync.payments.conflict && (
        <ConflictBar
          what="payments list"
          count={sync.payments.conflict.items.length}
          resolve={sync.payments.resolve}
        />
      )}
      {sync.scripts.conflict && (
        <ConflictBar
          what="scripts"
          count={sync.scripts.conflict.items.length}
          resolve={sync.scripts.resolve}
        />
      )}
    </>
  )
}

function ConflictBar({
  what,
  count,
  resolve,
}: {
  what: string
  count: number
  resolve: (keep: 'mine' | 'theirs') => void
}) {
  return (
    <div className="mb-2 rounded-2xl bg-[#FFF2F2] px-4 py-3.5 dark:bg-[#2A1414]">
      <p className="text-[15px] tracking-tight text-[var(--text)]">
        This {what} and the one on GitHub both changed. Keep which?
      </p>
      <div className="flex gap-2 pt-2.5">
        <button
          onClick={() => resolve('mine')}
          className="rounded-full bg-[#FF3B30] px-3.5 py-1.5 text-[14px] font-semibold text-white"
        >
          This machine
        </button>
        <button
          onClick={() => resolve('theirs')}
          className="rounded-full bg-[var(--field)] px-3.5 py-1.5 text-[14px] font-semibold text-[var(--text)]"
        >
          GitHub ({count})
        </button>
      </div>
      <p className="pt-2 text-[12px] text-[var(--muted)]">
        Either way the other version stays in the repo’s commit history.
      </p>
    </div>
  )
}

/* ---------------------------------------------------------------- Buy view */

function BuyView({
  items,
  commit,
  replaceAll,
  setToast,
  sync,
  onExport,
  onImport,
}: {
  items: Item[]
  commit: (next: Item[], undoLabel?: string) => void
  replaceAll: (items: Item[]) => void
  setToast: (t: string | null) => void
  sync: Sync
  onExport: () => void
  onImport: (file: File) => void
}) {
  const [kindFilter, setKindFilter] = useState<Set<Kind>>(new Set())
  const [tagFilter, setTagFilter] = useState<Set<string>>(new Set())
  const [editing, setEditing] = useState<string | null>(null)
  const [showBought, setShowBought] = useState(false)
  const [showSync, setShowSync] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  const tags = useMemo(
    () => [...new Set(items.flatMap((i) => (i.tag ? [i.tag] : [])))].sort(),
    [items],
  )

  const isVisible = (i: Item) =>
    !i.bought &&
    (kindFilter.size === 0 || kindFilter.has(i.kind)) &&
    (tagFilter.size === 0 || (i.tag != null && tagFilter.has(i.tag)))

  const open = items.filter((i) => !i.bought)
  const visible = items.filter(isVisible)
  const bought = items.filter((i) => i.bought)

  const nowTotal = open.filter((i) => i.urgency === 'Now').reduce((s, i) => s + (i.price ?? 0), 0)
  const openTotal = open.reduce((s, i) => s + (i.price ?? 0), 0)
  const needTotal = open.reduce((s, i) => s + (i.kind === 'Need' ? (i.price ?? 0) : 0), 0)

  const rows = buildItemRows(visible)

  const update = (id: string, patch: Partial<Item>) =>
    commit(items.map((i) => (i.id === id ? { ...i, ...patch } : i)))

  const add = (draft: { title: string; price?: number; kind: Kind; tag?: string }) =>
    commit([
      ...items,
      {
        id: crypto.randomUUID(),
        title: draft.title,
        kind: draft.kind,
        tag: draft.tag,
        price: draft.price,
        urgency: 'Later',
        bought: false,
      },
    ])

  const toggleBought = (i: Item) =>
    commit(
      items.map((x) =>
        x.id === i.id
          ? { ...x, bought: !x.bought, boughtAt: x.bought ? undefined : new Date().toISOString() }
          : x,
      ),
      i.bought ? undefined : `Bought “${i.title}”`,
    )

  const remove = (i: Item) =>
    commit(
      items.filter((x) => x.id !== i.id),
      `Deleted “${i.title}”`,
    )

  const onDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over) return
    const ids = rows.map(rowId)
    const from = ids.indexOf(String(active.id))
    const to = ids.indexOf(String(over.id))
    if (from < 0 || to < 0 || from === to) return
    commit(applyItemDrag(items, rows, from, to))
  }

  const toggle = <T,>(set: Set<T>, v: T) => {
    const n = new Set(set)
    n.has(v) ? n.delete(v) : n.add(v)
    return n
  }

  return (
    <>
      <AddBar onAdd={add} knownTags={tags} />

      {items.length === 0 ? (
        <p className="px-1 pt-6 text-[17px] text-[var(--muted)]">
          Nothing on the list yet. Add the first thing.
        </p>
      ) : (
        <>
          {/* overscroll-x-contain: without it, scrolling this row to its end chains the
              rest of the gesture to the pager and flips the page. */}
          <div className="-mx-3 flex gap-2 overflow-x-auto overscroll-x-contain px-3 pt-3 pb-1 sm:mx-0 sm:flex-wrap sm:px-0">
            {KINDS.map((k) => (
              <button
                key={k}
                onClick={() => setKindFilter((f) => toggle(f, k))}
                className="shrink-0 rounded-full px-3.5 py-1.5 text-[14px] font-semibold tracking-tight"
                style={
                  kindFilter.has(k)
                    ? { background: KIND_COLOR[k], color: '#fff' }
                    : { background: 'var(--card)', color: 'var(--text)' }
                }
              >
                {k}
              </button>
            ))}
            {tags.map((t) => (
              <button
                key={t}
                onClick={() => setTagFilter((f) => toggle(f, t))}
                className="shrink-0 rounded-full px-3.5 py-1.5 text-[14px] tracking-tight"
                style={
                  tagFilter.has(t)
                    ? { background: 'var(--text)', color: 'var(--bg)' }
                    : { background: 'var(--card)', color: 'var(--muted)' }
                }
              >
                {t}
              </button>
            ))}
          </div>

          {/* The real number leads, at a size you can read it at. The urgency splits are
              captions under it and only appear when they are not zero — "Now ₹0" is a
              label with nothing to say. */}
          <div className="px-1 pt-4 pb-1">
            <p className="text-[22px] leading-none font-semibold tracking-tight tabular-nums">
              {money(openTotal)}
            </p>
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 pt-1.5 text-[13px] tracking-tight text-[var(--muted)]">
              <span>
                {open.length} {open.length === 1 ? 'item' : 'items'} open
              </span>
              {nowTotal > 0 && (
                <span className="font-semibold text-[#FF3B30] tabular-nums">
                  {money(nowTotal)} now
                </span>
              )}
              {needTotal > 0 && <span className="tabular-nums">{money(needTotal)} needed</span>}
            </div>
          </div>

          <DndContext
            autoScroll={AUTO_SCROLL_Y}
            sensors={sensors}
            collisionDetection={closestCenter}
            modifiers={[restrictToVerticalAxis]}
            onDragEnd={onDragEnd}
          >
            <SortableContext items={rows.map(rowId)} strategy={verticalListSortingStrategy}>
              <AnimatePresence initial={false}>
                {rows.map((r) =>
                  r.kind === 'header' ? (
                    <Slot key={rowId(r)} id={rowId(r)} droppable={false}>
                      <h2 className="flex items-center gap-2 px-1 pt-6 pb-2 text-[13px] font-semibold tracking-[0.06em] text-[var(--muted)] uppercase">
                        <span
                          className="size-1.5 shrink-0 rounded-full"
                          style={{ background: URGENCY_COLOR[r.section as Urgency] }}
                        />
                        {r.section}
                      </h2>
                    </Slot>
                  ) : r.kind === 'ghost' ? (
                    <Slot key={rowId(r)} id={rowId(r)} droppable>
                      {/* Still a sortable member — that is what lets a drag land in an
                          empty section — just no longer a full card of nothing. */}
                      <p className="px-1 py-2 text-[13px] text-[var(--ghost)]">Nothing here</p>
                    </Slot>
                  ) : (
                    <ItemRow
                      key={r.item.id}
                      item={r.item}
                      editing={editing === r.item.id}
                      setEditing={setEditing}
                      update={update}
                      onToggle={() => toggleBought(r.item)}
                      onDelete={() => remove(r.item)}
                    />
                  ),
                )}
              </AnimatePresence>
            </SortableContext>
          </DndContext>

          {bought.length > 0 && (
            <div className="pt-8">
              <button
                onClick={() => setShowBought((s) => !s)}
                className="px-1 text-[15px] font-semibold tracking-tight text-[var(--muted)]"
              >
                Bought · {bought.length}
                <span
                  className="ml-1.5 inline-block transition-transform"
                  style={{ transform: showBought ? 'rotate(90deg)' : 'none' }}
                >
                  ›
                </span>
              </button>
              <AnimatePresence initial={false}>
                {showBought && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    className="overflow-hidden"
                  >
                    <div className="space-y-2.5 pt-3">
                      {bought.map((i) => (
                        <BoughtRow
                          key={i.id}
                          item={i}
                          onRestore={() => toggleBought(i)}
                          onDelete={() => remove(i)}
                        />
                      ))}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          )}
        </>
      )}

      <div className="flex flex-wrap items-center gap-4 px-1 pt-10 text-[13px] text-[var(--muted)]">
        <button onClick={onExport} className="hover:text-[#007AFF]">
          Export JSON
        </button>
        <button onClick={() => fileRef.current?.click()} className="hover:text-[#007AFF]">
          Import JSON
        </button>
        <button onClick={() => setShowSync((s) => !s)} className="hover:text-[#007AFF]">
          Sync
        </button>
        <SyncStatus status={sync.status} onRetry={sync.sync} verbose={showSync} />
        <input
          ref={fileRef}
          type="file"
          accept="application/json,.json"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0]
            if (f) onImport(f)
            e.target.value = ''
          }}
        />
      </div>

      {showSync && <SyncPanel cfg={sync.cfg} setCfg={sync.setCfg} />}
    </>
  )
}

function AddBar({
  onAdd,
  knownTags,
}: {
  onAdd: (d: { title: string; price?: number; kind: Kind; tag?: string }) => void
  knownTags: string[]
}) {
  const [title, setTitle] = useState('')
  const [price, setPrice] = useState('')
  const [tag, setTag] = useState('')
  const [kind, setKind] = useState<Kind>('Need')

  const open = title.trim().length > 0

  const submit = () => {
    if (!title.trim()) return
    const p = parseFloat(price)
    onAdd({
      title: title.trim(),
      price: isFinite(p) ? p : undefined,
      kind,
      tag: cleanTag(tag),
    })
    setTitle('')
    setPrice('')
    setTag('')
  }

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') submit()
    if (e.key === 'Escape') {
      setTitle('')
      setPrice('')
      setTag('')
    }
  }

  return (
    <div className="rounded-2xl bg-[var(--card)] px-4 py-1">
      <div className="flex items-center gap-2">
        <span className="text-[20px] leading-none text-[var(--faint)]">+</span>
        <input
          autoFocus={matchMedia('(pointer: fine)').matches}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={onKey}
          placeholder="Add something to buy"
          className="w-full bg-transparent py-3 text-[17px] tracking-tight outline-none"
        />
      </div>

      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden"
          >
            <div className="flex flex-wrap items-center gap-2 pt-1 pb-3">
              <div className="flex shrink-0 gap-1">
                {KINDS.map((k) => (
                  <button
                    key={k}
                    onClick={() => setKind(k)}
                    className="rounded-full px-3 py-1.5 text-[13px] font-semibold tracking-tight"
                    style={
                      kind === k
                        ? { background: KIND_COLOR[k], color: '#fff' }
                        : { background: 'var(--field)', color: 'var(--muted)' }
                    }
                  >
                    {k}
                  </button>
                ))}
              </div>
              <input
                value={price}
                onChange={(e) => setPrice(e.target.value)}
                onKeyDown={onKey}
                inputMode="decimal"
                placeholder="Price"
                className={`${FIELD} w-24 shrink-0`}
              />
              <input
                value={tag}
                onChange={(e) => setTag(e.target.value)}
                onKeyDown={onKey}
                list="known-tags"
                placeholder="Tag (Lego, Shoes…)"
                className={`${FIELD} min-w-0 flex-1`}
              />
              <datalist id="known-tags">
                {knownTags.map((t) => (
                  <option key={t} value={t} />
                ))}
              </datalist>
              <button
                onClick={submit}
                className="shrink-0 rounded-full bg-[#007AFF] px-4 py-1.5 text-[13px] font-semibold text-white"
              >
                Add
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

/** Non-draggable participant in the sortable list (section header or empty-section ghost). */
function Slot({
  id,
  droppable,
  children,
}: {
  id: string
  droppable: boolean
  children: React.ReactNode
}) {
  const { setNodeRef, transform, transition } = useSortable({
    id,
    disabled: { draggable: true, droppable: !droppable },
  })
  return (
    <div ref={setNodeRef} style={{ transform: CSS.Translate.toString(transform), transition }}>
      {children}
    </div>
  )
}

function ItemRow({
  item,
  editing,
  setEditing,
  update,
  onToggle,
  onDelete,
}: {
  item: Item
  editing: boolean
  setEditing: (id: string | null) => void
  update: (id: string, patch: Partial<Item>) => void
  onToggle: () => void
  onDelete: () => void
}) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } =
    useSortable({ id: item.id })

  const cycleKind = () =>
    update(item.id, { kind: KINDS[(KINDS.indexOf(item.kind) + 1) % KINDS.length] })

  // Two elements on purpose: dnd-kit owns the outer transform, Framer the inner one.
  // On one element they both write `transform` and the drag offset fights the animation.
  return (
    <div
      ref={setNodeRef}
      style={{
        transform: CSS.Translate.toString(transform),
        transition,
        zIndex: isDragging ? 10 : undefined,
        position: 'relative',
      }}
    >
      <motion.div
        exit={{ opacity: 0, height: 0, marginBottom: 0, paddingTop: 0, paddingBottom: 0 }}
        className="mb-2.5 flex touch-pan-y items-center gap-2.5 overflow-hidden rounded-2xl bg-[var(--card)] py-3 pr-4 pl-2"
        style={isDragging ? { background: 'var(--card-2)' } : undefined}
      >
        <button
          ref={setActivatorNodeRef}
          {...attributes}
          {...listeners}
          aria-label="Reorder"
          className={`${TAP} shrink-0 cursor-grab p-1 text-[var(--faint)] active:cursor-grabbing`}
          style={{ touchAction: 'none' }}
        >
          <GripVertical size={18} />
        </button>

        <button
          onClick={onToggle}
          aria-label={`Mark ${item.title} bought`}
          className={`${TAP} size-6 shrink-0 rounded-full border-2 border-[var(--faint)] transition-colors hover:border-[var(--muted)]`}
        />

        <div className="min-w-0 flex-1">
          {editing ? (
            <EditFields
              item={item}
              update={update}
              onDelete={onDelete}
              done={() => setEditing(null)}
            />
          ) : (
            <div>
              <button
                onClick={() => setEditing(item.id)}
                className="block w-full text-left text-[17px] tracking-tight break-words"
              >
                {item.title}
              </button>
              <div className="mt-1.5 flex items-center gap-2">
                <button
                  onClick={cycleKind}
                  aria-label={`${item.kind}, tap to switch`}
                  className="relative shrink-0 rounded-full px-2.5 py-1 text-[12px] leading-none font-semibold tracking-tight after:absolute after:-inset-y-2.5 after:content-['']"
                  // Tinted, not filled. A solid pill on every row turns the list into a
                  // colour chart; at 12% the hue still reads but the title leads again.
                  // Selected filter chips stay solid — there the colour *is* the state.
                  style={{ background: `${KIND_COLOR[item.kind]}1F`, color: KIND_COLOR[item.kind] }}
                >
                  {item.kind}
                </button>
                {item.tag && (
                  <span className="min-w-0 truncate rounded-full bg-[var(--card-2)] px-2.5 py-1 text-[12px] leading-none text-[var(--muted)]">
                    {item.tag}
                  </span>
                )}
                {item.price != null && (
                  <span className="ml-auto shrink-0 text-[15px] text-[var(--muted)] tabular-nums">
                    {money(item.price)}
                  </span>
                )}
              </div>
            </div>
          )}

          {!editing && (item.note || item.link) && (
            <div className="flex gap-2 pt-1 pl-0.5 text-[13px] text-[var(--muted)]">
              {item.note && <span className="truncate">{item.note}</span>}
              {item.link && (
                <a
                  href={item.link}
                  target="_blank"
                  rel="noreferrer"
                  className="shrink-0 text-[#007AFF]"
                >
                  Link ↗
                </a>
              )}
            </div>
          )}
        </div>
      </motion.div>
    </div>
  )
}

function EditFields({
  item,
  update,
  onDelete,
  done,
}: {
  item: Item
  update: (id: string, patch: Partial<Item>) => void
  onDelete: () => void
  done: () => void
}) {
  const [d, setD] = useState({
    title: item.title,
    price: item.price?.toString() ?? '',
    tag: item.tag ?? '',
    note: item.note ?? '',
    link: item.link ?? '',
  })

  const save = () => {
    if (!d.title.trim()) return done()
    const price = parseFloat(d.price)
    update(item.id, {
      title: d.title.trim(),
      price: isFinite(price) ? price : undefined,
      tag: cleanTag(d.tag),
      note: d.note.trim() || undefined,
      link: safeUrl(d.link),
    })
    done()
  }

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') save()
    if (e.key === 'Escape') done()
  }

  // focusout bubbles, so moving between these fields fires it too. Only commit once focus
  // has left the whole group — saving on the title's own blur unmounted the other fields
  // mid-click, so tapping Price or Note just snapped the row shut.
  const onBlur = (e: React.FocusEvent<HTMLDivElement>) => {
    if (!e.currentTarget.contains(e.relatedTarget as Node | null)) save()
  }

  return (
    <div className="flex flex-col gap-2" onBlur={onBlur}>
      <input
        autoFocus
        value={d.title}
        onChange={(e) => setD({ ...d, title: e.target.value })}
        onKeyDown={onKey}
        className={`${FIELD} text-[17px]`}
      />
      <div className="flex flex-wrap gap-2">
        <input
          value={d.price}
          onChange={(e) => setD({ ...d, price: e.target.value })}
          onKeyDown={onKey}
          inputMode="decimal"
          placeholder="Price"
          className={`${FIELD} w-20 shrink-0`}
        />
        <input
          value={d.tag}
          onChange={(e) => setD({ ...d, tag: e.target.value })}
          onKeyDown={onKey}
          placeholder="Tag"
          className={`${FIELD} w-24 shrink-0`}
        />
        <input
          value={d.note}
          onChange={(e) => setD({ ...d, note: e.target.value })}
          onKeyDown={onKey}
          placeholder="Note"
          className={`${FIELD} min-w-0 flex-1`}
        />
        <input
          value={d.link}
          onChange={(e) => setD({ ...d, link: e.target.value })}
          onKeyDown={onKey}
          inputMode="url"
          placeholder="Link"
          className={`${FIELD} min-w-0 flex-1`}
        />
        {/* preventDefault on pointerDown, not delete on it: blur-to-save would unmount this
            before a click lands, but deleting on touch-down means any finger that grazes
            the row on its way past takes the item with it. */}
        <button
          onPointerDown={(e) => e.preventDefault()}
          onClick={onDelete}
          aria-label={`Delete ${item.title}`}
          className="shrink-0 rounded-lg px-2 py-1.5 text-[var(--faint)] transition-colors hover:text-[#FF3B30]"
        >
          <X size={17} />
        </button>
      </div>
    </div>
  )
}

function BoughtRow({
  item,
  onRestore,
  onDelete,
}: {
  item: Item
  onRestore: () => void
  onDelete: () => void
}) {
  return (
    <div className="flex items-center gap-3 rounded-2xl bg-[var(--card)] px-4 py-3">
      <button
        onClick={onRestore}
        aria-label={`Move ${item.title} back to the list`}
        className="grid size-6 shrink-0 place-items-center rounded-full bg-[#34C759] text-white"
      >
        <Check size={14} strokeWidth={3} />
      </button>
      <span className="min-w-0 flex-1 truncate text-[16px] text-[var(--muted)] line-through">
        {item.title}
      </span>
      {item.price != null && (
        <span className="shrink-0 text-[14px] text-[var(--faint)] tabular-nums">
          {money(item.price)}
        </span>
      )}
      <button
        onClick={onDelete}
        aria-label={`Delete ${item.title}`}
        className="shrink-0 p-1 text-[var(--faint)] hover:text-[#FF3B30]"
      >
        <X size={16} />
      </button>
    </div>
  )
}

/* -------------------------------------------------------------- To-do view */

/** Date-heading for the done log: the two days you actually recognise, then a real date. */
function dayLabel(day: string): string {
  if (!day) return 'Earlier'
  const d = new Date(day)
  const days = Math.round((Date.parse(new Date().toDateString()) - Date.parse(day)) / 86400000)
  if (days === 0) return 'Today'
  if (days === 1) return 'Yesterday'
  return d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })
}

function TodoView({ todos, setTodos }: { todos: Todo[]; setTodos: (t: Todo[]) => void }) {
  const [title, setTitle] = useState('')
  const [day, setDay] = useState<When>('Today')
  const [editing, setEditing] = useState<string | null>(null)
  const [showDone, setShowDone] = useState(false)
  const [asDaily, setAsDaily] = useState(false)

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  const openOn = (w: When) => todos.filter((t) => !isDone(t) && t.when === w)
  // A ticked daily stays on the list and just turns green; only one-offs leave for the log.
  const shown = todos.filter((t) => t.when === day && (t.daily || !isDone(t)))
  const doneDays = doneByDay(todos)

  // Peek at the next bucket along, so tomorrow can warn you without taking the screen.
  const nextDay = WHENS[(WHENS.indexOf(day) + 1) % WHENS.length]
  const peek = glimpse(todos, nextDay)

  const add = () => {
    if (!title.trim()) return
    setTodos([
      ...todos,
      {
        id: crypto.randomUUID(),
        title: title.trim(),
        // A daily belongs to Today whichever day you happened to be looking at.
        when: asDaily ? 'Today' : day,
        done: false,
        daily: asDaily || undefined,
        since: new Date().toISOString(),
      },
    ])
    setTitle('')
  }

  const patch = (id: string, next: Partial<Todo>) =>
    setTodos(todos.map((x) => (x.id === id ? { ...x, ...next } : x)))

  // Keyed off isDone, not `done`: a daily ticked yesterday reads as open today, and a plain
  // `!t.done` would flip it back to false and leave the tap doing nothing.
  const toggle = (t: Todo) =>
    patch(t.id, isDone(t) ? { done: false, doneAt: undefined } : { done: true, doneAt: new Date().toISOString() })

  // A standing task has no "next day" to be pushed to — it belongs to every one.
  const moveOn = (t: Todo) => {
    if (t.daily) return
    patch(t.id, {
      when: WHENS[(WHENS.indexOf(t.when) + 1) % WHENS.length],
      since: new Date().toISOString(),
    })
  }

  const remove = (t: Todo) => setTodos(todos.filter((x) => x.id !== t.id))

  const onDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over) return
    const ids = shown.map((t) => t.id)
    const from = ids.indexOf(String(active.id))
    const to = ids.indexOf(String(over.id))
    if (from < 0 || to < 0 || from === to) return
    setTodos(reorderVisible(todos, shown, from, to))
  }

  return (
    <>
      <div className="flex gap-2 pt-1">
        {WHENS.map((w) => {
          const count = openOn(w).length
          const on = w === day
          return (
            <button
              key={w}
              onClick={() => setDay(w)}
              className="min-w-0 flex-1 rounded-2xl px-3 py-3.5 text-left transition-colors"
              style={
                on
                  ? { background: WHEN_COLOR[w], color: '#fff' }
                  : { background: 'var(--card)', color: 'var(--muted)' }
              }
            >
              <span className="block truncate text-[17px] font-semibold tracking-tight">{w}</span>
              <span
                className="block pt-0.5 text-[13px] tabular-nums"
                style={on ? { color: 'rgba(255,255,255,0.85)' } : undefined}
              >
                {count === 0 ? 'clear' : `${count} open`}
              </span>
            </button>
          )
        })}
      </div>

      <div className="mt-3 flex items-center gap-2 rounded-2xl bg-[var(--card)] px-4">
        <span className="text-[20px] leading-none text-[var(--faint)]">+</span>
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && add()}
          placeholder={asDaily ? 'Add a daily task' : `Add to ${day.toLowerCase()}`}
          className="w-full bg-transparent py-3.5 text-[17px] tracking-tight outline-none"
        />
        <button
          onClick={() => setAsDaily((d) => !d)}
          aria-pressed={asDaily}
          aria-label="Make this a daily task"
          title="Every day"
          className="shrink-0 rounded-full p-1.5 transition-colors"
          style={
            asDaily
              ? { background: `${WHEN_COLOR.Today}1F`, color: WHEN_COLOR.Today }
              : { color: 'var(--faint)' }
          }
        >
          <Repeat size={16} />
        </button>
      </div>

      {shown.length === 0 ? (
        <p className="px-1 pt-6 text-[17px] text-[var(--muted)]">
          {day === 'Today' ? 'Nothing for today. Enjoy it.' : `Nothing for ${day.toLowerCase()}.`}
        </p>
      ) : (
        // keyed by day so switching days swaps the list outright. Without it every row of the
        // old day plays its exit animation at once, which reads as noise for what is really
        // just a view change — removals within a day still animate normally.
        <div className="pt-4" key={day}>
          <DndContext
            autoScroll={AUTO_SCROLL_Y}
            sensors={sensors}
            collisionDetection={closestCenter}
            modifiers={[restrictToVerticalAxis]}
            onDragEnd={onDragEnd}
          >
            <SortableContext items={shown.map((t) => t.id)} strategy={verticalListSortingStrategy}>
              <AnimatePresence initial={false}>
                {shown.map((t) => (
                  <TodoRow
                    key={t.id}
                    todo={t}
                    editing={editing === t.id}
                    setEditing={setEditing}
                    rename={(id, next) => patch(id, { title: next })}
                    onToggle={() => toggle(t)}
                    onStar={() => patch(t.id, { important: t.important ? undefined : true })}
                    onMove={() => moveOn(t)}
                    nextDay={WHENS[(WHENS.indexOf(t.when) + 1) % WHENS.length]}
                    onDaily={() =>
                      patch(t.id, {
                        daily: t.daily ? undefined : true,
                        when: 'Today',
                        // Dropping daily drops the colour with it — a one-off has no accent.
                        color: t.daily ? undefined : t.color,
                      })
                    }
                    onColor={(c) => patch(t.id, { color: c })}
                    onDelete={() => remove(t)}
                  />
                ))}
              </AnimatePresence>
            </SortableContext>
          </DndContext>
        </div>
      )}

      {peek.top && (
        <button
          onClick={() => setDay(nextDay)}
          className="mt-6 w-full rounded-2xl bg-[var(--card)] px-4 py-3.5 text-left"
        >
          <span
            className="block text-[13px] font-semibold tracking-tight"
            style={{ color: WHEN_COLOR[nextDay] }}
          >
            {nextDay}
          </span>
          <span className="flex items-center gap-1.5 pt-1 text-[15px] tracking-tight">
            {peek.top.important && <Star size={13} fill="#FF9500" color="#FF9500" />}
            <span className="min-w-0 truncate">{peek.top.title}</span>
          </span>
          {peek.more > 0 && (
            <span className="block pt-1 text-[13px] text-[var(--muted)]">
              + {peek.more} more …
            </span>
          )}
        </button>
      )}

      {doneDays.length > 0 && (
        <div className="pt-8">
          <button
            onClick={() => setShowDone((s) => !s)}
            className="px-1 text-[15px] font-semibold tracking-tight text-[var(--muted)]"
          >
            Done · {doneDays.reduce((n, d) => n + d.todos.length, 0)}
            <span
              className="ml-1.5 inline-block transition-transform"
              style={{ transform: showDone ? 'rotate(90deg)' : 'none' }}
            >
              ›
            </span>
          </button>
          {showDone &&
            doneDays.map(({ day, todos: sameDay }) => (
              <div key={day || 'undated'} className="pt-4">
                <p className="px-1 pb-2 text-[13px] font-semibold tracking-tight text-[var(--faint)]">
                  {dayLabel(day)}
                </p>
                <div className="space-y-2.5">
                  {sameDay.map((t) => (
                    <div
                      key={t.id}
                      className="flex items-center gap-3 rounded-2xl bg-[var(--card)] px-4 py-3"
                    >
                      <button
                        onClick={() => toggle(t)}
                        aria-label={`Mark ${t.title} not done`}
                        className="grid size-6 shrink-0 place-items-center rounded-full bg-[#34C759] text-white"
                      >
                        <Check size={14} strokeWidth={3} />
                      </button>
                      <span className="min-w-0 flex-1 truncate text-[16px] text-[var(--muted)] line-through">
                        {t.title}
                      </span>
                      <button
                        onClick={() => remove(t)}
                        aria-label={`Delete ${t.title}`}
                        className="shrink-0 p-1 text-[var(--faint)] hover:text-[#FF3B30]"
                      >
                        <X size={16} />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            ))}
        </div>
      )}
    </>
  )
}
function TodoRow({
  todo,
  editing,
  setEditing,
  rename,
  onToggle,
  onStar,
  onMove,
  nextDay,
  onDaily,
  onColor,
  onDelete,
}: {
  todo: Todo
  editing: boolean
  setEditing: (id: string | null) => void
  rename: (id: string, next: string) => void
  onToggle: () => void
  onStar: () => void
  onMove: () => void
  nextDay: When
  onDaily: () => void
  onColor: (c: string) => void
  onDelete: () => void
}) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } =
    useSortable({ id: todo.id })
  const [draft, setDraft] = useState(todo.title)

  const done = isDone(todo)
  const overdue = isOverdue(todo)
  // The accent says "this one repeats", green says "and it's handled for today". A one-off
  // has no accent at all, so the standing tasks stay picked out of the list at a glance.
  // Done stays green whatever colour the task carries — that signal is worth more than
  // the grouping, and a finished task no longer needs telling apart.
  const accent = todo.daily ? (done ? '#34C759' : (todo.color ?? DEFAULT_DAILY_COLOR)) : undefined

  const save = () => {
    const next = draft.trim()
    if (next) rename(todo.id, next)
    else setDraft(todo.title)
    setEditing(null)
  }

  return (
    <div
      ref={setNodeRef}
      style={{
        transform: CSS.Translate.toString(transform),
        transition,
        zIndex: isDragging ? 10 : undefined,
        position: 'relative',
      }}
    >
      <motion.div
        exit={{ opacity: 0, height: 0, marginBottom: 0, paddingTop: 0, paddingBottom: 0 }}
        className="mb-2.5 touch-pan-y overflow-hidden rounded-2xl bg-[var(--card)] py-3 pr-4 pl-2"
        style={
          isDragging
            ? { background: 'var(--card-2)' }
            : done
              ? { background: '#34C75914' }
              : undefined
        }
      >
        <div className="flex items-center gap-2.5">
          <button
            ref={setActivatorNodeRef}
            {...attributes}
            {...listeners}
            aria-label="Reorder"
            className={`${TAP} shrink-0 cursor-grab p-1 text-[var(--faint)] active:cursor-grabbing`}
            style={{ touchAction: 'none' }}
          >
            <GripVertical size={18} />
          </button>
    
          <button
            onClick={onToggle}
            aria-label={done ? `Mark ${todo.title} not done` : `Mark ${todo.title} done`}
            className={`${TAP} grid size-6 shrink-0 place-items-center rounded-full border-2 transition-colors`}
            style={
              done
                ? { background: '#34C759', borderColor: '#34C759', color: '#fff' }
                : { borderColor: accent ?? 'var(--faint)' }
            }
          >
            {done && <Check size={14} strokeWidth={3} />}
          </button>
    
          {editing ? (
            <input
              autoFocus
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onBlur={save}
              onKeyDown={(e) => {
                if (e.key === 'Enter') save()
                if (e.key === 'Escape') {
                  setDraft(todo.title)
                  setEditing(null)
                }
              }}
              className={`${FIELD} min-w-0 flex-1 text-[17px]`}
            />
          ) : (
            <button
              onClick={() => {
                setDraft(todo.title)
                setEditing(todo.id)
              }}
              className="flex min-w-0 flex-1 items-center gap-1.5 text-left text-[17px] tracking-tight break-words"
            >
              {/* Marker, not a control — turning it off lives in the editor, so the row
                  never grows a sixth button just to say "this one repeats". */}
              {todo.daily && <Repeat size={12} className="shrink-0" style={{ color: accent }} aria-label="Daily" />}
              {overdue && (
                <span className="shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold text-[#FF3B30] bg-[#FF3B30]/12">
                  Due
                </span>
              )}
              <span className="min-w-0" style={done ? { color: 'var(--muted)' } : undefined}>
                {todo.title}
              </span>
            </button>
          )}
    
          {/* onPointerDown, not onClick: the input's onBlur fires first and closes the editor,
              which would eat a plain click before it lands. */}
          {editing && (
            <button
              onPointerDown={(e) => {
                e.preventDefault()
                onDaily()
              }}
              aria-pressed={!!todo.daily}
              aria-label={todo.daily ? `Stop repeating ${todo.title}` : `Repeat ${todo.title} daily`}
              title={todo.daily ? 'Stop repeating' : 'Every day'}
              className="shrink-0 rounded-full p-1 transition-colors"
              style={
                todo.daily
                  ? { background: `${WHEN_COLOR.Today}1F`, color: WHEN_COLOR.Today }
                  : { color: 'var(--faint)' }
              }
            >
              <Repeat size={16} />
            </button>
          )}
    
          <button
            onClick={onStar}
            aria-label={todo.important ? `Unstar ${todo.title}` : `Mark ${todo.title} important`}
            title="Important"
            className="shrink-0 p-1 transition-colors"
            style={{ color: todo.important ? '#FF9500' : 'var(--faint)' }}
          >
            <Star size={16} fill={todo.important ? '#FF9500' : 'none'} />
          </button>
    
          {!todo.daily && (
            <button
              onClick={onMove}
              aria-label={`Move ${todo.title} to ${nextDay}`}
              title={`Move to ${nextDay}`}
              className="shrink-0 p-1 text-[var(--faint)] transition-colors hover:text-[var(--text)]"
            >
              <ChevronRight size={16} />
            </button>
          )}
    
          <button
            onPointerDown={(e) => e.preventDefault()}
            onClick={onDelete}
            aria-label={`Delete ${todo.title}`}
            className="shrink-0 p-1 text-[var(--faint)] transition-colors hover:text-[#FF3B30]"
          >
            <X size={16} />
          </button>
        </div>

        {/* Second line, so six swatches never squeeze the title. Only for a daily: a
            one-off has no accent, which is the point — grey means "just today". */}
        {editing && todo.daily && (
          <div className="flex items-center gap-2.5 pt-3 pl-9">
            {DAILY_COLORS.map((c) => {
              const on = (todo.color ?? DEFAULT_DAILY_COLOR) === c
              return (
                <button
                  key={c}
                  onPointerDown={(e) => {
                    e.preventDefault()
                    onColor(c)
                  }}
                  aria-label={`Colour ${todo.title}`}
                  aria-pressed={on}
                  className="size-5 shrink-0 rounded-full transition-transform"
                  style={{
                    background: c,
                    // The ring is the selected state; no tick, no border-width jump.
                    boxShadow: on ? `0 0 0 2px var(--card), 0 0 0 4px ${c}` : undefined,
                  }}
                />
              )
            })}
          </div>
        )}
      </motion.div>
    </div>
  )
}

/* ----------------------------------------------------------- Spending view */

function SpendView({
  items,
  payments,
  setPayments,
}: {
  items: Item[]
  payments: Payment[]
  setPayments: (p: Payment[]) => void
}) {
  const months = useMemo(() => monthlySpend(items), [items])

  return (
    <>
      <MustPayments payments={payments} setPayments={setPayments} />
      <MonthHistory months={months} />
    </>
  )
}

/**
 * Deliberately unlike the rest of the app: one dark slab stating the monthly floor, then a
 * plain ledger. These are commitments, not choices, so they get no cards, pills or drag.
 */
function MustPayments({
  payments,
  setPayments,
}: {
  payments: Payment[]
  setPayments: (p: Payment[]) => void
}) {
  const [name, setName] = useState('')
  const [amount, setAmount] = useState('')
  const [group, setGroup] = useState('')
  const [open, setOpen] = useState(false)

  const { groups, monthly, activeCount } = useMemo(() => groupPayments(payments), [payments])
  const knownGroups = useMemo(
    () => [...new Set(payments.flatMap((p) => (p.group ? [p.group] : [])))].sort(),
    [payments],
  )

  const add = () => {
    const value = parseFloat(amount)
    if (!name.trim() || !isFinite(value)) return
    setPayments([
      ...payments,
      { id: crypto.randomUUID(), name: name.trim(), amount: value, group: cleanTag(group) },
    ])
    setName('')
    setAmount('')
  }

  const patch = (id: string, next: Partial<Payment>) =>
    setPayments(payments.map((p) => (p.id === id ? { ...p, ...next } : p)))

  const remove = (id: string) => setPayments(payments.filter((p) => p.id !== id))

  return (
    <div className="pt-1">
      <div className="rounded-2xl bg-[#1D1D1F] px-5 py-5 dark:bg-[#161618]">
        <p className="text-[13px] font-semibold tracking-[0.08em] text-[#8E8E93] uppercase">
          Must pay every month
        </p>
        <p className="pt-1.5 text-[34px] leading-none font-semibold tracking-tight text-white tabular-nums">
          {money(monthly)}
        </p>
        <p className="pt-2 text-[13px] text-[#8E8E93]">
          {activeCount === 0
            ? 'Nothing committed yet'
            : `${activeCount} commitment${activeCount === 1 ? '' : 's'} before anything else`}
        </p>
      </div>

      {/* <details> rather than a useState toggle: the disclosure, the keyboard and the
          accessibility semantics are all free, and the group total stays readable shut —
          which is the point, since the rows are reference, not something to scan daily. */}
      {groups.map((g) => (
        <details key={g.group} className="group pt-4">
          <summary className="flex cursor-pointer list-none items-center gap-1.5 px-1 py-1.5 [&::-webkit-details-marker]:hidden">
            <ChevronRight
              size={12}
              className="shrink-0 text-[var(--faint)] transition-transform duration-200 group-open:rotate-90"
            />
            <h3 className="text-[13px] font-semibold tracking-[0.06em] text-[var(--muted)] uppercase">
              {g.group}
            </h3>
            <span className="ml-auto text-[13px] text-[var(--muted)] tabular-nums">
              {money(g.total)}
            </span>
          </summary>
          <div className="mt-1 overflow-hidden rounded-2xl bg-[var(--card)]">
            {g.rows.map((p, i) => (
              <div
                key={p.id}
                className="flex items-center gap-3 px-4 py-2.5"
                style={{
                  opacity: p.paused ? 0.45 : 1,
                  // Inset hairline, aligned to the text rather than the card edge.
                  boxShadow: i ? 'inset 0 0.5px 0 var(--separator)' : undefined,
                }}
              >
                <button
                  onClick={() => patch(p.id, { paused: p.paused ? undefined : true })}
                  aria-label={p.paused ? `Resume ${p.name}` : `Pause ${p.name}`}
                  title={p.paused ? 'Resume' : 'Pause'}
                  className="min-w-0 flex-1 truncate text-left text-[16px] tracking-tight"
                  style={{ textDecoration: p.paused ? 'line-through' : 'none' }}
                >
                  {p.name}
                </button>
                <span className="shrink-0 text-[16px] tabular-nums">{money(p.amount)}</span>
                <button
                  onClick={() => remove(p.id)}
                  aria-label={`Delete ${p.name}`}
                  className="shrink-0 p-1 text-[var(--faint)] transition-colors hover:text-[#FF3B30]"
                >
                  <X size={15} />
                </button>
              </div>
            ))}
          </div>
        </details>
      ))}

      {open ? (
        <div className="mt-4 flex flex-wrap items-center gap-2 rounded-2xl bg-[var(--card)] p-3">
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && add()}
            placeholder="Netflix, Claude, rent…"
            className={`${FIELD} min-w-0 flex-1`}
          />
          <input
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && add()}
            inputMode="decimal"
            placeholder="Amount"
            className={`${FIELD} w-24 shrink-0`}
          />
          <input
            value={group}
            onChange={(e) => setGroup(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && add()}
            list="known-groups"
            placeholder="Work / Entertainment"
            className={`${FIELD} w-40 shrink-0`}
          />
          <datalist id="known-groups">
            {knownGroups.map((g) => (
              <option key={g} value={g} />
            ))}
          </datalist>
          <button
            onClick={add}
            className="shrink-0 rounded-full bg-[#007AFF] px-4 py-1.5 text-[13px] font-semibold text-white"
          >
            Add
          </button>
        </div>
      ) : (
        <button
          onClick={() => setOpen(true)}
          className="mt-4 text-[13px] font-semibold text-[var(--muted)] transition-colors hover:text-[#007AFF]"
        >
          + Add a monthly payment
        </button>
      )}
    </div>
  )
}

/**
 * Two waves of *different* wavelength drifting in *opposite* directions. One wave, however
 * pretty, is a rigid shape sliding sideways and reads as a slideshow; two that disagree let
 * the crests overtake and cancel each other, so the surface itself keeps changing shape.
 *
 * The viewBox is 600 wide against a real box of 592 (desktop) or 319 (mobile), so the
 * horizontal scale is ≤1 and Bézier flattening never gets magnified into visible facets —
 * this is what the old 100-wide viewBox got wrong, and it looked pixelated. Period is half
 * the viewBox either way, so exactly two S-curves are on screen at any width.
 *
 * Each path is 1200 wide with the drift a whole number of periods, so the loop is seamless;
 * the rightward one starts at -400 so drifting right never exposes its left edge.
 */
const WAVE_BACK = `M-400,0 q50,-8 100,0 ${'t100,0 '.repeat(11)}V200 H-400 Z`
const WAVE_FRONT = `M0,0 q75,-12 150,0 ${'t150,0 '.repeat(7)}V200 H0 Z`

/**
 * A box that fills from the bottom to `pct`, with a slow drifting surface. The level rides
 * a CSS custom property so `@starting-style` owns the from-empty rise on mount; if
 * animations are off the box still lands at the right height, it just gets there instantly.
 */
function WaveBox({
  pct,
  color,
  height,
  children,
}: {
  pct: number
  color: string
  height: number
  children?: React.ReactNode
}) {
  // 60 is the viewBox height; the surface sits at the top of the fill.
  const y = (1 - pct) * 60

  return (
    <div
      className="relative overflow-hidden rounded-xl bg-[var(--card-2)]"
      style={{ height }}
    >
      {pct > 0 && (
        <svg
          viewBox="0 0 600 60"
          preserveAspectRatio="none"
          aria-hidden="true"
          className="absolute inset-0 h-full w-full"
        >
          <g className="bn-wave-level" style={{ '--bn-lvl': `${y}px` } as React.CSSProperties}>
            <g className="bn-wave-back">
              <path d={WAVE_BACK} fill={color} opacity={0.4} />
            </g>
            <g className="bn-wave-front">
              <path d={WAVE_FRONT} fill={color} opacity={0.9} />
            </g>
          </g>
        </svg>
      )}
      {children}
    </div>
  )
}

/**
 * The only gauge with a real ceiling. Spending has no natural limit, so this one is the
 * user's own number — unset, it offers to take one rather than inventing a figure.
 */
function BudgetGauge({ total }: { total: number }) {
  const { budget, setBudget } = useBudget()
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(budget ? String(budget) : '')

  const save = () => {
    const v = parseFloat(draft)
    setBudget(isFinite(v) && v > 0 ? v : 0)
    setEditing(false)
  }

  if (editing)
    return (
      <div className="flex items-center gap-2 pt-3">
        <input
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') save()
            if (e.key === 'Escape') setEditing(false)
          }}
          inputMode="decimal"
          placeholder="Monthly budget"
          className={`${FIELD} w-32`}
        />
        <button onClick={save} className="text-[13px] font-semibold text-[#007AFF]">
          Save
        </button>
        {/* Clearing is saving an empty field — parseFloat('') is NaN, which lands on 0. */}
      </div>
    )

  if (budget <= 0)
    return (
      <button
        onClick={() => setEditing(true)}
        className="pt-2 text-[13px] font-semibold text-[var(--muted)] transition-colors hover:text-[#007AFF]"
      >
        + Set a monthly budget
      </button>
    )

  const pct = fillRatio(total, budget)
  const over = total > budget
  const color = over ? '#FF3B30' : pct > 0.8 ? '#FF9500' : '#34C759'

  return (
    <div className="pt-3">
      <WaveBox pct={pct} color={color} height={64}>
        <div className="absolute inset-0 flex items-center justify-between px-3.5">
          <span className="text-[13px] font-semibold tracking-tight">
            {over
              ? `${money(total - budget)} over`
              : `${money(budget - total)} left`}
          </span>
          <button
            onClick={() => {
              setDraft(String(budget))
              setEditing(true)
            }}
            className="text-[13px] tabular-nums opacity-70"
          >
            of {money(budget)}
          </button>
        </div>
      </WaveBox>
    </div>
  )
}

function MonthHistory({ months }: { months: ReturnType<typeof monthlySpend> }) {
  if (months.length === 0)
    return (
      <p className="px-1 pt-8 text-[15px] text-[var(--muted)]">
        Nothing bought yet. Tick something off the buy list and it shows up here.
      </p>
    )

  const dated = months.filter((m) => m.key !== 'undated')
  const delta =
    dated.length >= 2 ? dated[0].total - dated[1].total : null

  return (
    <div className="pt-2">
      {delta !== null && (
        <p className="px-1 pb-3 text-[13px] tracking-tight text-[var(--muted)]">
          {delta === 0
            ? `Same as ${dated[1].label}`
            : delta > 0
              ? `${money(delta)} more than ${dated[1].label}`
              : `${money(-delta)} less than ${dated[1].label}`}
        </p>
      )}

      <div className="space-y-3">
        {months.map((m, index) => {
          // Share of the month, so the three always add up to one full month — no
          // configuration needed for the category gauges to mean something.
          const share = (v: number) => (m.total > 0 ? v / m.total : 0)
          const isLatest = index === 0 && m.key !== 'undated'
          return (
            <div key={m.key} className="rounded-2xl bg-[var(--card)] px-4 py-4">
              <div className="flex items-baseline justify-between">
                <h2 className="text-[17px] font-semibold tracking-tight">{m.label}</h2>
                <span className="text-[20px] font-semibold tracking-tight tabular-nums">
                  {money(m.total)}
                </span>
              </div>
              <p className="pt-0.5 text-[13px] text-[var(--muted)]">
                {m.count} {m.count === 1 ? 'thing' : 'things'}
              </p>

              {isLatest && <BudgetGauge total={m.total} />}

              {/* Full width rather than three across: a wide box stretches the wave into the
                  long curve it is meant to be, and leaves the labels somewhere legible. */}
              <div className="space-y-2 pt-3">
                {KINDS.map((k) => (
                  <div key={k}>
                    <div className="flex items-baseline justify-between px-0.5 pb-1">
                      <span className="text-[13px] text-[var(--muted)]">{k}</span>
                      <span className="text-[13px] tabular-nums">{money(m.byKind[k])}</span>
                    </div>
                    <WaveBox pct={share(m.byKind[k])} color={KIND_COLOR[k]} height={52} />
                  </div>
                ))}
              </div>

              {m.tags.length > 0 && (
                <div className="flex flex-wrap gap-x-3 gap-y-1 pt-3 text-[13px] text-[var(--muted)]">
                  {m.tags.map((t) => (
                    <span key={t.tag}>
                      <span className={t.tag === UNTAGGED ? 'italic' : ''}>{t.tag}</span>{' '}
                      <span className="tabular-nums text-[var(--text)]">{money(t.total)}</span>
                    </span>
                  ))}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------- Sync  */

/**
 * Routine chatter ("Syncing…", "Synced 3:47 AM") only while the sync panel is open —
 * it changes on every window focus and reads as flicker otherwise. Anything that needs
 * a decision stays visible regardless, or a broken sync would fail silently.
 */
function SyncStatus({
  status,
  onRetry,
  verbose,
}: {
  status: Status
  onRetry: () => void
  verbose: boolean
}) {
  if (status.kind === 'off') return null
  if (status.kind === 'conflict') return <span className="text-[#FF9500]">Needs a choice</span>
  if (status.kind === 'error')
    return (
      <button onClick={onRetry} className="max-w-[60%] truncate text-[#FF3B30]" title={status.message}>
        {status.message} — retry
      </button>
    )
  if (!verbose) return null
  if (status.kind === 'syncing') return <span className="text-[var(--faint)]">Syncing…</span>
  return (
    <span className="text-[#34C759]">
      Synced {new Date(status.at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
    </span>
  )
}

function SyncPanel({
  cfg,
  setCfg,
}: {
  cfg: SyncConfig | null
  setCfg: (c: SyncConfig | null) => void
}) {
  const [d, setD] = useState({
    token: cfg?.token ?? '',
    repo: cfg?.repo ?? '',
    path: cfg?.path ?? 'momentum.json',
  })
  const ok = d.token.trim().length > 10 && validRepo(d.repo) && d.path.trim().length > 0
  const cls = `${FIELD} w-full`

  return (
    <div className="mt-3 rounded-2xl bg-[var(--card)] p-4">
      <p className="pb-3 text-[13px] leading-relaxed text-[var(--muted)]">
        Stores the list as a JSON file in a private repo, so both machines read and write the same
        file. Tasks go in a sibling <span className="text-[var(--text)]">.todos.json</span>. Use a{' '}
        <span className="text-[var(--text)]">fine-grained</span> token limited to that one repo with{' '}
        <span className="text-[var(--text)]">Contents: read and write</span> — it is kept in this
        browser only, and anyone with access to this machine can read it.
      </p>
      <div className="flex flex-col gap-2">
        <input
          value={d.repo}
          onChange={(e) => setD({ ...d, repo: e.target.value })}
          placeholder="owner/repo"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          className={cls}
        />
        <input
          value={d.path}
          onChange={(e) => setD({ ...d, path: e.target.value })}
          placeholder="momentum.json"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          className={cls}
        />
        <input
          value={d.token}
          onChange={(e) => setD({ ...d, token: e.target.value })}
          type="password"
          placeholder="github_pat_…"
          autoComplete="off"
          spellCheck={false}
          className={cls}
        />
      </div>
      <div className="flex gap-2 pt-3">
        <button
          disabled={!ok}
          onClick={() => setCfg({ token: d.token.trim(), repo: d.repo.trim(), path: d.path.trim() })}
          className="rounded-full bg-[#007AFF] px-3.5 py-1.5 text-[14px] font-semibold text-white disabled:bg-[var(--faint)]"
        >
          {cfg ? 'Update' : 'Connect'}
        </button>
        {cfg && (
          <button
            onClick={() => {
              setD({ token: '', repo: '', path: 'momentum.json' })
              setCfg(null)
            }}
            className="rounded-full bg-[var(--field)] px-3.5 py-1.5 text-[14px] font-semibold text-[#FF3B30]"
          >
            Disconnect
          </button>
        )}
      </div>
    </div>
  )
}

/* ------------------------------------------------------------ Scripts view */

const STATUS_COLOR: Record<ScriptStatus, string> = {
  Idea: '#8E8E93',
  Writing: '#FF9500',
  Ready: '#007AFF',
  Recorded: '#34C759',
}

/**
 * Caret position as a plain character offset. `Selection` speaks in nodes; every edit
 * here speaks in string offsets, so the two are converted at the boundary and nowhere
 * else.
 */
function caretOffset(el: HTMLElement): number {
  const sel = getSelection()
  if (!sel || !sel.rangeCount) return 0
  const range = sel.getRangeAt(0)
  const probe = range.cloneRange()
  probe.selectNodeContents(el)
  probe.setEnd(range.endContainer, range.endOffset)
  return probe.toString().length
}

function setCaret(el: HTMLElement, offset: number) {
  const node = el.firstChild
  const range = document.createRange()
  if (node && node.nodeType === Node.TEXT_NODE) {
    range.setStart(node, Math.min(offset, node.textContent?.length ?? 0))
  } else {
    range.setStart(el, 0)
  }
  range.collapse(true)
  const sel = getSelection()
  sel?.removeAllRanges()
  sel?.addRange(range)
}

/** Typed at the very start of a block, these become the block type. */
const BLOCK_SHORTCUTS: [RegExp, BlockType][] = [
  [/^# $/, 'h1'],
  [/^## $/, 'h2'],
  [/^### $/, 'h3'],
  [/^[-*] $/, 'bullet'],
  [/^1\. $/, 'number'],
  [/^\[[ x]?\] $/, 'todo'],
  [/^> $/, 'quote'],
  [/^```$/, 'code'],
  [/^--- $/, 'divider'],
]

const LIST_TYPES: BlockType[] = ['bullet', 'number', 'todo']

const BLOCK_CLASS: Record<BlockType, string> = {
  p: 'text-[17px] leading-relaxed',
  h1: 'text-[28px] font-semibold tracking-tight leading-snug',
  h2: 'text-[22px] font-semibold tracking-tight leading-snug',
  h3: 'text-[18px] font-semibold tracking-tight leading-snug',
  bullet: 'text-[17px] leading-relaxed',
  number: 'text-[17px] leading-relaxed',
  todo: 'text-[17px] leading-relaxed',
  quote: 'text-[17px] leading-relaxed text-[var(--muted)]',
  code: 'text-[14px] leading-relaxed font-mono whitespace-pre-wrap',
  divider: '',
}

/**
 * One block, one contenteditable. React never owns the innerHTML: the DOM is written
 * only when the model and the element disagree, which during plain typing they never do
 * because the model is read *from* the element. That is what stops the caret jumping —
 * a controlled contenteditable resets the selection on every keystroke.
 */
function EditorBlock({
  block,
  index,
  onText,
  onEnter,
  onBackspaceAtStart,
  onIndent,
  onCheck,
  onDelete,
}: {
  block: Block
  index: number
  onText: (text: string) => void
  onEnter: (offset: number) => void
  onBackspaceAtStart: () => void
  onIndent: (delta: number) => void
  onCheck: () => void
  onDelete: () => void
}) {
  const ref = useRef<HTMLDivElement>(null)

  /**
   * Invariant: the DOM mirrors the model. Deliberately runs on *every* render with no
   * dependency array — a markdown shortcut sets the text to '' when it was already '',
   * so a `[block.text]` dependency never fires and the typed "# " is left behind in the
   * heading. Typing costs nothing here because the model is read from the DOM, so the
   * two already agree and no write happens.
   *
   * Layout, not passive: child layout effects run before the parent's, which is what
   * lets ScriptEditor place the caret *after* this has rewritten the text.
   */
  useLayoutEffect(() => {
    const el = ref.current
    if (el && el.textContent !== block.text) el.textContent = block.text
  })

  if (block.type === 'divider') {
    return (
      <div className="group flex items-center gap-2 py-3">
        <div className="h-px flex-1" style={{ background: 'var(--separator)' }} />
        <button
          onClick={onDelete}
          aria-label="Delete divider"
          className="shrink-0 p-1 text-[var(--faint)] opacity-0 transition-opacity group-hover:opacity-100 hover:text-[#FF3B30]"
        >
          <X size={14} />
        </button>
      </div>
    )
  }

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const el = e.currentTarget
    if (e.key === 'Enter' && !e.shiftKey) {
      // A code block keeps Enter for itself — that is the one place a newline is content.
      // Except on an empty one, or there is no way back out without a mouse.
      if (block.type === 'code' && block.text) return
      e.preventDefault()
      onEnter(caretOffset(el))
      return
    }
    if (e.key === 'Backspace' && caretOffset(el) === 0 && getSelection()?.isCollapsed) {
      e.preventDefault()
      onBackspaceAtStart()
      return
    }
    if (e.key === 'Tab') {
      e.preventDefault()
      onIndent(e.shiftKey ? -1 : 1)
    }
  }

  const marker =
    block.type === 'bullet' ? (
      <span className="shrink-0 pt-[3px] text-[var(--muted)] select-none">•</span>
    ) : block.type === 'number' ? (
      <span className="shrink-0 pt-[1px] text-[15px] text-[var(--muted)] tabular-nums select-none">
        {index}.
      </span>
    ) : block.type === 'todo' ? (
      <button
        onClick={onCheck}
        aria-label={block.checked ? 'Mark not done' : 'Mark done'}
        className="mt-[3px] grid size-[18px] shrink-0 place-items-center rounded-[5px] border-2 transition-colors"
        style={
          block.checked
            ? { background: '#34C759', borderColor: '#34C759', color: '#fff' }
            : { borderColor: 'var(--faint)' }
        }
      >
        {block.checked && <Check size={11} strokeWidth={3} />}
      </button>
    ) : null

  return (
    <div
      className="flex gap-2"
      style={{ paddingLeft: (block.indent ?? 0) * 24, paddingTop: 2, paddingBottom: 2 }}
    >
      {marker}
      {block.type === 'quote' && (
        <div className="w-[3px] shrink-0 rounded-full" style={{ background: 'var(--faint)' }} />
      )}
      <div
        ref={ref}
        data-block={block.id}
        contentEditable
        suppressContentEditableWarning
        role="textbox"
        aria-label={`Block ${index}`}
        onInput={(e) => onText(e.currentTarget.textContent ?? '')}
        onKeyDown={onKeyDown}
        className={`min-w-0 flex-1 outline-none ${BLOCK_CLASS[block.type]} ${
          block.type === 'code' ? 'rounded-xl bg-[var(--card)] px-3 py-2' : ''
        }`}
        style={
          block.checked
            ? { textDecoration: 'line-through', color: 'var(--muted)' }
            : undefined
        }
      />
    </div>
  )
}

function ScriptEditor({
  script,
  onChange,
  onBack,
}: {
  script: Script
  onChange: (next: Script) => void
  onBack: () => void
}) {
  const [blocks, setBlocks] = useState<Block[]>(script.blocks)
  const [title, setTitle] = useState(script.title)
  const [dirty, setDirty] = useState(false)
  // Where the caret belongs once a structural edit has re-rendered.
  const caret = useRef<{ id: string; offset: number } | null>(null)

  // Autosave. The timer restarts on every keystroke, so it writes once the typing stops.
  useEffect(() => {
    if (!dirty) return
    const t = setTimeout(() => {
      onChange({ ...script, title: title.trim(), blocks, updatedAt: new Date().toISOString() })
      setDirty(false)
    }, 500)
    return () => clearTimeout(t)
  }, [dirty, blocks, title])

  // Before paint, so the caret never visibly lands in the wrong place first.
  useLayoutEffect(() => {
    const want = caret.current
    if (!want) return
    caret.current = null
    const el = document.querySelector<HTMLElement>(`[data-block="${want.id}"]`)
    if (el) {
      el.focus()
      setCaret(el, want.offset)
    }
  }, [blocks])

  const edit = (next: Block[]) => {
    setBlocks(next)
    setDirty(true)
  }

  const patch = (id: string, p: Partial<Block>) =>
    edit(blocks.map((b) => (b.id === id ? { ...b, ...p } : b)))

  const onText = (b: Block, text: string) => {
    const shortcut = BLOCK_SHORTCUTS.find(([re]) => re.test(text))
    if (!shortcut) return patch(b.id, { text })

    const [, type] = shortcut
    if (type === 'divider') {
      // A divider holds no text, so typing continues in a fresh block under it.
      const fresh = emptyBlock()
      const i = blocks.findIndex((x) => x.id === b.id)
      const next = [...blocks]
      next[i] = { ...b, type: 'divider', text: '', indent: undefined }
      next.splice(i + 1, 0, fresh)
      edit(next)
      caret.current = { id: fresh.id, offset: 0 }
      return
    }
    edit(
      blocks.map((x) =>
        x.id === b.id
          ? { ...x, type, text: '', checked: type === 'todo' ? false : undefined }
          : x,
      ),
    )
    caret.current = { id: b.id, offset: 0 }
  }

  const onEnter = (b: Block, offset: number) => {
    // Enter on an empty list item leaves the list rather than making another bullet.
    if (!b.text && b.type !== 'p') {
      patch(b.id, { type: 'p', indent: undefined, checked: undefined })
      caret.current = { id: b.id, offset: 0 }
      return
    }
    const carry: BlockType = LIST_TYPES.includes(b.type) ? b.type : 'p'
    const fresh: Block = {
      id: crypto.randomUUID(),
      type: carry,
      text: b.text.slice(offset),
      indent: b.indent,
      checked: carry === 'todo' ? false : undefined,
    }
    const i = blocks.findIndex((x) => x.id === b.id)
    const next = [...blocks]
    next[i] = { ...b, text: b.text.slice(0, offset) }
    next.splice(i + 1, 0, fresh)
    edit(next)
    caret.current = { id: fresh.id, offset: 0 }
  }

  const onBackspaceAtStart = (b: Block) => {
    // Peel the formatting off before merging: one Backspace un-does the block type.
    if (b.type !== 'p') {
      patch(b.id, { type: 'p', indent: undefined, checked: undefined })
      caret.current = { id: b.id, offset: 0 }
      return
    }
    if (b.indent) {
      patch(b.id, { indent: b.indent - 1 || undefined })
      caret.current = { id: b.id, offset: 0 }
      return
    }
    const i = blocks.findIndex((x) => x.id === b.id)
    if (i <= 0) return
    const prev = blocks[i - 1]
    if (prev.type === 'divider') {
      edit(blocks.filter((x) => x.id !== prev.id))
      caret.current = { id: b.id, offset: 0 }
      return
    }
    const joinAt = prev.text.length
    edit(
      blocks
        .filter((x) => x.id !== b.id)
        .map((x) => (x.id === prev.id ? { ...x, text: prev.text + b.text } : x)),
    )
    caret.current = { id: prev.id, offset: joinAt }
  }

  const onIndent = (b: Block, delta: number) => {
    if (!LIST_TYPES.includes(b.type)) return
    const next = Math.min(Math.max((b.indent ?? 0) + delta, 0), 3)
    patch(b.id, { indent: next || undefined })
    caret.current = { id: b.id, offset: caretOffsetOf(b.id) }
  }

  const words = wordCount(blocks)
  const mins = readingMinutes(words)

  // Numbering restarts after anything that is not a numbered item at the same depth.
  let run = 0

  return (
    <div className="pt-1">
      <div className="flex items-center gap-3 pb-2">
        <button
          onClick={onBack}
          aria-label="Back to scripts"
          className="-ml-1 shrink-0 rounded-full p-1 text-[var(--muted)] transition-colors hover:text-[var(--text)]"
        >
          <ChevronLeft size={20} />
        </button>
        <span className="text-[13px] text-[var(--muted)] tabular-nums">
          {words} {words === 1 ? 'word' : 'words'}
          {mins > 0 && ` · ${mins} min`}
        </span>
        <span className="ml-auto text-[13px] text-[var(--faint)]">
          {dirty ? 'Saving…' : 'Saved'}
        </span>
      </div>

      <input
        value={title}
        onChange={(e) => {
          setTitle(e.target.value)
          setDirty(true)
        }}
        placeholder="Untitled script"
        className="w-full bg-transparent pt-2 pb-3 text-[28px] font-semibold tracking-tight outline-none"
      />

      <div className="pb-24">
        {blocks.map((b) => {
          run = b.type === 'number' ? run + 1 : 0
          return (
            <EditorBlock
              key={b.id}
              block={b}
              index={b.type === 'number' ? run : 0}
              onText={(text) => onText(b, text)}
              onEnter={(offset) => onEnter(b, offset)}
              onBackspaceAtStart={() => onBackspaceAtStart(b)}
              onIndent={(delta) => onIndent(b, delta)}
              onCheck={() => patch(b.id, { checked: !b.checked })}
              onDelete={() => edit(blocks.filter((x) => x.id !== b.id))}
            />
          )
        })}
      </div>
    </div>
  )
}

/** The caret inside a block that is currently mounted, or 0. */
function caretOffsetOf(id: string): number {
  const el = document.querySelector<HTMLElement>(`[data-block="${id}"]`)
  return el ? caretOffset(el) : 0
}

function ScriptsView({
  scripts,
  setScripts,
  openId,
  setOpenId,
}: {
  scripts: Script[]
  setScripts: (s: Script[]) => void
  openId: string | null
  setOpenId: (id: string | null) => void
}) {
  const [title, setTitle] = useState('')
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  const open = scripts.find((s) => s.id === openId)

  const add = () => {
    if (!title.trim()) return
    const script: Script = {
      id: crypto.randomUUID(),
      title: title.trim(),
      status: 'Idea',
      blocks: [emptyBlock()],
      updatedAt: new Date().toISOString(),
    }
    setScripts([script, ...scripts])
    setTitle('')
    setOpenId(script.id)
  }

  // Same shape as the Buy list: headers and empty-section ghosts are sortable members,
  // which is what lets a drag across a boundary reassign the status.
  const rows = useMemo(() => buildRows(scripts, SCRIPT_STATUSES, (s) => s.status), [scripts])

  const onDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over) return
    const ids = rows.map(rowId)
    const from = ids.indexOf(String(active.id))
    const to = ids.indexOf(String(over.id))
    if (from < 0 || to < 0 || from === to) return
    setScripts(
      applyDrag(scripts, rows, from, to, SCRIPT_STATUSES, (s, status) => ({
        ...s,
        status: status as ScriptStatus,
      })),
    )
  }

  if (open)
    return (
      <ScriptEditor
        script={open}
        onBack={() => setOpenId(null)}
        onChange={(next) => setScripts(scripts.map((s) => (s.id === next.id ? next : s)))}
      />
    )

  return (
    <>
      <div className="rounded-2xl bg-[var(--card)] px-4 py-1">
        <div className="flex items-center gap-2">
          <span className="text-[20px] leading-none text-[var(--faint)]">+</span>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && add()}
            placeholder="New script"
            className="w-full bg-transparent py-3 text-[17px] tracking-tight outline-none"
          />
        </div>
      </div>

      {scripts.length === 0 ? (
        <p className="px-1 pt-6 text-[17px] text-[var(--muted)]">
          Nothing written yet. Name the first one.
        </p>
      ) : (
        <div className="pt-2">
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            modifiers={[restrictToVerticalAxis]}
            onDragEnd={onDragEnd}
          >
            <SortableContext items={rows.map(rowId)} strategy={verticalListSortingStrategy}>
              <AnimatePresence initial={false}>
                {rows.map((r) =>
                  r.kind === 'header' ? (
                    <Slot key={rowId(r)} id={rowId(r)} droppable={false}>
                      <h2 className="flex items-center gap-2 px-1 pt-6 pb-2 text-[13px] font-semibold tracking-[0.06em] text-[var(--muted)] uppercase">
                        <span
                          className="size-1.5 shrink-0 rounded-full"
                          style={{ background: STATUS_COLOR[r.section as ScriptStatus] }}
                        />
                        {r.section}
                      </h2>
                    </Slot>
                  ) : r.kind === 'ghost' ? (
                    <Slot key={rowId(r)} id={rowId(r)} droppable>
                      <p className="px-1 py-2 text-[13px] text-[var(--ghost)]">Nothing here</p>
                    </Slot>
                  ) : (
                    <ScriptRow
                      key={r.item.id}
                      script={r.item}
                      onOpen={() => setOpenId(r.item.id)}
                      onDelete={() => setScripts(scripts.filter((s) => s.id !== r.item.id))}
                    />
                  ),
                )}
              </AnimatePresence>
            </SortableContext>
          </DndContext>
        </div>
      )}
    </>
  )
}

function ScriptRow({
  script,
  onOpen,
  onDelete,
}: {
  script: Script
  onOpen: () => void
  onDelete: () => void
}) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } =
    useSortable({ id: script.id })
  const words = wordCount(script.blocks)
  const mins = readingMinutes(words)

  return (
    <div
      ref={setNodeRef}
      style={{
        transform: CSS.Translate.toString(transform),
        transition,
        zIndex: isDragging ? 10 : undefined,
        position: 'relative',
      }}
    >
      <motion.div
        exit={{ opacity: 0, height: 0, marginBottom: 0, paddingTop: 0, paddingBottom: 0 }}
        className="mb-2.5 flex touch-pan-y items-center gap-2.5 overflow-hidden rounded-2xl bg-[var(--card)] py-3 pr-4 pl-2"
        style={isDragging ? { background: 'var(--card-2)' } : undefined}
      >
        <button
          ref={setActivatorNodeRef}
          {...attributes}
          {...listeners}
          aria-label="Reorder"
          className={`${TAP} shrink-0 cursor-grab p-1 text-[var(--faint)] active:cursor-grabbing`}
          style={{ touchAction: 'none' }}
        >
          <GripVertical size={18} />
        </button>

        <button onClick={onOpen} className="min-w-0 flex-1 text-left">
          <span className="block truncate text-[17px] tracking-tight">
            {script.title || 'Untitled script'}
          </span>
          <span className="flex items-center gap-2 pt-1 text-[13px] text-[var(--muted)]">
            <span
              className="shrink-0 rounded-full px-2 py-0.5 text-[11px] leading-none font-semibold"
              style={{
                background: `${STATUS_COLOR[script.status]}1F`,
                color: STATUS_COLOR[script.status],
              }}
            >
              {script.status}
            </span>
            <span className="min-w-0 truncate tabular-nums">
              {words} {words === 1 ? 'word' : 'words'}
              {mins > 0 && ` · ${mins} min`} · {relativeTime(script.updatedAt)}
            </span>
          </span>
        </button>

        <button
          onPointerDown={(e) => e.preventDefault()}
          onClick={onDelete}
          aria-label={`Delete ${script.title || 'Untitled script'}`}
          className="shrink-0 p-1 text-[var(--faint)] transition-colors hover:text-[#FF3B30]"
        >
          <X size={16} />
        </button>
      </motion.div>
    </div>
  )
}
