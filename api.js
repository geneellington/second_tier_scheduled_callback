<script>
/** ==== Api.js (drop-in) ==== */
(() => {
  // Base URL for your API (kept as your current prod URL)
  const BASE = "https://f36ru2h4ua.execute-api.us-east-1.amazonaws.com/prod";

  // If your API requires an x-api-key, put it between the quotes below.
  // If not, leave it as "".
  const API_KEY = ""; // <-- put your API key here only if required

  async function fetchJSON(url, options = {}) {
    const headers = {
      "Content-Type": "application/json",
      ...(API_KEY ? { "x-api-key": API_KEY } : {}),
      ...(options.headers || {}),
    };

    let res;
    try {
      res = await fetch(url, { ...options, headers });
    } catch (networkErr) {
      console.error("Network error calling:", url, networkErr);
      throw new Error("Network error. Check CORS, URL, or connectivity.");
    }

    const text = await res.text();
    let data = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      // Non-JSON response is okay for DELETE/204, etc.
    }

    if (!res.ok) {
      const msg =
        (data && (data.error || data.message)) ||
        `${res.status} ${res.statusText}`;
      console.error("API error:", url, msg, data);
      throw new Error(msg);
    }
    return data;
  }

  function qs(params) {
    const p = new URLSearchParams();
    Object.entries(params).forEach(([k, v]) => {
      if (v != null && v !== "") p.append(k, v);
    });
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

  console.log("API BASE =", BASE);
})();
</script>
