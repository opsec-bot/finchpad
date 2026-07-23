import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

/** Placeholder matching TokenCard's shape while the feed loads its details. */
export default function TokenCardSkeleton() {
  return (
    <Card className="gap-0 overflow-hidden p-0">
      <div className="flex items-start gap-3 p-4">
        <Skeleton className="size-12 rounded-lg" />
        <div className="flex-1">
          <Skeleton className="h-4 w-24 rounded" />
          <Skeleton className="mt-2 h-3 w-12 rounded" />
        </div>
      </div>
      <div className="flex items-end justify-between px-4">
        <div>
          <Skeleton className="h-3 w-16 rounded" />
          <Skeleton className="mt-2 h-7 w-24 rounded" />
          <Skeleton className="mt-2 h-4 w-14 rounded" />
        </div>
        <Skeleton className="h-9 w-28 rounded" />
      </div>
      <div className="mt-4 px-4 pb-4">
        <div className="mb-1.5 flex items-center justify-between">
          <Skeleton className="h-3 w-20 rounded" />
          <Skeleton className="h-3 w-8 rounded" />
        </div>
        <Skeleton className="h-1 w-full rounded-full" />
      </div>
    </Card>
  );
}
