import { useEffect, useRef, useState } from "react";
import {
  Container, Grid, TextField, FormControlLabel, Switch, Box,
  Stack, Typography, CircularProgress, Alert, InputAdornment, Paper, Button,
} from "@mui/material";
import { motion } from "motion/react";
import SearchIcon from "@mui/icons-material/Search";
import ArrowDownwardIcon from "@mui/icons-material/ArrowDownward";
import AppHeader from "../components/AppHeader";
import PartCard from "../components/PartCard";
import HeroWaves from "../components/HeroWaves";
import Magnetic from "../components/Magnetic";
import { fetchParts, fetchSettings } from "../api";

const MotionBox = motion.create(Box);
const MotionTypography = motion.create(Typography);
const MotionButton = motion.create(Button);

const HERO_ITEM_VARIANTS = {
  hidden: { opacity: 0, y: 22 },
  visible: { opacity: 1, y: 0, transition: { type: "spring", stiffness: 260, damping: 24 } },
};

const PAGE_SIZE = 24;

// Показывается, пока не подгрузился реальный контент из /settings (и как
// аварийный fallback, если запрос не удался) — совпадает с тем, что отдаёт
// бэкенд по умолчанию, пока админ ничего не сохранил.
const DEFAULT_HERO = {
  title: "Omegation — новые стандарты качества в автокомпонентах",
  description:
    "Omegation — молодая и динамично развивающаяся компания, специализирующаяся на поставке " +
    "автозапчастей для легковых и коммерческих автомобилей. Несмотря на недавнее основание, " +
    "мы уже выстроили современную систему контроля качества и логистическую цепочку, " +
    "позволяющую предлагать рынку один из самых широких и технологичных ассортиментов " +
    "в своём сегменте.",
};

export default function CatalogPage() {
  const [items, setItems] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [inStockOnly, setInStockOnly] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState(null);
  const [hero, setHero] = useState(DEFAULT_HERO);

  const catalogSectionRef = useRef(null);

  const hasMore = items.length < total;

  const scrollToCatalog = () => {
    catalogSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  useEffect(() => {
    fetchSettings()
      .then((data) => {
        if (data?.hero) setHero(data.hero);
      })
      .catch(() => {
        // тихо остаёмся на DEFAULT_HERO — не критично для работы каталога
      });
  }, []);

  useEffect(() => {
    const timeout = setTimeout(() => {
      setSearch(searchInput);
      setPage(1);
    }, 400);
    return () => clearTimeout(timeout);
  }, [searchInput]);

  useEffect(() => {
    let cancelled = false;
    const isFirstPage = page === 1;
    if (isFirstPage) setLoading(true);
    else setLoadingMore(true);
    setError(null);

    fetchParts({ search, inStockOnly, page, pageSize: PAGE_SIZE })
      .then((data) => {
        if (cancelled) return;
        // Первая страница (в т.ч. после смены поиска/фильтра) заменяет
        // список целиком, остальные — дописываются в конец (кнопка
        // "Показать ещё" вместо постраничной навигации).
        setItems((prev) => (isFirstPage ? data.items : [...prev, ...data.items]));
        setTotal(data.total);
      })
      .catch(() => {
        if (!cancelled) setError("Не удалось загрузить каталог. Проверьте подключение к серверу.");
      })
      .finally(() => {
        if (cancelled) return;
        setLoading(false);
        setLoadingMore(false);
      });

    return () => {
      cancelled = true;
    };
  }, [search, inStockOnly, page]);

  function handleShowMore() {
    setPage((p) => p + 1);
  }

  return (
    <>
      <AppHeader />

      <Box
        sx={{
          color: "#FFFFFF",
          background:
            "radial-gradient(circle at 50% 0%, rgba(175,211,234,0.16) 0%, transparent 42%), linear-gradient(118deg, #0F2740 0%, #1B3A5C 48%, #3D7CAE 100%)",
          position: "relative",
          overflow: "hidden",
          width: "100%",
        }}
      >
        <HeroWaves />
        <Container maxWidth="md" sx={{ px: { xs: 1.5, sm: 3 } }}>
          <MotionBox
            initial="hidden"
            animate="visible"
            variants={{ visible: { transition: { staggerChildren: 0.14 } } }}
            sx={{
              position: "relative",
              zIndex: 1,
              py: { xs: 6, sm: 8, md: 10 },
              textAlign: "center",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
            }}
          >
            <MotionTypography
              component="h1"
              variants={HERO_ITEM_VARIANTS}
              sx={{
                fontFamily: '"Oswald", sans-serif',
                textTransform: "uppercase",
                color: "#FFFFFF",
                mb: 2.5,
                fontWeight: 700,
                letterSpacing: "0.01em",
                fontSize: { xs: "2.1rem", sm: "2.9rem", md: "3.4rem" },
                lineHeight: 1.1,
                maxWidth: 760,
              }}
            >
              {hero.title}
            </MotionTypography>
            <MotionTypography
              variants={HERO_ITEM_VARIANTS}
              sx={{
                color: "rgba(255,255,255,0.82)",
                mb: 4.5,
                maxWidth: 560,
                fontSize: { xs: "0.92rem", sm: "1.05rem" },
                lineHeight: 1.75,
                whiteSpace: "pre-line",
              }}
            >
              {hero.description}
            </MotionTypography>

            <Magnetic>
              <MotionButton
                variants={HERO_ITEM_VARIANTS}
                whileHover={{ scale: 1.045, backgroundColor: "rgba(255,255,255,0.92)" }}
                whileTap={{ scale: 0.96 }}
                variant="contained"
                size="large"
                onClick={scrollToCatalog}
                endIcon={<ArrowDownwardIcon />}
                sx={{
                  position: "relative",
                  overflow: "hidden",
                  bgcolor: "#FFFFFF",
                  color: "primary.main",
                  fontWeight: 700,
                  px: 4,
                  py: 1.3,
                  fontSize: "1rem",
                  borderRadius: 999,
                  boxShadow: "0 14px 32px rgba(2,12,25,0.28)",
                  "&::after": {
                    content: '""',
                    position: "absolute",
                    top: 0,
                    left: "-60%",
                    width: "35%",
                    height: "100%",
                    background: "linear-gradient(120deg, transparent, rgba(61,124,174,0.4), transparent)",
                    transform: "skewX(-20deg)",
                    "@media (prefers-reduced-motion: no-preference)": {
                      animation: "shimmer-sweep 4.5s ease-in-out infinite",
                    },
                  },
                  "@keyframes shimmer-sweep": {
                    "0%, 55%": { left: "-60%" },
                    "85%, 100%": { left: "130%" },
                  },
                }}
              >
                Перейти к каталогу
              </MotionButton>
            </Magnetic>
          </MotionBox>
        </Container>
      </Box>

      <Container maxWidth="lg" sx={{ py: { xs: 2, md: 5 }, px: { xs: 1.5, sm: 3 } }}>
        <Box ref={catalogSectionRef} sx={{ scrollMarginTop: 88 }}>
          <Paper
            elevation={0}
            sx={{
              p: { xs: 2, sm: 3 },
              mb: 3.5,
              borderRadius: { xs: 2.5, sm: 3 },
            }}
          >
            <Stack direction={{ xs: "column", sm: "row" }} spacing={2} alignItems={{ sm: "center" }}>
              <TextField
                fullWidth
                size="medium"
                placeholder="Введите артикул или название детали"
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                InputProps={{
                  startAdornment: (
                    <InputAdornment position="start">
                      <SearchIcon sx={{ fontSize: 22, color: "primary.main" }} />
                    </InputAdornment>
                  ),
                }}
              />
              <FormControlLabel
                sx={{ whiteSpace: "nowrap", mr: 0 }}
                control={
                  <Switch
                    checked={inStockOnly}
                    onChange={(e) => { setInStockOnly(e.target.checked); setPage(1); }}
                  />
                }
                label="Только в наличии"
              />
            </Stack>
          </Paper>

          {error && <Alert severity="error" sx={{ mb: 2, borderRadius: 2.5 }}>{error}</Alert>}

          {loading ? (
            <Stack alignItems="center" sx={{ py: 9 }}>
              <CircularProgress />
            </Stack>
          ) : items.length === 0 ? (
            <Alert severity="info" sx={{ borderRadius: 2.5 }}>Ничего не найдено по заданным условиям.</Alert>
          ) : (
            <>
              <Stack direction="row" justifyContent="space-between" alignItems="baseline" sx={{ mb: 2.5, px: 0.5 }}>
                <Typography variant="h6" sx={{ fontWeight: 700 }}>Запчасти</Typography>
                <Typography variant="body2" color="text.secondary">Найдено: {total}</Typography>
              </Stack>
              <Grid container spacing={{ xs: 2, sm: 2.5 }} justifyContent="center">
                {items.map((part, index) => (
                  <Grid item xs={12} sm={6} md={4} lg={3} key={part.id}>
                    <PartCard part={part} index={index} />
                  </Grid>
                ))}
              </Grid>

              {hasMore && (
                <Stack alignItems="center" sx={{ mt: 5 }}>
                  <Button
                    variant="outlined"
                    size="large"
                    onClick={handleShowMore}
                    disabled={loadingMore}
                    startIcon={loadingMore ? <CircularProgress size={16} /> : null}
                    sx={{ px: 4, borderRadius: 999, textTransform: "none" }}
                  >
                    {loadingMore ? "Загрузка…" : "Показать ещё"}
                  </Button>
                </Stack>
              )}
            </>
          )}
        </Box>
      </Container>
    </>
  );
}
