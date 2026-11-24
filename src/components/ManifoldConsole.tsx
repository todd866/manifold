'use client';

import React, { useMemo, useState } from 'react';
import type { ManifoldDomain } from '@/lib/boundary';
import type { ManifoldLens, ManifoldWork } from '@/lib/engine';
import type { ContributorRecord } from '@/lib/reputation';

type TabKey = 'map' | 'lenses' | 'trust' | 'mcp';
type DomainFilter = 'all' | ManifoldDomain;

interface Props {
  works: ManifoldWork[];
  lenses: Array<ManifoldLens & { signatureValid: boolean }>;
  contributors: ContributorRecord[];
  mcpTools: Array<{ name: string; description: string }>;
}

function DomainGlyph({ domain, size = 12 }: { domain: ManifoldDomain; size?: number }) {
  if (domain === 'tv') {
    return (
      <svg width={size} height={size} viewBox="0 0 14 14" aria-label="TV work">
        <circle cx="7" cy="7" r="5" fill="var(--accent-tv)" />
      </svg>
    );
  }
  if (domain === 'radio') {
    return (
      <svg width={size} height={size} viewBox="0 0 14 14" aria-label="Radio work">
        <polygon points="7,1.5 12.5,7 7,12.5 1.5,7" fill="var(--accent-radio)" />
      </svg>
    );
  }
  if (domain === 'reader') {
    return (
      <svg width={size} height={size} viewBox="0 0 14 14" aria-label="Reader work">
        <polygon points="7,1.8 12.2,11.6 1.8,11.6" fill="var(--accent-reader)" />
      </svg>
    );
  }
  return (
    <svg width={size} height={size} viewBox="0 0 14 14" aria-label="Cohort concept">
      <rect x="2.2" y="2.2" width="9.6" height="9.6" rx="1.5" fill="var(--accent-cohort)" />
    </svg>
  );
}

function domainColor(domain: ManifoldDomain): string {
  if (domain === 'tv') return 'var(--accent-tv)';
  if (domain === 'radio') return 'var(--accent-radio)';
  if (domain === 'reader') return 'var(--accent-reader)';
  return 'var(--accent-cohort)';
}

function TierGlyph({ tier }: { tier: ContributorRecord['tier'] }) {
  const color =
    tier === 'steward'
      ? 'var(--ok)'
      : tier === 'trusted'
        ? 'var(--accent-radio)'
        : tier === 'provisional'
          ? 'var(--warn)'
          : 'var(--bad)';
  return (
    <svg width="13" height="13" viewBox="0 0 14 14" aria-label={`Tier ${tier}`}>
      <path
        d="M7 1.2L12 3.4V7.2C12 10.2 9.8 12.2 7 13C4.2 12.2 2 10.2 2 7.2V3.4L7 1.2Z"
        fill={color}
      />
    </svg>
  );
}

export function ManifoldConsole({ works, lenses, contributors, mcpTools }: Props) {
  const [tab, setTab] = useState<TabKey>('map');
  const [domain, setDomain] = useState<DomainFilter>('all');
  const [query, setQuery] = useState('');
  const [theme, setTheme] = useState<'dark' | 'light'>('dark');

  const [selectedId, setSelectedId] = useState<string>(works[0]?.workId || '');
  const [bridgeTargetId, setBridgeTargetId] = useState<string>('');
  const [bridgeMode, setBridgeMode] = useState(false);

  const [selectedLensId, setSelectedLensId] = useState<string>(lenses[0]?.id || '');
  const [mcpProbeOutput, setMcpProbeOutput] = useState<string>('');
  const [copiedMcp, setCopiedMcp] = useState(false);

  const toggleTheme = () => {
    const next = theme === 'dark' ? 'light' : 'dark';
    setTheme(next);
    if (typeof document !== 'undefined') {
      document.documentElement.setAttribute('data-theme', next);
    }
  };

  const workMap = useMemo(() => {
    const m = new Map<string, ManifoldWork>();
    for (const w of works) m.set(w.workId, w);
    return m;
  }, [works]);

  const filteredWorks = useMemo(() => {
    const q = query.trim().toLowerCase();
    return works.filter((w) => {
      if (domain !== 'all' && w.domain !== domain) return false;
      if (!q) return true;
      return (
        w.title.toLowerCase().includes(q) ||
        w.creator.toLowerCase().includes(q) ||
        w.kind.toLowerCase().includes(q) ||
        w.workId.toLowerCase().includes(q)
      );
    });
  }, [works, domain, query]);

  const selectedWork = workMap.get(selectedId) || filteredWorks[0] || works[0];
  const bridgeTarget = bridgeTargetId ? workMap.get(bridgeTargetId) || null : null;

  const bridgeResults = useMemo(() => {
    if (!selectedWork || !bridgeTarget) return [];
    const va = selectedWork.vec32;
    const vb = bridgeTarget.vec32;
    const dotSim = (a: number[], b: number[]) => {
      let d = 0;
      let na = 0;
      let nb = 0;
      for (let i = 0; i < a.length; i++) {
        d += a[i] * b[i];
        na += a[i] * a[i];
        nb += b[i] * b[i];
      }
      const den = Math.sqrt(na) * Math.sqrt(nb);
      return den > 0 ? d / den : 0;
    };
    return filteredWorks
      .filter((w) => w.workId !== selectedWork.workId && w.workId !== bridgeTarget.workId)
      .map((w) => {
        const simA = dotSim(va, w.vec32);
        const simB = dotSim(vb, w.vec32);
        const score = (simA + simB) * 0.5 - Math.abs(simA - simB) * 0.35;
        return { work: w, score, simA, simB };
      })
      .sort((a, b) => b.score - a.score)
      .slice(0, 6);
  }, [selectedWork, bridgeTarget, filteredWorks]);

  const visibleLenses = useMemo(
    () => lenses.filter((l) => domain === 'all' || l.domain === domain),
    [lenses, domain],
  );
  const activeLens =
    visibleLenses.find((l) => l.id === selectedLensId) || visibleLenses[0] || lenses[0];

  const lensPreview = useMemo(() => {
    if (!activeLens) return [];
    const blocked = new Set(activeLens.blockedMarks || []);
    const anchors = activeLens.anchors
      .map((a) => ({ weight: a.weight, work: workMap.get(a.workId) }))
      .filter((x): x is { weight: number; work: ManifoldWork } => Boolean(x.work));

    const dotSim = (a: number[], b: number[]) => {
      let d = 0;
      let na = 0;
      let nb = 0;
      for (let i = 0; i < a.length; i++) {
        d += a[i] * b[i];
        na += a[i] * a[i];
        nb += b[i] * b[i];
      }
      const den = Math.sqrt(na) * Math.sqrt(nb);
      return den > 0 ? d / den : 0;
    };

    return works
      .filter((w) => w.domain === activeLens.domain && (!w.mark || !blocked.has(w.mark)))
      .map((w) => {
        let sum = 0;
        let wt = 0;
        let best = 0;
        for (const anc of anchors) {
          const s = anc.work.workId === w.workId ? 1.0 : dotSim(anc.work.vec32, w.vec32);
          sum += s * anc.weight;
          wt += anc.weight;
          if (s > best) best = s;
        }
        const score = (wt > 0 ? sum / wt : 0) * 0.7 + best * 0.3;
        return { work: w, score };
      })
      .sort((a, b) => b.score - a.score)
      .slice(0, 10);
  }, [activeLens, works, workMap]);

  const counts = useMemo(
    () => ({
      tv: works.filter((w) => w.domain === 'tv').length,
      radio: works.filter((w) => w.domain === 'radio').length,
      cohort: works.filter((w) => w.domain === 'cohort').length,
      reader: works.filter((w) => w.domain === 'reader').length,
    }),
    [works],
  );

  const originUrl =
    typeof window !== 'undefined' ? window.location.origin : 'https://manifold-chi.vercel.app';
  const mcpConfigSnippet = JSON.stringify(
    {
      mcpServers: {
        manifold: {
          url: `${originUrl}/api/mcp`,
        },
      },
    },
    null,
    2,
  );

  const runLiveMcpProbe = async (toolName: string, args: Record<string, unknown>) => {
    try {
      const resp = await fetch('/api/mcp', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'tools/call',
          params: { name: toolName, arguments: args },
        }),
      });
      const json = await resp.json();
      const text = json?.result?.content?.[0]?.text || JSON.stringify(json, null, 2);
      setMcpProbeOutput(text);
    } catch (err) {
      setMcpProbeOutput(`Error: ${(err as Error).message}`);
    }
  };

  const toSvgCoord = (val: number) => 200 + val * 175;

  return (
    <div className="shell">
      {/* Row 1: Primary Navigation Bar */}
      <header className="topbar">
        <div className="brand">
          <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
            <circle cx="4" cy="11" r="2.5" fill="var(--accent-tv)" />
            <polygon points="8,2 11,5 8,8 5,5" fill="var(--accent-radio)" />
            <rect x="10" y="9" width="4.5" height="4.5" rx="1" fill="var(--accent-cohort)" />
            <path d="M5.5 9.5L7.5 6.5M9 6.5L11.5 9.5" stroke="var(--fg-muted)" strokeWidth="1.1" />
          </svg>
          <span>Manifold</span>
        </div>

        <nav className="segmented" role="tablist" aria-label="Console views">
          {(['map', 'lenses', 'trust', 'mcp'] as const).map((k) => (
            <button
              key={k}
              role="tab"
              aria-selected={tab === k}
              className="seg-btn"
              onClick={() => setTab(k)}
            >
              {k === 'map'
                ? 'Map'
                : k === 'lenses'
                  ? `Lenses ${lenses.length}`
                  : k === 'trust'
                    ? `Trust ${contributors.length}`
                    : `MCP ${mcpTools.length}`}
            </button>
          ))}
        </nav>

        <button
          type="button"
          className="ctrl-btn"
          onClick={toggleTheme}
          aria-label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
        >
          <svg width="13" height="13" viewBox="0 0 16 16" aria-hidden="true">
            {theme === 'dark' ? (
              <circle cx="8" cy="8" r="4.5" stroke="currentColor" strokeWidth="1.5" fill="none" />
            ) : (
              <path
                d="M10.5 2.2A6 6 0 1 0 13.8 11.5 5 5 0 0 1 10.5 2.2Z"
                fill="currentColor"
              />
            )}
          </svg>
          <span>{theme === 'dark' ? 'Light' : 'Dark'}</span>
        </button>
      </header>

      {/* Row 2: Domain Filter & Instrument Telemetry */}
      <div className="subbar">
        <div className="segmented" role="group" aria-label="Domain filter">
          {(
            [
              ['all', `All ${works.length}`],
              ['tv', `TV ${counts.tv}`],
              ['radio', `Radio ${counts.radio}`],
              ['cohort', `Cohort ${counts.cohort}`],
              ['reader', `Reader ${counts.reader}`],
            ] as const
          ).map(([d, label]) => (
            <button
              key={d}
              type="button"
              aria-pressed={domain === d}
              className="seg-btn num"
              onClick={() => setDomain(d)}
            >
              {d !== 'all' && <DomainGlyph domain={d} size={10} />}
              <span>{label}</span>
            </button>
          ))}
        </div>

        <div className="telemetry-strip num">
          <span className="telemetry-datum" title="Supported coordinate spaces">
            <span>3072d + 768d</span>
          </span>
          <span className="telemetry-datum" title="Canary overlap cosine gate">
            <span>Canary &ge;</span>
            <strong>0.980</strong>
          </span>
          <span className="telemetry-datum" title="Ed25519 signature verification">
            <strong>{lenses.filter((l) => l.signatureValid).length}/{lenses.length}</strong>
            <span>signed</span>
          </span>
        </div>
      </div>

      {/* Row 3: Active Tab Workspace (bounded to viewport height, zero page scroll) */}
      {tab === 'map' && (
        <main className="workspace">
          {/* Left Pane: 2D Latent Projection */}
          <section className="pane" aria-label="Latent coordinate map">
            <div className="pane-bar">
              <input
                type="search"
                className="search-input"
                placeholder="Filter works or IDs"
                aria-label="Filter works or IDs"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
              <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                <button
                  type="button"
                  className="ctrl-btn"
                  aria-pressed={bridgeMode}
                  onClick={() => {
                    if (bridgeMode) {
                      setBridgeMode(false);
                      setBridgeTargetId('');
                    } else {
                      setBridgeMode(true);
                      const fallback = filteredWorks.find((w) => w.workId !== selectedWork?.workId);
                      if (fallback) setBridgeTargetId(fallback.workId);
                    }
                  }}
                >
                  <span>{bridgeMode ? 'Clear bridge' : 'Bridge A-B'}</span>
                </button>
              </div>
            </div>

            <div className="plot-wrap">
              <svg viewBox="0 0 400 400" className="plot-svg" role="img" aria-label="2D SVD projection of works">
                <line x1="200" y1="12" x2="200" y2="388" stroke="var(--border)" strokeDasharray="3 3" />
                <line x1="12" y1="200" x2="388" y2="200" stroke="var(--border)" strokeDasharray="3 3" />

                {/* Neighbour spokes from selected work */}
                {selectedWork &&
                  !bridgeTarget &&
                  selectedWork.neighbours.slice(0, 5).map((edge) => {
                    const nb = workMap.get(edge.workId);
                    if (!nb || (domain !== 'all' && nb.domain !== domain)) return null;
                    return (
                      <line
                        key={edge.workId}
                        x1={toSvgCoord(selectedWork.x)}
                        y1={toSvgCoord(-selectedWork.y)}
                        x2={toSvgCoord(nb.x)}
                        y2={toSvgCoord(-nb.y)}
                        stroke="var(--fg-muted)"
                        strokeOpacity={0.45}
                        strokeWidth={1.1}
                      />
                    );
                  })}

                {/* Bridge geodesic line */}
                {selectedWork && bridgeTarget && (
                  <line
                    x1={toSvgCoord(selectedWork.x)}
                    y1={toSvgCoord(-selectedWork.y)}
                    x2={toSvgCoord(bridgeTarget.x)}
                    y2={toSvgCoord(-bridgeTarget.y)}
                    stroke="var(--ok)"
                    strokeWidth={1.8}
                    strokeDasharray="4 3"
                  />
                )}

                {filteredWorks.map((w) => {
                  const cx = toSvgCoord(w.x);
                  const cy = toSvgCoord(-w.y);
                  const isSel = selectedWork?.workId === w.workId;
                  const isBridgeB = bridgeTarget?.workId === w.workId;
                  const color = domainColor(w.domain);
                  return (
                    <g
                      key={w.workId}
                      style={{ cursor: 'pointer' }}
                      onClick={() => {
                        if (bridgeMode && selectedWork && w.workId !== selectedWork.workId) {
                          setBridgeTargetId(w.workId);
                        } else {
                          setSelectedId(w.workId);
                        }
                      }}
                    >
                      <title>{`${w.title} — ${w.creator} (${w.workId})`}</title>
                      {(isSel || isBridgeB) && (
                        <circle
                          cx={cx}
                          cy={cy}
                          r={10}
                          fill="none"
                          stroke={isBridgeB ? 'var(--ok)' : 'var(--fg)'}
                          strokeWidth={1.6}
                        />
                      )}
                      {w.domain === 'tv' && <circle cx={cx} cy={cy} r={isSel ? 5.5 : 4.2} fill={color} />}
                      {w.domain === 'radio' && (
                        <polygon
                          points={`${cx},${cy - 5.2} ${cx + 5.2},${cy} ${cx},${cy + 5.2} ${cx - 5.2},${cy}`}
                          fill={color}
                        />
                      )}
                      {w.domain === 'cohort' && (
                        <rect x={cx - 4.2} y={cy - 4.2} width={8.4} height={8.4} rx={1.4} fill={color} />
                      )}
                      {w.domain === 'reader' && (
                        <polygon
                          points={`${cx},${cy - 5.2} ${cx + 4.8},${cy + 4.2} ${cx - 4.8},${cy + 4.2}`}
                          fill={color}
                        />
                      )}
                    </g>
                  );
                })}
              </svg>
            </div>
          </section>

          {/* Right Pane: Selected Work / Bridge Readout & Aligned Neighbour Rows */}
          <section className="pane" aria-label="Coordinate inspector">
            <div className="pane-bar">
              <span style={{ fontWeight: 600 }}>
                {bridgeTarget && selectedWork
                  ? `Bridge: ${selectedWork.title} → ${bridgeTarget.title}`
                  : selectedWork?.title || 'Select work'}
              </span>
              {selectedWork && (
                <span className="mono inst-sub" title="Canonical public identifier">
                  {selectedWork.workId}
                </span>
              )}
            </div>

            <div className="pane-scroll">
              {selectedWork && !bridgeTarget && (
                <>
                  <div className="detail-card">
                    <div className="detail-head">
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontWeight: 600 }}>
                        <DomainGlyph domain={selectedWork.domain} />
                        <span>{selectedWork.creator}</span>
                      </span>
                      <span className="num inst-sub">
                        {selectedWork.year} · {selectedWork.kind}
                      </span>
                    </div>
                    <p className="detail-meta">{selectedWork.summary}</p>
                    <div className="mono inst-sub">
                      shard {selectedWork.shard} · {selectedWork.modelId} · canary{' '}
                      {(selectedWork.verifiedCanary ?? 0.996).toFixed(3)}
                      {selectedWork.mark ? ` · mark:${selectedWork.mark}` : ''}
                    </div>
                  </div>

                  {selectedWork.neighbours.map((edge) => {
                    const nb = workMap.get(edge.workId);
                    if (!nb) return null;
                    const pct = Math.max(4, Math.min(100, Math.round(edge.sim * 100)));
                    return (
                      <div
                        key={edge.workId}
                        className="inst-row num"
                        onClick={() => setSelectedId(nb.workId)}
                        title={`${nb.title} — ${nb.creator} (${nb.workId})`}
                      >
                        <DomainGlyph domain={nb.domain} />
                        <div>
                          <div className="inst-title">{nb.title}</div>
                          <div className="inst-sub">{nb.creator}</div>
                        </div>
                        <div className="gauge" aria-hidden="true">
                          <div
                            className="gauge-fill"
                            style={{ width: `${pct}%`, background: domainColor(nb.domain) }}
                          />
                        </div>
                        <div className="val-right">{edge.sim.toFixed(3)}</div>
                        <div className="datum-right">{nb.year}</div>
                      </div>
                    );
                  })}

                  {(selectedWork.resonances || []).map((edge) => {
                    const resWork = workMap.get(edge.workId);
                    if (!resWork) return null;
                    const pct = Math.max(4, Math.min(100, Math.round(edge.sim * 100)));
                    return (
                      <div
                        key={`res-${edge.workId}`}
                        className="inst-row num"
                        onClick={() => setSelectedId(resWork.workId)}
                        title={`Cross-domain resonance: ${resWork.title} (${resWork.workId})`}
                      >
                        <DomainGlyph domain={resWork.domain} />
                        <div>
                          <div className="inst-title">{resWork.title}</div>
                          <div className="inst-sub">cross · {resWork.domain}</div>
                        </div>
                        <div className="gauge" aria-hidden="true">
                          <div
                            className="gauge-fill"
                            style={{ width: `${pct}%`, background: domainColor(resWork.domain) }}
                          />
                        </div>
                        <div className="val-right">{edge.sim.toFixed(3)}</div>
                        <div className="datum-right">{resWork.domain}</div>
                      </div>
                    );
                  })}
                </>
              )}

              {selectedWork && bridgeTarget && (
                <>
                  {bridgeResults.map((row) => {
                    const pct = Math.max(4, Math.min(100, Math.round(Math.max(0, row.score) * 100)));
                    return (
                      <div
                        key={row.work.workId}
                        className="inst-row num"
                        onClick={() => {
                          setBridgeMode(false);
                          setBridgeTargetId('');
                          setSelectedId(row.work.workId);
                        }}
                        title={`sim(A)=${row.simA.toFixed(3)}, sim(B)=${row.simB.toFixed(3)}`}
                      >
                        <DomainGlyph domain={row.work.domain} />
                        <div>
                          <div className="inst-title">{row.work.title}</div>
                          <div className="inst-sub">{row.work.creator}</div>
                        </div>
                        <div className="gauge" aria-hidden="true">
                          <div
                            className="gauge-fill"
                            style={{ width: `${pct}%`, background: 'var(--ok)' }}
                          />
                        </div>
                        <div className="val-right">{row.score.toFixed(3)}</div>
                        <div className="datum-right">midpoint</div>
                      </div>
                    );
                  })}
                </>
              )}
            </div>
          </section>
        </main>
      )}

      {tab === 'lenses' && (
        <main className="workspace">
          <section className="pane" aria-label="Signed lenses">
            <div className="pane-bar">
              <span style={{ fontWeight: 600 }}>Signed lenses</span>
              <span className="inst-sub num">{visibleLenses.length} verified</span>
            </div>
            <div className="pane-scroll">
              {visibleLenses.map((lens) => {
                const compPct = Math.round((lens.completionRate ?? 0.85) * 100);
                return (
                  <div
                    key={lens.id}
                    className="inst-row num"
                    data-active={activeLens?.id === lens.id}
                    onClick={() => setSelectedLensId(lens.id)}
                    title={`${lens.summary} · Signed by ${lens.issuer}`}
                  >
                    <DomainGlyph domain={lens.domain} />
                    <div>
                      <div className="inst-title">{lens.name}</div>
                      <div className="inst-sub">{lens.issuerHandle}</div>
                    </div>
                    <div className="gauge" aria-hidden="true">
                      <div
                        className="gauge-fill"
                        style={{ width: `${compPct}%`, background: domainColor(lens.domain) }}
                      />
                    </div>
                    <div className="val-right">{compPct}%</div>
                    <div className="datum-right">{lens.subscribers ?? 0} subs</div>
                  </div>
                );
              })}
            </div>
          </section>

          <section className="pane" aria-label="Lens sequence">
            <div className="pane-bar">
              <span style={{ fontWeight: 600 }}>{activeLens?.name || 'Lens'}</span>
              {activeLens && (
                <span className="mono inst-sub">
                  {activeLens.signatureValid ? 'ed25519 ok' : 'invalid sig'}
                </span>
              )}
            </div>
            <div className="pane-scroll">
              {activeLens && (
                <div className="detail-card">
                  <p className="detail-meta">{activeLens.summary}</p>
                  <div className="mono inst-sub">
                    {activeLens.id} · {activeLens.anchors.length} anchors · issuer{' '}
                    {activeLens.issuer.slice(0, 22)}…
                  </div>
                </div>
              )}
              {lensPreview.map(({ work, score }, idx) => {
                const pct = Math.max(6, Math.min(100, Math.round(score * 100)));
                return (
                  <div
                    key={work.workId}
                    className="inst-row num"
                    onClick={() => {
                      setSelectedId(work.workId);
                      setTab('map');
                    }}
                    title={work.workId}
                  >
                    <span className="inst-sub mono">{idx + 1}</span>
                    <div>
                      <div className="inst-title">{work.title}</div>
                      <div className="inst-sub">{work.creator}</div>
                    </div>
                    <div className="gauge" aria-hidden="true">
                      <div
                        className="gauge-fill"
                        style={{ width: `${pct}%`, background: domainColor(work.domain) }}
                      />
                    </div>
                    <div className="val-right">{score.toFixed(3)}</div>
                    <div className="datum-right">{work.year}</div>
                  </div>
                );
              })}
            </div>
          </section>
        </main>
      )}

      {tab === 'trust' && (
        <main className="workspace">
          <section className="pane single-pane" aria-label="Contributor reputation ledger">
            <div className="pane-bar">
              <span style={{ fontWeight: 600 }}>Canary trust ledger</span>
              <span className="inst-sub num">Beta(alpha, beta) · gate 0.980 cosine</span>
            </div>
            <div className="pane-scroll">
              {contributors.map((c) => {
                const trustPct = Math.round(c.trust * 100);
                return (
                  <div
                    key={c.issuer}
                    className="inst-row num"
                    title={`${c.issuer} · alpha=${c.alpha} beta=${c.beta} · domains: ${c.domains.join(', ')}`}
                  >
                    <TierGlyph tier={c.tier} />
                    <div>
                      <div className="inst-title">{c.handle}</div>
                      <div className="inst-sub mono">{c.issuer.slice(0, 28)}…</div>
                    </div>
                    <div className="gauge" aria-hidden="true">
                      <div
                        className="gauge-fill"
                        style={{ width: `${trustPct}%`, background: 'var(--ok)' }}
                      />
                    </div>
                    <div className="val-right">{c.meanCanaryCosine.toFixed(3)}</div>
                    <div className="datum-right">{c.credits} cr</div>
                  </div>
                );
              })}
            </div>
          </section>
        </main>
      )}

      {tab === 'mcp' && (
        <main className="workspace">
          <section className="pane" aria-label="MCP tools">
            <div className="pane-bar">
              <span style={{ fontWeight: 600 }}>MCP JSON-RPC 2.0 surface</span>
              <button
                type="button"
                className="ctrl-btn"
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(mcpConfigSnippet);
                    setCopiedMcp(true);
                    setTimeout(() => setCopiedMcp(false), 1800);
                  } catch {
                    // Clipboard unavailable in headless context
                  }
                }}
              >
                <span>{copiedMcp ? 'Copied' : 'Copy config'}</span>
              </button>
            </div>
            <div className="pane-scroll">
              <div className="detail-card">
                <p className="detail-meta">
                  Bring your own backend with your AI: connect to <span className="mono">/api/mcp</span> or
                  pull k-anonymous shards (<span className="mono">/api/v1/shard/:prefix</span>) to
                  organize your own media behind native frontends.
                </p>
                <div className="inst-sub" style={{ display: 'flex', flexWrap: 'wrap', gap: '10px' }}>
                  <a
                    href="https://github.com/todd866/onto-the-radio/blob/main/docs/BYO-BACKEND.md"
                    target="_blank"
                    rel="noreferrer"
                    style={{ color: 'var(--accent-radio)', textDecoration: 'none' }}
                  >
                    Onto the Radio BYO spec
                  </a>
                  <a
                    href="https://github.com/todd866/manifold/blob/main/docs/BYO-AI-ARCHITECTURE.md"
                    target="_blank"
                    rel="noreferrer"
                    style={{ color: 'var(--accent-radio)', textDecoration: 'none' }}
                  >
                    Architecture
                  </a>
                </div>
              </div>
              <pre className="code-box mono" style={{ marginBottom: 10 }}>
                {mcpConfigSnippet}
              </pre>
              {mcpTools.map((tool) => (
                <div
                  key={tool.name}
                  className="inst-row"
                  onClick={() => {
                    if (tool.name === 'manifold_status') {
                      runLiveMcpProbe('manifold_status', {});
                    } else if (tool.name === 'manifold_bridge') {
                      runLiveMcpProbe('manifold_bridge', {
                        workIdA: 'wikidata:Q151599',
                        workIdB: 'wikidata:Q207626',
                        limit: 4,
                      });
                    } else if (tool.name === 'manifold_apply_lens') {
                      runLiveMcpProbe('manifold_apply_lens', {
                        lensId: 'lens:radio:late-wire',
                        limit: 5,
                      });
                    } else if (tool.name === 'manifold_neighbours') {
                      runLiveMcpProbe('manifold_neighbours', {
                        workId: selectedWork?.workId || 'wikidata:Q752509',
                        k: 5,
                      });
                    } else {
                      runLiveMcpProbe('manifold_lenses', {});
                    }
                  }}
                  title={tool.description}
                >
                  <span className="mono inst-sub">&gt;</span>
                  <div>
                    <div className="inst-title mono">{tool.name}</div>
                    <div className="inst-sub">{tool.description}</div>
                  </div>
                  <div />
                  <div className="val-right inst-sub">POST</div>
                  <div className="datum-right">Run</div>
                </div>
              ))}
            </div>
          </section>

          <section className="pane" aria-label="Live MCP output">
            <div className="pane-bar">
              <span style={{ fontWeight: 600 }}>Probe readout</span>
              <span className="mono inst-sub">/api/mcp</span>
            </div>
            <div className="pane-scroll">
              <pre className="code-box mono">
                {mcpProbeOutput ||
                  'Click any MCP tool row on the left to execute a live JSON-RPC 2.0 call against /api/mcp.'}
              </pre>
            </div>
          </section>
        </main>
      )}
    </div>
  );
}
