// ShuffleText.jsx
// React Bits-inspired character shuffle. Scrambles glyphs then resolves the word
// left-to-right. Triggers ONLY on hover (no autoplay). Respects reduced-motion.
// Optional two-tone wordmark via colorFrom + colorClass (keeps "Universe" blue).
import { useCallback, useEffect, useRef, useState } from "react";

const GLYPHS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789#$%&@*";

export default function ShuffleText({
  text = "",
  className = "",
  colorFrom = null, // index from which colorClass is applied
  colorClass = "",
  duration = 620, // ms
}) {
  const final = text;
  const [display, setDisplay] = useState(final);
  const raf = useRef(0);
  const reduce = useRef(false);

  useEffect(() => {
    reduce.current =
      typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    return () => cancelAnimationFrame(raf.current);
  }, []);

  const run = useCallback(() => {
    if (reduce.current) return;
    cancelAnimationFrame(raf.current);
    const n = final.length;
    const start = performance.now();
    const tick = (now) => {
      const t = Math.min((now - start) / duration, 1);
      const locked = Math.floor(t * n);
      let out = "";
      for (let i = 0; i < n; i++) {
        const ch = final[i];
        if (ch === " ") {
          out += " ";
        } else if (i < locked) {
          out += ch;
        } else {
          out += GLYPHS[(Math.random() * GLYPHS.length) | 0];
        }
      }
      setDisplay(out);
      if (t < 1) raf.current = requestAnimationFrame(tick);
      else setDisplay(final);
    };
    raf.current = requestAnimationFrame(tick);
  }, [final, duration]);

  const chars = display.split("");

  return (
    <span
      className={className}
      onMouseEnter={run}
      style={{ display: "inline-block", whiteSpace: "pre" }}
    >
      {colorFrom == null
        ? display
        : chars.map((c, i) => (
            <span key={i} className={i >= colorFrom ? colorClass : undefined}>
              {c}
            </span>
          ))}
    </span>
  );
}
