import { useEffect, useState } from "react";
import {
  Container, Paper, Typography, TextField, Button, Stack,
  CircularProgress, Alert, Box, Table, TableHead, TableRow,
  TableCell, TableBody, Select, MenuItem, Switch, FormControlLabel,
  Dialog, DialogTitle, DialogContent, DialogActions, Chip,
} from "@mui/material";
import AppHeader from "../components/AppHeader";
import { useNavigateToLoginIfNoToken, useCurrentUser } from "../useAdminGuard";
import { fetchUsers, createUser, updateUser } from "../adminApi";

const ROLES = [
  { value: "viewer", label: "Просмотр" },
  { value: "editor", label: "Редактирование карточек" },
  { value: "full", label: "Полный доступ" },
];

const ROLE_LABEL = Object.fromEntries(ROLES.map((r) => [r.value, r.label]));

function CreateUserForm({ onCreated }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState("viewer");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  async function handleSubmit(e) {
    e.preventDefault();
    setError(null);
    setSaving(true);
    try {
      await createUser({ username: username.trim(), password, role });
      setUsername("");
      setPassword("");
      setRole("viewer");
      onCreated();
    } catch (err) {
      setError(
        err.response?.status === 409
          ? "Пользователь с таким логином уже существует."
          : err.response?.data?.detail || "Не удалось создать пользователя."
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <Paper variant="outlined" sx={{ p: 3, mb: 3 }}>
      <Typography variant="subtitle1" gutterBottom>Новый пользователь</Typography>
      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
      <form onSubmit={handleSubmit}>
        <Stack direction={{ xs: "column", sm: "row" }} spacing={2} alignItems={{ sm: "center" }}>
          <TextField
            label="Логин"
            size="small"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            required
          />
          <TextField
            label="Пароль (мин. 8 символов)"
            type="password"
            size="small"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
          <Select size="small" value={role} onChange={(e) => setRole(e.target.value)}>
            {ROLES.map((r) => (
              <MenuItem key={r.value} value={r.value}>{r.label}</MenuItem>
            ))}
          </Select>
          <Button type="submit" variant="contained" disabled={saving || !username || password.length < 8}>
            {saving ? "Создание..." : "Создать"}
          </Button>
        </Stack>
      </form>
    </Paper>
  );
}

function EditUserDialog({ user, currentUserId, onClose, onSaved }) {
  const [role, setRole] = useState(user.role);
  const [isActive, setIsActive] = useState(user.is_active);
  const [password, setPassword] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  const isSelf = user.id === currentUserId;

  async function handleSave() {
    setError(null);
    setSaving(true);
    try {
      const payload = { role, is_active: isActive };
      if (password) payload.password = password;
      await updateUser(user.id, payload);
      onSaved();
    } catch (err) {
      setError(err.response?.data?.detail || "Не удалось сохранить изменения.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="xs">
      <DialogTitle>Пользователь «{user.username}»</DialogTitle>
      <DialogContent>
        {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
        {isSelf && (
          <Alert severity="info" sx={{ mb: 2 }}>
            Это ваша учётная запись: нельзя отключить себя или понизить роль с «Полный доступ».
          </Alert>
        )}
        <Stack spacing={2} sx={{ mt: 1 }}>
          <Select value={role} onChange={(e) => setRole(e.target.value)} size="small">
            {ROLES.map((r) => (
              <MenuItem key={r.value} value={r.value}>{r.label}</MenuItem>
            ))}
          </Select>
          <FormControlLabel
            control={
              <Switch
                checked={isActive}
                onChange={(e) => setIsActive(e.target.checked)}
                disabled={isSelf}
              />
            }
            label={isActive ? "Активен" : "Отключён"}
          />
          <TextField
            label="Новый пароль (оставьте пустым, чтобы не менять)"
            type="password"
            size="small"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            helperText="Минимум 8 символов"
          />
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Отмена</Button>
        <Button
          variant="contained"
          onClick={handleSave}
          disabled={saving || (password && password.length < 8)}
        >
          {saving ? "Сохранение..." : "Сохранить"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

export default function AdminUsersPage() {
  useNavigateToLoginIfNoToken();
  const { user: currentUser, loading: meLoading, can } = useCurrentUser();

  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [editingUser, setEditingUser] = useState(null);

  function reload() {
    setLoading(true);
    fetchUsers()
      .then(setUsers)
      .catch(() => setError("Не удалось загрузить список пользователей."))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    // Ждём, пока подтвердится собственная роль — раздел только для full.
    if (!meLoading) reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [meLoading]);

  if (meLoading) {
    return (
      <>
        <AppHeader />
        <Container sx={{ py: 6, textAlign: "center" }}><CircularProgress /></Container>
      </>
    );
  }

  if (!can("full")) {
    return (
      <>
        <AppHeader />
        <Container sx={{ py: 6 }}>
          <Alert severity="warning">
            Раздел «Пользователи» доступен только учётным записям с полным доступом.
          </Alert>
        </Container>
      </>
    );
  }

  return (
    <>
      <AppHeader />
      <Container maxWidth="md" sx={{ py: 4 }}>
        <Typography variant="h5" gutterBottom>Пользователи</Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
          Учётные записи админ-панели и их роли: просмотр, редактирование карточек товаров,
          полный доступ (настройки сайта, синхронизация, пользователи).
        </Typography>

        <CreateUserForm onCreated={reload} />

        {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

        <Paper variant="outlined">
          {loading ? (
            <Box sx={{ p: 4, textAlign: "center" }}><CircularProgress size={24} /></Box>
          ) : (
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Логин</TableCell>
                  <TableCell>Роль</TableCell>
                  <TableCell>Статус</TableCell>
                  <TableCell>Последний вход</TableCell>
                  <TableCell align="right">Действия</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {users.map((u) => (
                  <TableRow key={u.id} hover>
                    <TableCell>
                      {u.username}
                      {u.id === currentUser?.id && (
                        <Chip label="вы" size="small" sx={{ ml: 1 }} />
                      )}
                    </TableCell>
                    <TableCell>{ROLE_LABEL[u.role] || u.role}</TableCell>
                    <TableCell>
                      <Chip
                        label={u.is_active ? "Активен" : "Отключён"}
                        color={u.is_active ? "success" : "default"}
                        size="small"
                        variant="outlined"
                      />
                    </TableCell>
                    <TableCell>
                      {u.last_login_at ? new Date(u.last_login_at).toLocaleString("ru-RU") : "никогда"}
                    </TableCell>
                    <TableCell align="right">
                      <Button size="small" onClick={() => setEditingUser(u)}>Изменить</Button>
                    </TableCell>
                  </TableRow>
                ))}
                {users.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={5} align="center">
                      <Typography variant="body2" color="text.secondary" sx={{ py: 2 }}>
                        Пользователей пока нет.
                      </Typography>
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          )}
        </Paper>
      </Container>

      {editingUser && (
        <EditUserDialog
          user={editingUser}
          currentUserId={currentUser?.id}
          onClose={() => setEditingUser(null)}
          onSaved={() => {
            setEditingUser(null);
            reload();
          }}
        />
      )}
    </>
  );
}
