import { useCallback, useEffect, useRef, useState } from 'react'
import { parseItems, type Item } from './store.ts'

export type SyncConfig = { token: string; repo: string; path: string }

const CFG_KEY = 'buy-next.sync'
const BASE_KEY = 'buy-next.synced'
const API = 'https://api.github.com'

export const serialize = (items: Item[]) => JSON.stringify(items, null, 2)

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

const contentsUrl = (cfg: SyncConfig) =>
  `${API}/repos/${cfg.repo}/contents/${cfg.path.split('/').map(encodeURIComponent).join('/')}`

async function fail(r: Response): Promise<never> {
  const body = await r.json().catch(() => ({}) as { message?: string })
  if (r.status === 401) throw new Error('Token rejected — check it hasn’t expired.')
  if (r.status === 403) throw new Error(body.message ?? 'Forbidden — token may lack Contents access.')
  if (r.status === 404)
    throw new Error('Repo not found — check the name, and that the token can reach it.')
  throw new Error(body.message ?? `GitHub error ${r.status}`)
}

export type Remote = { items: Item[]; json: string; sha: string }

/** null means the file doesn't exist in the repo yet. */
export async function pull(cfg: SyncConfig): Promise<Remote | null> {
  const r = await fetch(`${contentsUrl(cfg)}?ref=HEAD&t=${Date.now()}`, {
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
  return { items: parseItems(JSON.parse(json)), json, sha: j.sha }
}

export async function push(cfg: SyncConfig, items: Item[], sha: string | null): Promise<string> {
  const r = await fetch(contentsUrl(cfg), {
    method: 'PUT',
    headers: { ...headers(cfg.token), 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message: `buy-next: ${items.length} item${items.length === 1 ? '' : 's'}`,
      content: b64encode(serialize(items)),
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
export function decide(localJson: string, remote: Remote | null, base: Base): Decision {
  if (!remote) return localJson === '[]' ? 'up-to-date' : 'push-local'
  if (remote.json === localJson) return 'up-to-date'
  if (!base) return localJson === '[]' ? 'take-remote' : 'conflict'
  if (remote.sha === base.sha) return 'push-local' // only we moved
  if (localJson === base.json) return 'take-remote' // only they moved
  return 'conflict' // both moved
}

export type Status =
  | { kind: 'off' }
  | { kind: 'syncing' }
  | { kind: 'synced'; at: number }
  | { kind: 'conflict' }
  | { kind: 'error'; message: string }

const loadCfg = (): SyncConfig | null => {
  try {
    const c = JSON.parse(localStorage.getItem(CFG_KEY) ?? 'null')
    return c && c.token && validRepo(c.repo ?? '') ? c : null
  } catch {
    return null
  }
}

const loadBase = (): Base => {
  try {
    return JSON.parse(localStorage.getItem(BASE_KEY) ?? 'null')
  } catch {
    return null
  }
}

const saveBase = (b: Base) => localStorage.setItem(BASE_KEY, JSON.stringify(b))

export function useGitHubSync(items: Item[], replaceAll: (items: Item[]) => void) {
  const [cfg, setCfgState] = useState<SyncConfig | null>(loadCfg)
  const [status, setStatus] = useState<Status>(() => (loadCfg() ? { kind: 'syncing' } : { kind: 'off' }))
  const [conflict, setConflict] = useState<Remote | null>(null)

  // Refs so the debounce effect doesn't restart on every keystroke-driven rerender.
  const itemsRef = useRef(items)
  itemsRef.current = items
  const running = useRef(false)

  const sync = useCallback(async () => {
    if (!cfg || running.current) return
    running.current = true
    setStatus({ kind: 'syncing' })
    try {
      const remote = await pull(cfg)
      const localJson = serialize(itemsRef.current)
      switch (decide(localJson, remote, loadBase())) {
        case 'up-to-date':
          if (remote) saveBase({ sha: remote.sha, json: remote.json })
          break
        case 'take-remote':
          replaceAll(remote!.items)
          saveBase({ sha: remote!.sha, json: remote!.json })
          break
        case 'push-local': {
          const sha = await push(cfg, itemsRef.current, remote?.sha ?? null)
          saveBase({ sha, json: localJson })
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
  }, [cfg, replaceAll])

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
  const json = serialize(items)
  const syncedAt = status.kind === 'synced' ? status.at : 0
  useEffect(() => {
    if (!cfg) return
    const base = loadBase()
    if (base && base.json === json) return // nothing of ours to send
    const t = setTimeout(() => sync(), 1500)
    return () => clearTimeout(t)
  }, [json, cfg, sync, syncedAt])

  const setCfg = (next: SyncConfig | null) => {
    if (next) localStorage.setItem(CFG_KEY, JSON.stringify(next))
    else localStorage.removeItem(CFG_KEY)
    localStorage.removeItem(BASE_KEY) // different repo/file => old base is meaningless
    setConflict(null)
    setCfgState(next)
  }

  const resolve = async (keep: 'mine' | 'theirs') => {
    if (!conflict || !cfg) return
    if (keep === 'theirs') {
      replaceAll(conflict.items)
      saveBase({ sha: conflict.sha, json: conflict.json })
      setConflict(null)
      setStatus({ kind: 'synced', at: Date.now() })
      return
    }
    setStatus({ kind: 'syncing' })
    try {
      const localJson = serialize(itemsRef.current)
      const sha = await push(cfg, itemsRef.current, conflict.sha)
      saveBase({ sha, json: localJson })
      setConflict(null)
      setStatus({ kind: 'synced', at: Date.now() })
    } catch (e) {
      setStatus({ kind: 'error', message: e instanceof Error ? e.message : 'Sync failed' })
    }
  }

  return { cfg, setCfg, status, conflict, sync, resolve }
}
