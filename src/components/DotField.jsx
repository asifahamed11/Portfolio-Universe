import { memo, useEffect, useId, useRef } from 'react';
import './DotField.css';

const TWO_PI = Math.PI * 2;

const DotField = memo((
/** @type {any} */
{
  dotRadius = 1.5,
  dotSpacing = 14,
  cursorRadius = 500,
  cursorForce = 0.1,
  bulgeOnly = true,
  bulgeStrength = 67,
  glowRadius = 160,
  sparkle = false,
  waveAmplitude = 0,
  gradientFrom = 'rgba(168, 85, 247, 0.35)',
  gradientTo = 'rgba(180, 151, 207, 0.25)',
  glowColor = '#120F17',
  className = '',
  ...containerProps
}) => {
  const canvasRef = useRef(null);
  const glowRef = useRef(null);
  const propsRef = useRef({});
  const rebuildRef = useRef(null);
  const glowId = `dot-field-glow-${useId().replace(/:/g, '')}`;

  propsRef.current = {
    dotRadius,
    dotSpacing,
    cursorRadius,
    cursorForce,
    bulgeOnly,
    bulgeStrength,
    sparkle,
    waveAmplitude,
    gradientFrom,
    gradientTo,
  };

  useEffect(() => {
    const canvas = canvasRef.current;
    const glow = glowRef.current;
    const container = canvas?.parentElement;
    if (!canvas || !container) return undefined;

    const context = canvas.getContext('2d', { alpha: true });
    if (!context) return undefined;

    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
    const precisePointer = window.matchMedia('(hover: hover) and (pointer: fine)');
    const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    const size = { width: 0, height: 0, left: 0, top: 0 };
    const mouse = {
      x: -9999,
      y: -9999,
      previousX: -9999,
      previousY: -9999,
      speed: 0,
      lastMove: 0,
    };
    let dots = [];
    let gradient = null;
    let engagement = 0;
    let glowOpacity = 0;
    let frame = 0;
    let frameCount = 0;
    let resizeFrame = 0;

    const isInteractive = () => precisePointer.matches && !reducedMotion.matches;

    const buildDots = () => {
      const props = propsRef.current;
      const step = Math.max(4, props.dotRadius + props.dotSpacing);
      const columns = Math.floor(size.width / step);
      const rows = Math.floor(size.height / step);
      const paddingX = (size.width % step) / 2;
      const paddingY = (size.height % step) / 2;
      dots = new Array(rows * columns);
      let index = 0;

      for (let row = 0; row < rows; row += 1) {
        for (let column = 0; column < columns; column += 1) {
          const anchorX = paddingX + column * step + step / 2;
          const anchorY = paddingY + row * step + step / 2;
          dots[index] = {
            anchorX,
            anchorY,
            displayX: anchorX,
            displayY: anchorY,
            velocityX: 0,
            velocityY: 0,
          };
          index += 1;
        }
      }
    };

    const rebuildGradient = () => {
      gradient = context.createLinearGradient(0, 0, size.width, size.height);
      gradient.addColorStop(0, propsRef.current.gradientFrom);
      gradient.addColorStop(1, propsRef.current.gradientTo);
    };

    const draw = now => {
      frame = 0;
      if (document.hidden || size.width <= 0 || size.height <= 0) return;

      frameCount += 1;
      const props = propsRef.current;
      const interactive = isInteractive();
      const timeSinceMove = now - mouse.lastMove;
      const speedTarget = interactive && timeSinceMove < 90
        ? Math.min(mouse.speed / 5, 1)
        : 0;
      engagement += (speedTarget - engagement) * 0.11;
      if (engagement < 0.001) engagement = 0;
      mouse.speed *= 0.82;
      glowOpacity += (engagement - glowOpacity) * 0.1;
      if (glowOpacity < 0.001) glowOpacity = 0;

      if (glow) {
        glow.setAttribute('cx', String(mouse.x));
        glow.setAttribute('cy', String(mouse.y));
        glow.style.opacity = String(glowOpacity);
      }

      context.clearRect(0, 0, size.width, size.height);
      context.fillStyle = gradient;
      context.beginPath();

      const cursorRadiusSquared = props.cursorRadius * props.cursorRadius;
      const radius = props.dotRadius / 2;
      const waveTime = frameCount * 0.02;
      let largestOffset = 0;
      let largestVelocity = 0;

      for (let index = 0; index < dots.length; index += 1) {
        const dot = dots[index];
        const deltaX = mouse.x - dot.anchorX;
        const deltaY = mouse.y - dot.anchorY;
        const distanceSquared = deltaX * deltaX + deltaY * deltaY;

        if (interactive && distanceSquared < cursorRadiusSquared && engagement > 0.01) {
          const distance = Math.max(Math.sqrt(distanceSquared), 0.01);
          const angle = Math.atan2(deltaY, deltaX);
          if (props.bulgeOnly) {
            const influence = 1 - distance / props.cursorRadius;
            const push = influence * influence * props.bulgeStrength * engagement;
            const targetX = dot.anchorX - Math.cos(angle) * push;
            const targetY = dot.anchorY - Math.sin(angle) * push;
            dot.displayX += (targetX - dot.displayX) * 0.15;
            dot.displayY += (targetY - dot.displayY) * 0.15;
          } else {
            const movement = (500 / distance) * (mouse.speed * props.cursorForce);
            dot.velocityX += Math.cos(angle) * -movement;
            dot.velocityY += Math.sin(angle) * -movement;
          }
        } else if (props.bulgeOnly) {
          dot.displayX += (dot.anchorX - dot.displayX) * 0.12;
          dot.displayY += (dot.anchorY - dot.displayY) * 0.12;
        }

        if (!props.bulgeOnly) {
          dot.velocityX *= 0.9;
          dot.velocityY *= 0.9;
          dot.displayX += (dot.anchorX + dot.velocityX - dot.displayX) * 0.1;
          dot.displayY += (dot.anchorY + dot.velocityY - dot.displayY) * 0.1;
          largestVelocity = Math.max(
            largestVelocity,
            Math.abs(dot.velocityX),
            Math.abs(dot.velocityY),
          );
        }

        let drawX = dot.displayX;
        let drawY = dot.displayY;
        if (interactive && props.waveAmplitude > 0) {
          drawY += Math.sin(dot.anchorX * 0.03 + waveTime) * props.waveAmplitude;
          drawX +=
            Math.cos(dot.anchorY * 0.03 + waveTime * 0.7) *
            props.waveAmplitude *
            0.5;
        }

        const drawRadius =
          interactive &&
          props.sparkle &&
          ((((index * 2654435761) ^ (frameCount >> 3)) >>> 0) % 100) < 3
            ? radius * 1.8
            : radius;
        context.moveTo(drawX + drawRadius, drawY);
        context.arc(drawX, drawY, drawRadius, 0, TWO_PI);
        largestOffset = Math.max(
          largestOffset,
          Math.abs(dot.displayX - dot.anchorX),
          Math.abs(dot.displayY - dot.anchorY),
        );
      }

      context.fill();

      const keepAnimating =
        interactive &&
        (
          props.waveAmplitude > 0 ||
          props.sparkle ||
          engagement > 0 ||
          glowOpacity > 0 ||
          largestOffset > 0.05 ||
          largestVelocity > 0.02
        );
      if (keepAnimating) frame = requestAnimationFrame(draw);
    };

    const scheduleDraw = () => {
      if (!frame && !document.hidden) frame = requestAnimationFrame(draw);
    };

    const resize = () => {
      resizeFrame = 0;
      const rect = container.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return;
      size.width = rect.width;
      size.height = rect.height;
      size.left = rect.left;
      size.top = rect.top;
      canvas.width = Math.max(1, Math.round(rect.width * dpr));
      canvas.height = Math.max(1, Math.round(rect.height * dpr));
      canvas.style.width = `${rect.width}px`;
      canvas.style.height = `${rect.height}px`;
      context.setTransform(dpr, 0, 0, dpr, 0, 0);
      buildDots();
      rebuildGradient();
      scheduleDraw();
    };

    const queueResize = () => {
      if (!resizeFrame) resizeFrame = requestAnimationFrame(resize);
    };

    const onPointerMove = event => {
      if (!isInteractive()) return;
      const nextX = event.clientX - size.left;
      const nextY = event.clientY - size.top;
      if (mouse.previousX > -9000) {
        mouse.speed = Math.hypot(nextX - mouse.previousX, nextY - mouse.previousY);
      }
      mouse.x = nextX;
      mouse.y = nextY;
      mouse.previousX = nextX;
      mouse.previousY = nextY;
      mouse.lastMove = performance.now();
      scheduleDraw();
    };

    const onVisibilityChange = () => {
      if (document.hidden && frame) {
        cancelAnimationFrame(frame);
        frame = 0;
      } else {
        scheduleDraw();
      }
    };

    const onInteractionModeChange = () => {
      engagement = 0;
      glowOpacity = 0;
      mouse.x = -9999;
      mouse.y = -9999;
      for (const dot of dots) {
        dot.displayX = dot.anchorX;
        dot.displayY = dot.anchorY;
        dot.velocityX = 0;
        dot.velocityY = 0;
      }
      scheduleDraw();
    };

    const resizeObserver = new ResizeObserver(queueResize);
    resizeObserver.observe(container);
    window.addEventListener('pointermove', onPointerMove, { passive: true });
    document.addEventListener('visibilitychange', onVisibilityChange);
    reducedMotion.addEventListener('change', onInteractionModeChange);
    precisePointer.addEventListener('change', onInteractionModeChange);
    rebuildRef.current = () => {
      buildDots();
      rebuildGradient();
      scheduleDraw();
    };
    resize();

    return () => {
      if (frame) cancelAnimationFrame(frame);
      if (resizeFrame) cancelAnimationFrame(resizeFrame);
      resizeObserver.disconnect();
      window.removeEventListener('pointermove', onPointerMove);
      document.removeEventListener('visibilitychange', onVisibilityChange);
      reducedMotion.removeEventListener('change', onInteractionModeChange);
      precisePointer.removeEventListener('change', onInteractionModeChange);
    };
  }, []);

  useEffect(() => {
    rebuildRef.current?.();
  }, [dotRadius, dotSpacing, gradientFrom, gradientTo]);

  return (
    <div
      {...containerProps}
      className={`dot-field-container${className ? ` ${className}` : ''}`}
    >
      <canvas ref={canvasRef} aria-hidden="true" />
      <svg aria-hidden="true">
        <defs>
          <radialGradient id={glowId}>
            <stop offset="0%" stopColor={glowColor} />
            <stop offset="100%" stopColor="transparent" />
          </radialGradient>
        </defs>
        <circle
          ref={glowRef}
          cx="-9999"
          cy="-9999"
          r={glowRadius}
          fill={`url(#${glowId})`}
          style={{ opacity: 0 }}
        />
      </svg>
    </div>
  );
});

DotField.displayName = 'DotField';

export default DotField;
