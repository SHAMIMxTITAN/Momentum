import { useCallback, useEffect, useRef, useState } from 'react'
import { parseItems, parsePayments, parseTodos, type Item, type Payment, type Todo } from './store.ts'

export type SyncConfig = { token: string; repo: string; path: string }

const CFG_KEY = 'buy-next.sync'
const BASE_KEY = 'buy-next.synced'
const TODO_BASE_KEY = 'buy-next.synced.todos'
const PAY_BASE_KEY = 'buy-next.synced.payments'
const API = 'https://api.github.com'

export const serialize = (rows: unknown[]) => JSON.stringify(rows, null, 2)

/**
 * To-dos live in a sibling file rather than inside the list file. Keeping the list
 * file a plain array means a machine still running the old code can read it — a
 * combined object would parse as empty there and push the emptiness back.
 */
const stem = (path: string) => path.replace(/\.json$/i, '')

export const todosPath = (path: string) => `${stem(path)}.todos.json`

export const paymentsPath = (path: string) => `${stem(path)}.payments.json`

const b64encode = (s: string) => {
  const bytes = new TextEncoder().encode(s)
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  return btoa(bin)
}

const b64decode = (b64: string) => {
  const bin = atob(b64.replace(/\s/g, ''))
  return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)))
}

export const validRepo = (r: string) => /^[\w.-]+\/[\w.-]+$/.test(r.trim())

const headers = (token: string) => ({
  Authorization: `Bearer ${token}`,
  Accept: 'application/vnd.github+json',
  'X-GitHub-Api-Version': '2022-11-28',
})

const contentsUrl = (cfg: SyncConfig, path: string) =>
  `${API}/repos/${cfg.repo}/contents/${path.split('/').map(encodeURIComponent).join('/')}`

async function fail(r: Response): Promise<never> {
  const body = await r.json().catch(() => ({}) as { message?: string })
  if (r.status === 401) throw new Error('Token rejected — check it hasn’t expired.')
  if (r.status === 403) throw new Error(body.message ?? 'Forbidden — token may lack Contents access.')
  if (r.status === 404)
    throw new Error('Repo not found — check the name, and that the token can reach it.')
  throw new Error(body.message ?? `GitHub error ${r.status}`)
}

export type Remote<T> = { items: T[]; json: string; sha: string }

/** null means the file doesn't exist in the repo yet. */
export async function pull<T>(
  cfg: SyncConfig,
  path: string,
  parse: (raw: unknown) => T[],
): Promise<Remote<T> | null> {
  const r = await fetch(`${contentsUrl(cfg, path)}?ref=HEAD&t=${Date.now()}`, {
    headers: headers(cfg.token),
    cache: 'no-store',
  })
  if (r.status === 404) {
    // Distinguish "repo missing" from "file not yet created".
    const repoCheck = await fetch(`${API}/repos/${cfg.repo}`, { headers: headers(cfg.token) })
    if (!repoCheck.ok) return fail(repoCheck)
    return null
  }
  if (!r.ok) return fail(r)
  const j = (await r.json()) as { content: string; sha: string }
  const json = b64decode(j.content)
  return { items: parse(JSON.parse(json)), json, sha: j.sha }
}

export async function push(
  cfg: SyncConfig,
  path: string,
  rows: unknown[],
  sha: string | null,
  label: string,
): Promise<string> {
  const r = await fetch(contentsUrl(cfg, path), {
    method: 'PUT',
    headers: { ...headers(cfg.token), 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message: `buy-next: ${rows.length} ${label}${rows.length === 1 ? '' : 's'}`,
      content: b64encode(serialize(rows)),
      ...(sha ? { sha } : {}),
    }),
  })
  if (!r.ok) return fail(r)
  const j = (await r.json()) as { content: { sha: string } }
  return j.content.sha
}

export type Decision = 'up-to-date' | 'take-remote' | 'push-local' | 'conflict'
export type Base = { sha: string; json: string } | null

/**
 * Three-way compare against the last state we successfully synced.
 * Without the base we can't tell "I edited" from "they edited", so anything
 * ambiguous returns 'conflict' and asks rather than silently picking a side.
 */
export function decide<T>(localJson: string, remote: Remote<T> | null, base: Base): Decision {
  if (!remote) return localJson === '[]' ? 'up-to-date' : 'push-local'
  if (remote.json === localJson) return 'up-to-date'
  if (!base) return localJson === '[]' ? 'take-remote' : 'conflict'
  if (remote.sha === base.sha) return 'push-local' // only we moved
  if (localJson === base.json) return 'take-remote' // only they moved
  return 'conflict' // both moved
}

/**
 * What to remember after an 'up-to-date' result. Must never be null: the debounce effect
 * re-arms whenever there's no base, so returning null for a repo file that doesn't exist
 * yet spins forever — sync, "synced", sync again, 1.5s apart.
 */
export const upToDateBase = <T,>(remote: Remote<T> | null, localJson: string): Base =>
  remote ? { sha: remote.sha, json: remote.json } : { sha: '', json: localJson }

export type Status =
  | { kind: 'off' }
  | { kind: 'syncing' }
  | { kind: 'synced'; at: number }
  | { kind: 'conflict' }
  | { kind: 'error'; message: string }

export const loadCfg = (): SyncConfig | null => {
  try {
    const c = JSON.parse(localStorage.getItem(CFG_KEY) ?? 'null')
    return c && c.token && validRepo(c.repo ?? '') ? c : null
  } catch {
    return null
  }
}

const loadBase = (key: string): Base => {
  try {
    return JSON.parse(localStorage.getItem(key) ?? 'null')
  } catch {
    return null
  }
}

const saveBase = (key: string, b: Base) => localStorage.setItem(key, JSON.stringify(b))

type FileSync<T> = {
  path: (cfg: SyncConfig) => string
  baseKey: string
  parse: (raw: unknown) => T[]
  label: string
}

/** One file in the repo, kept in step with one local list. */
function useFileSync<T>(
  cfg: SyncConfig | null,
  rows: T[],
  replaceAll: (rows: T[]) => void,
  file: FileSync<T>,
) {
  const [status, setStatus] = useState<Status>(() => (cfg ? { kind: 'syncing' } : { kind: 'off' }))
  const [conflict, setConflict] = useState<Remote<T> | null>(null)

  // Refs so the debounce effect doesn't restart on every keystroke-driven rerender.
  const rowsRef = useRef(rows)
  rowsRef.current = rows
  const running = useRef(false)

  const sync = useCallback(async () => {
    if (!cfg || running.current) return
    running.current = true
    setStatus({ kind: 'syncing' })
    try {
      const path = file.path(cfg)
      const remote = await pull(cfg, path, file.parse)
      const localJson = serialize(rowsRef.current as unknown[])
      switch (decide(localJson, remote, loadBase(file.baseKey))) {
        case 'up-to-date':
          saveBase(file.baseKey, upToDateBase(remote, localJson))
          break
        case 'take-remote':
          replaceAll(remote!.items)
          saveBase(file.baseKey, { sha: remote!.sha, json: remote!.json })
          break
        case 'push-local': {
          const sha = await push(
            cfg,
            path,
            rowsRef.current as unknown[],
            remote?.sha ?? null,
            file.label,
          )
          saveBase(file.baseKey, { sha, json: localJson })
          break
        }
        case 'conflict':
          setConflict(remote)
          setStatus({ kind: 'conflict' })
          return
      }
      setConflict(null)
      setStatus({ kind: 'synced', at: Date.now() })
    } catch (e) {
      setStatus({ kind: 'error', message: e instanceof Error ? e.message : 'Sync failed' })
    } finally {
      running.current = false
    }
  }, [cfg, replaceAll, file.baseKey, file.label, file.parse, file.path])

  // Pull on open and whenever the window regains focus — that's how the other machine's
  // changes arrive without any push infrastructure.
  useEffect(() => {
    if (!cfg) return setStatus({ kind: 'off' })
    sync()
    const onFocus = () => sync()
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [cfg, sync])

  // Debounced push after edits settle. Re-runs on each successful sync too: a call made
  // while another was in flight gets dropped, and this is what picks it back up.
  const json = serialize(rows as unknown[])
  const syncedAt = status.kind === 'synced' ? status.at : 0
  useEffect(() => {
    if (!cfg) return
    const base = loadBase(file.baseKey)
    if (base && base.json === json) return // nothing of ours to send
    const t = setTimeout(() => sync(), 1500)
    return () => clearTimeout(t)
  }, [json, cfg, sync, syncedAt, file.baseKey])

  const resolve = async (keep: 'mine' | 'theirs') => {
    if (!conflict || !cfg) return
    if (keep === 'theirs') {
      replaceAll(conflict.items)
      saveBase(file.baseKey, { sha: conflict.sha, json: conflict.json })
      setConflict(null)
      setStatus({ kind: 'synced', at: Date.now() })
      return
    }
    setStatus({ kind: 'syncing' })
    try {
      const localJson = serialize(rowsRef.current as unknown[])
      const sha = await push(
        cfg,
        file.path(cfg),
        rowsRef.current as unknown[],
        conflict.sha,
        file.label,
      )
      saveBase(file.baseKey, { sha, json: localJson })
      setConflict(null)
      setStatus({ kind: 'synced', at: Date.now() })
    } catch (e) {
      setStatus({ kind: 'error', message: e instanceof Error ? e.message : 'Sync failed' })
    }
  }

  return { status, conflict, sync, resolve }
}

const ITEM_FILE: FileSync<Item> = {
  path: (cfg) => cfg.path,
  baseKey: BASE_KEY,
  parse: parseItems,
  label: 'item',
}

const TODO_FILE: FileSync<Todo> = {
  path: (cfg) => todosPath(cfg.path),
  baseKey: TODO_BASE_KEY,
  parse: parseTodos,
  label: 'task',
}

const PAYMENT_FILE: FileSync<Payment> = {
  path: (cfg) => paymentsPath(cfg.path),
  baseKey: PAY_BASE_KEY,
  parse: parsePayments,
  label: 'payment',
}

/** Whichever half is in trouble is the one worth showing. */
const worst = (a: Status, b: Status): Status => {
  const rank = (s: Status) =>
    s.kind === 'error' ? 4 : s.kind === 'conflict' ? 3 : s.kind === 'syncing' ? 2 : s.kind === 'synced' ? 1 : 0
  return rank(a) >= rank(b) ? a : b
}

export function useGitHubSync(
  items: Item[],
  replaceItems: (items: Item[]) => void,
  todos: Todo[],
  replaceTodos: (todos: Todo[]) => void,
  payments: Payment[],
  replacePayments: (payments: Payment[]) => void,
) {
  const [cfg, setCfgState] = useState<SyncConfig | null>(loadCfg)

  const itemSync = useFileSync(cfg, items, replaceItems, ITEM_FILE)
  const todoSync = useFileSync(cfg, todos, replaceTodos, TODO_FILE)
  const paymentSync = useFileSync(cfg, payments, replacePayments, PAYMENT_FILE)

  const setCfg = (next: SyncConfig | null) => {
    if (next) localStorage.setItem(CFG_KEY, JSON.stringify(next))
    else localStorage.removeItem(CFG_KEY)
    // different repo/file => old bases are meaningless
    localStorage.removeItem(BASE_KEY)
    localStorage.removeItem(TODO_BASE_KEY)
    localStorage.removeItem(PAY_BASE_KEY)
    setCfgState(next)
  }

  const sync = () => {
    itemSync.sync()
    todoSync.sync()
    paymentSync.sync()
  }

  return {
    cfg,
    setCfg,
    sync,
    status: worst(worst(itemSync.status, todoSync.status), paymentSync.status),
    items: itemSync,
    todos: todoSync,
    payments: paymentSync,
  }
}
