// typesafe system one call through the local server
export async function ask(state, questions, { key = "", model = "jev-latest" } = {}) {
  const t0 = performance.now();
  const r = await fetch("/api/systemone", {
    method: "POST",
    headers: { ...(key ? { authorization: "Bearer " + key } : {}), "content-type": "application/json" },
    body: JSON.stringify({ model, state, questions }),
  });
  const j = await r.json();
  if (!r.ok) {
    const e = new Error(j.detail?.[0]?.msg ?? j.error ?? JSON.stringify(j).slice(0, 120));
    e.status = r.status;
    throw e;
  }
  return { answers: j.answers, usage: j.usage, model: j.model, latency: performance.now() - t0 };
}
