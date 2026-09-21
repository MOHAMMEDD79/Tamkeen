'use client';

import { useCallback, useEffect, useState } from 'react';
import { ArrowLeft, ArrowRight, ChevronLeft, ChevronRight, Sparkles } from 'lucide-react';

export interface HeroSlide { id: string; imageUrl: string; tag: string; title: string; body: string; cta: { label: string; href: string } | null }

const SLIDE_MS = 7000;

/**
 * The homepage banner: full-width photographs that crossfade with a slow zoom, each carrying its own
 * headline and call to action. Content comes from the admin's site settings.
 *
 * It pauses on hover and on keyboard focus, never auto-advances under reduced motion, and every
 * slide stays reachable with the dots and arrows. Only the active slide is exposed to assistive
 * technology, and the first slide is server-rendered so the page is complete before hydration.
 */
export function HeroCarousel({ slides, locale, secondary, labels }: {
  slides: HeroSlide[];
  locale: 'ar' | 'en';
  secondary: { label: string; href: string };
  labels: { previous: string; next: string; slide: string; region: string };
}) {
  const [active, setActive] = useState(0);
  const [paused, setPaused] = useState(false);
  const count = slides.length;
  const go = useCallback((index: number) => setActive(((index % count) + count) % count), [count]);

  useEffect(() => {
    if (paused || count < 2 || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const timer = window.setTimeout(() => go(active + 1), SLIDE_MS);
    return () => window.clearTimeout(timer);
  }, [active, paused, count, go]);

  const Forward = locale === 'ar' ? ArrowLeft : ArrowRight;
  const Previous = locale === 'ar' ? ChevronRight : ChevronLeft;
  const Next = locale === 'ar' ? ChevronLeft : ChevronRight;

  return (
    <section className="tmk-carousel" aria-roledescription="carousel" aria-label={labels.region}
      data-paused={paused} style={{ ['--slide-ms' as string]: `${SLIDE_MS}ms` }}
      onMouseEnter={() => setPaused(true)} onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)} onBlur={() => setPaused(false)}>
      {slides.map((slide, index) => (
        <div key={slide.id} className="tmk-carousel__slide" data-active={index === active} aria-hidden={index !== active}
          role="group" aria-roledescription="slide" aria-label={`${labels.slide} ${index + 1} / ${count}`}>
          {/* The first photo is the page's largest paint, so it loads eagerly; the rest wait. */}
          <img className="tmk-carousel__image" src={slide.imageUrl} alt="" loading={index === 0 ? 'eager' : 'lazy'} fetchPriority={index === 0 ? 'high' : 'auto'} />
          <div className="tmk-carousel__shade" />
          <div className="tmk-carousel__content">
            <span className="tmk-carousel__tag"><Sparkles aria-hidden="true" size={16} />{slide.tag}</span>
            {index === 0 ? <h1>{slide.title}</h1> : <h2>{slide.title}</h2>}
            <p>{slide.body}</p>
            <div className="tmk-carousel__actions">
              {slide.cta ? <a className="tmk-button tmk-button--accent tmk-button--large" href={slide.cta.href} tabIndex={index === active ? 0 : -1}>{slide.cta.label}<Forward aria-hidden="true" size={20} /></a> : null}
              <a className="tmk-button tmk-button--glass tmk-button--large" href={secondary.href} tabIndex={index === active ? 0 : -1}>{secondary.label}</a>
            </div>
          </div>
        </div>
      ))}
      {count > 1 ? (
        <div className="tmk-carousel__controls">
          <div className="tmk-carousel__dots">
            {slides.map((slide, index) => (
              <button key={slide.id} type="button" className="tmk-carousel__dot" aria-label={`${labels.slide} ${index + 1}`} aria-current={index === active} onClick={() => go(index)} />
            ))}
          </div>
          <div className="tmk-carousel__arrows">
            <button type="button" className="tmk-carousel__arrow" aria-label={labels.previous} onClick={() => go(active - 1)}><Previous aria-hidden="true" size={22} /></button>
            <button type="button" className="tmk-carousel__arrow" aria-label={labels.next} onClick={() => go(active + 1)}><Next aria-hidden="true" size={22} /></button>
          </div>
        </div>
      ) : null}
    </section>
  );
}
