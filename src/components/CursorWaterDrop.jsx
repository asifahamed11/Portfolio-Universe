// CursorWaterDrop.jsx
// A pure crystal water-droplet cursor: one clean glass bead with a very subtle,
// tight liquid trail. Spring-based motion. No chromatic aberration, no heavy blur.
//
// Hover logic (restores the original behaviour):
//   • portfolio card (.portfolio-wrapper / a[target=_blank]) -> droplet GROWS, "Open" fades in
//   • any button / link                                      -> droplet SHRINKS
import { useEffect, useRef, useState } from "react";
import {
  motion,
  useMotionValue,
  useSpring,
  useTransform,
  useMotionTemplate,
} from "motion/react";
import "./CursorWaterDrop.css";

const BASE = 28; // resting droplet diameter (px)
const GROW = 3.0; // card hover  -> ~84px
const SHRINK = 0.5; // button/link -> ~14px

const LEAD = { stiffness: 700, damping: 38, mass: 0.7 }; // smooth, responsive
const TRAILCFG = { stiffness: 260, damping: 26, mass: 0.9 }; // tight subtle trail

const CARD_SEL = ".portfolio-wrapper, a[target='_blank']";
const CLICK_SEL =
  "a, button, [role='button'], .filter-btn, .cursor-pointer, input, textarea, select, [data-cursor]";

export default function CursorWaterDrop() {
  const mx = useMotionValue(-200);
  const my = useMotionValue(-200);

  // Lead droplet follows the pointer; the echo springs off the lead = tight trail.
  const x = useSpring(mx, LEAD);
  const y = useSpring(my, LEAD);
  const tx = useSpring(x, TRAILCFG);
  const ty = useSpring(y, TRAILCFG);

  const scale = useSpring(1, { stiffness: 320, damping: 24 });
  const press = useSpring(1, { stiffness: 600, damping: 26 });
  const textOpacity = useSpring(0, { stiffness: 260, damping: 28 });

  const show = useMotionValue(0);
  const opacity = useSpring(show, { stiffness: 250, damping: 30 });

  const sizeScale = useTransform([scale, press], ([s, p]) => s * p);
  const dropTransform = useMotionTemplate`translate(-50%, -50%) scale(${sizeScale})`;
  const echoScale = useTransform(sizeScale, (v) => v * 0.6);
  const echoTransform = useMotionTemplate`translate(-50%, -50%) scale(${echoScale})`;

  const [active, setActive] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!window.matchMedia("(pointer: fine)").matches) return; // touch -> native cursor

    setActive(true);
    document.documentElement.classList.add("wd-cursor-active");

    const reset = () => {
      scale.set(1);
      textOpacity.set(0);
    };
    const evalTarget = (el) => {
      if (!el || el.nodeType !== 1) return reset();
      if (el.closest(CARD_SEL)) {
        scale.set(GROW);
        textOpacity.set(1);
        return;
      }
      if (el.closest(CLICK_SEL)) {
        scale.set(SHRINK);
        textOpacity.set(0);
        return;
      }
      reset();
    };

    const move = (e) => {
      mx.set(e.clientX);
      my.set(e.clientY);
      show.set(1);
    };
    const leave = () => show.set(0);
    const down = () => press.set(0.88);
    const up = () => press.set(1);
    const over = (e) => evalTarget(e.target);
    const out = (e) => evalTarget(e.relatedTarget);

    window.addEventListener("pointermove", move, { passive: true });
    window.addEventListener("pointerdown", down, { passive: true });
    window.addEventListener("pointerup", up, { passive: true });
    document.addEventListener("pointerover", over, { passive: true });
    document.addEventListener("pointerout", out, { passive: true });
    window.addEventListener("blur", leave);
    document.addEventListener("mouseleave", leave);

    return () => {
      document.documentElement.classList.remove("wd-cursor-active");
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerdown", down);
      window.removeEventListener("pointerup", up);
      document.removeEventListener("pointerover", over);
      document.removeEventListener("pointerout", out);
      window.removeEventListener("blur", leave);
      document.removeEventListener("mouseleave", leave);
    };
  }, [mx, my, show, scale, press, textOpacity]);

  if (!active) return null;

  return (
    <motion.div className="wd-cursor" style={{ opacity }} aria-hidden="true">
      {/* subtle trailing echo */}
      <motion.div className="wd-echo-pos" style={{ x: tx, y: ty }}>
        <motion.div className="wd-echo" style={{ width: BASE, height: BASE, transform: echoTransform }} />
      </motion.div>

      {/* lead droplet */}
      <motion.div className="wd-drop-pos" style={{ x, y }}>
        <motion.div className="wd-drop" style={{ width: BASE, height: BASE, transform: dropTransform }}>
          <span className="wd-glint" />
          <motion.span className="wd-label" style={{ opacity: textOpacity }}>
            Open
          </motion.span>
        </motion.div>
      </motion.div>
    </motion.div>
  );
}
