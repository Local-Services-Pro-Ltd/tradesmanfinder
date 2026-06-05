import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { AlertCircle, Home, Search } from "lucide-react";

export default function NotFound() {
return (
<div className="min-h-screen w-full flex items-center justify-center bg-gray-50 dark:bg-gray-900 px-4">
<div className="w-full max-w-lg text-center">
<div className="flex justify-center mb-6">
<span className="flex h-16 w-16 items-center justify-center rounded-full bg-orange-100 dark:bg-orange-900/30">
<AlertCircle className="h-8 w-8 text-orange-500" />
</span>
</div>
<p className="text-sm font-semibold uppercase tracking-wide text-orange-500">Error 404</p>
<h1 className="mt-2 text-3xl font-bold text-gray-900 dark:text-gray-100 sm:text-4xl">Page not found</h1>
<p className="mt-4 text-base text-gray-600 dark:text-gray-400">
Sorry, we couldn't find the page you were looking for. It may have been moved or no longer exists.
</p>
<div className="mt-8 flex flex-col sm:flex-row gap-3 justify-center">
<Link href="/">
<Button className="w-full sm:w-auto gap-2">
<Home className="h-4 w-4" />
Back to home
</Button>
</Link>
<Link href="/categories">
<Button variant="outline" className="w-full sm:w-auto gap-2">
<Search className="h-4 w-4" />
Browse all trades
</Button>
</Link>
</div>
<p className="mt-8 text-sm text-gray-500 dark:text-gray-400">
Need help? <Link href="/contact"><a className="font-medium text-orange-500 hover:underline">Contact us</a></Link>
</p>
</div>
</div>
);
}
