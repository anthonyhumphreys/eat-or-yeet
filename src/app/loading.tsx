import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  return <div role="status" aria-label="Loading page" className="page-shell py-6 sm:py-10"><div aria-hidden="true" className="max-w-3xl"><Skeleton className="h-12 w-2/3" /><Skeleton className="mt-5 h-5 w-full" /><Skeleton className="mt-10 h-80 w-full rounded-xl" /></div></div>;
}
