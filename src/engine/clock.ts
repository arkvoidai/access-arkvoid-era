import type { WorldMinute } from './types.ts';

export type PartOfDay = 'dawn' | 'day' | 'dusk' | 'night';

// Clock module default start: Day 1, 06:00 (360 minutes)
export const CLOCK_START_MINUTE: WorldMinute = 6 * 60;

// Default speed: 0.1 world minutes per real second (a world day is 4 real hours)
export const TIME_SCALE = 0.1;

// Away speed: 1 world minute per real second away
export const AWAY_SCALE = 1.0;

// Maximum away catch-up: 7 world days
export const MAX_AWAY_MINUTES = 7 * 1440;

export function dayOf(t: WorldMinute): number {
  const safe = Math.max(0, Math.floor(t));
  return Math.floor(safe / 1440) + 1;
}

export function hourOf(t: WorldMinute): number {
  const safe = Math.max(0, Math.floor(t));
  return Math.floor((safe % 1440) / 60);
}

export function minuteOfHour(t: WorldMinute): number {
  const safe = Math.max(0, Math.floor(t));
  return safe % 60;
}

/**
 * dawn 5–8, day 8–17, dusk 17–20, night 20–5
 */
export function partOfDay(t: WorldMinute): PartOfDay {
  const h = hourOf(t);
  if (h >= 5 && h < 8) return 'dawn';
  if (h >= 8 && h < 17) return 'day';
  if (h >= 17 && h < 20) return 'dusk';
  return 'night';
}

export function capitalizePartOfDay(p: PartOfDay): string {
  return p.charAt(0).toUpperCase() + p.slice(1);
}

export function formatClockDigits(t: WorldMinute): string {
  const h = String(hourOf(t)).padStart(2, '0');
  const m = String(minuteOfHour(t)).padStart(2, '0');
  return `${h}:${m}`;
}

/**
 * Returns both "Day 3 · Dusk" (default) and "Day 3 · 18:42" (when mode === "time" or exact === true).
 */
export function formatWorld(t: WorldMinute, mode: 'part' | 'time' | 'both' = 'part'): string {
  const d = dayOf(t);
  const partLabel = capitalizePartOfDay(partOfDay(t));
  const digits = formatClockDigits(t);
  if (mode === 'time') {
    return `Day ${d} · ${digits}`;
  }
  if (mode === 'both') {
    return `Day ${d} · ${partLabel} · ${digits}`;
  }
  return `Day ${d} · ${partLabel}`;
}
