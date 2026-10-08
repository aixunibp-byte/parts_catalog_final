import { useEffect, useState } from "react";
import { Container, Typography, Stack, Paper, Box, Button, Divider } from "@mui/material";
import { useNavigate } from "react-router-dom";
import { motion } from "motion/react";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import Inventory2Icon from "@mui/icons-material/Inventory2";
import VerifiedIcon from "@mui/icons-material/Verified";
import FactoryIcon from "@mui/icons-material/Factory";
import GroupsIcon from "@mui/icons-material/Groups";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import AppHeader from "../components/AppHeader";
import BlurText from "../components/BlurText";
import { fetchSettings } from "../api";

const MotionPaper = motion.create(Paper);
const MotionBox = motion.create(Box);

// Иконки подобраны по смыслу под четыре стандартных блока (по порядку).
// Если админ добавит блок сверх этих четырёх — покажется нейтральная галочка.
const SECTION_ICONS = [Inventory2Icon, VerifiedIcon, FactoryIcon, GroupsIcon];

// Показывается, пока не подгрузился реальный контент из /settings (и как
// аварийный fallback, если запрос не удался).
const DEFAULT_ABOUT = {
  tagline: "OMEGATION: ТОЧНОСТЬ. НАДЁЖНОСТЬ. ДВИЖЕНИЕ ВПЕРЁД.",
  intro:
    "OMEGATION поставляет автозапчасти для легковых и коммерческих автомобилей. Несмотря на " +
    "молодость компании, мы уже выстроили современную логистику и строгий контроль качества — " +
    "и предлагаем один из самых широких ассортиментов в сегменте.",
  sections: [
    {
      title: "Широкий ассортимент",
      text:
        "Более тысячи наименований: двигатель и трансмиссия, подвеска и рулевое, тормозная система, " +
        "автоэлектрика, расходники. Линейку регулярно расширяем — под популярные и редкие модели.",
    },
    {
      title: "Контроль качества и стандарты",
      text:
        "Каждая партия проходит входной контроль и проверку на соответствие OEM-спецификациям — " +
        "точная геометрия и стабильный ресурс гарантированы.",
    },
    {
      title: "Отбор поставщиков",
      text:
        "Работаем только с проверенными производителями. Обязательные требования к каждому партнёру: " +
        "износостойкие сплавы, точные допуски, конструкции под реальные дорожные условия.",
    },
    {
      title: "Для бизнеса и частных клиентов",
      text:
        "Работаем с СТО, дилерами, автомагазинами и напрямую с водителями. Склад всегда полон, " +
        "отгрузка быстрая, документация и гарантия — прозрачные.",
    },
  ],
  closing:
    "Наша цель — качественные запчасти, доступные и всегда в наличии. Каждая деталь OMEGATION — " +
    "это уверенность в безопасности и долговечности вашего автомобиля.",
};

export default function AboutPage() {
  const navigate = useNavigate();
  const [about, setAbout] = useState(DEFAULT_ABOUT);

  useEffect(() => {
    fetchSettings()
      .then((data) => {
        if (data?.about) setAbout(data.about);
      })
      .catch(() => {
        // тихо остаёмся на DEFAULT_ABOUT
      });
  }, []);

  return (
    <>
      <AppHeader />
      <Container maxWidth="md" sx={{ py: { xs: 3, md: 6 }, px: { xs: 1.5, sm: 3 } }}>
        <Button
          startIcon={<ArrowBackIcon />}
          onClick={() => navigate("/")}
          sx={{ mb: 3, textTransform: "none", fontWeight: 600 }}
        >
          Назад в каталог
        </Button>

        <Paper
          elevation={0}
          sx={{
            p: { xs: 3, sm: 5, md: 6 },
            mb: 4.5,
            borderRadius: { xs: 2.5, sm: 3.5 },
            textAlign: "center",
            color: "#FFFFFF",
            background:
              "radial-gradient(circle at 12% 15%, rgba(175,211,234,0.16) 0%, transparent 32%), linear-gradient(118deg, #0F2740 0%, #1B3A5C 50%, #3D7CAE 100%)",
            boxShadow: "0 18px 42px rgba(15,39,64,0.18)",
          }}
        >
          <Typography
            variant="h3"
            sx={{
              color: "#FFFFFF",
              fontWeight: 700,
              letterSpacing: "0.02em",
              fontSize: { xs: "1.45rem", sm: "1.9rem", md: "2.25rem" },
              lineHeight: 1.28,
            }}
          >
            <BlurText text={about.tagline} />
          </Typography>
        </Paper>

        <Paper elevation={0} sx={{ p: { xs: 2.5, sm: 3.5 }, borderRadius: { xs: 2.5, sm: 3 }, mb: 3 }}>
          <Typography
            variant="body1"
            sx={{ lineHeight: 1.85, fontSize: { xs: "0.98rem", sm: "1.05rem" }, whiteSpace: "pre-line" }}
          >
            {about.intro}
          </Typography>
        </Paper>

        <MotionPaper
          elevation={0}
          initial={{ opacity: 0, y: 24 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-80px" }}
          transition={{ type: "spring", stiffness: 260, damping: 24 }}
          sx={{ p: { xs: 2.5, sm: 4 }, borderRadius: { xs: 2.5, sm: 3.5 }, mb: 3 }}
        >
          <Stack divider={<Divider sx={{ my: { xs: 2.5, sm: 3 } }} />}>
            {about.sections.map((section, index) => {
              const IconComponent = SECTION_ICONS[index] || CheckCircleIcon;
              return (
                <MotionBox
                  key={section.title}
                  initial={{ opacity: 0, x: -16 }}
                  whileInView={{ opacity: 1, x: 0 }}
                  viewport={{ once: true, margin: "-60px" }}
                  transition={{ type: "spring", stiffness: 260, damping: 24, delay: index * 0.06 }}
                  sx={{
                    display: "grid",
                    gridTemplateColumns: { xs: "48px 1fr", sm: "64px 1fr" },
                    columnGap: { xs: 2, sm: 3 },
                    alignItems: "start",
                  }}
                >
                  <Box
                    sx={{
                      width: { xs: 48, sm: 64 },
                      height: { xs: 48, sm: 64 },
                      borderRadius: 3,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      flexShrink: 0,
                      bgcolor: (theme) =>
                        theme.palette.mode === "dark" ? "rgba(91,155,213,0.14)" : "rgba(27,58,92,0.06)",
                    }}
                  >
                    <IconComponent sx={{ fontSize: { xs: 24, sm: 30 }, color: "primary.main" }} />
                  </Box>
                  <Box>
                    <Typography variant="h6" sx={{ fontWeight: 700, mb: 1, color: "primary.main" }}>
                      {section.title}
                    </Typography>
                    <Typography variant="body1" sx={{ lineHeight: 1.75, whiteSpace: "pre-line" }}>
                      {section.text}
                    </Typography>
                  </Box>
                </MotionBox>
              );
            })}
          </Stack>
        </MotionPaper>

        <Paper elevation={0} sx={{ p: { xs: 3, sm: 4 }, borderRadius: { xs: 2.5, sm: 3 }, textAlign: "center", mt: 3 }}>
          <Typography variant="body1" sx={{ lineHeight: 1.85, whiteSpace: "pre-line" }}>
            {about.closing}
          </Typography>
        </Paper>
      </Container>
    </>
  );
}
