import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Container, Paper, TextField, Button, Typography, Alert, Box } from "@mui/material";
import Logo from "../components/Logo";
import { login } from "../adminApi";
import { adminPath } from "../adminPaths";

export default function AdminLoginPage() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  async function handleSubmit(e) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await login(username.trim(), password);
      navigate(adminPath("/parts"));
    } catch (err) {
      setError(
        err.response?.status === 401
          ? "Неверный логин или пароль."
          : err.response?.status === 429
          ? err.response?.data?.detail || "Слишком много попыток входа. Подождите и повторите."
          : err.response?.status === 403
          ? "Учётная запись отключена."
          : "Не удалось войти. Попробуйте ещё раз."
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <Container maxWidth="xs" sx={{ display: "flex", alignItems: "center", minHeight: "100vh" }}>
      <Paper elevation={2} sx={{ p: 4, width: "100%" }}>
        <Box sx={{ display: "flex", justifyContent: "center", mb: 3 }}>
          <Logo height={32} color="#5B9BD5" />
        </Box>
        <Typography variant="h6" align="center" gutterBottom>
          Вход в админ-панель
        </Typography>

        {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

        <form onSubmit={handleSubmit}>
          <TextField
            fullWidth
            label="Логин"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            sx={{ mb: 2 }}
            autoFocus
            autoComplete="username"
          />
          <TextField
            fullWidth
            type="password"
            label="Пароль"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            sx={{ mb: 2 }}
            autoComplete="current-password"
          />
          <Button type="submit" variant="contained" fullWidth disabled={loading || !username || !password}>
            {loading ? "Проверка..." : "Войти"}
          </Button>
        </form>
      </Paper>
    </Container>
  );
}
