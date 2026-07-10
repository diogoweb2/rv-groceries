import { useCallback, useSyncExternalStore } from 'react'

// Only one overflow ("⋮") menu may be open at a time, across every row and card.
// The open menu's id lives outside React so unrelated rows can close each other
// without the id having to be threaded through their common parent.
let openId: string | null = null
const listeners = new Set<() => void>()

function setOpenId(next: string | null) {
  if (openId === next) return
  openId = next
  listeners.forEach(l => l())
}

function subscribe(l: () => void) {
  listeners.add(l)
  return () => listeners.delete(l)
}

export function useOverflowMenu(id: string) {
  const open = useSyncExternalStore(subscribe, () => openId === id)
  const toggle = useCallback(() => setOpenId(openId === id ? null : id), [id])
  const close = useCallback(() => setOpenId(openId === id ? null : openId), [id])
  return { open, toggle, close }
}
