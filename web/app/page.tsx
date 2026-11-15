"use client";

import { useEffect, useState } from "react";
import { api, fmtCost, fmtInt, ScoresSummary, ScoresTimeseries, Stats } from "@/lib/api";

/** Daily average task_completion as a line — quality drift at a glance. */
function ScoreTrend({ series }: { series: ScoresTimeseries }) {
  const points = series.points.filter((p) => p.name === "task_completion");
  if (points.length < 2) return null;

  const W = 720, H = 170, L = 34, R = 10, T = 12, B = 26;
  const t = (day: string) => new Date(day + "T00:00:00Z").getTime();
  const t0 = t(points[0].day), t1 = t(points[points.length - 1].day);
  const x = (day: string) => L + ((t(day) - t0) / Math.max(1, t1 - t0)) * (W - L - R);
  const y = (v: number) => T + (1 - v) * (H - T - B);

  const path = points.map((p, i) => `${i === 0 ? "M" : "L"}${x(p.day).toFixed(1)},${y(p.avg).toFixed(1)}`).join(" ");
  const minPoint = points.reduce((a, b) => (b.avg < a.avg ? b : a));
  const last = points[points.length - 1];
  const fmtDay = (day: string) =>
    new Date(day + "T00:00:00Z").toLocaleDateString(undefined, { month: "short", day: "numeric" });
  const tickCount = Math.min(4, points.length);
  const ticks = Array.from({ length: tickCount }, (_, i) =>
    points[Math.round((i * (points.length - 1)) / (tickCount - 1))].day
  );

  return (
    <div className="card">
      <h2>Task completion over time</h2>
      <div className="muted" style={{ marginBottom: 6 }}>
        Daily average judge score, by when the trace ran — drops flag regressions.
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height: "auto", display: "block" }} role="img"
           aria-label="Line chart of average task completion score per day">
        {[0, 0.5, 1].map((v) => (
          <g key={v}>
            <line x1={L} x2={W - R} y1={y(v)} y2={y(v)} stroke="var(--border)" strokeWidth={1} />
            <text x={L - 6} y={y(v) + 3.5} textAnchor="end" fontSize={10.5}
                  fill="var(--text-3)" style={{ fontVariantNumeric: "tabular-nums" }}>
              {v.toFixed(1)}
            </text>
          </g>
        ))}
        <path d={path} fill="none" stroke="var(--accent)" strokeWidth={2}
              strokeLinejoin="round" strokeLinecap="round" />
        {points.map((p) => (
          <circle key={p.day} cx={x(p.day)} cy={y(p.avg)} r={4} fill="var(--accent)"
                  stroke="var(--surface-2)" strokeWidth={2}>
            <title>{`${fmtDay(p.day)} · avg ${p.avg.toFixed(2)} · ${p.count} trace${p.count === 1 ? "" : "s"}${p.low_count ? ` · ${p.low_count} low` : ""}`}</title>
          </circle>
        ))}
        {[minPoint, last].filter((p, i, a) => a.indexOf(p) === i).map((p) => (
          <text key={p.day} x={x(p.day)} y={y(p.avg) + (p === minPoint ? 16 : -9)}
                textAnchor="middle" fontSize={11} fill="var(--text-2)"
                style={{ fontVariantNumeric: "tabular-nums" }}>
            {p.avg.toFixed(2)}
          </text>
        ))}
        {ticks.map((day, i) => (
          <text key={day} x={x(day)} y={H - 8}
                textAnchor={i === 0 ? "start" : i === ticks.length - 1 ? "end" : "middle"}
                fontSize={10.5} fill="var(--text-3)">
            {fmtDay(day)}
          </text>
        ))}
      </svg>
    </div>
  );
}

export default function Dashboard() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [evals, setEvals] = useState<ScoresSummary | null>(null);
  const [trend, setTrend] = useState<ScoresTimeseries | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = () => {
    api.stats().then(setStats).catch((e) => setError(String(e)));
    api.scoresSummary().then(setEvals).catch(() => {});
    api.scoresTimeseries(30).then(setTrend).catch(() => {});
  };
  useEffect(load, []);

  if (error) {
    return (
      <div className="empty">
        Could not reach the Veekshana server.
        <div className="faint" style={{ marginTop: 6 }}>{error} — is it running on port 8787?</div>
      </div>
    );
  }
  if (!stats) return <div className="empty">Loading…</div>;

  const maxCost = Math.max(...stats.by_model.map((m) => m.cost_usd), 0);

  return (
    <>
      <div className="page-title">Dashboard</div>

      <div className="tiles">
        <div className="tile">
          <div className="label">Traces</div>
          <div className="value">{fmtInt(stats.traces)}</div>
        </div>
        <div className="tile">
          <div className="label">Spans</div>
          <div className="value">{fmtInt(stats.spans)}</div>
        </div>
        <div className="tile">
          <div className="label">Tokens</div>
          <div className="value">{fmtInt(stats.input_tokens + stats.output_tokens)}</div>
          <div className="sub">{fmtInt(stats.input_tokens)} in · {fmtInt(stats.output_tokens)} out</div>
        </div>
        <div className="tile">
          <div className="label">Total cost</div>
          <div className="value">{stats.cost_usd === 0 ? "$0" : `$${stats.cost_usd.toFixed(4)}`}</div>
        </div>
      </div>

      {evals && evals.by_name.length > 0 && (
        <div className="card">
          <h2>Evals</h2>
          <div className="muted" style={{ marginBottom: 10 }}>
            {fmtInt(evals.scored_traces)} trace{evals.scored_traces === 1 ? "" : "s"} scored
          </div>
          <table>
            <thead>
              <tr>
                <th>Score</th>
                <th className="num">Traces</th>
                <th className="num">Average</th>
                <th className="num">Low (&lt;0.5)</th>
              </tr>
            </thead>
            <tbody>
              {evals.by_name.map((s) => (
                <tr key={s.name}>
                  <td className="mono">{s.name}</td>
                  <td className="num">{fmtInt(s.count)}</td>
                  <td className="num" style={{ color: (s.avg ?? 1) < 0.5 ? "var(--error)" : undefined }}>
                    {s.avg != null ? s.avg.toFixed(2) : "–"}
                  </td>
                  <td className="num">{fmtInt(s.low_count)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {trend && <ScoreTrend series={trend} />}

      <div className="card">
        <h2>Cost by model</h2>
        {stats.by_model.length === 0 && <div className="empty">No LLM calls recorded yet.</div>}
        {stats.by_model
          .slice()
          .sort((a, b) => b.cost_usd - a.cost_usd)
          .map((m) => (
            <div className="bar-row" key={m.model}>
              <div className="name mono" title={m.model}>{m.model}</div>
              <div className="bar-track">
                <div
                  className="bar-fill"
                  style={{ width: `${maxCost > 0 ? (m.cost_usd / maxCost) * 100 : 0}%` }}
                />
              </div>
              <div className="val">{fmtCost(m.cost_usd)}</div>
            </div>
          ))}
      </div>

      <div className="card">
        <h2>Model usage</h2>
        <table>
          <thead>
            <tr>
              <th>Model</th>
              <th className="num">Calls</th>
              <th className="num">Input tokens</th>
              <th className="num">Output tokens</th>
              <th className="num">Cost</th>
            </tr>
          </thead>
          <tbody>
            {stats.by_model.map((m) => (
              <tr key={m.model}>
                <td className="mono">{m.model}</td>
                <td className="num">{fmtInt(m.calls)}</td>
                <td className="num">{fmtInt(m.input_tokens)}</td>
                <td className="num">{fmtInt(m.output_tokens)}</td>
                <td className="num">{fmtCost(m.cost_usd)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div style={{ marginTop: 16 }}>
        <button className="btn" onClick={load}>Refresh</button>
      </div>
    </>
  );
}
