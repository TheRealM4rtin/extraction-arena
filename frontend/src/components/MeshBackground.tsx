import { motion } from 'framer-motion';

/** Slow-moving dark aurora background (purple/blue/cyan at low opacity). */
export function MeshBackground() {
  return (
    <div className="pointer-events-none fixed inset-0 -z-10 overflow-hidden bg-background">
      <motion.div
        className="absolute -left-40 -top-40 h-[40rem] w-[40rem] rounded-full blur-[120px]"
        style={{ background: 'radial-gradient(circle, var(--mesh-violet), transparent 70%)' }}
        animate={{ x: [0, 80, 0], y: [0, 60, 0] }}
        transition={{ duration: 18, repeat: Infinity, ease: 'easeInOut' }}
      />
      <motion.div
        className="absolute -right-40 top-1/4 h-[36rem] w-[36rem] rounded-full blur-[120px]"
        style={{ background: 'radial-gradient(circle, var(--mesh-cyan), transparent 70%)' }}
        animate={{ x: [0, -60, 0], y: [0, 80, 0] }}
        transition={{ duration: 22, repeat: Infinity, ease: 'easeInOut' }}
      />
      <motion.div
        className="absolute bottom-0 left-1/3 h-[34rem] w-[34rem] rounded-full blur-[120px]"
        style={{ background: 'radial-gradient(circle, var(--mesh-emerald), transparent 70%)' }}
        animate={{ x: [0, 40, 0], y: [0, -50, 0] }}
        transition={{ duration: 20, repeat: Infinity, ease: 'easeInOut' }}
      />
      {/* Subtle grid overlay */}
      <div
        className="absolute inset-0 opacity-[0.035]"
        style={{
          backgroundImage:
            'linear-gradient(to right, var(--mesh-grid) 1px, transparent 1px), linear-gradient(to bottom, var(--mesh-grid) 1px, transparent 1px)',
          backgroundSize: '48px 48px',
        }}
      />
    </div>
  );
}
