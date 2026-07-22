import { useEffect, useState } from 'react';
import { animate, motion, useMotionValue } from 'framer-motion';
import { cn } from '@/lib/utils';

interface AccuracyScoreProps {
  accuracy: number; // 0-100
  accent: string; // hex
  size?: number;
  /** When false (no result yet), the gauge half-circle collapses so the
   *  number sits near the top of the column; expanding it animates back down. */
  active?: boolean;
  /** Small caption under the percentage (e.g. "Extraction"). */
  label?: string;
  className?: string;
}

/** Semi-circular (speedometer) gauge with an animated fill + count-up number.
 *  The gauge reserve collapses when `active` is false to avoid wasted space. */
export function AccuracyScore({
  accuracy,
  accent,
  size = 150,
  active = true,
  label,
  className,
}: AccuracyScoreProps) {
  const r = 60;
  const cx = 75;
  const cy = 72;
  const stroke = 12;
  const fraction = Math.max(0, Math.min(1, accuracy / 100));
  const viewW = 150;
  const viewH = 86;
  const gaugeHeight = (size * viewH) / viewW;
  const collapsedHeight = 36;

  return (
    <div
      className={cn('relative flex flex-col items-center', className)}
      style={{ width: size }}
    >
      <motion.div
        initial={false}
        animate={{ height: active ? gaugeHeight : collapsedHeight }}
        transition={{ duration: 0.6, ease: 'easeInOut' }}
        className="relative w-full overflow-hidden"
      >
        <motion.svg
          viewBox={`0 0 ${viewW} ${viewH}`}
          width={size}
          height={gaugeHeight}
          initial={false}
          animate={{ opacity: active ? 1 : 0 }}
          transition={{ duration: 0.3, ease: 'easeOut' }}
          className="absolute left-0 top-0 overflow-visible"
          style={{ display: 'block' }}
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
        </motion.svg>
        <div className="absolute bottom-0 flex w-full flex-col items-center">
          <span className="font-mono text-3xl font-bold leading-none" style={{ color: accent }}>
            <AnimatedNumber value={accuracy} />
            <span className="text-base">%</span>
          </span>
          {label && (
            <span className="mt-0.5 text-[9px] font-semibold uppercase tracking-wider text-muted-foreground">
              {label}
            </span>
          )}
        </div>
      </motion.div>
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
