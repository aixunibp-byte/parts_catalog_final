import { motion } from "motion/react";

// Текстовая анимация (в духе Text Animations/BlurText из react-bits): слова
// проявляются из размытия по одному, при попадании в область видимости.
export default function BlurText({ text, delay = 0.05 }) {
  const words = text.split(" ");
  return (
    <span style={{ display: "inline" }}>
      {words.map((word, i) => (
        <motion.span
          key={`${word}-${i}`}
          initial={{ opacity: 0, filter: "blur(10px)", y: 8 }}
          whileInView={{ opacity: 1, filter: "blur(0px)", y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.5, delay: i * delay, ease: "easeOut" }}
          style={{ display: "inline-block", whiteSpace: "pre" }}
        >
          {word + (i < words.length - 1 ? " " : "")}
        </motion.span>
      ))}
    </span>
  );
}
