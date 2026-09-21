'use client';

import { useEffect, useRef, useState } from 'react';

const prefersReducedMotion = () => typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * Fades and lifts every `.tmk-reveal` element into view as it scrolls in.
 *
 * Content is visible by default. Only once this has run does the root get `tmk-motion`, which is
 * what hides not-yet-seen elements — so without JavaScript, or with reduced motion, nothing is
 * ever hidden. Mounted once by the shell; new elements added later are picked up too.
 */
export function RevealOnScroll() {
  useEffect(() => {
    if (prefersReducedMotion() || !('IntersectionObserver' in window)) return;
    const root = document.documentElement;
    root.classList.add('tmk-motion');
    const observer = new IntersectionObserver(entries => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        entry.target.classList.add('tmk-reveal--in');
        observer.unobserve(entry.target);
      }
    }, { rootMargin: '0px 0px -8% 0px', threshold: 0.08 });
    const watch = () => document.querySelectorAll('.tmk-reveal:not(.tmk-reveal--in)').forEach(element => observer.observe(element));
    watch();
    const mutations = new MutationObserver(watch);
    mutations.observe(document.body, { childList: true, subtree: true });
    return () => { observer.disconnect(); mutations.disconnect(); root.classList.remove('tmk-motion'); };
  }, []);
  return null;
}

/**
 * Counts up to a whole number when it first scrolls into view. The final value is rendered on the
 * server and is what assistive technology reads; the animation only runs visually.
 */
export function CountUp({ value, durationMs = 1600 }: { value: number; durationMs?: number }) {
  const ref = useRef<HTMLSpanElement>(null);
  const [shown, setShown] = useState(value);
  useEffect(() => {
    const element = ref.current;
    if (!element || prefersReducedMotion() || !('IntersectionObserver' in window) || value <= 0) return;
    setShown(0);
    let frame = 0;
    const observer = new IntersectionObserver(([entry]) => {
      if (!entry?.isIntersecting) return;
      observer.disconnect();
      const start = performance.now();
      const step = (now: number) => {
        const progress = Math.min(1, (now - start) / durationMs);
        setShown(Math.round(value * (1 - Math.pow(1 - progress, 3))));
        if (progress < 1) frame = requestAnimationFrame(step);
      };
      frame = requestAnimationFrame(step);
    }, { threshold: 0.4 });
    observer.observe(element);
    return () => { observer.disconnect(); cancelAnimationFrame(frame); };
  }, [value, durationMs]);
  return (
    <span ref={ref} className="tmk-countup">
      <span aria-hidden="true">{shown.toLocaleString('en-US')}</span>
      <span className="tmk-visually-hidden">{value.toLocaleString('en-US')}</span>
    </span>
  );
}
