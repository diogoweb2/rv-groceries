import { forwardRef } from 'react'
import { cn } from '@/lib/cn'

export const Textarea = forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(
  ({ className, ...props }, ref) => (
    <textarea
      ref={ref}
      className={cn(
        'w-full border border-gray-200 rounded-xl px-4 py-3 text-base bg-white focus:outline-none focus:ring-2 focus:ring-[#2f6b4f] placeholder:text-gray-400 resize-y min-h-[7rem]',
        className
      )}
      {...props}
    />
  )
)
Textarea.displayName = 'Textarea'
