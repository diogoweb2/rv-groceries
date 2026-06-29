import { forwardRef } from 'react'
import { cn } from '@/lib/cn'

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'ghost' | 'destructive' | 'outline'
  size?: 'sm' | 'md' | 'lg' | 'icon'
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = 'primary', size = 'md', ...props }, ref) => {
    return (
      <button
        ref={ref}
        className={cn(
          'inline-flex items-center justify-center font-semibold rounded-xl transition-colors disabled:opacity-50 disabled:pointer-events-none',
          {
            'bg-[#2f6b4f] text-white hover:bg-[#255741] active:bg-[#1a4030]': variant === 'primary',
            'bg-gray-100 text-gray-700 hover:bg-gray-200': variant === 'secondary',
            'text-gray-600 hover:bg-gray-100': variant === 'ghost',
            'bg-red-500 text-white hover:bg-red-600': variant === 'destructive',
            'border border-gray-300 text-gray-700 hover:bg-gray-50': variant === 'outline',
          },
          {
            'text-sm px-3 py-1.5 gap-1.5': size === 'sm',
            'text-base px-4 py-2.5 gap-2': size === 'md',
            'text-base px-5 py-3.5 gap-2': size === 'lg',
            'w-10 h-10': size === 'icon',
          },
          className
        )}
        {...props}
      />
    )
  }
)
Button.displayName = 'Button'
