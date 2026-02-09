const BASE = "/.netlify/functions/api";

async function get(action, params = {}) {
  const qs = new URLSearchParams({ action, ...params }).toString();
  const res = await fetch(`${BASE}?${qs}`);
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

async function post(action, data) {
  const res = await fetch(`${BASE}?action=${action}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

async function del(action, id) {
  const res = await fetch(`${BASE}?action=${action}&id=${id}`, {
    method: "DELETE",
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export const api = {
  setup: () => get("setup"),
  getCompanies: () => get("companies"),
  getClients: () => get("clients"),
  getInvoices: () => get("invoices"),
  getInvoice: (id) => get("invoice", { id }),
  getSuggestions: () => get("suggestions"),
  saveCompany: (data) => post("save-company", data),
  saveInvoice: (data) => post("save-invoice", data),
  deleteInvoice: (id) => del("delete-invoice", id),
};
