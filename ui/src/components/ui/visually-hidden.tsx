import * as React from "react"
import { VisuallyHidden as VisuallyHiddenPrimitive } from "radix-ui"

function VisuallyHidden({
  ...props
}: React.ComponentProps<typeof VisuallyHiddenPrimitive.Root>) {
  return <VisuallyHiddenPrimitive.Root {...props} />
}

export { VisuallyHidden }
