import { motion, useMotionValue, useSpring } from "motion/react";

// Магнитный эффект (в духе Animations/Magnet из react-bits): элемент внутри
// слегка "притягивается" к курсору, когда тот рядом, и пружинисто
// возвращается на место при уходе мыши. Оборачивает любой один элемент.
export default function Magnetic({ children, strength = 0.35 }) {
  const x = useMotionValue(0);
  const y = useMotionValue(0);
  const springX = useSpring(x, { stiffness: 200, damping: 15, mass: 0.4 });
  const springY = useSpring(y, { stiffness: 200, damping: 15, mass: 0.4 });

  function handleMove(e) {
    const rect = e.currentTarget.getBoundingClientRect();
    const relX = e.clientX - (rect.left + rect.width / 2);
    const relY = e.clientY - (rect.top + rect.height / 2);
    x.set(relX * strength);
    y.set(relY * strength);
  }

  function handleLeave() {
    x.set(0);
    y.set(0);
  }

  return (
    <motion.div
      onMouseMove={handleMove}
      onMouseLeave={handleLeave}
      style={{ x: springX, y: springY, display: "inline-block" }}
    >
      {children}
    </motion.div>
  );
}
