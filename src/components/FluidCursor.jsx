/* eslint-disable react/no-unknown-property */
import * as THREE from 'three';
import { useRef, memo, useEffect } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { useGLTF, MeshTransmissionMaterial, Environment } from '@react-three/drei';
import { easing } from 'maath';

const LensCursor = memo(function LensCursor() {
  const ref = useRef();
  // We use the lens.glb downloaded exactly from React Bits
  // Using the base path /Portfolio-Universe/ to match Astro's config
  const { nodes } = useGLTF('/Portfolio-Universe/assets/3d/lens.glb');
  
  useFrame((state, delta) => {
    const { pointer, camera, viewport } = state;
    const v = viewport.getCurrentViewport(camera, [0, 0, 15]);
    const destX = (pointer.x * v.width) / 2;
    const destY = (pointer.y * v.height) / 2;
    easing.damp3(ref.current.position, [destX, destY, 15], 0.15, delta);
  });

  if (!nodes || !nodes.Cylinder) return null;

  return (
    <mesh ref={ref} scale={0.15} rotation-x={Math.PI / 2} geometry={nodes.Cylinder.geometry}>
      <MeshTransmissionMaterial
        ior={1.15}
        thickness={5}
        anisotropy={0.01}
        chromaticAberration={0.1}
        transmission={1}
        roughness={0}
        clearcoat={1}
        clearcoatRoughness={0.1}
      />
    </mesh>
  );
});

export default function FluidCursor() {
  return (
    <div style={{ position: 'fixed', inset: 0, pointerEvents: 'none', zIndex: 9999 }}>
      {/* We set eventSource to document.body so it still tracks the mouse while letting clicks pass through to the HTML */}
      <Canvas 
        camera={{ position: [0, 0, 20], fov: 15 }} 
        gl={{ alpha: true }} 
        eventSource={typeof document !== 'undefined' ? document.body : undefined}
      >
        <ambientLight intensity={1} />
        <directionalLight position={[10, 10, 10]} intensity={2} />
        {/* Environment gives the glass something to reflect so it looks like a real 3D liquid lens over the HTML! */}
        <Environment preset="city" />
        <LensCursor />
      </Canvas>
    </div>
  );
}
