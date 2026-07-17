import { useState, useEffect, useCallback } from "react";

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

interface RiskSignals {
  sensitivePathScore: number;
  coverageDeltaScore: number;
  changeSizeScore: number;
  authorFamiliarityScore: number;
  deployTimingScore: number;
  historicalCorrelationScore: number;
  compositeScore: number;
}

interface Deploy {
  id: string;
  repo: string;
  commitSha: string;
  author: string;
  filesChanged: string[];
  linesAdded: number;
  linesDeleted: number;
  coverageDelta: number | null;
  deployedAt: string;
  riskScore: number;
  riskSignals: RiskSignals;
  llmExplanation: string | null;
  outcome: string | null;
  createdAt: string;
}

interface Stats {
  totalDeploys: number;
  avgRiskScore: number | null;
  highRiskCount: number;
  accuracyRate: number | null;
  highRiskWithOutcome: number;
}

interface DeploysResponse {
  deploys: Deploy[];
  pagination: { page: number; limit: number; total: number; pages: number };
  stats: Stats;
}

// ─────────────────────────────────────────────────────────────────────────────
// Utilities & constants
// ─────────────────────────────────────────────────────────────────────────────

type RiskLevel = "low" | "medium" | "high";

const getRiskLevel = (score: number): RiskLevel =>
  score < 40 ? "low" : score < 75 ? "medium" : "high";

const RISK = {
  low: {
    badge: "bg-emerald-950 text-emerald-400 ring-1 ring-emerald-500/30",
    bar: "bg-emerald-500",
    glow: "shadow-emerald-500/20",
    label: "LOW",
    dot: "bg-emerald-400",
  },
  medium: {
    badge: "bg-amber-950 text-amber-400 ring-1 ring-amber-500/30",
    bar: "bg-amber-500",
    glow: "shadow-amber-500/20",
    label: "MED",
    dot: "bg-amber-400",
  },
  high: {
    badge: "bg-red-950 text-red-400 ring-1 ring-red-500/30",
    bar: "bg-red-500",
    glow: "shadow-red-500/20",
    label: "HIGH",
    dot: "bg-red-400",
  },
};

const SIGNAL_META = [
  { key: "sensitivePathScore" as const, label: "Sensitive Paths", weight: 25 },
  { key: "coverageDeltaScore" as const, label: "Coverage Delta", weight: 20 },
  { key: "changeSizeScore" as const, label: "Change Size", weight: 15 },
  { key: "authorFamiliarityScore" as const, label: "Author Familiarity", weight: 15 },
  { key: "historicalCorrelationScore" as const, label: "Historical Correlation", weight: 15 },
  { key: "deployTimingScore" as const, label: "Deploy Timing", weight: 10 },
];

const OUTCOME_CONFIG = {
  safe: { label: "Safe", cls: "bg-emerald-950 text-emerald-400 ring-1 ring-emerald-500/30" },
  incident: { label: "Incident", cls: "bg-red-950 text-red-400 ring-1 ring-red-500/30" },
  rolled_back: { label: "Rolled Back", cls: "bg-orange-950 text-orange-400 ring-1 ring-orange-500/30" },
};

function fmt(dateStr: string): string {
  const diff = Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000);
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 86400 * 7) return `${Math.floor(diff / 86400)}d ago`;
  return new Date(dateStr).toLocaleDateString();
}

function shortSha(sha: string): string {
  return sha.slice(0, 7);
}

function barColor(score: number): string {
  if (score < 40) return "bg-emerald-500";
  if (score < 75) return "bg-amber-500";
  return "bg-red-500";
}

// ─────────────────────────────────────────────────────────────────────────────
// Sub-components
// ─────────────────────────────────────────────────────────────────────────────

function StatusBadge({ ok }: { ok: boolean | null }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium
        ${ok === null ? "bg-gray-800 text-gray-400" : ok ? "bg-emerald-950 text-emerald-400 ring-1 ring-emerald-500/30" : "bg-red-950 text-red-400 ring-1 ring-red-500/30"}`}
    >
      <span className={`w-1.5 h-1.5 rounded-full ${ok === null ? "bg-gray-500" : ok ? "bg-emerald-400 animate-pulse" : "bg-red-400"}`} />
      {ok === null ? "Checking…" : ok ? "API Online" : "API Offline"}
    </span>
  );
}

function RiskBadge({ score }: { score: number }) {
  const level = getRiskLevel(score);
  const r = RISK[level];
  return (
    <div className={`inline-flex flex-col items-center justify-center w-14 h-14 rounded-xl ${r.badge} shadow-lg ${r.glow} flex-shrink-0`}>
      <span className="text-lg font-extrabold leading-none">{score}</span>
      <span className="text-[9px] font-bold tracking-widest mt-0.5">{r.label}</span>
    </div>
  );
}

function SignalRow({ label, score, weight }: { label: string; score: number; weight: number }) {
  return (
    <div className="flex items-center gap-3">
      <span className="text-xs text-gray-400 w-40 flex-shrink-0 truncate">{label}</span>
      <div className="flex-1 bg-gray-800/80 rounded-full h-1.5 overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-700 ${barColor(score)}`}
          style={{ width: `${score}%` }}
        />
      </div>
      <span className="text-xs text-gray-300 font-mono w-8 text-right">{score}</span>
      <span className="text-xs text-gray-600 w-10 text-right">{weight}%</span>
    </div>
  );
}

function SignalBreakdown({ signals }: { signals: RiskSignals }) {
  return (
    <div className="space-y-2.5">
      <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">
        Signal Breakdown
      </p>
      {SIGNAL_META.map((m) => (
        <SignalRow
          key={m.key}
          label={m.label}
          score={signals[m.key]}
          weight={m.weight}
        />
      ))}
      <div className="pt-2 mt-2 border-t border-gray-800 flex items-center justify-between">
        <span className="text-xs text-gray-400 font-semibold">Composite Score</span>
        <span className={`text-sm font-extrabold ${barColor(signals.compositeScore).replace("bg-", "text-")}`}>
          {signals.compositeScore}
        </span>
      </div>
    </div>
  );
}

function OutcomeSelector({
  deployId,
  current,
  onUpdate,
}: {
  deployId: string;
  current: string | null;
  onUpdate: (id: string, outcome: string) => void;
}) {
  const [saving, setSaving] = useState(false);

  const setOutcome = async (outcome: string) => {
    if (saving || current === outcome) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/deploys/${deployId}/outcome`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ outcome }),
      });
      if (res.ok) onUpdate(deployId, outcome);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex flex-col gap-2">
      <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider">
        Record Outcome
      </p>
      <div className="flex gap-2 flex-wrap">
        {(["safe", "incident", "rolled_back"] as const).map((o) => {
          const cfg = OUTCOME_CONFIG[o];
          const active = current === o;
          return (
            <button
              key={o}
              id={`outcome-${deployId}-${o}`}
              onClick={() => setOutcome(o)}
              disabled={saving}
              className={`text-xs px-3 py-1.5 rounded-lg font-medium transition-all cursor-pointer
                ${active ? cfg.cls : "bg-gray-800 text-gray-500 hover:text-gray-300 hover:bg-gray-700"}
                disabled:opacity-50`}
            >
              {cfg.label}
            </button>
          );
        })}
      </div>
      {current && (
        <p className="text-xs text-gray-500 mt-1">
          Recorded outcome:{" "}
          <span className={`font-semibold ${OUTCOME_CONFIG[current as keyof typeof OUTCOME_CONFIG]?.cls.split(" ")[1] ?? "text-gray-300"}`}>
            {OUTCOME_CONFIG[current as keyof typeof OUTCOME_CONFIG]?.label ?? current}
          </span>
        </p>
      )}
    </div>
  );
}

function DeployRow({
  deploy,
  onOutcomeUpdate,
}: {
  deploy: Deploy;
  onOutcomeUpdate: (id: string, outcome: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const level = getRiskLevel(deploy.riskScore);

  return (
    <div
      className={`rounded-xl border transition-all duration-200 overflow-hidden
        ${expanded ? "border-gray-700 bg-gray-900/80" : "border-gray-800/70 bg-gray-900/50 hover:border-gray-700 hover:bg-gray-900/70"}`}
    >
      {/* Row header — always visible */}
      <button
        id={`deploy-row-${deploy.id}`}
        onClick={() => setExpanded((e) => !e)}
        className="w-full text-left px-4 py-4 flex items-center gap-4 cursor-pointer"
      >
        <RiskBadge score={deploy.riskScore} />

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-semibold text-white truncate">
              {deploy.repo}
            </span>
            <code className="text-xs text-gray-500 bg-gray-800/60 px-1.5 py-0.5 rounded font-mono">
              {shortSha(deploy.commitSha)}
            </code>
            {deploy.outcome && (
              <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${OUTCOME_CONFIG[deploy.outcome as keyof typeof OUTCOME_CONFIG]?.cls ?? ""}`}>
                {OUTCOME_CONFIG[deploy.outcome as keyof typeof OUTCOME_CONFIG]?.label ?? deploy.outcome}
              </span>
            )}
          </div>
          <div className="flex items-center gap-3 mt-1 flex-wrap">
            <span className="text-xs text-gray-500">{deploy.author}</span>
            <span className="text-gray-700">·</span>
            <span className="text-xs text-gray-500">{fmt(deploy.deployedAt)}</span>
            <span className="text-gray-700">·</span>
            <span className="text-xs text-gray-500">
              +{deploy.linesAdded} / -{deploy.linesDeleted} lines
            </span>
            {deploy.coverageDelta !== null && (
              <>
                <span className="text-gray-700">·</span>
                <span className={`text-xs font-medium ${deploy.coverageDelta >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                  {deploy.coverageDelta > 0 ? "+" : ""}{deploy.coverageDelta}% cov
                </span>
              </>
            )}
          </div>
        </div>

        {/* Score bar */}
        <div className="hidden sm:flex flex-col items-end gap-1.5 w-24 flex-shrink-0">
          <div className="w-full bg-gray-800 rounded-full h-1">
            <div
              className={`h-full rounded-full ${RISK[level].bar} transition-all`}
              style={{ width: `${deploy.riskScore}%` }}
            />
          </div>
          <span className="text-xs text-gray-500">
            {deploy.filesChanged.length} files
          </span>
        </div>

        {/* Chevron */}
        <svg
          className={`w-4 h-4 text-gray-600 flex-shrink-0 transition-transform duration-300 ${expanded ? "rotate-180" : ""}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {/* Expanded details */}
      <div
        style={{
          maxHeight: expanded ? "700px" : "0",
          overflow: "hidden",
          transition: "max-height 0.35s ease",
        }}
      >
        <div className="px-4 pb-5 border-t border-gray-800/60">
          <div className="pt-4 grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Left: Signal breakdown */}
            <div className="bg-gray-950/60 rounded-xl p-4 border border-gray-800/50">
              <SignalBreakdown signals={deploy.riskSignals} />
            </div>

            {/* Right: LLM explanation + files + outcome */}
            <div className="space-y-4">
              {deploy.llmExplanation && (
                <div className="bg-brand-500/5 border border-brand-500/20 rounded-xl p-4">
                  <p className="text-xs font-semibold text-brand-400 uppercase tracking-wider mb-2">
                    AI Analysis
                  </p>
                  <p className="text-sm text-gray-300 leading-relaxed italic">
                    &ldquo;{deploy.llmExplanation}&rdquo;
                  </p>
                </div>
              )}

              {/* Files changed */}
              <div className="bg-gray-950/60 rounded-xl p-4 border border-gray-800/50">
                <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">
                  Files Changed ({deploy.filesChanged.length})
                </p>
                <div className="max-h-32 overflow-y-auto space-y-1 scrollbar-thin">
                  {deploy.filesChanged.map((f) => (
                    <p key={f} className="text-xs text-gray-400 font-mono truncate">
                      {f}
                    </p>
                  ))}
                </div>
              </div>

              {/* Outcome recorder */}
              <div className="bg-gray-950/60 rounded-xl p-4 border border-gray-800/50">
                <OutcomeSelector
                  deployId={deploy.id}
                  current={deploy.outcome}
                  onUpdate={onOutcomeUpdate}
                />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function StatCard({
  label,
  value,
  sub,
  icon,
  accent,
}: {
  label: string;
  value: string | number;
  sub?: string;
  icon: React.ReactNode;
  accent: string;
}) {
  return (
    <div className={`relative bg-gray-900/60 border rounded-2xl p-5 overflow-hidden ${accent}`}>
      <div className="flex items-start justify-between">
        <div>
          <p className="text-xs text-gray-500 font-medium uppercase tracking-wider mb-1">{label}</p>
          <p className="text-3xl font-extrabold text-white leading-none">{value}</p>
          {sub && <p className="text-xs text-gray-500 mt-1.5">{sub}</p>}
        </div>
        <div className="text-gray-700">{icon}</div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Dashboard view
// ─────────────────────────────────────────────────────────────────────────────

function Dashboard() {
  const [data, setData] = useState<DeploysResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sort, setSort] = useState<"deployedAt" | "riskScore">("deployedAt");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);

  const fetchDeploys = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/deploys?sort=${sort}&order=desc&limit=30&page=${page}`
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json: DeploysResponse = await res.json();
      setData(json);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load deploys");
    } finally {
      setLoading(false);
    }
  }, [sort, page]);

  useEffect(() => {
    fetchDeploys();
  }, [fetchDeploys]);

  const handleOutcomeUpdate = useCallback((id: string, outcome: string) => {
    setData((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        deploys: prev.deploys.map((d) =>
          d.id === id ? { ...d, outcome } : d
        ),
      };
    });
  }, []);

  const filtered = (data?.deploys ?? []).filter((d) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      d.repo.toLowerCase().includes(q) ||
      d.commitSha.toLowerCase().includes(q) ||
      d.author.toLowerCase().includes(q)
    );
  });

  const stats = data?.stats;

  return (
    <div className="space-y-6">
      {/* Stats bar */}
      {stats && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <StatCard
            label="Total Deploys"
            value={stats.totalDeploys}
            sub="all time"
            accent="border-gray-800"
            icon={
              <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5.25 14.25h13.5m-13.5 0a3 3 0 01-3-3m3 3a3 3 0 100 6h13.5a3 3 0 100-6m-16.5-3a3 3 0 013-3h13.5a3 3 0 013 3m-19.5 0a4.5 4.5 0 01.9-2.7L5.737 5.1a3.375 3.375 0 012.7-1.35h7.126c1.062 0 2.062.5 2.7 1.35l2.587 3.45a4.5 4.5 0 01.9 2.7m0 0a3 3 0 01-3 3m0 3h.008v.008h-.008v-.008zm0-6h.008v.008h-.008v-.008zm-3 6h.008v.008h-.008v-.008zm0-6h.008v.008h-.008v-.008z" />
              </svg>
            }
          />
          <StatCard
            label="Avg Risk Score"
            value={stats.avgRiskScore !== null ? stats.avgRiskScore : "—"}
            sub={
              stats.avgRiskScore !== null
                ? getRiskLevel(stats.avgRiskScore) + " risk"
                : "no data"
            }
            accent={
              stats.avgRiskScore === null
                ? "border-gray-800"
                : stats.avgRiskScore < 40
                ? "border-emerald-500/20"
                : stats.avgRiskScore < 75
                ? "border-amber-500/20"
                : "border-red-500/20"
            }
            icon={
              <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 013 19.875v-6.75zM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V8.625zM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V4.125z" />
              </svg>
            }
          />
          <StatCard
            label="High Risk Deploys"
            value={stats.highRiskCount}
            sub="score ≥ 75"
            accent={stats.highRiskCount > 0 ? "border-red-500/20" : "border-gray-800"}
            icon={
              <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
              </svg>
            }
          />
          <StatCard
            label="Prediction Accuracy"
            value={stats.accuracyRate !== null ? `${stats.accuracyRate}%` : "—"}
            sub={
              stats.highRiskWithOutcome > 0
                ? `${stats.highRiskWithOutcome} outcomes recorded`
                : "no outcomes yet"
            }
            accent={
              stats.accuracyRate === null
                ? "border-gray-800"
                : stats.accuracyRate >= 70
                ? "border-emerald-500/20"
                : "border-amber-500/20"
            }
            icon={
              <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12c0 1.268-.63 2.39-1.593 3.068a3.745 3.745 0 01-1.043 3.296 3.745 3.745 0 01-3.296 1.043A3.745 3.745 0 0112 21c-1.268 0-2.39-.63-3.068-1.593a3.746 3.746 0 01-3.296-1.043 3.745 3.745 0 01-1.043-3.296A3.745 3.745 0 013 12c0-1.268.63-2.39 1.593-3.068a3.745 3.745 0 011.043-3.296 3.746 3.746 0 013.296-1.043A3.746 3.746 0 0112 3c1.268 0 2.39.63 3.068 1.593a3.746 3.746 0 013.296 1.043 3.746 3.746 0 011.043 3.296A3.745 3.745 0 0121 12z" />
              </svg>
            }
          />
        </div>
      )}

      {/* Controls */}
      <div className="flex flex-col sm:flex-row gap-3">
        <input
          id="deploy-search"
          type="text"
          placeholder="Search repo, commit, or author…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="flex-1 bg-gray-900/60 border border-gray-800 rounded-xl px-4 py-2.5 text-sm text-gray-200 placeholder-gray-600 focus:outline-none focus:border-brand-500/60 focus:ring-1 focus:ring-brand-500/30 transition"
        />
        <div className="flex gap-2">
          <select
            id="deploy-sort"
            value={sort}
            onChange={(e) => { setSort(e.target.value as typeof sort); setPage(1); }}
            className="bg-gray-900/60 border border-gray-800 rounded-xl px-4 py-2.5 text-sm text-gray-300 focus:outline-none focus:border-brand-500/60 cursor-pointer"
          >
            <option value="deployedAt">Latest first</option>
            <option value="riskScore">Highest risk first</option>
          </select>
          <button
            id="deploy-refresh"
            onClick={fetchDeploys}
            disabled={loading}
            className="px-4 py-2.5 bg-gray-900/60 border border-gray-800 rounded-xl text-sm text-gray-400 hover:text-gray-200 hover:border-gray-700 transition disabled:opacity-50 cursor-pointer"
          >
            {loading ? (
              <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
            ) : (
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
            )}
          </button>
        </div>
      </div>

      {/* Deploy list */}
      {loading && !data ? (
        <div className="space-y-3">
          {[...Array(5)].map((_, i) => (
            <div key={i} className="h-20 bg-gray-900/50 rounded-xl animate-pulse border border-gray-800" />
          ))}
        </div>
      ) : error ? (
        <div className="rounded-xl border border-red-500/30 bg-red-950/20 px-6 py-8 text-center">
          <p className="text-red-400 font-medium">Failed to load deploys</p>
          <p className="text-red-400/60 text-sm mt-1">{error}</p>
          <p className="text-gray-500 text-xs mt-3">Is the backend running at localhost:4000?</p>
        </div>
      ) : filtered.length === 0 ? (
        <div className="rounded-xl border border-gray-800 bg-gray-900/30 px-6 py-14 text-center">
          <div className="w-16 h-16 mx-auto mb-4 rounded-2xl overflow-hidden ring-2 ring-brand-500/20">
            <img src="/logo.png" alt="DRP" className="w-full h-full object-contain" />
          </div>
          <p className="text-gray-300 font-semibold">No deployments yet</p>
          <p className="text-gray-500 text-sm mt-2">
            {search
              ? "No results match your search."
              : "POST a payload to /webhook/deploy to start scoring deployments."}
          </p>
          {!search && (
            <code className="block mt-3 text-xs text-gray-600 bg-gray-900 px-3 py-1.5 rounded-lg inline-block">
              POST /api/webhook/deploy
            </code>
          )}
        </div>
      ) : (
        <div className="space-y-2.5">
          {filtered.map((deploy) => (
            <DeployRow
              key={deploy.id}
              deploy={deploy}
              onOutcomeUpdate={handleOutcomeUpdate}
            />
          ))}
        </div>
      )}

      {/* Pagination */}
      {data && data.pagination.pages > 1 && (
        <div className="flex items-center justify-between pt-2">
          <span className="text-xs text-gray-500">
            {data.pagination.total} total · page {page} of {data.pagination.pages}
          </span>
          <div className="flex gap-2">
            <button
              id="page-prev"
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page === 1}
              className="px-3 py-1.5 rounded-lg bg-gray-900 border border-gray-800 text-xs text-gray-400 hover:text-white disabled:opacity-40 transition cursor-pointer"
            >
              ← Prev
            </button>
            <button
              id="page-next"
              onClick={() => setPage((p) => Math.min(data.pagination.pages, p + 1))}
              disabled={page === data.pagination.pages}
              className="px-3 py-1.5 rounded-lg bg-gray-900 border border-gray-800 text-xs text-gray-400 hover:text-white disabled:opacity-40 transition cursor-pointer"
            >
              Next →
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Phases view (progress tracker)
// ─────────────────────────────────────────────────────────────────────────────

const PHASES = [
  { n: "1", label: "Scaffolding", status: "complete" as const, desc: "Monorepo, Docker, Prisma schema, webhook ingest" },
  { n: "2", label: "Scoring Engine", status: "complete" as const, desc: "6 deterministic signals, weighted composite 0–100" },
  { n: "3", label: "LLM Synthesis", status: "complete" as const, desc: "Gemini-powered explanation + score refinement" },
  { n: "4", label: "GitHub Actions", status: "complete" as const, desc: "CI workflow fires on merge to main" },
  { n: "5", label: "Dashboard", status: "complete" as const, desc: "Deploy list, signal drill-down, accuracy tracking" },
  { n: "6", label: "Rollback Advisor", status: "next" as const, desc: "Post-deploy error spike detection + recommendation" },
];

function PhasesView() {
  return (
    <div className="max-w-2xl mx-auto space-y-3">
      <h2 className="text-2xl font-bold text-white mb-6">Implementation Phases</h2>
      {PHASES.map(({ n, label, status, desc }) => (
        <div
          key={n}
          className={`p-4 rounded-xl border transition-all flex items-start gap-4
            ${status === "complete" ? "bg-emerald-950/30 border-emerald-500/25" :
              status === "next" ? "bg-brand-500/5 border-brand-500/25" :
              "bg-gray-900/40 border-gray-800"}`}
        >
          <div className={`w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 text-sm font-bold
            ${status === "complete" ? "bg-emerald-500/20 text-emerald-400" :
              status === "next" ? "bg-brand-500/20 text-brand-400" :
              "bg-gray-800 text-gray-500"}`}>
            {status === "complete" ? "✓" : n}
          </div>
          <div>
            <p className={`font-semibold text-sm ${status === "complete" ? "text-emerald-300" : status === "next" ? "text-brand-300" : "text-gray-500"}`}>
              Phase {n} — {label}
            </p>
            <p className="text-xs text-gray-500 mt-0.5">{desc}</p>
          </div>
          <span className={`ml-auto text-xs px-2 py-0.5 rounded-full flex-shrink-0
            ${status === "complete" ? "bg-emerald-500/15 text-emerald-400" :
              status === "next" ? "bg-brand-500/15 text-brand-400" :
              "bg-gray-800 text-gray-600"}`}>
            {status === "complete" ? "Done" : status === "next" ? "Up next" : "Planned"}
          </span>
        </div>
      ))}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// App shell
// ─────────────────────────────────────────────────────────────────────────────

export default function App() {
  const [healthOk, setHealthOk] = useState<boolean | null>(null);
  const [view, setView] = useState<"dashboard" | "phases">("dashboard");

  useEffect(() => {
    fetch("/api/health")
      .then((r) => setHealthOk(r.ok))
      .catch(() => setHealthOk(false));
  }, []);

  return (
    <div className="min-h-screen bg-gray-950 flex flex-col">
      {/* Header */}
      <header className="sticky top-0 z-20 border-b border-gray-800/60 bg-gray-900/60 backdrop-blur-md">
        <div className="max-w-6xl mx-auto px-6 py-3.5 flex items-center gap-6">
          {/* Logo */}
          <div className="flex items-center gap-3 flex-shrink-0">
            <div className="w-8 h-8 rounded-lg overflow-hidden shadow-lg shadow-brand-500/30 ring-1 ring-brand-500/40">
              <img src="/logo.png" alt="DRP logo" className="w-full h-full object-contain" />
            </div>
            <span className="font-bold text-white tracking-tight text-base hidden sm:block">
              Deploy Risk Advisor
            </span>
          </div>

          {/* Nav */}
          <nav className="flex gap-1">
            {(["dashboard", "phases"] as const).map((v) => (
              <button
                key={v}
                id={`nav-${v}`}
                onClick={() => setView(v)}
                className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-all cursor-pointer capitalize
                  ${view === v
                    ? "bg-brand-500/15 text-brand-300"
                    : "text-gray-500 hover:text-gray-300 hover:bg-gray-800/60"}`}
              >
                {v}
              </button>
            ))}
          </nav>

          <div className="ml-auto">
            <StatusBadge ok={healthOk} />
          </div>
        </div>
      </header>

      {/* Page title strip */}
      <div className="border-b border-gray-800/40 bg-gray-900/30">
        <div className="max-w-6xl mx-auto px-6 py-5">
          <h1 className="text-2xl font-extrabold text-white tracking-tight">
            {view === "dashboard" ? (
              <>
                Deployment{" "}
                <span className="bg-gradient-to-r from-brand-400 to-purple-400 bg-clip-text text-transparent">
                  Risk Dashboard
                </span>
              </>
            ) : (
              <>
                Implementation{" "}
                <span className="bg-gradient-to-r from-brand-400 to-purple-400 bg-clip-text text-transparent">
                  Progress
                </span>
              </>
            )}
          </h1>
          <p className="text-sm text-gray-500 mt-1">
            {view === "dashboard"
              ? "Real-time risk scores, signal breakdowns, and AI explanations for every deploy."
              : "Track the build progress of the Deploy Risk Advisor system."}
          </p>
        </div>
      </div>

      {/* Main content */}
      <main className="flex-1 max-w-6xl w-full mx-auto px-6 py-8">
        {view === "dashboard" ? <Dashboard /> : <PhasesView />}
      </main>

      {/* Footer */}
      <footer className="border-t border-gray-800/40 py-4 text-center">
        <p className="text-xs text-gray-700">
          Deploy Risk Advisor · Phases 1–5 complete ·{" "}
          <code className="text-gray-600">POST /api/webhook/deploy</code>
        </p>
      </footer>
    </div>
  );
}
