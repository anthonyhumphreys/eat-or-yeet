import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  return <div className="page-shell max-w-3xl py-10"><Skeleton className="h-12 w-2/3" /><Skeleton className="mt-5 h-5 w-full" /><Skeleton className="mt-10 h-80 w-full rounded-xl" /></div>;
}
