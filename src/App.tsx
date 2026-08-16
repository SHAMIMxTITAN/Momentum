import { useEffect, useMemo, useRef, useState } from 'react'
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
import { Check, GripVertical, Monitor, Moon, Sun, X } from 'lucide-react'
import {
  KINDS,
  UNTAGGED,
  applyItemDrag,
  applyTodoDrag,
  buildItemRows,
  buildTodoRows,
  cleanTag,
  monthlySpend,
  rowId,
  safeUrl,
  useItems,
  useTodos,
  parseItems,
  type Item,
  type Kind,
  type Row,
  type Todo,
  type Urgency,
} from './store'
import { useTheme, type ThemeChoice } from './theme'
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

const inr = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 })
const money = (n: number) => `₹${inr.format(n)}`

const FIELD =
  'rounded-lg bg-[var(--field)] px-2.5 py-1.5 text-[14px] tracking-tight outline-none'

type Tab = 'Buy' | 'To-do' | 'Spending'
const TABS: Tab[] = ['Buy', 'To-do', 'Spending']

export default function App() {
  const { items, commit, replaceAll, undo, toast, setToast } = useItems()
  const { todos, setTodos } = useTodos()
  const theme = useTheme()
  const [tab, setTab] = useState<Tab>('Buy')
  const sync = useGitHubSync(items, replaceAll, todos, setTodos)

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

  return (
    <MotionConfig reducedMotion="user" transition={SPRING}>
      <div className="min-h-dvh bg-[var(--bg)]">
        <div className="mx-auto max-w-2xl px-3 pb-32 sm:px-6">
          <div className="sticky top-0 z-20 bg-[var(--bg)] pt-4 pb-2">
            <div className="flex items-center justify-between pb-3">
              <div className="flex gap-1">
                {TABS.map((t) => (
                  <button
                    key={t}
                    onClick={() => setTab(t)}
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
              <ThemeToggle choice={theme.choice} cycle={theme.cycle} />
            </div>
          </div>

          <ConflictBars sync={sync} />

          {tab === 'Buy' && (
            <BuyView items={items} commit={commit} replaceAll={replaceAll} setToast={setToast} sync={sync} />
          )}
          {tab === 'To-do' && <TodoView todos={todos} setTodos={setTodos} />}
          {tab === 'Spending' && <SpendView items={items} />}
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

function ThemeToggle({ choice, cycle }: { choice: ThemeChoice; cycle: () => void }) {
  const Icon = choice === 'system' ? Monitor : choice === 'dark' ? Moon : Sun
  return (
    <button
      onClick={cycle}
      aria-label={`Theme: ${choice}. Tap to change.`}
      title={`Theme: ${choice}`}
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
}: {
  items: Item[]
  commit: (next: Item[], undoLabel?: string) => void
  replaceAll: (items: Item[]) => void
  setToast: (t: string | null) => void
  sync: Sync
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

  const exportJson = () => {
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(items, null, 2)], { type: 'application/json' }),
    )
    const a = document.createElement('a')
    a.href = url
    a.download = `buy-next-${new Date().toISOString().slice(0, 10)}.json`
    a.click()
    URL.revokeObjectURL(url)
  }

  const importJson = async (file: File) => {
    try {
      const parsed = parseItems(JSON.parse(await file.text()))
      if (!parsed.length) return setToast('Nothing usable in that file')
      commit(parsed, `Imported ${parsed.length} items`)
    } catch {
      setToast(`Couldn't read that file`)
    }
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
          <div className="-mx-3 flex gap-2 overflow-x-auto px-3 pt-3 pb-1 sm:mx-0 sm:flex-wrap sm:px-0">
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

          <div className="flex flex-wrap gap-x-4 gap-y-1 px-1 pt-3 text-[13px] tracking-tight text-[var(--muted)]">
            <span className="font-semibold text-[#FF3B30]">Now {money(nowTotal)}</span>
            <span>Need {money(needTotal)}</span>
            <span>
              Open {money(openTotal)} · {open.length} {open.length === 1 ? 'item' : 'items'}
            </span>
          </div>

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
                      <h2
                        className="px-1 pt-5 pb-2 text-[20px] font-semibold tracking-tight"
                        style={{ color: URGENCY_COLOR[r.section as Urgency] }}
                      >
                        {r.section}
                      </h2>
                    </Slot>
                  ) : r.kind === 'ghost' ? (
                    <Slot key={rowId(r)} id={rowId(r)} droppable>
                      <p className="rounded-2xl bg-[var(--card)] px-4 py-3 text-[14px] text-[var(--ghost)]">
                        Nothing here
                      </p>
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
        <button onClick={exportJson} className="hover:text-[#007AFF]">
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
            if (f) importJson(f)
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
        className="mb-2.5 flex items-center gap-2.5 overflow-hidden rounded-2xl bg-[var(--card)] py-3 pr-4 pl-2"
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
            <div className="flex items-start gap-2.5">
              <button
                onClick={cycleKind}
                aria-label={`${item.kind}, tap to switch`}
                className="relative mt-0.5 shrink-0 rounded-full px-2.5 py-1 text-[12px] leading-none font-semibold tracking-tight text-white after:absolute after:-inset-y-2.5 after:content-['']"
                style={{ background: KIND_COLOR[item.kind] }}
              >
                {item.kind}
              </button>
              {item.tag && (
                <span className="mt-0.5 shrink-0 rounded-full bg-[var(--card-2)] px-2.5 py-1 text-[12px] leading-none text-[var(--muted)]">
                  {item.tag}
                </span>
              )}
              <button
                onClick={() => setEditing(item.id)}
                className="min-w-0 flex-1 text-left text-[17px] tracking-tight break-words hyphens-auto"
              >
                {item.title}
              </button>
              {item.price != null && (
                <span className="shrink-0 text-[15px] text-[var(--muted)] tabular-nums">
                  {money(item.price)}
                </span>
              )}
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

  return (
    <div className="flex flex-col gap-2">
      <input
        autoFocus
        value={d.title}
        onChange={(e) => setD({ ...d, title: e.target.value })}
        onKeyDown={onKey}
        onBlur={save}
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
        {/* pointerDown, not click: the title's onBlur would unmount this first */}
        <button
          onPointerDown={onDelete}
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

function TodoView({ todos, setTodos }: { todos: Todo[]; setTodos: (t: Todo[]) => void }) {
  const [title, setTitle] = useState('')
  const [editing, setEditing] = useState<string | null>(null)
  const [showDone, setShowDone] = useState(false)

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  const openTodos = todos.filter((t) => !t.done)
  const done = todos.filter((t) => t.done)
  const rows = buildTodoRows(openTodos)

  const add = () => {
    if (!title.trim()) return
    setTodos([
      ...todos,
      { id: crypto.randomUUID(), title: title.trim(), when: 'Today', done: false },
    ])
    setTitle('')
  }

  const toggle = (t: Todo) =>
    setTodos(
      todos.map((x) =>
        x.id === t.id
          ? { ...x, done: !x.done, doneAt: x.done ? undefined : new Date().toISOString() }
          : x,
      ),
    )

  const remove = (t: Todo) => setTodos(todos.filter((x) => x.id !== t.id))

  const rename = (id: string, next: string) =>
    setTodos(todos.map((x) => (x.id === id ? { ...x, title: next } : x)))

  const onDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over) return
    const ids = rows.map(rowId)
    const from = ids.indexOf(String(active.id))
    const to = ids.indexOf(String(over.id))
    if (from < 0 || to < 0 || from === to) return
    setTodos(applyTodoDrag(todos, rows, from, to))
  }

  return (
    <>
      <div className="flex items-center gap-2 rounded-2xl bg-[var(--card)] px-4">
        <span className="text-[20px] leading-none text-[var(--faint)]">+</span>
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && add()}
          placeholder="Add a task"
          className="w-full bg-transparent py-3.5 text-[17px] tracking-tight outline-none"
        />
      </div>

      {todos.length === 0 ? (
        <p className="px-1 pt-6 text-[17px] text-[var(--muted)]">
          Nothing to do yet. Add the first task.
        </p>
      ) : (
        <>
          <div className="px-1 pt-3 text-[13px] tracking-tight text-[var(--muted)]">
            {openTodos.length} open · {done.length} done
          </div>

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
                      <h2
                        className="px-1 pt-5 pb-2 text-[20px] font-semibold tracking-tight"
                        style={{ color: WHEN_COLOR[r.section] }}
                      >
                        {r.section}
                      </h2>
                    </Slot>
                  ) : r.kind === 'ghost' ? (
                    <Slot key={rowId(r)} id={rowId(r)} droppable>
                      <p className="rounded-2xl bg-[var(--card)] px-4 py-3 text-[14px] text-[var(--ghost)]">
                        Nothing here
                      </p>
                    </Slot>
                  ) : (
                    <TodoRow
                      key={r.item.id}
                      todo={r.item}
                      editing={editing === r.item.id}
                      setEditing={setEditing}
                      rename={rename}
                      onToggle={() => toggle(r.item)}
                      onDelete={() => remove(r.item)}
                    />
                  ),
                )}
              </AnimatePresence>
            </SortableContext>
          </DndContext>

          {done.length > 0 && (
            <div className="pt-8">
              <button
                onClick={() => setShowDone((s) => !s)}
                className="px-1 text-[15px] font-semibold tracking-tight text-[var(--muted)]"
              >
                Done · {done.length}
                <span
                  className="ml-1.5 inline-block transition-transform"
                  style={{ transform: showDone ? 'rotate(90deg)' : 'none' }}
                >
                  ›
                </span>
              </button>
              {showDone && (
                <div className="space-y-2.5 pt-3">
                  {done.map((t) => (
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
              )}
            </div>
          )}
        </>
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
  onDelete,
}: {
  todo: Todo
  editing: boolean
  setEditing: (id: string | null) => void
  rename: (id: string, next: string) => void
  onToggle: () => void
  onDelete: () => void
}) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } =
    useSortable({ id: todo.id })
  const [draft, setDraft] = useState(todo.title)

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
        className="mb-2.5 flex items-center gap-2.5 overflow-hidden rounded-2xl bg-[var(--card)] py-3 pr-4 pl-2"
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
          aria-label={`Mark ${todo.title} done`}
          className={`${TAP} size-6 shrink-0 rounded-full border-2 border-[var(--faint)] transition-colors hover:border-[var(--muted)]`}
        />

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
            className="min-w-0 flex-1 text-left text-[17px] tracking-tight break-words"
          >
            {todo.title}
          </button>
        )}

        <button
          onPointerDown={onDelete}
          aria-label={`Delete ${todo.title}`}
          className="shrink-0 p-1 text-[var(--faint)] transition-colors hover:text-[#FF3B30]"
        >
          <X size={16} />
        </button>
      </motion.div>
    </div>
  )
}

/* ----------------------------------------------------------- Spending view */

function SpendView({ items }: { items: Item[] }) {
  const months = useMemo(() => monthlySpend(items), [items])

  if (months.length === 0)
    return (
      <p className="px-1 pt-6 text-[17px] text-[var(--muted)]">
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
        {months.map((m) => {
          const max = Math.max(...KINDS.map((k) => m.byKind[k]), 1)
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

              <div className="space-y-1.5 pt-3">
                {KINDS.map((k) => (
                  <div key={k} className="flex items-center gap-2.5">
                    <span className="w-11 shrink-0 text-[13px] text-[var(--muted)]">{k}</span>
                    <div className="h-2 min-w-0 flex-1 overflow-hidden rounded-full bg-[var(--card-2)]">
                      <div
                        className="h-full rounded-full"
                        style={{
                          width: `${(m.byKind[k] / max) * 100}%`,
                          background: KIND_COLOR[k],
                        }}
                      />
                    </div>
                    <span className="shrink-0 text-[13px] text-[var(--muted)] tabular-nums">
                      {money(m.byKind[k])}
                    </span>
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
    path: cfg?.path ?? 'buy-next.json',
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
          placeholder="buy-next.json"
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
              setD({ token: '', repo: '', path: 'buy-next.json' })
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
