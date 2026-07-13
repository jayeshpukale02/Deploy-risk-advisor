import { useState, useEffect } from "react";

// Simple animated status badge
function StatusBadge({
  label,
  ok,
}: {
  label: string;
  ok: boolean | null;
}) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium transition-colors
        ${
          ok === null
            ? "bg-gray-800 text-gray-400"
            : ok
            ? "bg-emerald-950 text-emerald-400 ring-1 ring-emerald-500/30"
            : "bg-red-950 text-red-400 ring-1 ring-red-500/30"
        }`}
    >
      <span
        className={`w-1.5 h-1.5 rounded-full ${
          ok === null ? "bg-gray-500" : ok ? "bg-emerald-400" : "bg-red-400"
        }`}
      />
      {label}
    </span>
  );
}

interface HealthStatus {
  status: string;
  timestamp: string;
}

export default function App() {
  const [health, setHealth] = useState<HealthStatus | null>(null);
  const [healthOk, setHealthOk] = useState<boolean | null>(null);
  const [checking, setChecking] = useState(false);

  const checkHealth = async () => {
    setChecking(true);
    try {
      const res = await fetch("/api/health");
      if (res.ok) {
        const data: HealthStatus = await res.json();
        setHealth(data);
        setHealthOk(true);
      } else {
        setHealthOk(false);
        setHealth(null);
      }
    } catch {
      setHealthOk(false);
      setHealth(null);
    } finally {
      setChecking(false);
    }
  };

  useEffect(() => {
    checkHealth();
  }, []);

  return (
    <div className="min-h-screen bg-gray-950 flex flex-col">
      {/* Top nav */}
      <header className="border-b border-gray-800/60 bg-gray-900/60 backdrop-blur-md sticky top-0 z-10">
        <div className="max-w-5xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            {/* Logo mark */}
            <div className="w-8 h-8 rounded-lg flex items-center justify-center bg-gradient-to-br from-brand-500 to-purple-600 shadow-lg shadow-brand-500/30">
              <svg
                className="w-5 h-5 text-white"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                />
              </svg>
            </div>
            <span className="font-bold text-white tracking-tight text-lg">
              Deploy Risk Advisor
            </span>
          </div>

          <StatusBadge
            label={
              healthOk === null
                ? "Checking API…"
                : healthOk
                ? "API Online"
                : "API Offline"
            }
            ok={healthOk}
          />
        </div>
      </header>

      {/* Hero */}
      <main className="flex-1 flex flex-col items-center justify-center px-6 py-20">
        <div className="max-w-2xl w-full text-center space-y-8">
          {/* Glow ring */}
          <div className="relative inline-flex">
            <div className="absolute inset-0 rounded-full bg-brand-500/20 blur-3xl" />
            <div className="relative w-20 h-20 rounded-2xl flex items-center justify-center bg-gradient-to-br from-brand-500 to-purple-600 shadow-2xl shadow-brand-500/40 mx-auto">
              <svg
                className="w-10 h-10 text-white"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={1.5}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M3.75 13.5l10.5-11.25L12 10.5h8.25L9.75 21.75 12 13.5H3.75z"
                />
              </svg>
            </div>
          </div>

          <div className="space-y-3">
            <h1 className="text-5xl font-extrabold tracking-tight text-white">
              Deploy Risk{" "}
              <span className="bg-gradient-to-r from-brand-400 to-purple-400 bg-clip-text text-transparent">
                Advisor
              </span>
            </h1>
            <p className="text-lg text-gray-400 max-w-xl mx-auto leading-relaxed">
              A hybrid deterministic + AI system that scores deployment risk
              before and as your code ships — and recommends rollback when
              things go sideways.
            </p>
          </div>

          {/* Phase status cards */}
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-left">
            {[
              { phase: "1", label: "Scaffolding", status: "complete" },
              { phase: "2", label: "Scoring Engine", status: "next" },
              { phase: "3", label: "LLM Synthesis", status: "pending" },
              { phase: "4", label: "GitHub Actions", status: "pending" },
              { phase: "5", label: "Dashboard", status: "pending" },
              { phase: "6", label: "Rollback Advisor", status: "pending" },
            ].map(({ phase, label, status }) => (
              <div
                key={phase}
                className={`p-3 rounded-xl border transition-all
                  ${
                    status === "complete"
                      ? "bg-emerald-950/50 border-emerald-500/30"
                      : status === "next"
                      ? "bg-brand-500/10 border-brand-500/30"
                      : "bg-gray-900/50 border-gray-800"
                  }`}
              >
                <div className="flex items-center gap-2">
                  <span
                    className={`text-xs font-bold px-1.5 py-0.5 rounded-md
                      ${
                        status === "complete"
                          ? "bg-emerald-500/20 text-emerald-400"
                          : status === "next"
                          ? "bg-brand-500/20 text-brand-400"
                          : "bg-gray-800 text-gray-500"
                      }`}
                  >
                    {phase}
                  </span>
                  <span
                    className={`text-xs font-medium ${
                      status === "complete"
                        ? "text-emerald-300"
                        : status === "next"
                        ? "text-brand-300"
                        : "text-gray-500"
                    }`}
                  >
                    {label}
                  </span>
                </div>
                <p className="text-xs text-gray-600 mt-1 ml-0.5">
                  {status === "complete"
                    ? "✓ Done"
                    : status === "next"
                    ? "→ Up next"
                    : "Planned"}
                </p>
              </div>
            ))}
          </div>

          {/* Health check */}
          <div className="bg-gray-900/60 border border-gray-800 rounded-2xl p-5 text-left space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-sm font-semibold text-gray-300">
                Backend Health
              </span>
              <button
                onClick={checkHealth}
                disabled={checking}
                className="text-xs px-3 py-1.5 rounded-lg bg-gray-800 hover:bg-gray-700 text-gray-400 hover:text-gray-200 transition-colors disabled:opacity-50 cursor-pointer"
              >
                {checking ? "Checking…" : "Refresh"}
              </button>
            </div>
            {health ? (
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <StatusBadge label="API Online" ok={true} />
                  <span className="text-xs text-gray-500">
                    {new Date(health.timestamp).toLocaleTimeString()}
                  </span>
                </div>
                <p className="text-xs text-gray-600 font-mono">
                  GET /health → {health.status}
                </p>
              </div>
            ) : (
              <p className="text-xs text-gray-600">
                {healthOk === null
                  ? "Waiting for first check…"
                  : "Cannot reach backend at localhost:4000. Is Docker Compose running?"}
              </p>
            )}
          </div>

          <p className="text-xs text-gray-700">
            Dashboard coming in Phase 5 · Webhook:{" "}
            <code className="text-gray-500 bg-gray-900 px-1 py-0.5 rounded">
              POST /api/webhook/deploy
            </code>
          </p>
        </div>
      </main>
    </div>
  );
}
