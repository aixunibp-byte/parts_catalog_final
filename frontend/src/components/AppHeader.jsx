import {
  AppBar, Toolbar, Box, Button, Stack, IconButton, Container,
  Dialog, DialogTitle, DialogContent, IconButton as MuiIconButton,
  List, ListItem, ListItemIcon, ListItemText, Typography, Divider,
  Menu, MenuItem,
} from "@mui/material";
import { useNavigate, useLocation } from "react-router-dom";
import { useEffect, useState } from "react";
import MenuIcon from "@mui/icons-material/Menu";
import LightModeIcon from "@mui/icons-material/LightMode";
import DarkModeIcon from "@mui/icons-material/DarkMode";
import CloseIcon from "@mui/icons-material/Close";
import LogoutIcon from "@mui/icons-material/Logout";
import PhoneIcon from "@mui/icons-material/Phone";
import EmailIcon from "@mui/icons-material/Email";
import LocationOnIcon from "@mui/icons-material/LocationOn";
import AccessTimeIcon from "@mui/icons-material/AccessTime";
import Logo from "./Logo";
import { useThemeMode } from "../ThemeModeContext";
import { fetchSettings } from "../api";
import { getAdminToken, getCachedAdminUser, fetchMe, logout, hasRole } from "../adminApi";
import { adminPath, isAdminPathname } from "../adminPaths";

// Показывается, пока не подгрузились реальные контакты из /settings (и как
// аварийный fallback, если запрос не удался).
const DEFAULT_CONTACTS = {
  phone: "+7 (000) 000-00-00",
  email: "info@omegation.ru",
  address: "г. Москва, ул. Примерная, д. 1",
  hours: "Пн–Пт: 9:00–18:00",
};

function ContactsDialog({ open, onClose, contacts }) {
  const rows = [
    { icon: PhoneIcon, label: "Телефон", value: contacts.phone },
    { icon: EmailIcon, label: "Email", value: contacts.email },
    { icon: LocationOnIcon, label: "Адрес", value: contacts.address },
    { icon: AccessTimeIcon, label: "Режим работы", value: contacts.hours },
  ].filter((row) => row.value);

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="xs">
      <DialogTitle sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", pr: 1 }}>
        Контакты
        <MuiIconButton onClick={onClose} size="small">
          <CloseIcon fontSize="small" />
        </MuiIconButton>
      </DialogTitle>
      <DialogContent sx={{ pb: 3 }}>
        <List disablePadding>
          {rows.map((item) => (
            <ListItem key={item.label} disableGutters sx={{ py: 1.25 }}>
              <ListItemIcon sx={{ minWidth: 42, color: "primary.main" }}>
                <item.icon />
              </ListItemIcon>
              <ListItemText
                primary={item.label}
                secondary={item.value}
                primaryTypographyProps={{ variant: "caption", color: "text.secondary" }}
                secondaryTypographyProps={{ variant: "body1", sx: { fontWeight: 600, color: "text.primary" } }}
              />
            </ListItem>
          ))}
        </List>
        <Divider sx={{ my: 1.5 }} />
        <Typography variant="caption" color="text.secondary">
          Свяжитесь с нами любым удобным способом — ответим в течение рабочего дня.
        </Typography>
      </DialogContent>
    </Dialog>
  );
}

const NAV_LINKS = [
  { label: "О нас", path: "/about", type: "page" },
  { label: "Контакты", type: "modal" },
];

// Пути — относительные части секретного адреса /console/<uid>; полный путь
// собирается при отрисовке через adminPath().
const ADMIN_NAV_LINKS = [
  { label: "Товары", sub: "/parts" },
  { label: "Синхронизация", sub: "/sync" },
  { label: "Настройки сайта", sub: "/settings" },
  // Виден только роли full — фильтруется ниже по user.role
  { label: "Пользователи", sub: "/users", minRole: "full" },
];

export default function AppHeader() {
  const navigate = useNavigate();
  const location = useLocation();
  const { mode, toggleMode } = useThemeMode();
  const isAdmin = isAdminPathname(location.pathname);
  const isAdminLoggedIn = isAdmin && !location.pathname.endsWith("/login");
  const [contactsOpen, setContactsOpen] = useState(false);
  const [contacts, setContacts] = useState(DEFAULT_CONTACTS);
  const [adminUser, setAdminUser] = useState(() => getCachedAdminUser());
  const [menuAnchor, setMenuAnchor] = useState(null);

  useEffect(() => {
    fetchSettings()
      .then((data) => {
        if (data?.contacts) setContacts(data.contacts);
      })
      .catch(() => {
        // тихо остаёмся на DEFAULT_CONTACTS
      });
  }, []);

  // Подгружаем текущего пользователя для шапки (имя, роль, кнопка выхода) —
  // только в разделах админки и только если есть сессия. Не критично, если
  // не успеет загрузиться: остальные страницы сами уводят на /admin/login.
  useEffect(() => {
    if (!isAdminLoggedIn || !getAdminToken()) return;
    let cancelled = false;
    fetchMe()
      .then((data) => {
        if (!cancelled) setAdminUser(data);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [isAdminLoggedIn]);

  async function handleLogout() {
    await logout();
    navigate(adminPath("/login"), { replace: true });
  }

  // В админке пунктов навигации много (Товары/Синхронизация/Настройки/
  // Пользователи) и вместе с бейджем пользователя и кнопками они не влезали
  // в одну строку справа — наезжали на логотип по центру. Убрали это в
  // выпадающее меню слева, справа остаются только компактные иконки
  // (тема/выход), которые всегда помещаются.
  const navLinks = (isAdmin
    ? (isAdminLoggedIn ? ADMIN_NAV_LINKS.map((l) => ({ ...l, path: adminPath(l.sub) })) : [])
    : NAV_LINKS)
    .filter((link) => !link.minRole || hasRole(adminUser, link.minRole));

  function handleNavClick(link) {
    setMenuAnchor(null);
    if (link.type === "modal") setContactsOpen(true);
    else navigate(link.path);
  }

  return (
    <AppBar position="sticky" elevation={0}>
      <Container maxWidth="lg" disableGutters>
        <Toolbar
          sx={{
            minHeight: { xs: 58, sm: 66 },
            px: { xs: 1.5, sm: 3 },
            display: "grid",
            gridTemplateColumns: "1fr auto 1fr",
            alignItems: "center",
          }}
        >
          <Box sx={{ display: "flex", alignItems: "center" }}>
            {navLinks.length > 0 && (
              <>
                <IconButton
                  onClick={(e) => setMenuAnchor(e.currentTarget)}
                  color="inherit"
                  size="small"
                  aria-label="Меню"
                  sx={{
                    border: "1px solid rgba(255,255,255,0.18)",
                    width: 34,
                    height: 34,
                    "&:hover": { bgcolor: "rgba(255,255,255,0.12)" },
                  }}
                >
                  <MenuIcon sx={{ fontSize: 19 }} />
                </IconButton>
                <Menu
                  anchorEl={menuAnchor}
                  open={!!menuAnchor}
                  onClose={() => setMenuAnchor(null)}
                >
                  {navLinks.map((link) => (
                    <MenuItem key={link.label} onClick={() => handleNavClick(link)}>
                      {link.label}
                    </MenuItem>
                  ))}
                </Menu>
              </>
            )}
          </Box>

          <Box
            sx={{
              cursor: isAdmin ? "default" : "pointer",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              py: 0.5,
            }}
            onClick={() => !isAdmin && navigate("/")}
          >
            <Logo height={28} color="#FFFFFF" />
          </Box>

          <Stack
            direction="row"
            spacing={{ xs: 0, sm: 0.5 }}
            alignItems="center"
            justifyContent="flex-end"
            sx={{ minWidth: 0 }}
          >
            {isAdminLoggedIn && adminUser && (
              <Typography
                variant="caption"
                sx={{
                  color: "rgba(255,255,255,0.6)",
                  display: { xs: "none", md: "inline" },
                  mx: 0.75,
                  whiteSpace: "nowrap",
                }}
              >
                {adminUser.username} · {adminUser.role}
              </Typography>
            )}
            {isAdminLoggedIn && (
              <IconButton
                onClick={handleLogout}
                color="inherit"
                size="small"
                aria-label="Выйти"
                title="Выйти"
                sx={{
                  ml: { xs: 0.15, sm: 0.5 },
                  border: "1px solid rgba(255,255,255,0.18)",
                  width: 30,
                  height: 30,
                  "&:hover": { bgcolor: "rgba(255,255,255,0.12)" },
                }}
              >
                <LogoutIcon sx={{ fontSize: 16 }} />
              </IconButton>
            )}
            <IconButton
              onClick={toggleMode}
              color="inherit"
              size="small"
              aria-label="Переключить тему"
              sx={{
                ml: { xs: 0.15, sm: 0.5 },
                border: "1px solid rgba(255,255,255,0.18)",
                width: 30,
                height: 30,
                "&:hover": { bgcolor: "rgba(255,255,255,0.12)" },
              }}
            >
              {mode === "dark" ? <LightModeIcon sx={{ fontSize: 16 }} /> : <DarkModeIcon sx={{ fontSize: 16 }} />}
            </IconButton>
          </Stack>
        </Toolbar>
      </Container>

      <ContactsDialog open={contactsOpen} onClose={() => setContactsOpen(false)} contacts={contacts} />
    </AppBar>
  );
}
