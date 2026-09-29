import { useEffect } from "react";
import { Link } from "react-router";

export function NotFound({ title = "This page doesn't exist." }: { title?: string }) {
  useEffect(() => {
    document.title = "Not found · Telltale";
  }, []);
  return (
    <div className="max-w-xl space-y-4 py-12">
      <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
      <p className="text-sm text-muted-foreground">It may have been delisted, or the link may have a typo.</p>
      <Link to="/" className="btn-secondary">
        See all markets
      </Link>
    </div>
  );
}
