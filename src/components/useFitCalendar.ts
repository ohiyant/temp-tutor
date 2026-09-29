"use client";

import { useEffect, useState } from "react";
import { FIT_HOURS } from "@/lib/calendarUi";

// The grid is scaled so about FIT_HOURS hours fill its box's height (the
// rest of the day scrolls), but never squashed below this.
export const MIN_PX_PER_MIN = 1;
export const DAY_HEADER_HEIGHT_PX = 44; // keep in sync with .calendar-day-header

/**
 * Sizes a week calendar to its scroll box: returns a callback ref for the
 * box and the pixels-per-minute that make FIT_HOURS hours fill its height
 * (the full-day grid scrolls for the rest). Shared by every calendar so they
 * all scale the same way.
 */
export function useFitCalendar(): {
  scrollRef: (el: HTMLDivElement | null) => void;
  scrollEl: HTMLDivElement | null;
  size: { width: number; height: number };
  pxPerMin: number;
} {
  const [scrollEl, setScrollEl] = useState<HTMLDivElement | null>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });

  useEffect(() => {
    if (!scrollEl) return;
    const measure = () => setSize({ width: scrollEl.clientWidth, height: scrollEl.clientHeight });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(scrollEl);
    return () => observer.disconnect();
  }, [scrollEl]);

  const pxPerMin = size.height
    ? Math.max(MIN_PX_PER_MIN, (size.height - DAY_HEADER_HEIGHT_PX - 8) / (FIT_HOURS * 60))
    : 0.8;

  return { scrollRef: setScrollEl, scrollEl, size, pxPerMin };
}
