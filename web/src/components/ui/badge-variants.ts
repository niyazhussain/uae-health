import { cva } from "class-variance-authority"

export const badgeVariants = cva(
  "group/badge inline-flex min-h-6 w-fit shrink-0 items-center justify-center gap-1 overflow-hidden rounded-full border border-transparent px-2.5 py-0.5 text-xs font-semibold whitespace-nowrap transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/30 [&>svg]:pointer-events-none [&>svg]:size-3.5!",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground [a]:hover:bg-primary/90",
        secondary:
          "bg-secondary text-secondary-foreground [a]:hover:bg-secondary/80",
        destructive:
          "bg-destructive/12 text-destructive focus-visible:ring-destructive/20 [a]:hover:bg-destructive/18",
        success:
          "bg-success-soft text-success focus-visible:ring-success/20 [a]:hover:bg-success-soft/80",
        warning:
          "bg-warning-soft text-warning focus-visible:ring-warning/20 [a]:hover:bg-warning-soft/80",
        info:
          "bg-info-soft text-info focus-visible:ring-info/20 [a]:hover:bg-info-soft/80",
        outline:
          "border-border text-foreground [a]:hover:bg-muted [a]:hover:text-foreground",
        ghost: "hover:bg-muted hover:text-foreground",
        link: "text-primary underline-offset-4 hover:underline",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
)
