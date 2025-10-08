<script>
/** ==== Api.js ==== */
(() => {
  const BASE = "https://f36ru2h4ua.execute-api.us-east-1.amazonaws.com/prod";

  async function fetchJSON(url, options = {}) {
    //const headers = { "Content-Type":"application/json", "x-api-key": "<YOUR_KEY>" };

    const headers = { "Content-Type": "application/json", ...(options.headers || {}) };
    const res = await fetch(url, { ...options, headers });
    const text = await res.text();
    const data = text ? JSON.parse(text) : null;
    if (!res.ok) throw new Error(data?.error || data?.message || res.statusText);
    return data;
  }

  function qs(params) {
    const p = new URLSearchParams();
    Object.entries(params).forEach(([k, v]) => (v != null && v !== "") && p.append(k, v));
    return p.toString();
  }

  window.Api = {
    listEntries: (date, from, to) =>
      fetchJSON(`${BASE}/entries?${qs({ date, from, to })}`),

    createEntry: (entry) =>
      fetchJSON(`${BASE}/entries`, { method: "POST", body: JSON.stringify(entry) }),

    replaceEntry: (id, entry) =>
      fetchJSON(`${BASE}/entries/${id}`, { method: "PUT", body: JSON.stringify(entry) }),

    updateEntry: (id, patch) =>
      fetchJSON(`${BASE}/entries/${id}`, { method: "PATCH", body: JSON.stringify(patch) }),

    deleteEntry: (id, date, time) =>
      fetchJSON(`${BASE}/entries/${id}?${qs({ date, time })}`, { method: "DELETE" }),
  };
})();
</script>
