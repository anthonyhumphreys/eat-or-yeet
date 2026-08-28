"use client";

import { Button } from "@/components/ui/button";

export default function ErrorPage({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <div className="page-shell grid flex-1 place-items-center py-16 text-center"><div><p className="text-5xl font-black">Something went wonky.</p><p className="mt-3 text-muted-foreground">No safety verdict was issued. Try the request again.</p><Button className="mt-6 rounded-full" onClick={reset}>Try again</Button></div></div>;
}
