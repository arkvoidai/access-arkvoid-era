import { useEffect } from 'react';
import { KEYMAP, type KeyActionId } from '../config/keymap.ts';

export type KeyHandlerMap = Partial<Record<KeyActionId, (e: KeyboardEvent) => void>>;

function isEditableElement(el: EventTarget | null): boolean {
  if (!el || !(el instanceof HTMLElement)) return false;
  const tag = el.tagName.toLowerCase();
  if (tag === 'input' || tag === 'textarea' || tag === 'select') return true;
  return el.isContentEditable;
}

export function useKeys(handlers: KeyHandlerMap, enabled = true): void {
  useEffect(() => {
    if (!enabled || typeof window === 'undefined') return;

    const onKeyDown = (e: KeyboardEvent) => {
      // Ignore shortcuts while typing in an input, except Escape
      if (isEditableElement(e.target) && e.key !== 'Escape') {
        return;
      }
      if (e.metaKey || e.ctrlKey || e.altKey) {
        return;
      }

      const keyLower = e.key.toLowerCase();
      const isDev = Boolean(import.meta.env?.DEV);

      for (const binding of KEYMAP) {
        if (binding.devOnly && !isDev) continue;
        if (!binding.keys.includes(keyLower)) continue;

        if (binding.shift === true && !e.shiftKey) continue;
        if (binding.shift === false && e.shiftKey) continue;
        if (binding.shift === undefined && e.shiftKey && binding.id !== 'run') continue;

        const fn = handlers[binding.id];
        if (fn) {
          fn(e);
          break;
        }
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [handlers, enabled]);
}
