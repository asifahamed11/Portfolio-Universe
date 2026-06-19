import { useEffect, useRef, useState } from 'react';
import { motion, useMotionValue, useSpring, AnimatePresence } from 'motion/react';
import './WaterCursor.css';

/*
 * WaterCursor — a single pure water-droplet cursor.
 *
 * Visuals  : FluidGlass concept — refraction via backdrop-filter (blur + brightness +
 *            saturate), a white specular glint top-left. NO chromatic aberration.
 * Physics  : BlobCursor concept — a lead "lens" drop plus two tighter trailing droplets,
 *            all driven by motion/react springs (no GSAP).
 * Hover    : shrinks over buttons / <a>; grows + fades "Open" in over portfolio cards.
 * Safety   : pointer-events:none everywhere so it never blocks the UI.
 */

const SIZES = { default: 40, button: 22, card: 92 };

// Portfolio cards (this project uses .portfolio-wrapper; also support .portfolio-card).
const CARD_SELECTOR = '.portfolio-wrapper, .portfolio-card, [data-cursor="card"]';
// Clickable controls -> droplet shrinks.
const CONTROL_SELECTOR =
  'button, .filter-btn, [role="button"], input, textarea, select, label';

export default function WaterCursor() {
  const [variant, setVariant] = useState('default');
  const [pressed, setPressed] = useState(false);
  const [visible, setVisible] = useState(false);
  const visibleRef = useRef(false);

  // Raw pointer position.
  const x = useMotionValue(-200);
  const y = useMotionValue(-200);

  // Lead lens drop (snappy) + two progressively looser trailing droplets.
  const leadX = useSpring(x, { stiffness: 500, damping: 34, mass: 0.6 });
  const leadY = useSpring(y, { stiffness: 500, damping: 34, mass: 0.6 });
  const t1X = useSpring(x, { stiffness: 260, damping: 26, mass: 0.7 });
  const t1Y = useSpring(y, { stiffness: 260, damping: 26, mass: 0.7 });
  const t2X = useSpring(x, { stiffness: 150, damping: 22, mass: 0.9 });
  const t2Y = useSpring(y, { stiffness: 150, damping: 22, mass: 0.9 });

  const size = SIZES[variant] ?? SIZES.default;
  const scale = pressed ? 0.82 : 1;
  // Trail recedes when the drop is doing something (shrunk or grown).
  const trailOpacity = variant === 'default' ? 1 : 0;

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (!window.matchMedia('(pointer: fine)').matches) return;

    document.documentElement.classList.add('water-cursor-active');

    const onMove = (e) => {
      x.set(e.clientX);
      y.set(e.clientY);
      if (!visibleRef.current) {
        visibleRef.current = true;
        setVisible(true);
      }
    };

    const evaluate = (target) => {
      if (!target || !target.closest) return setVariant('default');
      // Controls win even inside a card (e.g. the bookmark button).
      if (target.closest(CONTROL_SELECTOR)) return setVariant('button');
      if (target.closest(CARD_SELECTOR)) return setVariant('card');
      if (target.closest('a')) return setVariant('button');
      return setVariant('default');
    };
    const onOver = (e) => evaluate(e.target);

    const onDown = () => setPressed(true);
    const onUp = () => setPressed(false);
    const onLeave = () => {
      visibleRef.current = false;
      setVisible(false);
    };
    const onEnter = () => {
      visibleRef.current = true;
      setVisible(true);
    };

    window.addEventListener('mousemove', onMove, { passive: true });
    document.addEventListener('mouseover', onOver, { passive: true });
    document.addEventListener('mousedown', onDown);
    document.addEventListener('mouseup', onUp);
    document.addEventListener('mouseleave', onLeave);
    document.addEventListener('mouseenter', onEnter);

    return () => {
      window.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseover', onOver);
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('mouseup', onUp);
      document.removeEventListener('mouseleave', onLeave);
      document.removeEventListener('mouseenter', onEnter);
      document.documentElement.classList.remove('water-cursor-active');
    };
  }, [x, y]);

  const springT = { type: 'spring', stiffness: 300, damping: 24, mass: 0.6 };

  return (
    <div
      className="water-cursor-root"
      aria-hidden="true"
      style={{ opacity: visible ? 1 : 0 }}
    >
      {/* Trailing droplet 2 (softest, smallest) */}
      <motion.div className="water-cursor-anchor" style={{ x: t2X, y: t2Y }}>
        <motion.span
          className="water-cursor-trail water-cursor-trail--sm"
          animate={{ opacity: trailOpacity * 0.55, scale }}
          transition={springT}
        />
      </motion.div>

      {/* Trailing droplet 1 */}
      <motion.div className="water-cursor-anchor" style={{ x: t1X, y: t1Y }}>
        <motion.span
          className="water-cursor-trail"
          animate={{ opacity: trailOpacity * 0.8, scale }}
          transition={springT}
        />
      </motion.div>

      {/* Lead lens drop */}
      <motion.div className="water-cursor-anchor" style={{ x: leadX, y: leadY }}>
        <motion.div
          className="water-cursor"
          animate={{ width: size, height: size, scale }}
          transition={springT}
        >
          <span className="water-cursor__sheen" />
          <span className="water-cursor__glint" />
          <span className="water-cursor__glint-sharp" />
          <AnimatePresence>
            {variant === 'card' && (
              <motion.span
                className="water-cursor__label"
                initial={{ opacity: 0, scale: 0.5 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.5 }}
                transition={{ duration: 0.2 }}
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
