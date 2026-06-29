import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { UserIdentity } from '@/types'

interface AppState {
  identity: UserIdentity | null
  isAuthenticated: boolean
  fcmToken: string | null
  setIdentity: (identity: UserIdentity) => void
  setAuthenticated: (val: boolean) => void
  setFcmToken: (token: string) => void
  logout: () => void
}

export const useAppStore = create<AppState>()(
  persist(
    (set) => ({
      identity: null,
      isAuthenticated: false,
      fcmToken: null,
      setIdentity: (identity) => set({ identity }),
      setAuthenticated: (val) => set({ isAuthenticated: val }),
      setFcmToken: (token) => set({ fcmToken: token }),
      logout: () => set({ identity: null, isAuthenticated: false, fcmToken: null }),
    }),
    { name: 'rv-app-state' },
  ),
)
