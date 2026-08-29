import { useEffect, useState } from 'react'

export const THEMES = ['system', 'light', 'dark'] as const
export type ThemeChoice = (typeof THEMES)[number]

const KEY = 'buy-next.theme'

const prefersDark = () => matchMedia('(prefers-color-scheme: dark)').matches

export const resolveTheme = (choice: ThemeChoice): 'light' | 'dark' =>
  choice === 'system' ? (prefersDark() ? 'dark' : 'light') : choice

const load = (): ThemeChoice => {
  const v = localStorage.getItem(KEY)
  return (THEMES as readonly string[]).includes(v ?? '') ? (v as ThemeChoice) : 'system'
}

/**
 * Follows the OS by default. Picking light or dark pins it until the user picks
 * `system` again — that's the only state that keeps listening to the OS.
 */
export function useTheme() {
  const [choice, setChoice] = useState<ThemeChoice>(load)
  const [resolved, setResolved] = useState<'light' | 'dark'>(() => resolveTheme(load()))

  useEffect(() => {
    localStorage.setItem(KEY, choice)
    const apply = () => setResolved(resolveTheme(choice))
    apply()
    if (choice !== 'system') return
    const mq = matchMedia('(prefers-color-scheme: dark)')
    mq.addEventListener('change', apply)
    return () => mq.removeEventListener('change', apply)
  }, [choice])

  useEffect(() => {
    document.documentElement.classList.toggle('dark', resolved === 'dark')
    document
      .querySelector('meta[name="theme-color"]')
      ?.setAttribute('content', resolved === 'dark' ? '#000000' : '#FFFFFF')
  }, [resolved])

  // Toggles against what is *on screen*, not against `choice`: cycling through 'system'
  // renders identically to whichever of light/dark the OS already is, so a third of the
  // old three-way cycle was a no-op that read as "the button needs two clicks".
  // 'system' stays the stored default on a fresh install, it just is not a cycle stop.
  const cycle = () => setChoice(resolved === 'dark' ? 'light' : 'dark')

  return { choice, resolved, setChoice, cycle }
}
