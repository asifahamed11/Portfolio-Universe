import { useEffect, useRef } from 'react';
import { Color, Mesh, Program, Renderer, Triangle } from 'ogl';
import './SpecularButton.css';

const PAD = 20;
const pointerSubscribers = new Set();
let pointerListenerInstalled = false;

const dispatchPointerMove = event => {
  for (const subscriber of pointerSubscribers) subscriber(event);
};

const subscribeToPointer = subscriber => {
  pointerSubscribers.add(subscriber);
  if (!pointerListenerInstalled) {
    window.addEventListener('pointermove', dispatchPointerMove, { passive: true });
    pointerListenerInstalled = true;
  }

  return () => {
    pointerSubscribers.delete(subscriber);
    if (pointerSubscribers.size === 0 && pointerListenerInstalled) {
      window.removeEventListener('pointermove', dispatchPointerMove);
      pointerListenerInstalled = false;
    }
  };
};

const VERT = `#version 300 es
in vec2 position;
void main() {
  gl_Position = vec4(position, 0.0, 1.0);
}
`;

const FRAG = `#version 300 es
precision highp float;

uniform vec2 uCenter;
uniform vec2 uHalfSize;
uniform float uRadius;
uniform float uAngle;
uniform float uPx;
uniform vec3 uLineColor;
uniform vec3 uBaseColor;
uniform float uIntensity;
uniform float uShineSize;
uniform float uShineFade;
uniform float uThickness;
uniform float uBaseWidth;

out vec4 fragColor;

float sdRoundedRect(vec2 p, vec2 b, float r) {
  vec2 q = abs(p) - b + r;
  return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
}

float gaussianLine(float d, float sigma) {
  float x = d / (sigma + 1e-6);
  float k = mix(1.0, 1.6, smoothstep(0.0, 1.5, x));
  return exp(-k * x * x);
}

void main() {
  vec2 p = gl_FragCoord.xy - uCenter;
  float d = sdRoundedRect(p, uHalfSize, uRadius);
  vec2 lightDirection = vec2(cos(uAngle), sin(uAngle));
  float base = (1.0 - smoothstep(0.0, uBaseWidth, abs(d))) * 0.45;
  vec2 normal = normalize(p / (uHalfSize * uHalfSize) + 1e-6);
  float phi = acos(clamp(abs(dot(normal, lightDirection)), 0.0, 1.0));
  float rim = 1.0 - smoothstep(
    uShineSize - uShineFade,
    uShineSize + uShineFade + 1e-4,
    phi
  );
  float line = gaussianLine(d, uThickness);
  float edgeClamp = 1.0 - smoothstep(0.5 * uPx, 3.0 * uPx, abs(d));
  float highlight = line * rim * edgeClamp * uIntensity;
  vec3 color = uBaseColor * base + uLineColor * highlight;
  float alpha = clamp(base + highlight, 0.0, 1.0);
  fragColor = vec4(color, alpha);
}
`;

const SpecularButton = (
/** @type {any} */
{
  children = 'Get Started',
  size = 'lg',
  radius = 18,
  tint = '#ffffff',
  tintOpacity = 0,
  blur = 0,
  textColor = '#f5f5f5',
  lineColor = '#ffffff',
  baseColor = '#525252',
  intensity = 1,
  shineSize = 10,
  shineFade = 40,
  thickness = 1,
  speed = 0.35,
  followMouse = true,
  proximity = 250,
  autoAnimate = false,
  disabled = false,
  onClick,
  className = '',
  style,
  type = 'button',
  ...buttonProps
}) => {
  const buttonRef = useRef(null);
  const effectRef = useRef(null);
  const propsRef = useRef({});

  propsRef.current = {
    radius,
    lineColor,
    baseColor,
    intensity,
    shineSize,
    shineFade,
    thickness,
    speed,
    followMouse,
    proximity,
    autoAnimate,
  };

  useEffect(() => {
    const button = buttonRef.current;
    const effect = effectRef.current;
    if (!button || !effect) return undefined;

    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
    const precisePointer = window.matchMedia('(hover: hover) and (pointer: fine)');
    if (reducedMotion.matches || !precisePointer.matches) return undefined;

    const visibilityRoot = button.closest('[role="dialog"][aria-hidden]');
    let renderer;
    let gl;
    let program;
    let mesh;
    let resizeObserver;
    let unsubscribePointer = () => {};
    let frame = 0;
    let initialized = false;
    let inView = false;
    let contextLost = false;
    let focused = false;
    let pointerAngle = null;
    let proximityAmount = 0;
    let angle = 2.4;
    let idleAngle = 2.4;
    let brightness = 0;
    let lastFrame = performance.now();
    const size = { width: 1, height: 1 };
    const line = new Color();
    const base = new Color();
    const isVisibleInInterface = () =>
      !visibilityRoot || visibilityRoot.getAttribute('aria-hidden') !== 'true';

    const canRender = () =>
      initialized &&
      inView &&
      isVisibleInInterface() &&
      !document.hidden &&
      !contextLost &&
      renderer &&
      program &&
      mesh;

    const renderCurrentFrame = () => {
      if (!canRender()) return;
      const dpr = renderer.dpr || 1;
      const props = propsRef.current;
      line.set(props.lineColor);
      base.set(props.baseColor);
      program.uniforms.uAngle.value = angle;
      program.uniforms.uRadius.value =
        Math.min(props.radius, Math.min(size.width, size.height) / 2) * dpr;
      program.uniforms.uLineColor.value = [line.r, line.g, line.b];
      program.uniforms.uBaseColor.value = [base.r, base.g, base.b];
      program.uniforms.uIntensity.value = props.intensity * brightness;
      program.uniforms.uShineSize.value = (props.shineSize * Math.PI) / 180;
      program.uniforms.uShineFade.value = (props.shineFade * Math.PI) / 180;
      program.uniforms.uThickness.value = props.thickness * dpr;
      renderer.render({ scene: mesh });
    };

    const scheduleFrame = () => {
      if (!frame && canRender()) frame = requestAnimationFrame(update);
    };

    const update = now => {
      frame = 0;
      if (!canRender()) return;

      const delta = Math.min((now - lastFrame) / 1000, 0.05);
      lastFrame = now;
      const props = propsRef.current;
      if (props.autoAnimate) idleAngle += props.speed * delta;

      const steer =
        props.followMouse &&
        pointerAngle !== null &&
        (!props.autoAnimate || proximityAmount > 0);
      const targetAngle = steer ? pointerAngle : idleAngle;
      const angleDifference =
        ((targetAngle - angle + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
      angle += angleDifference * (1 - Math.exp(-delta * 7));

      const targetBrightness = props.autoAnimate || focused ? 1 : proximityAmount;
      brightness += (targetBrightness - brightness) * (1 - Math.exp(-delta * 8));
      if (Math.abs(targetBrightness - brightness) < 0.001) brightness = targetBrightness;

      renderCurrentFrame();

      const needsAnotherFrame =
        props.autoAnimate ||
        proximityAmount > 0.001 ||
        brightness > 0.001 ||
        Math.abs(angleDifference) > 0.001;
      if (needsAnotherFrame) scheduleFrame();
    };

    const resize = () => {
      if (!renderer || !program || !gl) return;
      const rect = button.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return;
      size.width = rect.width;
      size.height = rect.height;
      renderer.setSize(rect.width + PAD * 2, rect.height + PAD * 2);
      const dpr = renderer.dpr || 1;
      program.uniforms.uCenter.value = [
        (PAD + rect.width / 2) * dpr,
        (PAD + rect.height / 2) * dpr,
      ];
      program.uniforms.uHalfSize.value = [
        (rect.width / 2) * dpr,
        (rect.height / 2) * dpr,
      ];
      renderCurrentFrame();
    };

    const onPointerMove = event => {
      const rect = button.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return;
      const centerX = rect.left + rect.width / 2;
      const centerY = rect.top + rect.height / 2;
      const deltaX = Math.max(rect.left - event.clientX, 0, event.clientX - rect.right);
      const deltaY = Math.max(rect.top - event.clientY, 0, event.clientY - rect.bottom);
      const distance = Math.hypot(deltaX, deltaY);

      if (distance === 0) {
        const normalizedX = (event.clientX - centerX) / (rect.width / 2);
        const normalizedY = (centerY - event.clientY) / (rect.height / 2);
        pointerAngle =
          Math.atan2(2 / rect.height, -2 / rect.width) +
          normalizedX * 0.3 +
          normalizedY * 0.15;
      } else {
        pointerAngle = Math.atan2(centerY - event.clientY, event.clientX - centerX);
      }

      const amount = Math.max(
        0,
        1 - distance / Math.max(propsRef.current.proximity, 1),
      );
      proximityAmount = amount * amount * (3 - 2 * amount);
      scheduleFrame();
    };

    const onFocus = () => {
      focused = true;
      scheduleFrame();
    };
    const onBlur = () => {
      focused = false;
      proximityAmount = 0;
      scheduleFrame();
    };
    const onVisibilityChange = () => {
      if (document.hidden && frame) {
        cancelAnimationFrame(frame);
        frame = 0;
      } else {
        lastFrame = performance.now();
        scheduleFrame();
      }
    };

    const initialize = () => {
      if (initialized || !inView || !isVisibleInInterface()) return;
      try {
        renderer = new Renderer({
          alpha: true,
          premultipliedAlpha: true,
          antialias: true,
          dpr: Math.min(window.devicePixelRatio || 1, 1.5),
        });
      } catch (error) {
        console.warn('Specular button WebGL is unavailable; using the CSS edge.', error);
        return;
      }

      gl = renderer.gl;
      gl.clearColor(0, 0, 0, 0);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);

      const geometry = new Triangle(gl);
      if (geometry.attributes.uv) delete geometry.attributes.uv;
      program = new Program(gl, {
        vertex: VERT,
        fragment: FRAG,
        uniforms: {
          uCenter: { value: [0, 0] },
          uHalfSize: { value: [1, 1] },
          uRadius: { value: 0 },
          uAngle: { value: angle },
          uPx: { value: renderer.dpr || 1 },
          uLineColor: { value: [1, 1, 1] },
          uBaseColor: { value: [0.32, 0.32, 0.32] },
          uIntensity: { value: 0 },
          uShineSize: { value: 0.17 },
          uShineFade: { value: 0.7 },
          uThickness: { value: 1 },
          uBaseWidth: { value: renderer.dpr || 1 },
        },
      });
      mesh = new Mesh(gl, { geometry, program });
      gl.canvas.setAttribute('aria-hidden', 'true');
      gl.canvas.setAttribute('role', 'presentation');
      effect.appendChild(gl.canvas);
      initialized = true;

      resizeObserver = new ResizeObserver(resize);
      resizeObserver.observe(button);
      unsubscribePointer = subscribeToPointer(onPointerMove);
      button.addEventListener('focus', onFocus);
      button.addEventListener('blur', onBlur);
      document.addEventListener('visibilitychange', onVisibilityChange);
      gl.canvas.addEventListener('webglcontextlost', event => {
        event.preventDefault();
        contextLost = true;
        if (frame) cancelAnimationFrame(frame);
        frame = 0;
      });

      resize();
      if (propsRef.current.autoAnimate) scheduleFrame();
    };

    const intersectionObserver = new IntersectionObserver(
      entries => {
        inView = entries.some(entry => entry.isIntersecting);
        if (inView) {
          initialize();
          lastFrame = performance.now();
          scheduleFrame();
        } else if (frame) {
          cancelAnimationFrame(frame);
          frame = 0;
        }
      },
      { rootMargin: '80px' },
    );
    intersectionObserver.observe(button);

    const visibilityObserver = visibilityRoot
      ? new MutationObserver(() => {
          if (isVisibleInInterface()) {
            initialize();
            lastFrame = performance.now();
            scheduleFrame();
          } else if (frame) {
            cancelAnimationFrame(frame);
            frame = 0;
          }
        })
      : null;
    visibilityObserver?.observe(visibilityRoot, {
      attributes: true,
      attributeFilter: ['aria-hidden'],
    });

    return () => {
      if (frame) cancelAnimationFrame(frame);
      intersectionObserver.disconnect();
      visibilityObserver?.disconnect();
      resizeObserver?.disconnect();
      unsubscribePointer();
      button.removeEventListener('focus', onFocus);
      button.removeEventListener('blur', onBlur);
      document.removeEventListener('visibilitychange', onVisibilityChange);
      if (gl?.canvas.parentNode === effect) effect.removeChild(gl.canvas);
      gl?.getExtension('WEBGL_lose_context')?.loseContext();
    };
  }, []);

  return (
    <button
      {...buttonProps}
      ref={buttonRef}
      type={type}
      disabled={disabled}
      onClick={onClick}
      className={`specular-button specular-button--${size}${className ? ` ${className}` : ''}`}
      style={{
        '--sb-radius': `${radius}px`,
        '--sb-tint': tint,
        '--sb-tint-opacity': tintOpacity,
        '--sb-blur': `${blur}px`,
        '--sb-text-color': textColor,
        ...style,
      }}
    >
      <span ref={effectRef} className="specular-button__fx" aria-hidden="true" />
      <span className="specular-button__label">{children}</span>
    </button>
  );
};

export default SpecularButton;
