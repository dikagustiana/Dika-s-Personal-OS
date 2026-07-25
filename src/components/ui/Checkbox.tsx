import * as CheckboxPrimitive from '@radix-ui/react-checkbox';
import { Check } from 'lucide-react';
import { cn } from '../../lib/utils';

/**
 * 20px visual box inside a 40px touch target (padding on the root). Checked
 * and focus are visually separate states: checked = primary fill with a dark
 * checkmark, focus = an offset ring on :focus-visible only — hover never
 * recolours the border, so an unchecked box can't read as checked.
 */
export function Checkbox({
  className,
  ...props
}: React.ComponentPropsWithoutRef<typeof CheckboxPrimitive.Root>) {
  return (
    <CheckboxPrimitive.Root
      className={cn(
        'group grid size-10 shrink-0 place-items-center outline-none',
        className,
      )}
      {...props}
    >
      <span
        aria-hidden
        className="grid size-5 place-items-center rounded-sm border border-border bg-surface-2 text-primary-foreground transition-colors duration-150 group-hover:bg-surface-3 group-focus-visible:ring-2 group-focus-visible:ring-ring group-focus-visible:ring-offset-2 group-focus-visible:ring-offset-background group-data-[state=checked]:border-primary group-data-[state=checked]:bg-primary"
      >
        <CheckboxPrimitive.Indicator>
          <Check className="size-3.5" strokeWidth={3} />
        </CheckboxPrimitive.Indicator>
      </span>
    </CheckboxPrimitive.Root>
  );
}
