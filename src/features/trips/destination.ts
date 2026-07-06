import { Home, Car, Caravan, MapPin, type LucideIcon } from 'lucide-react'
import type { ItemDestination } from '@/types'

// Final destination (§18): Home / Truck / RV. Tapping the row icon cycles it.
export const DESTINATIONS: { value: ItemDestination; label: string; icon: LucideIcon }[] = [
  { value: 'home', label: 'Home', icon: Home },
  { value: 'truck', label: 'Truck', icon: Car },
  { value: 'rv', label: 'RV', icon: Caravan },
]

export function destinationMeta(dest: ItemDestination | undefined) {
  return DESTINATIONS.find(d => d.value === dest)
}

export function destinationIcon(dest: ItemDestination | undefined): LucideIcon {
  return destinationMeta(dest)?.icon ?? MapPin
}

export function nextDestination(current: ItemDestination | undefined): ItemDestination {
  if (!current) return 'home'
  const i = DESTINATIONS.findIndex(d => d.value === current)
  return DESTINATIONS[(i + 1) % DESTINATIONS.length].value
}
