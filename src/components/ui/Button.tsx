import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import type { ButtonHTMLAttributes } from 'react';
import { cn } from '../../lib/utils';

// Accent discipline: the solid `default` (primary) variant is reserved for
// the one primary action per screen. Everything else is secondary or ghost.
const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-sm text-sm font-semibold transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background active:translate-y-px disabled:pointer-events-none disabled:opacity-45',
  {
    variants: {
      variant: {
        default: 'bg-primary px-4 text-primary-foreground hover:bg-primary/85',
        secondary:
          'border border-border bg-surface-2 px-4 text-foreground hover:bg-surface-3',
        ghost: 'px-3 text-foreground-secondary hover:bg-surface-3 hover:text-foreground',
        danger: 'px-3 text-destructive hover:bg-destructive/10 hover:text-destructive',
      },
      size: {
        default: 'h-10',
        sm: 'h-9 px-3 text-xs',
        icon: 'size-9 p-0',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  },
);

export interface ButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

export function Button({
  className,
  variant,
  size,
  asChild = false,
  ...props
}: ButtonProps) {
  const Comp = asChild ? Slot : 'button';
  return <Comp className={cn(buttonVariants({ variant, size, className }))} {...props} />;
}
