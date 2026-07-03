import { useEffect, useState } from 'react';
import { motion, useMotionValue, useSpring } from 'framer-motion';
import { useMediaQuery } from '../lib/hooks';

/** Custom cursor: a dot + trailing ring that swells over interactive targets. */
export default function CursorGlow() {
  const fine = useMediaQuery('(pointer: fine) and (min-width: 768px)');
  const mx = useMotionValue(-100);
  const my = useMotionValue(-100);
  const rx = useSpring(mx, { stiffness: 140, damping: 16, mass: 0.6 });
  const ry = useSpring(my, { stiffness: 140, damping: 16, mass: 0.6 });
  const [hot, setHot] = useState(false);
  const [down, setDown] = useState(false);

  useEffect(() => {
    if (!fine) return;
    const onMove = (e: MouseEvent) => {
      mx.set(e.clientX);
      my.set(e.clientY);
      const target = e.target as HTMLElement;
      setHot(Boolean(target.closest('a, button, [data-magnetic], input, [role="button"]')));
    };
    const onDown = () => setDown(true);
    const onUp = () => setDown(false);
    window.addEventListener('mousemove', onMove, { passive: true });
    window.addEventListener('mousedown', onDown);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('mouseup', onUp);
    };
  }, [fine, mx, my]);

  if (!fine) return null;

  return (
    <>
      <motion.div
        className="pointer-events-none fixed z-[90] h-1.5 w-1.5 rounded-full bg-white mix-blend-difference"
        style={{ x: mx, y: my, translateX: '-50%', translateY: '-50%' }}
      />
      <motion.div
        className="pointer-events-none fixed z-[90] rounded-full border border-white/60 mix-blend-difference"
        style={{ x: rx, y: ry, translateX: '-50%', translateY: '-50%' }}
        animate={{
          width: hot ? 52 : down ? 18 : 34,
          height: hot ? 52 : down ? 18 : 34,
          opacity: hot ? 1 : 0.55,
        }}
        transition={{ type: 'spring', stiffness: 260, damping: 22 }}
      />
    </>
  );
}
