import { cn } from "@/lib/utils";

const Skeleton = ({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    data-slot="skeleton"
    className={cn("bg-muted rounded-none animate-pulse", className)}
    {...props}
  />
);

export { Skeleton };
