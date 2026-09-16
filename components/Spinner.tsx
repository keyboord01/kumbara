import { cn } from "cn";
import { Spinner as UiSpinner } from "@/components/ui/spinner";

/** The one loading ring: inherits the text colour of its parent, 1em by default, decorative (the surrounding control says what is busy). */
export function Spinner({ className = "", ...props }: React.ComponentProps<"svg">) {
  return <UiSpinner {...props} role="presentation" aria-label={undefined} aria-hidden className={cn("size-[1em]", className)} />;
}
