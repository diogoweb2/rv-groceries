import { cn } from '@/lib/cn'

interface ProgressProps {
  value: number
  className?: string
}

export function Progress({ value, className }: ProgressProps) {
  return (
    <div className={cn('h-2 bg-gray-100 rounded-full overflow-hidden', className)}>
      <div
        className="h-full bg-[#1e3a5f] rounded-full transition-all duration-300"
        style={{ width: `${Math.min(100, Math.max(0, value))}%` }}
      />
    </div>
  )
}
