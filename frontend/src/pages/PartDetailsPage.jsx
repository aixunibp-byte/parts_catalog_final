import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { motion } from "motion/react";
import {
  Container, Grid, Typography, Chip, Stack, Divider, Button,
  CircularProgress, Alert, Paper, Box,
} from "@mui/material";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import ShoppingCartOutlinedIcon from "@mui/icons-material/ShoppingCartOutlined";
import ZoomInIcon from "@mui/icons-material/ZoomIn";
import AppHeader from "../components/AppHeader";
import ImageZoomDialog from "../components/ImageZoomDialog";
import { fetchPart } from "../api";
import { getOzonUrl } from "../ozonLink";
import { getOzonDiscountPercent } from "../priceUtils";

const PLACEHOLDER_IMAGE = "/no-image.svg";
const MotionButton = motion.create(Button);

// Человеко-читаемые подписи для известных атрибутов Ozon (см. BRAND_ATTRIBUTE_ID
// и ARTICLE_ATTRIBUTE_ID в app/main.py). Остальные атрибуты показываем как есть.
const ATTRIBUTE_LABELS = {
  85: "Бренд",
  9048: "Артикул",
};

export default function PartDetailsPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [part, setPart] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [activeImage, setActiveImage] = useState(null);
  const [zoomOpen, setZoomOpen] = useState(false);

  useEffect(() => {
    setLoading(true);
    fetchPart(id)
      .then((data) => {
        setPart(data);
        setActiveImage(data.primary_image || data.images?.[0]?.url || null);
      })
      .catch(() => setError("Не удалось загрузить карточку товара."))
      .finally(() => setLoading(false));
  }, [id]);

  if (loading) {
    return (
      <>
        <AppHeader />
        <Container sx={{ py: 6, textAlign: "center" }}>
          <CircularProgress />
        </Container>
      </>
    );
  }

  if (error || !part) {
    return (
      <>
        <AppHeader />
        <Container sx={{ py: 6 }}>
          <Alert severity="error" sx={{ borderRadius: 3 }}>{error || "Товар не найден."}</Alert>
          <Button startIcon={<ArrowBackIcon />} onClick={() => navigate("/")} sx={{ mt: 2 }}>
            Назад в каталог
          </Button>
        </Container>
      </>
    );
  }

  const totalStock = part.stocks.reduce((sum, s) => sum + (s.present - s.reserved), 0);
  // Фото для просмотра с зумом: вся галерея, а если её нет — хотя бы главное фото.
  const zoomImages = part.images.length
    ? part.images
    : activeImage
    ? [{ url: activeImage }]
    : [];
  const zoomIndex = Math.max(0, zoomImages.findIndex((img) => img.url === activeImage));
  const canZoom = zoomImages.length > 0 && !!activeImage;
  const ozonUrl = getOzonUrl(part);
  const discountPct = getOzonDiscountPercent(part);

  return (
    <>
      <AppHeader />
      <Container maxWidth="lg" sx={{ py: { xs: 2, md: 5 }, px: { xs: 1.5, sm: 3 } }}>
        <Button
          startIcon={<ArrowBackIcon />}
          onClick={() => navigate("/")}
          sx={{ mb: 3, textTransform: "none", fontWeight: 500 }}
        >
          Назад в каталог
        </Button>

        <Grid container spacing={5}>
          <Grid item xs={12} md={5}>
            <Paper
              elevation={0}
              onClick={canZoom ? () => setZoomOpen(true) : undefined}
              sx={{
                p: 3,
                position: "relative",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                height: 420,
                borderRadius: 4,
                cursor: canZoom ? "zoom-in" : "default",
                bgcolor: (theme) => (theme.palette.mode === "dark" ? "rgba(255,255,255,0.03)" : "#F3F7FB"),
              }}
            >
              <img
                src={activeImage || PLACEHOLDER_IMAGE}
                alt={part.name}
                style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain" }}
              />
              {canZoom && (
                <Chip
                  size="small"
                  icon={<ZoomInIcon />}
                  label="Увеличить"
                  sx={{
                    position: "absolute",
                    right: 12,
                    bottom: 12,
                    fontWeight: 500,
                    pointerEvents: "none",
                    bgcolor: (theme) => (theme.palette.mode === "dark" ? "rgba(255,255,255,0.1)" : "rgba(255,255,255,0.9)"),
                  }}
                />
              )}
            </Paper>

            {part.images.length > 1 && (
              <Stack direction="row" spacing={1.5} sx={{ mt: 2, overflowX: "auto", pb: 1 }}>
                {part.images.map((img) => (
                  <Box
                    key={img.uid || img.url}
                    onClick={() => setActiveImage(img.url)}
                    sx={{
                      p: 0.5,
                      cursor: "pointer",
                      flexShrink: 0,
                      borderRadius: 2,
                      border: "2px solid",
                      borderColor: img.url === activeImage ? "primary.main" : "transparent",
                      bgcolor: (theme) => (theme.palette.mode === "dark" ? "rgba(255,255,255,0.03)" : "#F3F7FB"),
                    }}
                  >
                    <img src={img.url} alt="" width={64} height={64} style={{ objectFit: "contain", borderRadius: 6 }} />
                  </Box>
                ))}
              </Stack>
            )}
          </Grid>

          <Grid item xs={12} md={7}>
            <Typography variant="h4" sx={{ fontWeight: 700, letterSpacing: "-0.01em", mb: 2 }}>
              {part.name}
            </Typography>

            <Stack direction="row" spacing={1} sx={{ mb: 3 }} flexWrap="wrap">
              {part.brand && <Chip label={part.brand} sx={{ fontWeight: 500 }} />}
              <Chip
                label={totalStock > 0 ? `В наличии: ${totalStock} шт.` : "Нет в наличии"}
                color={totalStock > 0 ? "success" : "default"}
                sx={{ fontWeight: 500 }}
              />
            </Stack>

            <Stack direction="row" spacing={2} alignItems="baseline" sx={{ mb: 1 }} flexWrap="wrap">
              <Typography variant="h3" sx={{ fontWeight: 700, color: "primary.main", fontSize: { xs: "1.8rem", sm: "2.4rem" } }}>
                {part.price != null ? `${part.price.toLocaleString("ru-RU")} ₽` : "Цена не указана"}
              </Typography>
              {part.old_price != null && part.old_price > (part.price ?? 0) && (
                <Typography
                  variant="h6"
                  color="text.secondary"
                  sx={{ textDecoration: "line-through", fontWeight: 400 }}
                >
                  {part.old_price.toLocaleString("ru-RU")} ₽
                </Typography>
              )}
              {discountPct != null && (
                <Chip
                  size="small"
                  label={`Скидки на OZON −${discountPct}%`}
                  sx={{
                    fontWeight: 700,
                    bgcolor: "rgba(219, 68, 55, 0.12)",
                    color: "#C0392B",
                  }}
                />
              )}
            </Stack>
            {discountPct != null && (
              <Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 1 }}>
                Цена на Ozon может отличаться от указанной здесь — актуальную стоимость со скидкой
                смотрите на самой площадке.
              </Typography>
            )}

            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
              Артикул: {part.article}
              {part.barcode && ` · штрихкод: ${part.barcode}`}
            </Typography>

            {ozonUrl && (
              <MotionButton
                component="a"
                href={ozonUrl}
                target="_blank"
                rel="noopener noreferrer"
                whileHover={{ scale: 1.035 }}
                whileTap={{ scale: 0.96 }}
                variant="contained"
                size="large"
                startIcon={<ShoppingCartOutlinedIcon />}
                sx={{
                  mb: 1,
                  borderRadius: 999,
                  fontWeight: 700,
                  textTransform: "none",
                  px: 3.5,
                  py: 1.15,
                }}
              >
                Купить на Ozon
              </MotionButton>
            )}

            {part.description && (
              <>
                <Divider sx={{ my: 3 }} />
                <Typography variant="body1" sx={{ whiteSpace: "pre-line", lineHeight: 1.7 }}>
                  {part.description}
                </Typography>
              </>
            )}

            {part.attributes.length > 0 && (
              <>
                <Divider sx={{ my: 3 }} />
                <Typography variant="h6" sx={{ fontWeight: 600, mb: 2 }}>Характеристики</Typography>
                <Grid container spacing={1.5}>
                  {part.attributes.map((attr) => (
                    <Grid item xs={12} sm={6} key={attr.id}>
                      <Paper
                        elevation={0}
                        sx={{
                          p: 1.5,
                          borderRadius: 3,
                          bgcolor: (theme) => (theme.palette.mode === "dark" ? "rgba(255,255,255,0.03)" : "#F3F7FB"),
                        }}
                      >
                        <Typography variant="caption" color="text.secondary" display="block">
                          {ATTRIBUTE_LABELS[attr.id] || `Атрибут #${attr.id}`}
                        </Typography>
                        <Typography variant="body2" sx={{ fontWeight: 500 }}>{attr.value}</Typography>
                      </Paper>
                    </Grid>
                  ))}
                </Grid>
              </>
            )}

            {(part.dimensions.width || part.weight) && (
              <>
                <Divider sx={{ my: 3 }} />
                <Typography variant="h6" sx={{ fontWeight: 600, mb: 2 }}>Габариты и вес</Typography>
                <Grid container spacing={1.5}>
                  {part.dimensions.width && (
                    <Grid item xs={12} sm={6}>
                      <Paper
                        elevation={0}
                        sx={{
                          p: 1.5,
                          borderRadius: 3,
                          bgcolor: (theme) => (theme.palette.mode === "dark" ? "rgba(255,255,255,0.03)" : "#F3F7FB"),
                        }}
                      >
                        <Typography variant="caption" color="text.secondary" display="block">Размеры</Typography>
                        <Typography variant="body2" sx={{ fontWeight: 500 }}>
                          {part.dimensions.depth}×{part.dimensions.width}×{part.dimensions.height} {part.dimensions.unit}
                        </Typography>
                      </Paper>
                    </Grid>
                  )}
                  {part.weight && (
                    <Grid item xs={12} sm={6}>
                      <Paper
                        elevation={0}
                        sx={{
                          p: 1.5,
                          borderRadius: 3,
                          bgcolor: (theme) => (theme.palette.mode === "dark" ? "rgba(255,255,255,0.03)" : "#F3F7FB"),
                        }}
                      >
                        <Typography variant="caption" color="text.secondary" display="block">Вес</Typography>
                        <Typography variant="body2" sx={{ fontWeight: 500 }}>{part.weight} {part.weight_unit}</Typography>
                      </Paper>
                    </Grid>
                  )}
                </Grid>
              </>
            )}
          </Grid>
        </Grid>
      </Container>

      <ImageZoomDialog
        open={zoomOpen}
        onClose={() => setZoomOpen(false)}
        images={zoomImages}
        index={zoomIndex}
        onIndexChange={(i) => setActiveImage(zoomImages[i]?.url || null)}
        alt={part.name}
      />
    </>
  );
}
