import { useEffect, useState } from "react";
import {
  Container, Paper, Typography, TextField, Button, Stack,
  CircularProgress, Alert, Divider, Box,
} from "@mui/material";
import AppHeader from "../components/AppHeader";
import { useNavigateToLoginIfNoToken, useCurrentUser } from "../useAdminGuard";
import { fetchAdminSettings, updateSiteSettings } from "../adminApi";

const EMPTY_FORM = {
  hero: { title: "", description: "" },
  about: {
    tagline: "",
    intro: "",
    sections: [
      { title: "", text: "" },
      { title: "", text: "" },
      { title: "", text: "" },
      { title: "", text: "" },
    ],
    closing: "",
  },
  contacts: { phone: "", email: "", address: "", hours: "" },
};

export default function AdminSettingsPage() {
  useNavigateToLoginIfNoToken();
  const { can } = useCurrentUser();
  // Изменение настроек сайта целиком (шапка/о нас/контакты) — только роль
  // full, сервер (PUT /admin/settings) тоже это требует. viewer/editor видят
  // форму, но не могут её сохранить — поля задизейблены через <fieldset>.
  const canEdit = can("full");

  const [form, setForm] = useState(EMPTY_FORM);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(null);

  useEffect(() => {
    fetchAdminSettings()
      .then((data) => setForm(data))
      .catch(() => setError("Не удалось загрузить настройки сайта."))
      .finally(() => setLoading(false));
  }, []);

  function updateHero(field, value) {
    setForm((f) => ({ ...f, hero: { ...f.hero, [field]: value } }));
  }

  function updateAbout(field, value) {
    setForm((f) => ({ ...f, about: { ...f.about, [field]: value } }));
  }

  function updateSection(index, field, value) {
    setForm((f) => {
      const sections = f.about.sections.map((s, i) =>
        i === index ? { ...s, [field]: value } : s
      );
      return { ...f, about: { ...f.about, sections } };
    });
  }

  function updateContacts(field, value) {
    setForm((f) => ({ ...f, contacts: { ...f.contacts, [field]: value } }));
  }

  async function handleSave() {
    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      const updated = await updateSiteSettings(form);
      setForm(updated);
      setSuccess("Настройки сайта сохранены.");
    } catch {
      setError("Не удалось сохранить настройки. Проверьте, что все поля заполнены.");
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <>
        <AppHeader />
        <Container sx={{ py: 6, textAlign: "center" }}><CircularProgress /></Container>
      </>
    );
  }

  return (
    <>
      <AppHeader />
      <Container maxWidth="md" sx={{ py: 4 }}>
        <Typography variant="h4" gutterBottom>Настройки сайта</Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
          Текст главной страницы, страницы «О нас» и контактов в шапке сайта. Изменения
          появляются на сайте сразу после сохранения.
        </Typography>

        {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
        {success && (
          <Alert severity="success" sx={{ mb: 2 }} onClose={() => setSuccess(null)}>
            {success}
          </Alert>
        )}
        {!canEdit && (
          <Alert severity="info" sx={{ mb: 2 }}>
            Ваша роль позволяет только просматривать настройки сайта. Изменять их может
            учётная запись с полным доступом.
          </Alert>
        )}

        <Box component="fieldset" disabled={!canEdit} sx={{ border: "none", p: 0, m: 0 }}>

        {/* Главная страница */}
        <Paper variant="outlined" sx={{ p: 3, mb: 3 }}>
          <Typography variant="h6" gutterBottom>Главная страница</Typography>
          <Stack spacing={2}>
            <TextField
              label="Заголовок"
              fullWidth
              value={form.hero.title}
              onChange={(e) => updateHero("title", e.target.value)}
            />
            <TextField
              label="Описание компании"
              fullWidth
              multiline
              minRows={4}
              value={form.hero.description}
              onChange={(e) => updateHero("description", e.target.value)}
            />
          </Stack>
        </Paper>

        {/* О нас */}
        <Paper variant="outlined" sx={{ p: 3, mb: 3 }}>
          <Typography variant="h6" gutterBottom>Страница «О нас»</Typography>
          <Stack spacing={2}>
            <TextField
              label="Слоган в баннере"
              fullWidth
              value={form.about.tagline}
              onChange={(e) => updateAbout("tagline", e.target.value)}
            />
            <TextField
              label="Вводный текст"
              fullWidth
              multiline
              minRows={3}
              value={form.about.intro}
              onChange={(e) => updateAbout("intro", e.target.value)}
            />

            <Divider sx={{ my: 1 }} />
            <Typography variant="subtitle2" color="text.secondary">
              Четыре блока с карточками ниже вводного текста
            </Typography>

            {form.about.sections.map((section, i) => (
              <Box
                key={i}
                sx={{ p: 2, borderRadius: 2, border: "1px solid", borderColor: "divider" }}
              >
                <Stack spacing={1.5}>
                  <TextField
                    label={`Заголовок блока ${i + 1}`}
                    fullWidth
                    size="small"
                    value={section.title}
                    onChange={(e) => updateSection(i, "title", e.target.value)}
                  />
                  <TextField
                    label="Текст блока"
                    fullWidth
                    multiline
                    minRows={2}
                    size="small"
                    value={section.text}
                    onChange={(e) => updateSection(i, "text", e.target.value)}
                  />
                </Stack>
              </Box>
            ))}

            <Divider sx={{ my: 1 }} />
            <TextField
              label="Заключительный текст"
              fullWidth
              multiline
              minRows={2}
              value={form.about.closing}
              onChange={(e) => updateAbout("closing", e.target.value)}
            />
          </Stack>
        </Paper>

        {/* Контакты */}
        <Paper variant="outlined" sx={{ p: 3, mb: 3 }}>
          <Typography variant="h6" gutterBottom>Контакты (окно в шапке сайта)</Typography>
          <Stack spacing={2}>
            <TextField
              label="Телефон"
              fullWidth
              value={form.contacts.phone}
              onChange={(e) => updateContacts("phone", e.target.value)}
            />
            <TextField
              label="Email"
              fullWidth
              value={form.contacts.email}
              onChange={(e) => updateContacts("email", e.target.value)}
            />
            <TextField
              label="Адрес"
              fullWidth
              value={form.contacts.address}
              onChange={(e) => updateContacts("address", e.target.value)}
            />
            <TextField
              label="Режим работы"
              fullWidth
              value={form.contacts.hours}
              onChange={(e) => updateContacts("hours", e.target.value)}
            />
          </Stack>
        </Paper>

        <Button variant="contained" size="large" onClick={handleSave} disabled={saving || !canEdit}>
          {saving ? "Сохранение..." : "Сохранить всё"}
        </Button>

        </Box>
      </Container>
    </>
  );
}
