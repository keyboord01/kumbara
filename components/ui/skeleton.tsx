import { cn } from "cn"

/** A block with the shape of what is loading: the soft shimmer on paper, never a bare pulse. Inline so it can sit inside text. */
function Skeleton({ className, ...props }: React.ComponentProps<"span">) {
  return (
    <span
      data-slot="skeleton"
      aria-hidden
      className={cn(
        "relative inline-block overflow-hidden rounded-md bg-muted align-middle text-transparent after:absolute after:inset-0 after:-translate-x-full after:animate-[kumbara-shimmer_1.4s_infinite] after:bg-linear-to-r after:from-transparent after:via-white/70 after:to-transparent motion-reduce:after:animate-none",
        className
      )}
      {...props}
    >
      &nbsp;
    </span>
  )
}

export { Skeleton }
