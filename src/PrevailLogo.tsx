import { motion, MotionConfig } from "framer-motion";

/**
 * PrevailLogo — the animated 3D Prevail mark.
 *
 * Choreographed loop (~28s): spin CW → settle TILTED → gold dot winks →
 * rotate to HORIZONTAL → cyan dot winks → spin CW → settle HORIZONTAL →
 * BOTH dots blink → 3D axis swivel → repeat.
 *
 * The eyelids live in SCREEN space (not children of the rotating mark) so a
 * blink always closes top→down like a real eyelid regardless of orientation.
 * Dot positions/size were measured from the logo pixels:
 *   tilted (home):  gold 55.5%/39%   cyan 43.7%/59%   (r≈7%)
 *   horizontal:     gold 62.3%/49.3% cyan 39.1%/49%   (mark rotated +60°)
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

  const T = 28; // full sequence seconds
  const EYE = size * 0.16; // ~dot diameter (14%) + a hair of margin

  const Lid = ({
    left,
    top,
    times,
    scaleY,
  }: {
    left: string;
    top: string;
    times: number[];
    scaleY: number[];
  }) => (
    <motion.span
      aria-hidden
      style={{
        position: "absolute",
        left,
        top,
        width: EYE,
        height: EYE,
        marginLeft: -EYE / 2,
        marginTop: -EYE / 2,
        borderRadius: "9999px",
        background: "#141416", // matches the logo's dark face around the dots
        transformOrigin: "center top",
        zIndex: 10,
      }}
      animate={{ scaleY }}
      transition={{ duration: T, ease: "easeInOut", times, repeat: Infinity }}
    />
  );

  const content = (
    <span
      style={{
        position: "relative",
        display: "inline-block",
        perspective: size * 5,
        width: size,
        height: size,
      }}
    >
      <motion.span
        style={{
          position: "relative",
          display: "inline-block",
          transformStyle: "preserve-3d",
          filter: "drop-shadow(0 2px 8px rgba(196,163,90,0.55))",
        }}
        animate={{
          rotateZ: [0, 360, 360, 420, 420, 780, 780, 720, 720, 720],
          rotateY: [0, 0, 0, 0, 0, 0, 0, 0, 45, 0],
          rotateX: [6, 0, 0, 0, 0, 0, 0, 0, 8, 6],
        }}
        transition={{
          duration: T,
          ease: "easeInOut",
          times: [0, 0.15, 0.22, 0.33, 0.42, 0.55, 0.64, 0.72, 0.86, 1],
          repeat: Infinity,
        }}
        whileHover={{ scale: 1.12 }}
      >
        {img}
      </motion.span>

      {/* GOLD @ tilted home — single wink (~0.20) */}
      <Lid left="55.5%" top="39%" times={[0, 0.18, 0.2, 0.22, 1]} scaleY={[0, 0, 1, 0, 0]} />
      {/* CYAN @ horizontal — single wink (~0.40) + both-blink (~0.62) */}
      <Lid
        left="39.1%"
        top="49%"
        times={[0, 0.38, 0.4, 0.42, 0.6, 0.62, 0.64, 1]}
        scaleY={[0, 0, 1, 0, 0, 1, 0, 0]}
      />
      {/* GOLD @ horizontal — both-blink (~0.62) */}
      <Lid left="62.3%" top="49.3%" times={[0, 0.6, 0.62, 0.64, 1]} scaleY={[0, 0, 1, 0, 0]} />
    </span>
  );

  return forceMotion ? (
    <MotionConfig reducedMotion="never">{content}</MotionConfig>
  ) : (
    content
  );
}

export default PrevailLogo;
