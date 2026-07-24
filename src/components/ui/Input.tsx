import { forwardRef, type InputHTMLAttributes } from 'react';
import { cn } from '../../lib/utils';

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  ({ className, ...props }, ref) => (
    <input
      ref={ref}
      className={cn(
        'h-12 w-full rounded-sm border border-gray-800 bg-black/25 px-3 text-base text-gray-100 outline-none placeholder:text-gray-600 focus:border-primary focus:ring-1 focus:ring-primary md:text-sm',
        className,
      )}
      {...props}
    />
  ),
);

Input.displayName = 'Input';
