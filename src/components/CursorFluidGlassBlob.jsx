// CursorFluidGlassBlob.jsx
// A merged "Fluid-Glass Blob" cursor: gooey metaball trail (Blob Cursor) whose
// focal head is a real refractive liquid-glass lens (Fluid Glass), DOM-only.
// No three.js / no GSAP — built on `motion` springs + native SVG filters.
import { useEffect, useRef, useState } from "react";
import {
  motion,
  useMotionValue,
  useSpring,
  useTransform,
  useAnimationFrame,
} from "motion/react";
import "./CursorFluidGlassBlob.css";

// Lead lens = snappy. Trail blobs = progressively looser → liquid lag.
const LEAD = { stiffness: 1100, damping: 58, mass: 0.6 };
const TRAIL = [
  { stiffness: 360, damping: 30, mass: 0.9 },
  { stiffness: 230, damping: 28, mass: 1.1 },
  { stiffness: 150, damping: 26, mass: 1.3 },
];

export default function CursorFluidGlassBlob({
  size = 40, // lead lens diameter (px)
  accent = "190 170 255", // soft violet rgb, echoes the site palette
}) {
  const mx = useMotionValue(-200);
  const my = useMotionValue(-200);

  // Lead lens follows pointer; each trail blob springs off the one before it.
  const lx = useSpring(mx, LEAD),
    ly = useSpring(my, LEAD);
  const a = [useSpring(lx, TRAIL[0]), useSpring(ly, TRAIL[0])];
  const b = [useSpring(a[0], TRAIL[1]), useSpring(a[1], TRAIL[1])];
  const c = [useSpring(b[0], TRAIL[2]), useSpring(b[1], TRAIL[2])];

  const press = useSpring(1, { stiffness: 700, damping: 30 });
  const hover = useSpring(1, { stiffness: 320, damping: 26 });
  const lensScale = useTransform([press, hover], ([p, h]) => p * h);
  const headScale = useTransform(hover, (h) => 1 + (h - 1) * 0.55);

  const show = useMotionValue(0);
  const opacity = useSpring(show, { stiffness: 250, damping: 30 });

  const turbRef = useRef(null);
  const reduceRef = useRef(false);
  const [label, setLabel] = useState("");
  const [active, setActive] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    // Touch / coarse pointers: bail out entirely, keep the native cursor.
    if (!window.matchMedia("(pointer: fine)").matches) return;
    reduceRef.current = window.matchMedia(
      "(prefers-reduced-motion: reduce)"
    ).matches;

    setActive(true);
    document.documentElement.classList.add("fg-cursor-active");

    const move = (e) => {
      mx.set(e.clientX);
      my.set(e.clientY);
      show.set(1);
    };
    const leave = () => show.set(0);
    const down = () => press.set(0.78);
    const up = () => press.set(1);

    const SEL = "a, button, [role='button'], input, textarea, select, [data-cursor]";
    const over = (e) => {
      const t = e.target?.closest?.(SEL);
      if (!t) return;
      hover.set(2.1);
      setLabel(t.getAttribute("data-cursor-label") || "");
    };
    const out = (e) => {
      const t = e.target?.closest?.(SEL);
      if (!t) return;
      hover.set(1);
      setLabel("");
    };

    window.addEventListener("pointermove", move, { passive: true });
    window.addEventListener("pointerdown", down, { passive: true });
    window.addEventListener("pointerup", up, { passive: true });
    document.addEventListener("pointerover", over, { passive: true });
    document.addEventListener("pointerout", out, { passive: true });
    window.addEventListener("blur", leave);
    document.addEventListener("mouseleave", leave);

    return () => {
      document.documentElement.classList.remove("fg-cursor-active");
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerdown", down);
      window.removeEventListener("pointerup", up);
      document.removeEventListener("pointerover", over);
      document.removeEventListener("pointerout", out);
      window.removeEventListener("blur", leave);
      document.removeEventListener("mouseleave", leave);
    };
  }, [mx, my, show, press, hover]);

  // Living liquid: gently breathe the turbulence so the glass refraction shifts.
  useAnimationFrame((t) => {
    const el = turbRef.current;
    if (!el || reduceRef.current) return;
    const f = 0.0085 + Math.sin(t / 1500) * 0.0028;
    el.setAttribute("baseFrequency", `${f.toFixed(4)} ${(f * 1.35).toFixed(4)}`);
  });

  if (!active) return null;

  const blob = (x, y, d, scale, cls) => (
    <motion.div
      className={`fg-blob ${cls}`}
      style={{ x, y, scale, width: d, height: d, marginLeft: -d / 2, marginTop: -d / 2 }}
    />
  );

  return (
    <motion.div
      className="fg-cursor"
      style={{ opacity, ["--accent"]: accent }}
      aria-hidden="true"
    >
      {/* Filters: goo (metaball fuse) + fluid-glass (refraction) */}
      <svg className="fg-defs" width="0" height="0" aria-hidden="true">
        <defs>
          <filter id="fgGoo">
            <feGaussianBlur in="SourceGraphic" stdDeviation="7" result="blur" />
            <feColorMatrix
              in="blur"
              mode="matrix"
              values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 20 -9"
              result="goo"
            />
            <feBlend in="SourceGraphic" in2="goo" />
          </filter>
          <filter
            id="fgFluidGlass"
            x="-50%"
            y="-50%"
            width="200%"
            height="200%"
            colorInterpolationFilters="sRGB"
          >
            <feTurbulence
              ref={turbRef}
              type="fractalNoise"
              baseFrequency="0.0085 0.011"
              numOctaves="2"
              seed="7"
              result="n"
            />
            <feGaussianBlur in="n" stdDeviation="1.5" result="sn" />
            <feDisplacementMap
              in="SourceGraphic"
              in2="sn"
              scale="42"
              xChannelSelector="R"
              yChannelSelector="G"
            />
          </filter>
        </defs>
      </svg>

      {/* Goo metaball trail (Blob Cursor) */}
      <div className="fg-goo">
        {blob(c[0], c[1], size * 0.7, 1, "fg-t3")}
        {blob(b[0], b[1], size * 0.9, 1, "fg-t2")}
        {blob(a[0], a[1], size * 1.05, 1, "fg-t1")}
        {blob(lx, ly, size * 1.15, headScale, "fg-head")}
      </div>

      {/* Liquid-glass lens (Fluid Glass) */}
      <motion.div
        className="fg-lens"
        style={{
          x: lx,
          y: ly,
          scale: lensScale,
          width: size,
          height: size,
          marginLeft: -size / 2,
          marginTop: -size / 2,
        }}
      >
        <span className="fg-spec" />
        {label ? <span className="fg-label">{label}</span> : null}
      </motion.div>
    </motion.div>
  );
}
