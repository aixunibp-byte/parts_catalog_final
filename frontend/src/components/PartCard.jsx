import { Card, CardActionArea, CardMedia, CardContent, Typography, Chip, Stack, Box, Button, Divider, useTheme } from "@mui/material";
import { useNavigate } from "react-router-dom";
import { motion, useMotionValue, useMotionTemplate } from "motion/react";
import ShoppingCartOutlinedIcon from "@mui/icons-material/ShoppingCartOutlined";
import { getOzonUrl } from "../ozonLink";
import { getOzonDiscountPercent } from "../priceUtils";

const PLACEHOLDER_IMAGE = "/no-image.svg";

const MotionCard = motion.create(Card);
const MotionButton = motion.create(Button);

export default function PartCard({ part, index = 0 }) {
  const navigate = useNavigate();
  const theme = useTheme();
  const ozonUrl = getOzonUrl(part);
  const discountPct = getOzonDiscountPercent(part);

  // Spotlight-эффект (в духе Components/SpotlightCard из react-bits): блик
  // следует за курсором внутри карточки. Реализован через motion values —
  // без ре-рендера React на каждое движение мыши.
  const mouseX = useMotionValue(0);
  const mouseY = useMotionValue(0);
  const spotlightColor = theme.palette.mode === "dark" ? "rgba(120,174,221,0.16)" : "rgba(61,124,174,0.12)";
  const spotlightBg = useMotionTemplate`radial-gradient(240px circle at ${mouseX}px ${mouseY}px, ${spotlightColor}, transparent 78%)`;

  function handleSpotlightMove(e) {
    const rect = e.currentTarget.getBoundingClientRect();
    mouseX.set(e.clientX - rect.left);
    mouseY.set(e.clientY - rect.top);
  }

  const hoverShadow =
    theme.palette.mode === "dark"
      ? "0 22px 46px rgba(0, 0, 0, 0.42)"
      : "0 22px 46px rgba(27, 58, 92, 0.18)";

  return (
    <MotionCard
      onMouseMove={handleSpotlightMove}
      initial={{ opacity: 0, y: 20 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-60px" }}
      transition={{ type: "spring", stiffness: 300, damping: 26, delay: (index % 12) * 0.035 }}
      whileHover={{ y: -7, boxShadow: hoverShadow }}
      whileTap={{ scale: 0.985 }}
      sx={{
        position: "relative",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        borderRadius: 2.5,
        overflow: "hidden",
        "&:hover": { borderColor: "rgba(91, 155, 213, 0.45)" },
        "&:hover .spotlight-overlay": { opacity: 1 },
      }}
    >
      <motion.div
        className="spotlight-overlay"
        style={{
          position: "absolute",
          inset: 0,
          zIndex: 2,
          pointerEvents: "none",
          opacity: 0,
          transition: "opacity 280ms ease",
          background: spotlightBg,
        }}
      />
      <CardActionArea
        onClick={() => navigate(`/parts/${part.id}`)}
        sx={{ flexGrow: 1, display: "flex", flexDirection: "column", alignItems: "stretch" }}
      >
        <Box
          sx={{
            position: "relative",
            height: 205,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: (theme) =>
              theme.palette.mode === "dark"
                ? "linear-gradient(145deg, rgba(255,255,255,0.055), rgba(61,124,174,0.10))"
                : "linear-gradient(145deg, #F8FBFD, #EAF2F8)",
            borderBottom: "1px solid",
            borderColor: "divider",
          }}
        >
          <CardMedia
            component="img"
            image={part.primary_image || PLACEHOLDER_IMAGE}
            alt={part.name}
            sx={{ width: "100%", height: "100%", objectFit: "contain", p: 2.25 }}
          />
          <Chip
            size="small"
            label={part.has_stock ? "В наличии" : "Нет в наличии"}
            icon={
              <Box
                sx={{
                  width: 6,
                  height: 6,
                  borderRadius: "50%",
                  bgcolor: part.has_stock ? "success.main" : "text.disabled",
                  ml: 1,
                }}
              />
            }
            sx={{
              position: "absolute",
              top: 12,
              right: 12,
              height: 25,
              bgcolor: (theme) => (theme.palette.mode === "dark" ? "rgba(18,38,58,0.92)" : "rgba(255,255,255,0.94)"),
              boxShadow: "0 3px 10px rgba(15,39,64,0.12)",
              backdropFilter: "blur(8px)",
              fontWeight: 600,
              fontSize: "0.68rem",
              "& .MuiChip-icon": { order: 1, mr: 0.75, ml: -0.25 },
            }}
          />
        </Box>

        <CardContent sx={{ p: 2.25, flexGrow: 1, display: "flex", flexDirection: "column" }}>
          <Typography
            variant="subtitle1"
            sx={{
              fontWeight: 650,
              display: "-webkit-box",
              WebkitLineClamp: 2,
              WebkitBoxOrient: "vertical",
              overflow: "hidden",
              minHeight: "2.65em",
              lineHeight: 1.33,
              letterSpacing: "-0.01em",
            }}
            title={part.name}
          >
            {part.name}
          </Typography>

          <Typography variant="caption" color="text.secondary" sx={{ mt: 0.8, mb: 2 }}>
            Артикул · {part.article}
          </Typography>

          <Stack direction="row" spacing={1} alignItems="baseline" sx={{ mt: "auto" }} flexWrap="wrap">
            <Typography variant="h6" sx={{ fontWeight: 750, color: "primary.main", letterSpacing: "-0.02em" }}>
              {part.price != null ? `${part.price.toLocaleString("ru-RU")} ₽` : "Цена не указана"}
            </Typography>
            {part.old_price != null && part.old_price > (part.price ?? 0) && (
              <Typography variant="body2" color="text.secondary" sx={{ textDecoration: "line-through" }}>
                {part.old_price.toLocaleString("ru-RU")} ₽
              </Typography>
            )}
            {discountPct != null && (
              <Chip
                size="small"
                label={`Скидки на OZON −${discountPct}%`}
                sx={{
                  height: 22,
                  fontSize: "0.68rem",
                  fontWeight: 700,
                  bgcolor: "rgba(219, 68, 55, 0.12)",
                  color: "#C0392B",
                }}
              />
            )}
          </Stack>
        </CardContent>
      </CardActionArea>

      {ozonUrl && (
        <>
          <Divider />
          <MotionButton
            component="a"
            href={ozonUrl}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
            whileHover={{ backgroundColor: theme.palette.mode === "dark" ? "rgba(91,155,213,0.12)" : "rgba(91,155,213,0.08)" }}
            whileTap={{ scale: 0.97 }}
            startIcon={<ShoppingCartOutlinedIcon sx={{ fontSize: 18 }} />}
            sx={{
              borderRadius: 0,
              py: 1.1,
              fontWeight: 600,
              fontSize: "0.8rem",
              textTransform: "none",
              color: "primary.main",
            }}
          >
            Купить на Ozon
          </MotionButton>
        </>
      )}
    </MotionCard>
  );
}
