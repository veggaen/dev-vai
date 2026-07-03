import { useMemo, useRef } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { Float, MeshDistortMaterial, Points, PointMaterial } from '@react-three/drei';
import * as THREE from 'three';

function Starfield({ warp }: { warp: boolean }) {
  const ref = useRef<THREE.Points>(null);
  const positions = useMemo(() => {
    const count = 4200;
    const arr = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      const r = 6 + Math.random() * 18;
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);
      arr[i * 3] = r * Math.sin(phi) * Math.cos(theta);
      arr[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta);
      arr[i * 3 + 2] = r * Math.cos(phi);
    }
    return arr;
  }, []);

  useFrame((state, delta) => {
    if (!ref.current) return;
    const speed = warp ? 8 : 1;
    ref.current.rotation.y += delta * 0.02 * speed;
    ref.current.rotation.x += delta * 0.008 * speed;
    // subtle mouse parallax
    ref.current.position.x = THREE.MathUtils.lerp(ref.current.position.x, state.pointer.x * 0.6, 0.03);
    ref.current.position.y = THREE.MathUtils.lerp(ref.current.position.y, state.pointer.y * 0.4, 0.03);
  });

  return (
    <Points ref={ref} positions={positions} stride={3} frustumCulled>
      <PointMaterial
        transparent
        color={warp ? '#67e8f9' : '#a5b4fc'}
        size={0.035}
        sizeAttenuation
        depthWrite={false}
        opacity={0.9}
      />
    </Points>
  );
}

function Core({ warp }: { warp: boolean }) {
  const mesh = useRef<THREE.Mesh>(null);
  const mat = useRef<never>(null);

  useFrame((state, delta) => {
    if (!mesh.current) return;
    mesh.current.rotation.y += delta * (warp ? 0.9 : 0.15);
    mesh.current.rotation.z += delta * 0.05;
    const s = 1 + Math.sin(state.clock.elapsedTime * 0.8) * 0.04;
    mesh.current.scale.setScalar(s);
  });

  return (
    <Float speed={1.4} rotationIntensity={0.4} floatIntensity={0.9}>
      <mesh ref={mesh}>
        <icosahedronGeometry args={[1.35, 24]} />
        <MeshDistortMaterial
          ref={mat}
          color={warp ? '#06b6d4' : '#6366f1'}
          emissive={warp ? '#0e7490' : '#312e81'}
          emissiveIntensity={0.55}
          roughness={0.18}
          metalness={0.75}
          distort={warp ? 0.62 : 0.38}
          speed={warp ? 4 : 1.8}
        />
      </mesh>
    </Float>
  );
}

function Halo() {
  const ref = useRef<THREE.Mesh>(null);
  useFrame((_, delta) => {
    if (ref.current) ref.current.rotation.z -= delta * 0.12;
  });
  return (
    <mesh ref={ref} rotation={[Math.PI / 2.4, 0, 0]}>
      <torusGeometry args={[2.4, 0.012, 16, 128]} />
      <meshBasicMaterial color="#818cf8" transparent opacity={0.45} />
    </mesh>
  );
}

export default function HeroScene({ warp }: { warp: boolean }) {
  return (
    <div className="absolute inset-0" aria-hidden data-testid="hero-scene">
      <Canvas
        camera={{ position: [0, 0, 5.2], fov: 48 }}
        dpr={[1, 2]}
        gl={{ antialias: true, alpha: true, powerPreference: 'high-performance' }}
      >
        <ambientLight intensity={0.35} />
        <pointLight position={[6, 4, 6]} intensity={40} color="#818cf8" />
        <pointLight position={[-6, -3, 2]} intensity={26} color="#22d3ee" />
        <Starfield warp={warp} />
        <Core warp={warp} />
        <Halo />
      </Canvas>
    </div>
  );
}
