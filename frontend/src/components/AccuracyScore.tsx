import { useEffect, useState } from 'react';
import { animate, motion, useMotionValue } from 'framer-motion';
import { cn } from '@/lib/utils';

interface AccuracyScoreProps {
  accuracy: number; // 0-100
  accent: string; // hex
  size?: number;
  className?: string;
}

/** Semi-circular (speedometer) gauge with an animated fill + count-up number. */
export function AccuracyScore({ accuracy, accent, size = 150, className }: AccuracyScoreProps) {
  const r = 60;
  const cx = 75;
  const cy = 72;
  const stroke = 12;
  const fraction = Math.max(0, Math.min(1, accuracy / 100));
  const viewW = 150;
  const viewH = 86;

  return (
    <div
      className={cn('relative flex flex-col items-center', className)}
      style={{ width: size }}
    >
      <svg
        viewBox={`0 0 ${viewW} ${viewH}`}
        width={size}
        height={(size * viewH) / viewW}
        className="overflow-visible"
      >
        <path
          d={`M ${cx - r} ${cy} A ${r} ${r} 0 0 1 ${cx + r} ${cy}`}
          fill="none"
          stroke="rgba(255,255,255,0.08)"
          strokeWidth={stroke}
          strokeLinecap="round"
        />
        <motion.path
          d={`M ${cx - r} ${cy} A ${r} ${r} 0 0 1 ${cx + r} ${cy}`}
          fill="none"
          stroke={accent}
          strokeWidth={stroke}
          strokeLinecap="round"
          initial={{ pathLength: 0, opacity: 0.4 }}
          animate={{ pathLength: fraction, opacity: 1 }}
          transition={{ duration: 1.5, ease: 'easeOut' }}
          style={{ filter: `drop-shadow(0 0 6px ${accent}66)` }}
        />
      </svg>
      <div className="absolute bottom-0 flex flex-col items-center">
        <span className="font-mono text-3xl font-bold leading-none" style={{ color: accent }}>
          <AnimatedNumber value={accuracy} />
          <span className="text-base">%</span>
        </span>
      </div>
    </div>
  );
}

function AnimatedNumber({ value }: { value: number }) {
  const mv = useMotionValue(0);
  const [display, setDisplay] = useState(0);

  useEffect(() => {
    const controls = animate(mv, value, {
      duration: 1.5,
      ease: 'easeOut',
      onUpdate: (v) => setDisplay(v),
    });
    return () => controls.stop();
  }, [value, mv]);

  return <>{Math.round(display)}</>;
}
