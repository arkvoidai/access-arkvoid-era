import { useMedia } from './useMedia.ts';

export function useReducedMotion(): boolean {
  return useMedia('(prefers-reduced-motion: reduce)', false);
}
