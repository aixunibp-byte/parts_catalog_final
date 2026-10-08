// frontend/src/api.js
import axios from "axios";

const client = axios.create({
  baseURL: "/api",
  timeout: 10000,
});

export async function fetchParts({ search = "", inStockOnly = false, page = 1, pageSize = 24 } = {}) {
  const { data } = await client.get("/parts", {
    params: {
      search: search || undefined,
      in_stock_only: inStockOnly,
      page,
      page_size: pageSize,
    },
  });
  return data;
}

export async function fetchPart(id) {
  const { data } = await client.get(`/parts/${id}`);
  return data;
}

export async function fetchSyncStatus() {
  const { data } = await client.get("/sync/status");
  return data;
}

export async function fetchSettings() {
  const { data } = await client.get("/settings");
  return data;
}
