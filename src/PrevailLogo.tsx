import { motion, MotionConfig } from "framer-motion";

/**
 * PrevailLogo — the animated Prevail mark (ascending chevrons + guiding star).
 *
 * The mark is original artwork (public/logo.svg → logo.png): two chevrons
 * climbing toward a cyan star, in the brand gold→cyan gradient. The motion
 * suits that shape — a slow "rise": a gentle vertical float, a soft 3D tilt,
 * and a breathing glow pulse. (No spin / no winking dots — those belonged to
 * the old circular mark and were retired with it.)
 *
 * Drop-in usage:
 *   <PrevailLogo size={84} />              // animated, defaults to /logo.png
 *   <PrevailLogo size={32} animated={false} />   // static mark
 *   <PrevailLogo size={120} src="/logo-512.png" />
 *
 * Requires: react + framer-motion (^12). The logo PNG must be reachable at
 * `src` (default "/logo.png").
 */
export function PrevailLogo({
  size = 84,
  src = "/logo.png",
  animated = true,
  /** Play even when the OS "Reduce Motion" setting is on (decorative mark). */
  forceMotion = true,
}: {
  size?: number;
  src?: string;
  animated?: boolean;
  forceMotion?: boolean;
}) {
  const img = (
    <img
      src={src}
      alt="Prevail"
      width={size}
      height={size}
      style={{ width: size, height: size, display: "block" }}
      draggable={false}
    />
  );

  if (!animated) return img;

  const T = 6; // gentle loop seconds
  const float = Math.max(2, size * 0.045); // vertical travel scales with size

  const content = (
    <span
      style={{
        position: "relative",
        display: "inline-block",
        perspective: size * 6,
        width: size,
        height: size,
      }}
    >
      <motion.span
        style={{
          position: "relative",
          display: "inline-block",
          transformStyle: "preserve-3d",
          willChange: "transform, filter",
        }}
        animate={{
          y: [0, -float, 0],
          rotateX: [7, 2, 7],
          rotateY: [-5, 5, -5],
          filter: [
            "drop-shadow(0 2px 6px rgba(196,163,90,0.35))",
            "drop-shadow(0 8px 18px rgba(60,216,255,0.45))",
            "drop-shadow(0 2px 6px rgba(196,163,90,0.35))",
          ],
        }}
        transition={{ duration: T, ease: "easeInOut", repeat: Infinity }}
        whileHover={{ scale: 1.1 }}
      >
        {img}
      </motion.span>
    </span>
  );

  return forceMotion ? (
    <MotionConfig reducedMotion="never">{content}</MotionConfig>
  ) : (
    content
  );
}

export default PrevailLogo;
