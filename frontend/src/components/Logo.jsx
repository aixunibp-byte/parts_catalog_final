// Логотип: фирменный значок Omegation (frontend/public/logo-icon.svg, тот же
// файл, что стоит фавиконкой) + название текстом "OMEGATION" (без ".ru" и
// остального мелкого текста из полного лого-файла) шрифтом Oswald — тем же,
// что подключён в index.html и используется в остальном сайте. Без анимации.
export default function Logo({ height = 28, color = "#5B9BD5" }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: height * 0.3 }}>
      <img
        src="/logo-icon.svg"
        alt="Omegation"
        height={height}
        style={{ display: "block", width: "auto" }}
      />
      <span
        style={{
          fontFamily: '"Oswald", sans-serif',
          fontWeight: 600,
          fontSize: height * 0.72,
          color,
          lineHeight: 1,
          letterSpacing: "0.03em",
          textTransform: "uppercase",
          whiteSpace: "nowrap",
        }}
      >
        OMEGATION
      </span>
    </span>
  );
}
