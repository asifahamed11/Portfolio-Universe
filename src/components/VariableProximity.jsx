import { forwardRef, useMemo, useRef, useEffect, useCallback } from 'react';
import { motion } from 'motion/react';
import './VariableProximity.css';

function useRafScheduler(callback) {
  const callbackRef = useRef(callback);
  const frameRef = useRef(0);
  callbackRef.current = callback;

  const schedule = useCallback(() => {
    if (
      frameRef.current
      || document.hidden
      || window.matchMedia('(prefers-reduced-motion: reduce)').matches
    ) {
      return;
    }
    frameRef.current = requestAnimationFrame(() => {
      frameRef.current = 0;
      callbackRef.current();
    });
  }, []);

  useEffect(() => () => {
    if (frameRef.current) cancelAnimationFrame(frameRef.current);
  }, []);

  return schedule;
}

function usePointerPosition(containerRef, positionRef, scheduleUpdate) {
  useEffect(() => {
    const updatePosition = (x, y) => {
      if (containerRef?.current) {
        const rect = containerRef.current.getBoundingClientRect();
        positionRef.current = { x: x - rect.left, y: y - rect.top };
      } else {
        positionRef.current = { x, y };
      }
      scheduleUpdate();
    };

    const container = containerRef?.current;
    if (!container) return undefined;

    const handlePointerMove = event => updatePosition(event.clientX, event.clientY);
    const handlePointerLeave = () => {
      positionRef.current = { x: Number.NEGATIVE_INFINITY, y: Number.NEGATIVE_INFINITY };
      scheduleUpdate();
    };

    container.addEventListener('pointermove', handlePointerMove, { passive: true });
    container.addEventListener('pointerleave', handlePointerLeave, { passive: true });
    return () => {
      container.removeEventListener('pointermove', handlePointerMove);
      container.removeEventListener('pointerleave', handlePointerLeave);
    };
  }, [containerRef, positionRef, scheduleUpdate]);
}

const VariableProximity = forwardRef((props, ref) => {
  const {
    label,
    fromFontVariationSettings,
    toFontVariationSettings,
    containerRef,
    radius = 50,
    falloff = 'linear',
    className = '',
    onClick,
    style,
    ...restProps
  } = props;

  const letterRefs = useRef([]);
  const interpolatedSettingsRef = useRef([]);
  const mousePositionRef = useRef({ x: Number.NEGATIVE_INFINITY, y: Number.NEGATIVE_INFINITY });
  // PERF-3 fix: cache each letter's center so we don't call getBoundingClientRect
  // for every letter on every mouse move (layout thrash). Re-measured on resize/scroll.
  const letterCentersRef = useRef([]);

  const parsedSettings = useMemo(() => {
    const parseSettings = settingsStr =>
      new Map(
        settingsStr
          .split(',')
          .map(s => s.trim())
          .map(s => {
            const [name, value] = s.split(' ');
            return [name.replace(/['"]/g, ''), parseFloat(value)];
          })
      );

    const fromSettings = parseSettings(fromFontVariationSettings);
    const toSettings = parseSettings(toFontVariationSettings);

    return Array.from(fromSettings.entries()).map(([axis, fromValue]) => ({
      axis,
      fromValue,
      toValue: toSettings.get(axis) ?? fromValue
    }));
  }, [fromFontVariationSettings, toFontVariationSettings]);

  const calculateDistance = (x1, y1, x2, y2) => Math.sqrt((x2 - x1) ** 2 + (y2 - y1) ** 2);

  const calculateFalloff = distance => {
    const norm = Math.min(Math.max(1 - distance / radius, 0), 1);
    switch (falloff) {
      case 'exponential':
        return norm ** 2;
      case 'gaussian':
        return Math.exp(-((distance / (radius / 2)) ** 2) / 2);
      case 'linear':
      default:
        return norm;
    }
  };

  const measureLetters = () => {
    const container = containerRef?.current;
    if (!container) return;
    const containerRect = container.getBoundingClientRect();
    letterCentersRef.current = letterRefs.current.map(letterRef => {
      if (!letterRef) return null;
      const rect = letterRef.getBoundingClientRect();
      return {
        x: rect.left + rect.width / 2 - containerRect.left,
        y: rect.top + rect.height / 2 - containerRect.top
      };
    });
  };

  useEffect(() => {
    measureLetters();
    const container = containerRef?.current;
    const observer = typeof ResizeObserver === 'function' && container
      ? new ResizeObserver(measureLetters)
      : null;
    observer?.observe(container);
    window.addEventListener('resize', measureLetters, { passive: true });
    return () => {
      window.removeEventListener('resize', measureLetters);
      observer?.disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [label]);

  const updateLetters = () => {
    if (!containerRef?.current) return;
    const { x, y } = mousePositionRef.current;

    letterRefs.current.forEach((letterRef, index) => {
      if (!letterRef) return;

      const center = letterCentersRef.current[index];
      if (!center) return;

      const distance = calculateDistance(
        x,
        y,
        center.x,
        center.y
      );

      if (distance >= radius) {
        letterRef.style.fontVariationSettings = fromFontVariationSettings;
        return;
      }

      const falloffValue = calculateFalloff(distance);
      const newSettings = parsedSettings
        .map(({ axis, fromValue, toValue }) => {
          const interpolatedValue = fromValue + (toValue - fromValue) * falloffValue;
          return `'${axis}' ${interpolatedValue}`;
        })
        .join(', ');

      interpolatedSettingsRef.current[index] = newSettings;
      letterRef.style.fontVariationSettings = newSettings;
    });
  };

  const scheduleUpdate = useRafScheduler(updateLetters);
  usePointerPosition(containerRef, mousePositionRef, scheduleUpdate);

  const words = label.split(' ');
  let letterIndex = 0;

  return (
    <span
      ref={ref}
      className={`${className} variable-proximity`}
      onClick={onClick}
      style={{ display: 'inline', ...style }}
      {...restProps}
    >
      {words.map((word, wordIndex) => (
        <span key={wordIndex} style={{ display: 'inline-block', whiteSpace: 'nowrap' }}>
          {word.split('').map(letter => {
            const currentLetterIndex = letterIndex++;
            return (
              <motion.span
                key={currentLetterIndex}
                ref={el => {
                  letterRefs.current[currentLetterIndex] = el;
                }}
                style={{
                  display: 'inline-block',
                  fontVariationSettings: interpolatedSettingsRef.current[currentLetterIndex]
                }}
                aria-hidden="true"
              >
                {letter}
              </motion.span>
            );
          })}
          {wordIndex < words.length - 1 && <span style={{ display: 'inline-block' }}>&nbsp;</span>}
        </span>
      ))}
      <span className="sr-only">{label}</span>
    </span>
  );
});

VariableProximity.displayName = 'VariableProximity';
export default VariableProximity;
