import * as React from "react"

import { cn } from "@/lib/utils"

function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        "placeholder:text-muted-foreground flex field-sizing-content min-h-16 w-full rounded-xl border border-border/75 bg-background px-3 py-2 text-sm shadow-[var(--shadow-inset)] transition-[border-color,box-shadow,background-color] outline-none focus-visible:border-primary/55 focus-visible:ring-2 focus-visible:ring-primary/18 aria-invalid:border-destructive aria-invalid:ring-destructive/20 disabled:cursor-not-allowed disabled:opacity-50",
        className
      )}
      {...props}
    />
  )
}

export { Textarea }
