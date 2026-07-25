import { forwardRef, type InputHTMLAttributes } from 'react';
import { cn } from '../../lib/utils';

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  ({ className, ...props }, ref) => (
    <input
      ref={ref}
      className={cn(
        'h-10 w-full rounded-sm border border-border bg-surface-2 px-3 text-base text-foreground outline-none transition-colors duration-150 placeholder:text-foreground-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:opacity-45 md:text-sm',
        className,
      )}
      {...props}
    />
  ),
);

Input.displayName = 'Input';
