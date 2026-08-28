import Link from "next/link";

import { Button } from "@/components/ui/button";

export default function NotFound() {
  return <div className="page-shell grid flex-1 place-items-center py-16 text-center"><div><p className="text-7xl font-black">404</p><h1 className="mt-4 text-2xl font-black">This one got yeeted.</h1><p className="mt-2 text-muted-foreground">The page is missing or the public share link has expired.</p><Button asChild className="mt-6 rounded-full"><Link href="/">Back home</Link></Button></div></div>;
}
