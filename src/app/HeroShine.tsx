"use client";

import { useEffect, useRef, type ReactNode } from "react";

/** Where the glow rests when the mouse is away: near the top-right corner. */
const HOME = { x: 88, y: 12 };
/** How far the glow drifts, as a share of the mouse's distance from the card's center. */
const DRIFT = 0.35;

/**
 * The welcome card, with a soft blue glow that drifts gently AWAY from the
 * mouse (a subtle parallax, like light shifting on a surface as you move
 * around it). It eases slowly rather than tracking the pointer, and settles
 * back near its corner when the mouse leaves the window. Mouse only; touch
 * screens and "reduce motion" keep the still glow.
 */
export default function HeroShine({ className, children }: { className: string; children: ReactNode }) {
  const ref = useRef<HTMLElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    let target = { ...HOME };
    const current = { ...HOME };
    let frame = 0;

    const step = () => {
      current.x += (target.x - current.x) * 0.05;
      current.y += (target.y - current.y) * 0.05;
      el.style.setProperty("--shine-x", `${current.x}%`);
      el.style.setProperty("--shine-y", `${current.y}%`);
      const settled = Math.abs(target.x - current.x) < 0.1 && Math.abs(target.y - current.y) < 0.1;
      frame = settled ? 0 : requestAnimationFrame(step);
    };
    const animate = () => {
      if (!frame) frame = requestAnimationFrame(step);
    };

    const onMove = (e: PointerEvent) => {
      if (e.pointerType !== "mouse") return;
      const r = el.getBoundingClientRect();
      // Mouse position relative to the card's center, in % of its size
      // (anywhere on the page, capped so a far-away mouse doesn't fling it).
      const cap = (v: number) => Math.max(-75, Math.min(75, v));
      const dx = cap(((e.clientX - r.left) / r.width) * 100 - 50);
      const dy = cap(((e.clientY - r.top) / r.height) * 100 - 50);
      // Move the other way, a little.
      target = { x: HOME.x - dx * DRIFT, y: HOME.y - dy * DRIFT };
      animate();
    };
    const onLeave = () => {
      target = { ...HOME };
      animate();
    };

    window.addEventListener("pointermove", onMove);
    document.documentElement.addEventListener("mouseleave", onLeave);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("pointermove", onMove);
      document.documentElement.removeEventListener("mouseleave", onLeave);
    };
  }, []);

  return (
    <section ref={ref} className={className}>
      {children}
    </section>
  );
}
