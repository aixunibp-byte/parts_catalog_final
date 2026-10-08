import { Box } from "@mui/material";

// Одна "плитка" волны шириной 720 — при дублировании x2 (1440) и сдвиге
// ровно на 720px по X получается бесшовный зацикленный дрейф (тайлы
// сгенерированы синусоидой, поэтому левый и правый край плитки совпадают
// по высоте и наклону).
const TILE = 720;
const WAVE_BACK =
  "M0,140 L0,70.00 C15.00,72.33 60.00,84.00 90.00,84.00 C120.00,84.00 150.00,74.67 180.00,70.00 " +
  "C210.00,65.33 240.00,56.00 270.00,56.00 C300.00,56.00 330.00,65.33 360.00,70.00 C390.00,74.67 " +
  "420.00,84.00 450.00,84.00 C480.00,84.00 510.00,74.67 540.00,70.00 C570.00,65.33 600.00,56.00 " +
  "630.00,56.00 C660.00,56.00 705.00,67.67 720.00,70.00 L720,140 Z";
const WAVE_FRONT =
  "M0,140 L0,85.00 C10.00,86.67 40.00,95.00 60.00,95.00 C80.00,95.00 100.00,88.33 120.00,85.00 " +
  "C140.00,81.67 160.00,75.00 180.00,75.00 C200.00,75.00 220.00,81.67 240.00,85.00 C260.00,88.33 " +
  "280.00,95.00 300.00,95.00 C320.00,95.00 340.00,88.33 360.00,85.00 C380.00,81.67 400.00,75.00 " +
  "420.00,75.00 C440.00,75.00 460.00,81.67 480.00,85.00 C500.00,88.33 520.00,95.00 540.00,95.00 " +
  "C560.00,95.00 580.00,88.33 600.00,85.00 C620.00,81.67 640.00,75.00 660.00,75.00 C680.00,75.00 " +
  "710.00,83.33 720.00,85.00 L720,140 Z";

function WaveLayer({ d, opacity, duration, reverse, bottom }) {
  return (
    <Box
      sx={{
        position: "absolute",
        left: 0,
        right: 0,
        bottom,
        height: 140,
        overflow: "hidden",
        pointerEvents: "none",
      }}
    >
      <Box
        component="svg"
        viewBox={`0 0 ${TILE * 2} 140`}
        preserveAspectRatio="none"
        sx={{
          width: TILE * 2,
          height: "100%",
          display: "block",
          willChange: "transform",
          "@media (prefers-reduced-motion: no-preference)": {
            animation: `${reverse ? "wave-drift-rev" : "wave-drift"} ${duration}s linear infinite`,
          },
          "@keyframes wave-drift": {
            from: { transform: "translateX(0)" },
            to: { transform: `translateX(-${TILE}px)` },
          },
          "@keyframes wave-drift-rev": {
            from: { transform: `translateX(-${TILE}px)` },
            to: { transform: "translateX(0)" },
          },
        }}
      >
        <path d={d} fill="#FFFFFF" opacity={opacity} />
        <path d={d} fill="#FFFFFF" opacity={opacity} transform={`translate(${TILE},0)`} />
      </Box>
    </Box>
  );
}

// Декоративные волны на фоне героя — чисто ambient-текстура, лежит под
// текстом (используется с z-index ниже контента). Уважает prefers-reduced-motion.
export default function HeroWaves() {
  return (
    <Box sx={{ position: "absolute", inset: 0, overflow: "hidden", zIndex: 0 }}>
      <WaveLayer d={WAVE_BACK} opacity={0.05} duration={30} bottom={-20} />
      <WaveLayer d={WAVE_FRONT} opacity={0.08} duration={20} reverse bottom={-30} />
    </Box>
  );
}
