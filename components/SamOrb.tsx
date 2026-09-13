"use client";

import { useEffect, useRef } from "react";

interface SamOrbProps {
  className?: string;
  /** 0 = idle white, 1 = fully "speaking" accent green. */
  energy?: number;
  points?: number;
}

const ACCENT: [number, number, number] = [90, 186, 65];

// Canvas port of the orb from the Sam design reference: a Fibonacci-sphere point cloud.
export function SamOrb({ className, energy = 0.35, points = 620 }: SamOrbProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const energyRef = useRef(energy);
  const repaintRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    energyRef.current = energy;
    repaintRef.current?.();
  }, [energy]);

  useEffect(() => {
    const cv = canvasRef.current;
    if (!cv) return;
    const ctx = cv.getContext("2d");
    if (!ctx) return;

    const pts = Array.from({ length: points }, (_, i) => {
      const y = 1 - (i / (points - 1)) * 2;
      const r = Math.sqrt(Math.max(0, 1 - y * y));
      const th = i * Math.PI * (3 - Math.sqrt(5));
      return { x: Math.cos(th) * r, y, z: Math.sin(th) * r, s: 0.6 + Math.random() * 0.9, ph: Math.random() * 6.28 };
    });

    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let mix = energyRef.current;
    let t = 0;
    let raf = 0;
    let visible = true;

    const paint = () => {
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const w = cv.clientWidth;
      const h = cv.clientHeight;
      if (!w || !h) return;
      if (cv.width !== Math.round(w * dpr)) {
        cv.width = Math.round(w * dpr);
        cv.height = Math.round(h * dpr);
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);

      mix = reduce ? energyRef.current : mix + (energyRef.current - mix) * 0.05;
      t += 0.008 + mix * 0.016;
      const col = [0, 1, 2].map((k) => Math.round(255 + (ACCENT[k] - 255) * mix)).join(",");
      const R = Math.min(w, h) * 0.36;
      const cx = w / 2;
      const cy = h / 2;
      const amp = 0.02 + mix * 0.06;

      const g = ctx.createRadialGradient(cx, cy, R * 0.1, cx, cy, Math.min(w, h) / 2);
      g.addColorStop(0, `rgba(${col},${0.12 + 0.14 * mix})`);
      g.addColorStop(0.62, `rgba(${col},${0.03 + 0.05 * mix})`);
      g.addColorStop(1, `rgba(${col},0)`);
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);

      const ry = t * 0.5;
      const rx = Math.sin(t * 0.23) * 0.34;
      for (const p of pts) {
        const nx0 = p.x * Math.cos(ry) - p.z * Math.sin(ry);
        let nz = p.x * Math.sin(ry) + p.z * Math.cos(ry);
        const ny = p.y * Math.cos(rx) - nz * Math.sin(rx);
        nz = p.y * Math.sin(rx) + nz * Math.cos(rx);
        const wob = 1 + amp * Math.sin(t * 2.6 + p.ph + ny * 3.1) + 0.03 * Math.sin(t * 1.1 + p.ph);
        const rr = R * wob;
        const depth = (nz + 1) / 2;
        const persp = 0.72 + depth * 0.42;
        const a = (0.1 + depth * 0.78) * (0.55 + 0.45 * Math.sin(t * 1.7 + p.ph));
        ctx.fillStyle = `rgba(${col},${Math.max(0.05, a)})`;
        ctx.beginPath();
        ctx.arc(cx + nx0 * rr * persp, cy + ny * rr * persp, p.s * (0.5 + depth * 1.25), 0, Math.PI * 2);
        ctx.fill();
      }
    };

    const loop = () => {
      raf = requestAnimationFrame(loop);
      if (visible && !document.hidden) paint();
    };

    const io = new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting;
    });
    io.observe(cv);

    if (reduce) {
      mix = energyRef.current;
      paint();
    } else {
      raf = requestAnimationFrame(loop);
    }

    repaintRef.current = reduce ? paint : null;
    const onResize = () => reduce && paint();
    window.addEventListener("resize", onResize);

    return () => {
      repaintRef.current = null;
      cancelAnimationFrame(raf);
      io.disconnect();
      window.removeEventListener("resize", onResize);
    };
  }, [points]);

  return <canvas ref={canvasRef} aria-hidden className={className} />;
}
