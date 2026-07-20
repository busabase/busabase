import { SearchX } from "lucide-react";
import Link from "next/link";

export default function NotFound() {
  return (
    <main className="shell not-found">
      <SearchX aria-hidden="true" size={28} />
      <h1>Content not found</h1>
      <p>The record may be unpublished, renamed, or absent from the configured Base.</p>
      <Link href="/">Return to content browser</Link>
    </main>
  );
}
