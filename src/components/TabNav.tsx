"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/** A row of page tabs; the one matching the current URL is highlighted. */
export default function TabNav({ tabs, label }: { tabs: { href: string; label: string }[]; label: string }) {
  const pathname = usePathname();
  // The longest matching href wins, so "/x" doesn't also light up on "/x/y".
  const active = tabs
    .filter((t) => pathname === t.href || pathname.startsWith(`${t.href}/`))
    .sort((a, b) => b.href.length - a.href.length)[0]?.href;
  return (
    <nav className="page-tabs" aria-label={label}>
      {tabs.map((t) => (
        <Link
          key={t.href}
          href={t.href}
          className={t.href === active ? "is-active" : undefined}
          aria-current={t.href === active ? "page" : undefined}
        >
          {t.label}
        </Link>
      ))}
    </nav>
  );
}
