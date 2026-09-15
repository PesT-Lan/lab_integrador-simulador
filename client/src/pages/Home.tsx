import { useEffect, useMemo, useState } from "react";
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  CircleStop,
  Gauge,
  Link2,
  MousePointerClick,
  Network,
  Play,
  RefreshCcw,
  Route,
  ShieldCheck,
  SlidersHorizontal,
  TimerReset,
  Unplug,
  X,
  Zap,
} from "lucide-react";

type ScenarioId = "healthy" | "congestion" | "microburst" | "combined";
type StrategyId = "ospf" | "agent";
type LinkId =
  | "h1-r1"
  | "r1-r2"
  | "r1-r3"
  | "r2-r3"
  | "r2-e1"
  | "r3-e2"
  | "e1-e2"
  | "e1-a1"
  | "e2-b1"
  | "a1-b1"
  | "a1-d1"
  | "b1-d1";
type ImpairmentKind = "latency" | "failure";
type Impairments = Partial<Record<LinkId, ImpairmentKind>>;

type Sample = {
  time: number;
  rtt: number;
  loss: number;
  goodput: number;
  degraded: boolean;
};

type LinkEffect = {
  failure: boolean;
  latencyMs: number;
};

const scenarios: Record<ScenarioId, { label: string; description: string; event: string }> = {
  healthy: {
    label: "Rede saudável",
    description: "Sem impairment. O caminho primário e1 permanece preferido.",
    event: "Sem evento injetado",
  },
  congestion: {
    label: "Congestionamento persistente",
    description: "Fila e limitação de capacidade no trânsito primário; Hellos OSPF continuam ativos.",
    event: "TBF 20 Mbit/s + tráfego de fundo",
  },
  microburst: {
    label: "Micro-rupturas",
    description: "Perda e atraso curtos e recorrentes abaixo do Dead Interval do OSPF.",
    event: "Netem: perda transitória a cada 5 s",
  },
  combined: {
    label: "Evento combinado",
    description: "Congestionamento e micro-rupturas no mesmo trânsito primário.",
    event: "TBF + Netem no enlace e1 → a1",
  },
};

const linkLabels: Record<LinkId, string> = {
  "h1-r1": "h1 ↔ r1 · acesso",
  "r1-r2": "r1 ↔ r2 · core A",
  "r1-r3": "r1 ↔ r3 · core B",
  "r2-r3": "r2 ↔ r3 · redundância",
  "r2-e1": "r2 ↔ e1 · egress primário",
  "r3-e2": "r3 ↔ e2 · egress alternativo",
  "e1-e2": "e1 ↔ e2 · inter-egress",
  "e1-a1": "e1 ↔ a1 · AS65010",
  "e2-b1": "e2 ↔ b1 · AS65020",
  "a1-b1": "a1 ↔ b1 · trânsito",
  "a1-d1": "a1 ↔ d1 · destino",
  "b1-d1": "b1 ↔ d1 · destino",
};

const primaryRouteLinks: LinkId[] = ["h1-r1", "r1-r2", "r2-e1", "e1-a1", "a1-d1"];
const alternateRouteLinks: LinkId[] = ["h1-r1", "r1-r3", "r3-e2", "e2-b1", "b1-d1"];

function metricFor(
  scenario: ScenarioId,
  strategy: StrategyId,
  time: number,
  effect: LinkEffect,
): Sample {
  const inEvent = time >= 120 && time < 240;
  const shifted = strategy === "agent" && time >= 160;
  let rtt = 24 + Math.sin(time / 17) * 1.8;
  let loss = Math.max(0, 0.18 + Math.sin(time / 23) * 0.12);
  let goodput = 92 + Math.cos(time / 19) * 1.8;

  if (inEvent && scenario !== "healthy" && !shifted) {
    if (scenario === "congestion" || scenario === "combined") {
      rtt += 40 + Math.sin(time / 8) * 4;
      loss += 3.4;
      goodput -= 40;
    }
    if (scenario === "microburst" || scenario === "combined") {
      rtt += 13 + Math.sin(time / 5) * 4;
      loss += 2.0 + Math.max(0, Math.sin(time / 4)) * 2.3;
      goodput -= 12;
    }
  }
  if (shifted && scenario !== "healthy") {
    rtt = 31 + Math.sin(time / 15) * 1.2;
    loss = Math.max(0, 0.32 + Math.sin(time / 11) * 0.1);
    goodput = 86 + Math.cos(time / 13) * 1.5;
  }
  if (effect.failure) {
    rtt += 50;
    loss += 8;
    goodput -= 55;
  } else {
    rtt += effect.latencyMs;
  }

  return {
    time,
    rtt: Number(Math.max(0, rtt).toFixed(1)),
    loss: Number(Math.max(0, loss).toFixed(2)),
    goodput: Number(Math.max(0, goodput).toFixed(1)),
    degraded: rtt > 45 || loss > 1 || goodput < 70,
  };
}

function Sparkline({ samples, field, color }: { samples: Sample[]; field: keyof Pick<Sample, "rtt" | "loss" | "goodput">; color: string }) {
  const values = samples.map((sample) => Number(sample[field]));
  const min = Math.min(...values, 0);
  const max = Math.max(...values, 1);
  const points = values
    .map((value, index) => {
      const x = (index / Math.max(1, values.length - 1)) * 100;
      const y = 42 - ((value - min) / Math.max(1, max - min)) * 34;
      return `${x},${y}`;
    })
    .join(" ");
  return (
    <svg viewBox="0 0 100 48" className="h-16 w-full overflow-visible" preserveAspectRatio="none" aria-label={`Curva de ${field}`}>
      <path d="M0 42 H100" stroke="rgba(148,163,184,.18)" strokeWidth="0.7" />
      <polyline points={points} fill="none" stroke={color} strokeWidth="2.4" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

type TopologyProps = {
  alternateActive: boolean;
  degraded: boolean;
  selectedLink: LinkId | null;
  impairments: Impairments;
  onSelectLink: (link: LinkId) => void;
};

function Topology({ alternateActive, degraded, selectedLink, impairments, onSelectLink }: TopologyProps) {
  const activeLinks = alternateActive ? alternateRouteLinks : primaryRouteLinks;
  const renderLink = (id: LinkId, d: string, baseClass: string) => {
    const impairment = impairments[id];
    const selected = selectedLink === id;
    const active = activeLinks.includes(id);
    const classes = [
      "topology-path",
      baseClass,
      active ? "route-active" : "route-muted",
      degraded && active && !alternateActive ? "route-alert" : "",
      impairment === "latency" ? "link-latency" : "",
      impairment === "failure" ? "link-failure" : "",
      selected ? "link-selected" : "",
    ].filter(Boolean).join(" ");
    return (
      <g
        key={id}
        className="topology-link-group"
        role="button"
        tabIndex={0}
        aria-label={`${linkLabels[id]}${impairment ? ` · ${impairment === "failure" ? "falha" : "pico de latência"}` : ""}`}
        aria-pressed={selected}
        onClick={() => onSelectLink(id)}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            onSelectLink(id);
          }
        }}
      >
        <path d={d} className="link-hitarea" />
        <path d={d} className={classes} />
        {impairment && <g className={`link-badge ${impairment}`}><circle cx={badgePosition[id][0]} cy={badgePosition[id][1]} r="10" /><text x={badgePosition[id][0]} y={badgePosition[id][1] + 4}>{impairment === "failure" ? "×" : "+"}</text></g>}
      </g>
    );
  };

  return (
    <div className="topology-shell" aria-label="Mapa interativo da topologia Multi-AS do laboratório">
      <svg viewBox="0 0 760 290" role="img">
        <defs>
          <filter id="glow"><feGaussianBlur stdDeviation="3" result="blur" /><feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge></filter>
        </defs>
        <text x="35" y="32" className="zone-label">AS65001 · DOMÍNIO LOCAL</text>
        <text x="535" y="32" className="zone-label">TRÂNSITO / DESTINO</text>
        {renderLink("h1-r1", "M104 143 L140 143", "primary-link")}
        {renderLink("r1-r2", "M140 143 L265 94", "primary-link")}
        {renderLink("r1-r3", "M140 143 L265 197", "alternate-link")}
        {renderLink("r2-e1", "M265 94 L394 94", "primary-link")}
        {renderLink("r3-e2", "M265 197 L394 197", "alternate-link")}
        {renderLink("e1-a1", "M394 94 L514 94", "primary-link")}
        {renderLink("e2-b1", "M394 197 L514 197", "alternate-link")}
        {renderLink("a1-d1", "M514 94 L660 143", "primary-link")}
        {renderLink("b1-d1", "M514 197 L660 143", "alternate-link")}
        {renderLink("r2-r3", "M265 94 L265 197", "internal-link")}
        {renderLink("e1-e2", "M394 94 L394 197", "internal-link")}
        {renderLink("a1-b1", "M514 94 L514 197", "internal-link")}
        <g className="node"><circle cx="104" cy="143" r="29" /><text x="104" y="139">h1</text><text x="104" y="160" className="node-sub">cliente</text></g>
        <g className="node"><circle cx="265" cy="94" r="29" /><text x="265" y="90">r2</text><text x="265" y="111" className="node-sub">core A</text></g>
        <g className="node"><circle cx="265" cy="197" r="29" /><text x="265" y="193">r3</text><text x="265" y="214" className="node-sub">core B</text></g>
        <g className={`node ${degraded && !alternateActive ? "node-alert" : ""}`}><circle cx="394" cy="94" r="30" /><text x="394" y="90">e1</text><text x="394" y="111" className="node-sub">egress 1</text></g>
        <g className={`node ${alternateActive ? "node-good" : ""}`}><circle cx="394" cy="197" r="30" /><text x="394" y="193">e2</text><text x="394" y="214" className="node-sub">egress 2</text></g>
        <g className={`node ${degraded && !alternateActive ? "node-alert" : ""}`}><circle cx="514" cy="94" r="30" /><text x="514" y="90">a1</text><text x="514" y="111" className="node-sub">AS65010</text></g>
        <g className={`node ${alternateActive ? "node-good" : ""}`}><circle cx="514" cy="197" r="30" /><text x="514" y="193">b1</text><text x="514" y="214" className="node-sub">AS65020</text></g>
        <g className="node destination"><circle cx="660" cy="143" r="31" /><text x="660" y="139">d1</text><text x="660" y="160" className="node-sub">AS65099</text></g>
        <g className="node ingress"><circle cx="140" cy="143" r="30" /><text x="140" y="139">r1</text><text x="140" y="160" className="node-sub">ingress</text></g>
        <text x="330" y="62" className="link-label">primário</text><text x="330" y="244" className="link-label">alternativo</text>
      </svg>
      <div className="topology-legend"><span><i className="legend-dot good" /> caminho ativo</span><span><i className="legend-dot alert" /> degradação observada</span><span><i className="legend-dot neutral" /> caminho disponível</span><span><i className="legend-dot violet" /> selecionado</span></div>
      <div className="map-instruction"><MousePointerClick className="h-3.5 w-3.5" /> Clique em qualquer enlace para selecionar e injetar um evento</div>
    </div>
  );
}

const badgePosition: Record<LinkId, [number, number]> = {
  "h1-r1": [122, 130],
  "r1-r2": [202, 111],
  "r1-r3": [202, 177],
  "r2-r3": [280, 145],
  "r2-e1": [330, 83],
  "r3-e2": [330, 209],
  "e1-e2": [409, 145],
  "e1-a1": [454, 83],
  "e2-b1": [454, 209],
  "a1-b1": [529, 145],
  "a1-d1": [580, 111],
  "b1-d1": [580, 177],
};

function LinkControl({ selectedLink, impairments, onInject, onClear, onClearAll }: { selectedLink: LinkId | null; impairments: Impairments; onInject: (kind: ImpairmentKind) => void; onClear: () => void; onClearAll: () => void }) {
  const impairment = selectedLink ? impairments[selectedLink] : undefined;
  return (
    <div className={`link-control-panel ${selectedLink ? "has-selection" : ""}`}>
      <div className="link-control-main">
        <div className="link-control-icon"><Link2 className="h-4 w-4" /></div>
        <div className="min-w-0"><p className="link-control-kicker">Injeção manual no mapa</p><h3>{selectedLink ? linkLabels[selectedLink] : "Selecione um enlace na topologia"}</h3><p>{selectedLink ? "O evento afeta as métricas imediatamente e fica visível no mapa." : "Escolha um trecho para abrir as ações de demonstração."}</p></div>
        {impairment && <span className={`impairment-chip ${impairment}`}>{impairment === "failure" ? "falha ativa" : "+20 ms ativo"}</span>}
      </div>
      <div className="link-control-actions">
        <button className="inject-button latency" onClick={() => onInject("latency")} disabled={!selectedLink}><Zap className="h-3.5 w-3.5" /> Injetar +20 ms</button>
        <button className="inject-button failure" onClick={() => onInject("failure")} disabled={!selectedLink}><Unplug className="h-3.5 w-3.5" /> Simular falha</button>
        <button className="inject-button clear" onClick={onClear} disabled={!selectedLink || !impairment}><X className="h-3.5 w-3.5" /> Normalizar enlace</button>
        <button className="clear-all" onClick={onClearAll} disabled={Object.keys(impairments).length === 0}>Limpar todos</button>
      </div>
    </div>
  );
}

export default function Home() {
  const [scenario, setScenario] = useState<ScenarioId>("congestion");
  const [strategy, setStrategy] = useState<StrategyId>("agent");
  const [running, setRunning] = useState(false);
  const [time, setTime] = useState(0);
  const [selectedLink, setSelectedLink] = useState<LinkId | null>(null);
  const [impairments, setImpairments] = useState<Impairments>({});

  useEffect(() => {
    if (!running) return;
    const timer = window.setInterval(() => setTime((current) => (current >= 300 ? 0 : current + 10)), 520);
    return () => window.clearInterval(timer);
  }, [running]);

  useEffect(() => {
    setTime(0);
    setRunning(false);
  }, [scenario, strategy]);

  const alternateActive = strategy === "agent" && time >= 160 && scenario !== "healthy";
  const activeLinks = alternateActive ? alternateRouteLinks : primaryRouteLinks;
  const manualEffect = useMemo<LinkEffect>(() => activeLinks.reduce<LinkEffect>((effect, link) => {
    const impairment = impairments[link];
    if (impairment === "failure") effect.failure = true;
    if (impairment === "latency") effect.latencyMs += 20;
    return effect;
  }, { failure: false, latencyMs: 0 }), [activeLinks, impairments]);
  const sample = metricFor(scenario, strategy, time, manualEffect);
  const samples = useMemo(() => Array.from({ length: 25 }, (_, index) => metricFor(scenario, strategy, index * 10, manualEffect)), [scenario, strategy, manualEffect]);
  const eventActive = time >= 120 && time < 240 && scenario !== "healthy";
  const recommendation = (eventActive || manualEffect.failure || manualEffect.latencyMs > 0) && !alternateActive && strategy === "agent" && (time >= 140 || manualEffect.failure || manualEffect.latencyMs > 0);
  const selectedImpairment = selectedLink ? impairments[selectedLink] : undefined;
  const status = alternateActive ? "Rota alternativa validada" : manualEffect.failure ? "Falha injetada no caminho ativo" : manualEffect.latencyMs > 0 ? "Pico de latência injetado" : recommendation ? "Degradação persistente detectada" : eventActive ? "OSPF mantém adjacência ativa" : "Telemetria dentro dos SLOs";

  const inject = (kind: ImpairmentKind) => {
    if (!selectedLink) return;
    setImpairments((current) => ({ ...current, [selectedLink]: kind }));
    setRunning(false);
  };
  const clearSelected = () => {
    if (!selectedLink) return;
    setImpairments((current) => {
      const next = { ...current };
      delete next[selectedLink];
      return next;
    });
  };
  const reset = () => {
    setRunning(false);
    setTime(0);
    setSelectedLink(null);
    setImpairments({});
  };

  return (
    <main className="min-h-screen bg-[#07111f] text-slate-100">
      <div className="noise" />
      <header className="border-b border-slate-700/60 bg-[#091725]/80 backdrop-blur-xl">
        <div className="mx-auto flex max-w-[1480px] items-center justify-between px-5 py-4 lg:px-8">
          <div className="flex items-center gap-3"><div className="grid h-10 w-10 place-items-center rounded-xl border border-cyan-300/30 bg-cyan-400/10 text-cyan-300"><Network className="h-5 w-5" /></div><div><p className="text-sm font-bold tracking-[0.16em] text-cyan-200">LAB INTEGRADOR</p><p className="text-xs text-slate-400">Engenharia de tráfego adjacente ao OSPF</p></div></div>
          <div className="hidden items-center gap-5 text-xs text-slate-400 md:flex"><span>AS65001</span><span className="h-4 w-px bg-slate-700" /><span>FRR + Vagrant</span><span className="h-4 w-px bg-slate-700" /><span>Mapa interativo</span></div>
        </div>
      </header>

      <section className="mx-auto max-w-[1480px] px-5 pb-10 pt-8 lg:px-8">
        <div className="mb-7 grid gap-6 xl:grid-cols-[1.4fr_.6fr] xl:items-end">
          <div><div className="mb-3 inline-flex items-center gap-2 rounded-full border border-cyan-300/20 bg-cyan-300/5 px-3 py-1 text-xs font-medium text-cyan-200"><Activity className="h-3.5 w-3.5" /> Simulador de defesa — mapa operacional</div><h1 className="max-w-4xl text-3xl font-bold tracking-tight text-white sm:text-4xl">Quando o caminho permanece vivo, mas o desempenho deixa de atender ao serviço.</h1><p className="mt-3 max-w-3xl text-sm leading-6 text-slate-400">Clique em um enlace da topologia para selecionar o trecho e injete uma falha ou um pico de latência. O agente reage às métricas alteradas sem esconder a diferença entre evento manual, impairment de cenário e decisão OSPF.</p></div>
          <div className="rounded-2xl border border-amber-300/20 bg-amber-300/5 p-4 text-sm text-amber-100"><div className="flex gap-3"><AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-300" /><p><strong>Escopo didático.</strong> Os eventos do mapa são sintéticos e locais à demonstração. Resultados científicos continuam dependendo da campanha emulada com Vagrant, FRR, <code>tc</code> e dados versionados.</p></div></div>
        </div>

        <div className="dashboard-grid">
          <aside className="control-panel">
            <div className="panel-title"><SlidersHorizontal className="h-4 w-4 text-cyan-300" /> Configuração da demonstração</div>
            <label className="control-label">Evento no trânsito primário</label>
            <div className="space-y-2">{(Object.keys(scenarios) as ScenarioId[]).map((id) => <button key={id} onClick={() => setScenario(id)} className={`choice ${scenario === id ? "selected" : ""}`}><span className="choice-radio" /><span><b>{scenarios[id].label}</b><small>{scenarios[id].description}</small></span></button>)}</div>
            <label className="control-label mt-6">Estratégia avaliada</label>
            <div className="grid grid-cols-2 gap-2"><button className={`strategy ${strategy === "ospf" ? "selected" : ""}`} onClick={() => setStrategy("ospf")}><Route className="h-4 w-4" /><span>OSPF baseline</span></button><button className={`strategy ${strategy === "agent" ? "selected" : ""}`} onClick={() => setStrategy("agent")}><ShieldCheck className="h-4 w-4" /><span>OSPF + agente</span></button></div>
            <div className="mt-6 rounded-xl border border-slate-700 bg-slate-950/40 p-3"><div className="mb-2 flex items-center justify-between text-xs"><span className="text-slate-400">Relógio experimental</span><b className="font-mono text-cyan-200">t = {time}s</b></div><div className="timeline"><span style={{ width: `${(time / 300) * 100}%` }} /></div><div className="mt-2 flex justify-between text-[10px] uppercase tracking-wider text-slate-500"><span>Warm-up</span><span>Evento 120–240s</span><span>Fim</span></div></div>
            <div className="mt-5 flex gap-2"><button className="action-button primary" onClick={() => setRunning((value) => !value)}>{running ? <><CircleStop className="h-4 w-4" /> Pausar</> : <><Play className="h-4 w-4" /> Iniciar</>}</button><button className="action-button" onClick={reset}><RefreshCcw className="h-4 w-4" /> Reiniciar</button></div>
          </aside>

          <section className="space-y-4">
            <div className="status-bar"><div className={`status-icon ${alternateActive ? "good" : sample.degraded ? "alert" : ""}`}>{alternateActive ? <CheckCircle2 /> : sample.degraded ? <AlertTriangle /> : <Gauge />}</div><div><p className="text-xs uppercase tracking-[0.15em] text-slate-500">Estado do experimento</p><h2>{status}</h2><p>{selectedImpairment ? `${linkLabels[selectedLink as LinkId]} · ${selectedImpairment === "failure" ? "falha manual" : "latência manual +20 ms"}` : eventActive ? scenarios[scenario].event : "Medição de baseline: janela móvel de 10 segundos"}</p></div><div className="ml-auto hidden text-right text-xs text-slate-400 sm:block"><span className="block">Egress efetivo</span><b className={alternateActive ? "text-emerald-300" : "text-cyan-200"}>{alternateActive ? "e2 → AS65020" : "e1 → AS65010"}</b></div></div>
            <Topology alternateActive={alternateActive} degraded={sample.degraded && !alternateActive} selectedLink={selectedLink} impairments={impairments} onSelectLink={setSelectedLink} />
            <LinkControl selectedLink={selectedLink} impairments={impairments} onInject={inject} onClear={clearSelected} onClearAll={() => setImpairments({})} />
            <div className="metrics-grid">
              <MetricCard label="RTT p95" value={`${sample.rtt} ms`} goal="SLO ≤ 45 ms" tone={sample.rtt > 45 ? "alert" : "good"} samples={samples} field="rtt" color="#38bdf8" />
              <MetricCard label="Perda de sondas" value={`${sample.loss}%`} goal="SLO ≤ 1%" tone={sample.loss > 1 ? "alert" : "good"} samples={samples} field="loss" color="#fbbf24" />
              <MetricCard label="Goodput recebido" value={`${sample.goodput} Mbit/s`} goal="SLO ≥ 70 Mbit/s" tone={sample.goodput < 70 ? "alert" : "good"} samples={samples} field="goodput" color="#34d399" />
            </div>
          </section>

          <aside className="decision-panel">
            <div className="panel-title"><TimerReset className="h-4 w-4 text-violet-300" /> Loop de decisão seguro</div>
            <ol className="decision-list"><DecisionStep number="01" label="Coletar" detail="RTT p95, perda, goodput, FIB e saúde da telemetria" active /><DecisionStep number="02" label="Persistir" detail={`${eventActive || manualEffect.failure || manualEffect.latencyMs > 0 ? "degradação em observação" : "aguardando evento"}`} active={recommendation || alternateActive} /><DecisionStep number="03" label="Validar candidato" detail="e2 alcançável e dentro do SLO" active={recommendation || alternateActive} /><DecisionStep number="04" label="Aplicar e verificar" detail={alternateActive ? "FIB alterada; três janelas saudáveis" : "bloqueado até cumprir guardrails"} active={alternateActive} /></ol>
            <div className={`recommendation ${recommendation || alternateActive ? "visible" : ""}`}><ArrowRight className="h-4 w-4" /><div><b>{alternateActive ? "Ação confirmada" : "Recomendação pronta"}</b><p>{alternateActive ? "Custo local ajustado; e2 foi validado como novo egress." : "Elevar custo para e1 e desviar para e2, sujeito a cooldown e rollback."}</p></div></div>
            <div className="guardrails"><p>Guardrails ativos</p><span>telemetria fresca</span><span>persistência 3/5</span><span>cooldown 120 s</span><span>máx. 2 mudanças</span><span>rollback</span></div>
          </aside>
        </div>

        <section className="mt-6 grid gap-4 lg:grid-cols-3"><InfoCard title="Como demonstrar" text="Clique em e1 ↔ a1, injete +20 ms ou falha e compare o baseline OSPF com o agente." /><InfoCard title="Pergunta de pesquisa" text="O agente reduz a duração e a severidade de violações de SLO quando o OSPF mantém a adjacência ativa?" /><InfoCard title="Métricas para análise" text="A_SLO, T_det, T_rec, L_trans, churn, falsos positivos, overhead e taxa de rollback." /></section>
        <footer className="mt-10 border-t border-slate-800/80 pt-5 text-center text-xs text-slate-500"><p>Desenvolvido por <span className="font-medium text-cyan-200">Luís Rodrigo Amaral</span> para o <span className="font-medium text-slate-300">Projeto Integrador Unisenac Pelotas</span>.</p></footer>
      </section>
    </main>
  );
}

function MetricCard({ label, value, goal, tone, samples, field, color }: { label: string; value: string; goal: string; tone: "good" | "alert"; samples: Sample[]; field: keyof Pick<Sample, "rtt" | "loss" | "goodput">; color: string }) {
  return <article className={`metric-card ${tone}`}><div className="flex items-start justify-between"><div><p>{label}</p><h3>{value}</h3></div><span>{goal}</span></div><Sparkline samples={samples} field={field} color={color} /></article>;
}

function DecisionStep({ number, label, detail, active }: { number: string; label: string; detail: string; active?: boolean }) {
  return <li className={active ? "active" : ""}><span>{number}</span><div><b>{label}</b><p>{detail}</p></div></li>;
}

function InfoCard({ title, text }: { title: string; text: string }) {
  return <article className="info-card"><p className="text-xs font-bold uppercase tracking-[0.14em] text-cyan-300">{title}</p><p className="mt-2 text-sm leading-6 text-slate-400">{text}</p></article>;
}
