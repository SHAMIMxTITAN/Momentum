import { useEffect, useRef, useState } from 'react'
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
import { Check, GripVertical, X } from 'lucide-react'
import {
  CATEGORIES,
  applyDrag,
  buildRows,
  rowId,
  safeUrl,
  useItems,
  parseItems,
  type Category,
  type Item,
  type Urgency,
} from './store'
import { useGitHubSync, validRepo, type Status, type SyncConfig } from './github'

const CAT_COLOR: Record<Category, string> = {
  Repair: '#FF3B30',
  Gear: '#007AFF',
  Lego: '#FF9500',
  Clothes: '#AF52DE',
  Want: '#34C759',
}

const URGENCY_COLOR: Record<Urgency, string> = {
  Now: '#FF3B30',
  Soon: '#FF9500',
  Later: '#8E8E93',
}

const SPRING = { type: 'spring' as const, stiffness: 520, damping: 36, mass: 0.7 }

// Grows the tap area to a thumb-sized box without changing the icon's footprint.
// Vertical only where the row is tight, so neighbouring controls never overlap.
const TAP = "relative after:absolute after:-inset-x-1.5 after:-inset-y-3 after:content-['']"

const inr = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 })
const money = (n: number) => `₹${inr.format(n)}`

export default function App() {
  const { items, commit, replaceAll, undo, toast, setToast } = useItems()
  const [filters, setFilters] = useState<Set<Category>>(new Set())
  const [editing, setEditing] = useState<string | null>(null)
  const [showBought, setShowBought] = useState(false)
  const [showSync, setShowSync] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const sync = useGitHubSync(items, replaceAll)

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  const isVisible = (i: Item) => !i.bought && (filters.size === 0 || filters.has(i.category))
  const open = items.filter((i) => !i.bought)
  const visible = items.filter(isVisible)
  const bought = items.filter((i) => i.bought)

  const nowTotal = open.filter((i) => i.urgency === 'Now').reduce((s, i) => s + (i.price ?? 0), 0)
  const openTotal = open.reduce((s, i) => s + (i.price ?? 0), 0)

  const rows = buildRows(visible)

  const update = (id: string, patch: Partial<Item>) =>
    commit(items.map((i) => (i.id === id ? { ...i, ...patch } : i)))

  const add = (title: string) =>
    commit([
      ...items,
      { id: crypto.randomUUID(), title, category: 'Gear', urgency: 'Later', bought: false },
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
    commit(applyDrag(items, rows, from, to))
  }

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

  return (
    <MotionConfig reducedMotion="user" transition={SPRING}>
      <div className="min-h-dvh bg-white">
        <div className="mx-auto max-w-2xl px-3 pb-32 sm:px-6">
          <div className="sticky top-0 z-20 bg-white pt-5 pb-3">
            <AddBar onAdd={add} />
          </div>

          {sync.conflict && (
            <div className="mb-2 rounded-2xl bg-[#FFF2F2] px-4 py-3.5">
              <p className="text-[15px] tracking-tight text-[#1D1D1F]">
                This list and the one on GitHub both changed. Keep which?
              </p>
              <div className="flex gap-2 pt-2.5">
                <button
                  onClick={() => sync.resolve('mine')}
                  className="rounded-full bg-[#FF3B30] px-3.5 py-1.5 text-[14px] font-semibold text-white"
                >
                  This machine
                </button>
                <button
                  onClick={() => sync.resolve('theirs')}
                  className="rounded-full bg-white px-3.5 py-1.5 text-[14px] font-semibold text-[#1D1D1F]"
                >
                  GitHub ({sync.conflict.items.length} items)
                </button>
              </div>
              <p className="pt-2 text-[12px] text-[#8E8E93]">
                Either way the other version stays in the repo’s commit history.
              </p>
            </div>
          )}

          {items.length === 0 ? (
            <p className="px-1 pt-6 text-[17px] text-[#8E8E93]">
              Nothing on the list yet. Add the first thing.
            </p>
          ) : (
            <>
              <div className="-mx-3 flex gap-2 overflow-x-auto px-3 pb-1 sm:mx-0 sm:flex-wrap sm:px-0">
                {CATEGORIES.map((c) => (
                  <Chip
                    key={c}
                    cat={c}
                    on={filters.has(c)}
                    onClick={() =>
                      setFilters((f) => {
                        const n = new Set(f)
                        n.has(c) ? n.delete(c) : n.add(c)
                        return n
                      })
                    }
                  />
                ))}
              </div>

              <div className="px-1 pt-4 text-[13px] tracking-tight text-[#8E8E93]">
                <span className="font-semibold text-[#FF3B30]">Now {money(nowTotal)}</span>
                <span className="px-2">·</span>
                <span>
                  Open {money(openTotal)} · {open.length} items
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
                            className="px-1 pt-8 pb-3 text-[26px] font-semibold tracking-tight"
                            style={{ color: URGENCY_COLOR[r.urgency] }}
                          >
                            {r.urgency}
                          </h2>
                        </Slot>
                      ) : r.kind === 'ghost' ? (
                        <Slot key={rowId(r)} id={rowId(r)} droppable>
                          <p className="rounded-2xl bg-[#F5F5F7] px-4 py-4 text-[15px] text-[#B0B0B8]">
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
                <div className="pt-10">
                  <button
                    onClick={() => setShowBought((s) => !s)}
                    className="px-1 text-[15px] font-semibold tracking-tight text-[#8E8E93]"
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
                        <div className="space-y-3 pt-3">
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

          <div className="flex flex-wrap items-center gap-4 px-1 pt-12 text-[13px] text-[#8E8E93]">
            <button onClick={exportJson} className="hover:text-[#007AFF]">
              Export JSON
            </button>
            <button onClick={() => fileRef.current?.click()} className="hover:text-[#007AFF]">
              Import JSON
            </button>
            <button onClick={() => setShowSync((s) => !s)} className="hover:text-[#007AFF]">
              Sync
            </button>
            <SyncStatus status={sync.status} onRetry={sync.sync} />
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
        </div>

        <AnimatePresence>
          {toast && (
            <motion.div
              initial={{ y: 60, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: 60, opacity: 0 }}
              className="fixed inset-x-0 bottom-6 z-30 flex justify-center px-4"
            >
              <div className="flex items-center gap-4 rounded-full bg-[#1D1D1F] py-3 pr-3 pl-5 text-[15px] text-white">
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

function SyncStatus({ status, onRetry }: { status: Status; onRetry: () => void }) {
  if (status.kind === 'off') return null
  if (status.kind === 'syncing') return <span className="text-[#B0B0B8]">Syncing…</span>
  if (status.kind === 'conflict') return <span className="text-[#FF9500]">Needs a choice</span>
  if (status.kind === 'error')
    return (
      <button onClick={onRetry} className="max-w-[60%] truncate text-[#FF3B30]" title={status.message}>
        {status.message} — retry
      </button>
    )
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
  const cls =
    'w-full rounded-lg bg-white px-2.5 py-2 text-[14px] tracking-tight outline-none placeholder:text-[#B0B0B8]'

  return (
    <div className="mt-3 rounded-2xl bg-[#F5F5F7] p-4">
      <p className="pb-3 text-[13px] leading-relaxed text-[#8E8E93]">
        Stores the list as a JSON file in a private repo, so both machines read and write the same
        file. Use a <span className="text-[#1D1D1F]">fine-grained</span> token limited to that one
        repo with <span className="text-[#1D1D1F]">Contents: read and write</span> — it is kept in
        this browser only, and anyone with access to this machine can read it.
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
          className="rounded-full bg-[#007AFF] px-3.5 py-1.5 text-[14px] font-semibold text-white disabled:bg-[#C7C7CC]"
        >
          {cfg ? 'Update' : 'Connect'}
        </button>
        {cfg && (
          <button
            onClick={() => {
              setD({ token: '', repo: '', path: 'buy-next.json' })
              setCfg(null)
            }}
            className="rounded-full bg-white px-3.5 py-1.5 text-[14px] font-semibold text-[#FF3B30]"
          >
            Disconnect
          </button>
        )}
      </div>
    </div>
  )
}

function AddBar({ onAdd }: { onAdd: (t: string) => void }) {
  const [v, setV] = useState('')
  return (
    <div className="flex items-center gap-2 rounded-2xl bg-[#F5F5F7] px-4">
      <span className="text-[20px] leading-none text-[#B0B0B8]">+</span>
      <input
        autoFocus={matchMedia('(pointer: fine)').matches}
        value={v}
        onChange={(e) => setV(e.target.value)}
        onKeyDown={(e) => {
          if (e.key !== 'Enter' || !v.trim()) return
          onAdd(v.trim())
          setV('')
        }}
        placeholder="Add something to buy"
        className="w-full bg-transparent py-3.5 text-[17px] tracking-tight outline-none placeholder:text-[#B0B0B8]"
      />
    </div>
  )
}

function Chip({ cat, on, onClick }: { cat: Category; on: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="shrink-0 rounded-full px-3.5 py-1.5 text-[14px] font-semibold tracking-tight"
      style={
        on
          ? { background: CAT_COLOR[cat], color: '#fff' }
          : { background: '#F5F5F7', color: '#1D1D1F' }
      }
    >
      {cat}
    </button>
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

  const cycleCategory = () =>
    update(item.id, {
      category: CATEGORIES[(CATEGORIES.indexOf(item.category) + 1) % CATEGORIES.length],
    })

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
        className="mb-3 flex items-center gap-2.5 overflow-hidden rounded-2xl bg-[#F5F5F7] py-4 pr-4 pl-2"
        style={isDragging ? { background: '#EBEBEF' } : undefined}
      >
        <button
          ref={setActivatorNodeRef}
          {...attributes}
          {...listeners}
          aria-label="Reorder"
          className={`${TAP} shrink-0 cursor-grab p-1 text-[#C0C0C8] active:cursor-grabbing`}
          style={{ touchAction: 'none' }}
        >
          <GripVertical size={18} />
        </button>

        <button
          onClick={onToggle}
          aria-label={`Mark ${item.title} bought`}
          className={`${TAP} size-6 shrink-0 rounded-full border-2 border-[#C7C7CC] transition-colors hover:border-[#8E8E93]`}
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
                onClick={cycleCategory}
                aria-label={`Category: ${item.category}, tap to change`}
                className="relative mt-0.5 shrink-0 rounded-full px-2.5 py-1 text-[12px] leading-none font-semibold tracking-tight text-white after:absolute after:-inset-y-2.5 after:content-['']"
                style={{ background: CAT_COLOR[item.category] }}
              >
                {item.category}
              </button>
              <button
                onClick={() => setEditing(item.id)}
                className="min-w-0 flex-1 text-left text-[17px] tracking-tight break-words hyphens-auto"
              >
                {item.title}
              </button>
              {item.price != null && (
                <span className="shrink-0 text-[15px] text-[#8E8E93] tabular-nums">
                  {money(item.price)}
                </span>
              )}
            </div>
          )}

          {!editing && (item.note || item.link) && (
            <div className="flex gap-2 pt-1 pl-0.5 text-[13px] text-[#8E8E93]">
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
    note: item.note ?? '',
    link: item.link ?? '',
  })

  const save = () => {
    if (!d.title.trim()) return done()
    const price = parseFloat(d.price)
    update(item.id, {
      title: d.title.trim(),
      price: isFinite(price) ? price : undefined,
      note: d.note.trim() || undefined,
      link: safeUrl(d.link),
    })
    done()
  }

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') save()
    if (e.key === 'Escape') done()
  }

  const cls =
    'rounded-lg bg-white px-2.5 py-1.5 text-[14px] tracking-tight outline-none placeholder:text-[#B0B0B8]'

  return (
    <div className="flex flex-col gap-2">
      <input
        autoFocus
        value={d.title}
        onChange={(e) => setD({ ...d, title: e.target.value })}
        onKeyDown={onKey}
        onBlur={save}
        className={`${cls} text-[17px]`}
      />
      <div className="flex gap-2">
        <input
          value={d.price}
          onChange={(e) => setD({ ...d, price: e.target.value })}
          onKeyDown={onKey}
          inputMode="decimal"
          placeholder="Price"
          className={`${cls} w-24 shrink-0`}
        />
        <input
          value={d.note}
          onChange={(e) => setD({ ...d, note: e.target.value })}
          onKeyDown={onKey}
          placeholder="Note"
          className={`${cls} min-w-0 flex-1`}
        />
        <input
          value={d.link}
          onChange={(e) => setD({ ...d, link: e.target.value })}
          onKeyDown={onKey}
          inputMode="url"
          placeholder="Link"
          className={`${cls} min-w-0 flex-1`}
        />
        {/* pointerDown, not click: the title's onBlur would unmount this first */}
        <button
          onPointerDown={onDelete}
          aria-label={`Delete ${item.title}`}
          className="shrink-0 rounded-lg px-2 py-1.5 text-[#C7C7CC] transition-colors hover:text-[#FF3B30]"
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
    <div className="flex items-center gap-3 rounded-2xl bg-[#F5F5F7] px-4 py-3">
      <button
        onClick={onRestore}
        aria-label={`Move ${item.title} back to the list`}
        className="grid size-6 shrink-0 place-items-center rounded-full bg-[#34C759] text-white"
      >
        <Check size={14} strokeWidth={3} />
      </button>
      <span className="min-w-0 flex-1 truncate text-[16px] text-[#8E8E93] line-through">
        {item.title}
      </span>
      {item.price != null && (
        <span className="shrink-0 text-[14px] text-[#B0B0B8] tabular-nums">{money(item.price)}</span>
      )}
      <button
        onClick={onDelete}
        aria-label={`Delete ${item.title}`}
        className="shrink-0 p-1 text-[#C7C7CC] hover:text-[#FF3B30]"
      >
        <X size={16} />
      </button>
    </div>
  )
}
