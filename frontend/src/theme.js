import { createTheme } from "@mui/material/styles";

const brand = {
  navy: "#1B3A5C",
  navyDark: "#0F2740",
  navySoft: "#3D5A7A",
  blue: "#3D7CAE",
  sky: "#5B9BD5",
  skyLight: "#AFD3EA",
};

const lightPalette = {
  mode: "light",
  primary: {
    main: brand.navy,
    light: brand.navySoft,
    dark: brand.navyDark,
    contrastText: "#FFFFFF",
  },
  secondary: {
    main: brand.sky,
    light: brand.skyLight,
    dark: brand.blue,
    contrastText: brand.navyDark,
  },
  success: { main: "#2E7D32" },
  background: {
    default: "#F4F7FA",
    paper: "#FFFFFF",
  },
  text: {
    primary: "#102A43",
    secondary: "#61758A",
  },
  divider: "rgba(27, 58, 92, 0.10)",
};

const darkPalette = {
  mode: "dark",
  primary: {
    main: "#78AEDD",
    light: "#A9CEF0",
    dark: brand.navy,
    contrastText: brand.navyDark,
  },
  secondary: {
    main: "#8CC2EE",
    light: brand.skyLight,
    dark: brand.blue,
    contrastText: brand.navyDark,
  },
  success: { main: "#64B76A" },
  background: {
    default: "#0C1724",
    paper: "#12263A",
  },
  text: {
    primary: "#EDF5FC",
    secondary: "#A9BED0",
  },
  divider: "rgba(169, 206, 240, 0.13)",
};

export function getTheme(mode = "light") {
  const isDark = mode === "dark";

  return createTheme({
    palette: isDark ? darkPalette : lightPalette,
    shape: { borderRadius: 14 },
    typography: {
      fontFamily: '"Roboto", "Helvetica", "Arial", sans-serif',
      button: { fontWeight: 600, letterSpacing: "0.01em" },
      h3: { fontWeight: 700, letterSpacing: "-0.035em" },
      h4: { fontWeight: 700, letterSpacing: "-0.025em" },
      h6: { fontWeight: 650, letterSpacing: "-0.01em" },
    },
    components: {
      MuiCssBaseline: {
        styleOverrides: {
          body: {
            backgroundImage: isDark
              ? "radial-gradient(circle at 50% -20%, rgba(61, 124, 174, 0.16), transparent 40%)"
              : "radial-gradient(circle at 50% -30%, rgba(175, 211, 234, 0.42), transparent 38%)",
          },
        },
      },
      MuiAppBar: {
        styleOverrides: {
          root: {
            background: "linear-gradient(105deg, #0F2740 0%, #1B3A5C 48%, #3D7CAE 100%)",
            borderBottom: "1px solid rgba(255,255,255,0.10)",
          },
        },
      },
      MuiCard: {
        styleOverrides: {
          root: {
            border: isDark ? "1px solid rgba(169, 206, 240, 0.10)" : "1px solid rgba(27, 58, 92, 0.07)",
            boxShadow: isDark
              ? "0 12px 34px rgba(0, 0, 0, 0.16)"
              : "0 12px 34px rgba(27, 58, 92, 0.06)",
          },
        },
      },
      MuiPaper: {
        styleOverrides: {
          rounded: {
            border: isDark ? "1px solid rgba(169, 206, 240, 0.09)" : "1px solid rgba(27, 58, 92, 0.07)",
          },
        },
      },
      MuiButton: {
        styleOverrides: {
          root: { borderRadius: 12 },
        },
      },
    },
  });
}

export default getTheme("light");
