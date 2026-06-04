const env = window.__TRZ_ENV__ || {};

export const supabaseConfig = {
  url: (env.VITE_SUPABASE_URL || "").replace(/\/$/, ""),
  anonKey: env.VITE_SUPABASE_ANON_KEY || ""
};

export function hasSupabaseConfig() {
  return Boolean(supabaseConfig.url && supabaseConfig.anonKey);
}

export async function select(table, { query = "", order = "" } = {}) {
  const suffix = [query, order].filter(Boolean).join("&");
  const url = `${supabaseConfig.url}/rest/v1/${table}${suffix ? `?${suffix}` : ""}`;
  const response = await fetch(url, { headers: dataHeaders() });
  return parseResponse(response);
}

export async function insert(table, payload, { returning = "representation" } = {}) {
  const response = await fetch(`${supabaseConfig.url}/rest/v1/${table}`, {
    method: "POST",
    headers: dataHeaders({ Prefer: `return=${returning}` }),
    body: JSON.stringify(payload)
  });
  return parseResponse(response);
}

export async function update(table, id, payload) {
  const response = await fetch(`${supabaseConfig.url}/rest/v1/${table}?id=eq.${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: dataHeaders({ Prefer: "return=representation" }),
    body: JSON.stringify(payload)
  });
  return parseResponse(response);
}

export async function rpc(name, payload = {}) {
  const response = await fetch(`${supabaseConfig.url}/rest/v1/rpc/${name}`, {
    method: "POST",
    headers: dataHeaders(),
    body: JSON.stringify(payload)
  });
  return parseResponse(response);
}

export function walletBalance(state, walletId) {
  return state.ledger_lines.reduce((total, line) => {
    const entry = state.ledger_entries.find((item) => item.id === line.ledger_entry_id);
    if (entry?.status === "posted" && line.wallet_id === walletId) return total + Number(line.amount);
    return total;
  }, 0);
}

function dataHeaders(extra = {}) {
  return {
    apikey: supabaseConfig.anonKey,
    Authorization: `Bearer ${supabaseConfig.anonKey}`,
    "Content-Type": "application/json",
    ...extra
  };
}

async function parseResponse(response) {
  const text = await response.text();
  const data = text ? JSON.parse(text) : null;
  if (!response.ok) {
    const message = data?.message || data?.error_description || data?.error || response.statusText;
    throw new Error(message);
  }
  return data;
}
