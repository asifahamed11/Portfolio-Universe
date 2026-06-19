import { useCallback, useRef, useState } from 'react';
import './ShuffleText.css';

// React Bits inspired "Shuffle": characters scramble through random glyphs and
// settle into the final text. This variant ONLY plays on hover (not continuously).

const GLYPHS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ#$%&*<>?/\\|=+';

export default function ShuffleText({
  text = '',
  duration = 600,
  blueFrom = null, // index from which characters render in brand blue
  className = '',
  style = {},
}) {
  const [display, setDisplay] = useState(text);
  const rafRef = useRef(null);
  const runningRef = useRef(false);

  const run = useCallback(() => {
    if (runningRef.current) return;
    runningRef.current = true;
    const final = text;
    const len = final.length;
    const start = performance.now();

    const tick = (now) => {
      const t = Math.min((now - start) / duration, 1);
      let out = '';
      for (let i = 0; i < len; i++) {
        const ch = final[i];
        if (ch === ' ') {
          out += ' ';
          continue;
        }
        // Each character locks in progressively across the timeline.
        const lockAt = ((i + 1) / len) * 0.75;
        out += t >= lockAt ? ch : GLYPHS[Math.floor(Math.random() * GLYPHS.length)];
      }
      setDisplay(out);
      if (t < 1) {
        rafRef.current = requestAnimationFrame(tick);
      } else {
        setDisplay(final);
        runningRef.current = false;
      }
    };

    cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(tick);
  }, [text, duration]);

  const chars = display.split('');

  return (
    <span
      className={`shuffle-text ${className}`.trim()}
      style={style}
      onMouseEnter={run}
    >
      {blueFrom == null
        ? display
        : chars.map((c, i) => (
            <span key={i} className={i >= blueFrom ? 'shuffle-text__accent' : undefined}>
              {c}
            </span>
          ))}
    </span>
  );
}
