import * as THREE from 'three';
import { useRef } from 'react';
import React, { Suspense } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { useGLTF, MeshTransmissionMaterial, Environment } from '@react-three/drei';

export default function FluidGlassPill({ className, style }) {
  return (
    <div className={className} style={{ width: '100%', height: '100%', position: 'absolute', inset: 0, zIndex: 10, ...style }}>
      <Canvas camera={{ position: [0, 0, 10], fov: 30 }} gl={{ alpha: true }}>
        <ambientLight intensity={1.5} />
        <directionalLight position={[5, 10, 5]} intensity={2} />
        <Environment preset="city" />
        <Suspense fallback={null}>
          <GlassModel />
        </Suspense>
      </Canvas>
    </div>
  );
}

function GlassModel() {
  const ref = useRef();
  
  // Use the lens model provided by the user
  const { nodes } = useGLTF('/assets/3d/lens.glb');
  const { viewport } = useThree();
  
  useFrame((state) => {
    // Subtle breathing/floating animation
    const t = state.clock.getElapsedTime();
    ref.current.rotation.y = Math.sin(t * 0.5) * 0.05;
    ref.current.rotation.x = (Math.PI / 2) + Math.cos(t * 0.5) * 0.02;
  });

  // Scale the lens to roughly fit the pill shape based on the viewport
  const scaleX = viewport.width * 0.45;
  const scaleY = viewport.height * 0.45;

  return (
    <mesh 
      ref={ref} 
      geometry={nodes.Cylinder?.geometry} 
      scale={[scaleX, 1, scaleY]} 
      rotation-x={Math.PI / 2}
    >
      <MeshTransmissionMaterial
        backside
        samples={4}
        thickness={2}
        chromaticAberration={0.15}
        anisotropy={0.1}
        ior={1.15}
        color="#e0eaff"
        clearcoat={1}
        clearcoatRoughness={0.1}
      />
    </mesh>
  );
}
