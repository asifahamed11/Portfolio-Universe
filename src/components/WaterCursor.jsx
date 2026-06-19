import { useEffect, useState } from 'react';
import { motion, useMotionValue, useSpring, AnimatePresence } from 'motion/react';
import './WaterCursor.css';

// Pure crystal-clear water droplet cursor.
// - Blob-cursor physics: spring-based follow with a tight liquid trail.
// - Fluid-glass body: clean backdrop blur + brightness, white top-left specular glint.
// - Hover: shrinks over buttons/links, grows + shows "Open" over portfolio cards.

const SIZES = { default: 46, button: 26, card: 96 };

// Treat these as "clickable" -> droplet shrinks.
const BUTTON_SELECTOR =
  'button, .filter-btn, [role="button"], input, textarea, select, label';
// Portfolio cards -> droplet grows + "Open" label.
const CARD_SELECTOR = '.portfolio-wrapper, [data-cursor="card"]';

export default function WaterCursor() {
  const [enabled, setEnabled] = useState(false);
  const [variant, setVariant] = useState('default');

  // Raw pointer position.
  const x = useMotionValue(-200);
  const y = useMotionValue(-200);

  // Blob-cursor physics: snappy spring for the droplet, looser spring for the trail.
  const dropX = useSpring(x, { stiffness: 380, damping: 30, mass: 0.7 });
  const dropY = useSpring(y, { stiffness: 380, damping: 30, mass: 0.7 });
  const trailX = useSpring(x, { stiffness: 170, damping: 24, mass: 0.9 });
  const trailY = useSpring(y, { stiffness: 170, damping: 24, mass: 0.9 });

  const size = SIZES[variant] ?? SIZES.default;

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (!window.matchMedia('(pointer: fine)').matches) return;

    setEnabled(true);
    document.documentElement.classList.add('water-cursor-active');

    const onMove = (e) => {
      x.set(e.clientX);
      y.set(e.clientY);
    };

    const evaluate = (target) => {
      if (!target || !target.closest) return setVariant('default');
      // Buttons / controls take priority (e.g. the bookmark button inside a card).
      if (target.closest(BUTTON_SELECTOR)) return setVariant('button');
      if (target.closest(CARD_SELECTOR)) return setVariant('card');
      if (target.closest('a')) return setVariant('button');
      return setVariant('default');
    };
    const onOver = (e) => evaluate(e.target);
    const onLeaveWindow = () => {
      x.set(-200);
      y.set(-200);
    };

    window.addEventListener('mousemove', onMove, { passive: true });
    // Delegated hover detection works for dynamically injected cards too.
    document.addEventListener('mouseover', onOver, { passive: true });
    document.addEventListener('mouseleave', onLeaveWindow);

    return () => {
      window.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseover', onOver);
      document.removeEventListener('mouseleave', onLeaveWindow);
      document.documentElement.classList.remove('water-cursor-active');
    };
  }, [x, y]);

  if (!enabled) return null;

  return (
    <div className="water-cursor-root" aria-hidden="true">
      {/* Tight liquid trail (sits behind the droplet) */}
      <motion.div className="water-cursor-anchor" style={{ x: trailX, y: trailY }}>
        <span className="water-cursor-trail" />
      </motion.div>

      {/* Main droplet */}
      <motion.div className="water-cursor-anchor" style={{ x: dropX, y: dropY }}>
        <motion.div
          className="water-cursor"
          animate={{ width: size, height: size }}
          transition={{ type: 'spring', stiffness: 300, damping: 24, mass: 0.6 }}
        >
          <span className="water-cursor__sheen" />
          <span className="water-cursor__glint" />
          <span className="water-cursor__glint-sharp" />
          <AnimatePresence>
            {variant === 'card' && (
              <motion.span
                className="water-cursor__label"
                initial={{ opacity: 0, scale: 0.6 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.6 }}
                transition={{ duration: 0.18 }}
              >
                Open
              </motion.span>
            )}
          </AnimatePresence>
        </motion.div>
      </motion.div>
    </div>
  );
}
