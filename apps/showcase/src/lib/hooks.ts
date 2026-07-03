import { useCallback, useEffect, useRef, useState } from 'react';

const KONAMI = [
  'ArrowUp', 'ArrowUp', 'ArrowDown', 'ArrowDown',
  'ArrowLeft', 'ArrowRight', 'ArrowLeft', 'ArrowRight',
  'b', 'a',
];

/** Fires the callback when the Konami code is typed. */
export function useKonami(onUnlock: () => void) {
  const idx = useRef(0);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const expected = KONAMI[idx.current];
      if (e.key === expected || e.key.toLowerCase() === expected) {
        idx.current += 1;
        if (idx.current === KONAMI.length) {
          idx.current = 0;
          onUnlock();
        }
      } else {
        idx.current = e.key === KONAMI[0] ? 1 : 0;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onUnlock]);
}

/** Tracks which section id is currently in view. */
export function useSectionSpy(ids: string[]) {
  const [active, setActive] = useState(ids[0] ?? '');
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) setActive(entry.target.id);
        }
      },
      { rootMargin: '-40% 0px -55% 0px' },
    );
    for (const id of ids) {
      const el = document.getElementById(id);
      if (el) observer.observe(el);
    }
    return () => observer.disconnect();
  }, [ids]);
  return active;
}

/** Global hotkey helper (e.g. mod+k). */
export function useHotkey(key: string, handler: (e: KeyboardEvent) => void, withMod = true) {
  const saved = useRef(handler);
  saved.current = handler;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (e.key.toLowerCase() === key && (!withMod || mod)) {
        e.preventDefault();
        saved.current(e);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [key, withMod]);
}

export function useMediaQuery(query: string) {
  const get = useCallback(() => window.matchMedia(query).matches, [query]);
  const [matches, setMatches] = useState(get);
  useEffect(() => {
    const mq = window.matchMedia(query);
    const onChange = () => setMatches(mq.matches);
    mq.addEventListener('change', onChange);
    setMatches(mq.matches);
    return () => mq.removeEventListener('change', onChange);
  }, [query]);
  return matches;
}
