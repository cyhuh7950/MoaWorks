const ALLOWED_ORIGINS = new Set([
  "https://user.moaworks.sinsan.kr",
  "https://admin.moaworks.sinsan.kr",
]);

function assertAllowedOrigin(origin) {
  if (!ALLOWED_ORIGINS.has(origin)) throw new Error(`허용되지 않은 preflight origin: ${origin}`);
}

export async function runPreflight({ manifest }) {
  const targets = [
    { name: "user-web", origin: manifest.environment.userOrigin, path: "/" },
    { name: "admin-web", origin: manifest.environment.adminOrigin, path: "/" },
    { name: "same-origin-health", origin: manifest.environment.userOrigin, path: "/api/v1/health" },
  ];
  const network = [];
  for (const target of targets) {
    assertAllowedOrigin(target.origin);
    const response = await fetch(new URL(target.path, target.origin), {
      method: "GET",
      redirect: "follow",
      signal: AbortSignal.timeout(15000),
    });
    network.push({ name: target.name, method: "GET", path: target.path, status: response.status });
  }
  const failures = network.filter((item) => item.status < 200 || item.status >= 400);
  return { status: failures.length ? "FAIL" : "PASS", network, failures };
}
