import gsap from 'gsap';
import { useEffect, useRef } from 'react';
import { useReducedMotion } from '../hooks/useReducedMotion.ts';

export interface LogoProps {
  size?: number;
  animateOnMount?: boolean;
  className?: string;
}

export function Logo({ size = 40, animateOnMount = false, className = '' }: LogoProps) {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const reducedMotion = useReducedMotion();

  useEffect(() => {
    if (!animateOnMount || reducedMotion || !svgRef.current) return;
    const ctx = gsap.context(() => {
      gsap.fromTo(
        svgRef.current,
        { opacity: 0, scale: 0.94 },
        { opacity: 1, scale: 1, duration: 0.85, ease: 'expo.out' }
      );
    }, svgRef);
    return () => ctx.revert();
  }, [animateOnMount, reducedMotion]);

  return (
    <svg
      ref={svgRef}
      width={size}
      height={size}
      viewBox="0 0 64 64"
      fill="none"
      aria-label="Arkvoid emblem"
      role="img"
      className={`shrink-0 ${className}`}
    >
      <path
        d="M10 56V30C10 17.85 19.85 8 32 8S54 17.85 54 30V56"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="round"
      />
      <path
        d="M20 56V34C20 27.37 25.37 22 32 22S44 27.37 44 34V56"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
      <circle cx="32" cy="41" r="4.5" fill="#FB5607" />
    </svg>
  );
}
