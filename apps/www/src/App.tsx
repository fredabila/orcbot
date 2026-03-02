import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import './index.css';

const TERMINAL_LINES = [
  { delay: 0,    text: '$ orcbot start',                                 color: 'prompt' },
  { delay: 600,  text: '✓ Loading memory (1,240 entries)…',              color: 'ok' },
  { delay: 1100, text: '✓ LLM provider: Gemini 2.0 Flash',               color: 'ok' },
  { delay: 1600, text: '✓ Telegram channel connected',                   color: 'ok' },
  { delay: 2100, text: '✓ Heartbeat scheduler active (15 min)',           color: 'ok' },
  { delay: 2400, text: '✓ TForce Tactical Monitor: Risk LOW',               color: 'ok' },
  { delay: 2700, text: '● Agent is live — awaiting tasks',               color: 'live' },
  { delay: 3400, text: '[Heartbeat] Idle 18m — running proactive check',  color: 'info' },
  { delay: 3800, text: '[TForce] Routing activated: [research, memory]',  color: 'info' },
  { delay: 4200, text: '→ search_memory_logs("last status report")',      color: 'tool' },
  { delay: 4800, text: '→ send_telegram(userId, summary)',                color: 'tool' },
  { delay: 5400, text: '✓ Task completed — goalsMet: true',              color: 'ok' },
];

function TerminalDemo() {
  const [visibleCount, setVisibleCount] = useState(0);
  useEffect(() => {
    TERMINAL_LINES.forEach((_, idx) => {
      setTimeout(() => setVisibleCount(idx + 1), TERMINAL_LINES[idx].delay + 400);
    });
  }, []);
  return (
    <div className="terminal-demo">
      <div className="terminal-demo-bar">
        <span className="tdb-dot red" /><span className="tdb-dot yellow" /><span className="tdb-dot green" />
        <span className="tdb-title">orcbot — zsh</span>
      </div>
      <div className="terminal-demo-body">
        {TERMINAL_LINES.slice(0, visibleCount).map((line, i) => (
          <div key={i} className={`tl tl-${line.color}`}>
            {line.text}{i === visibleCount - 1 && <span className="tl-cursor" />}
          </div>
        ))}
      </div>
    </div>
  );
}

function App() {
  const [copied, setCopied] = useState(false);
  const [activeTab, setActiveTab] = useState<'bash' | 'powershell' | 'docker'>('bash');
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 20);
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  const commands = {
    bash: 'curl -sSL https://orcbot.vercel.app/install.sh | bash',
    powershell: 'iwr https://orcbot.vercel.app/install.ps1 | iex',
    docker: 'docker compose -f docker-compose.minimal.yml up -d',
  };

  const copyToClipboard = () => {
    navigator.clipboard.writeText(commands[activeTab]);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="app">
      <div className="bg-gradient-orbs" />
      <div className="noise-overlay" />

      {/* ── Nav ── */}
      <nav className={`nav ${scrolled ? 'nav-scrolled' : ''}`}>
        <Link to="/" className="logo">
          <svg className="logo-mark" width="28" height="28" viewBox="0 0 28 28" fill="none">
            <rect width="28" height="28" rx="7" fill="#5cffb3" fillOpacity="0.15" />
            <path d="M8 14l4 4 8-8" stroke="#5cffb3" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"/>
            <circle cx="21" cy="7" r="2.5" fill="#5cffb3" />
          </svg>
          <span className="logo-text">OrcBot</span>
        </Link>

        <button className="mobile-toggle" onClick={() => setMobileMenuOpen(!mobileMenuOpen)} aria-label="Toggle menu">
          <span className={`hamburger ${mobileMenuOpen ? 'open' : ''}`} />
        </button>

        <div className={`nav-center ${mobileMenuOpen ? 'open' : ''}`}>
          <a href="#capabilities" onClick={() => setMobileMenuOpen(false)}>Capabilities</a>
          <a href="#how-it-works" onClick={() => setMobileMenuOpen(false)}>How It Works</a>
          <a href="#architecture" onClick={() => setMobileMenuOpen(false)}>Architecture</a>
          <a href="#docs" onClick={() => setMobileMenuOpen(false)}>Docs</a>
          <Link to="/skills" onClick={() => setMobileMenuOpen(false)}>Skills</Link>
          <Link to="/saas" onClick={() => setMobileMenuOpen(false)}>SaaS Farm</Link>
          <Link to="/deploy" onClick={() => setMobileMenuOpen(false)}>Deploy</Link>
        </div>

        <div className="nav-end">
          <a className="nav-btn ghost" href="https://fredabila.github.io/orcbot/docs/" target="_blank" rel="noopener noreferrer">Docs</a>
          <a className="nav-btn primary" href="https://github.com/fredabila/orcbot" target="_blank" rel="noopener noreferrer">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor"><path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z"/></svg>
            GitHub
          </a>
        </div>
      </nav>

      {/* ── Hero ── */}
      <header className="hero">
        <div className="hero-grid">
          <div className="hero-copy">
            <div className="hero-badge">
              <span className="badge-dot" /><span className="badge-pulse" />
              Open Source · v2.2
            </div>

            <h1 className="hero-title">
              The autonomous AI<br />
              <span className="hero-title-em">operating system</span><br />
              for operators.
            </h1>

            <p className="hero-subtitle">
              Plan, execute, self-repair, and stay local. OrcBot is built for real
              operations — multi-agent, memory-aware, and always on your hardware.
            </p>

            <div className="hero-actions">
              <a className="btn btn-primary btn-lg" href="#install">
                Get Started Free
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14M12 5l7 7-7 7"/></svg>
              </a>
              <a className="btn btn-outline btn-lg" href="https://github.com/fredabila/orcbot" target="_blank" rel="noopener noreferrer">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor"><path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z"/></svg>
                View on GitHub
              </a>
            </div>

            <div className="hero-stats">
              {[
                { label: 'LLM Providers', value: '6+' },
                { label: 'Built-in Skills', value: '30+' },
                { label: 'Chat Channels', value: '4' },
                { label: 'Extensibility', value: '∞' },
              ].map((s, i) => (
                <div className="hero-stat" key={i}>
                  <span className="hero-stat-value">{s.value}</span>
                  <span className="hero-stat-label">{s.label}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="hero-media">
            <TerminalDemo />
          </div>
        </div>

        <div className="integrations-row">
          <span className="int-label">Works with</span>
          <div className="int-chips">
            {['OpenAI', 'Gemini', 'Claude', 'Mistral', 'NVIDIA', 'Bedrock', 'Telegram', 'WhatsApp', 'Discord', 'Playwright', 'Docker'].map((n) => (
              <span className="int-chip" key={n}>{n}</span>
            ))}
          </div>
        </div>
      </header>

      <main>
        {/* ── Install ── */}
        <section id="install" className="install-section section-inner">
          <div className="install-shell">
            <div className="install-head">
              <div>
                <p className="section-label">Quick Install</p>
                <h2 className="section-title">Launch your agent in minutes.</h2>
                <p className="section-desc">Pick your platform and copy the command. OrcBot ships with sensible defaults and a guided setup wizard.</p>
              </div>
              <div className="install-tabs">
                {(['bash', 'powershell', 'docker'] as const).map(tab => (
                  <button key={tab} className={`install-tab ${activeTab === tab ? 'active' : ''}`} onClick={() => setActiveTab(tab)}>
                    {tab === 'bash' ? 'Linux / macOS' : tab === 'powershell' ? 'Windows' : 'Docker'}
                  </button>
                ))}
              </div>
            </div>
            <div className="install-terminal">
              <span className="terminal-prompt">$</span>
              <code className="terminal-cmd">{commands[activeTab]}</code>
              <button className={`terminal-copy ${copied ? 'copied' : ''}`} onClick={copyToClipboard}>
                {copied ? (
                  <><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg> Copied</>
                ) : 'Copy'}
              </button>
            </div>
            <div className="install-footnote">
              <span>Requires Node.js ≥ 18</span>
              <span className="dot-sep">·</span>
              <a href="https://fredabila.github.io/orcbot/docs/getting-started.html" target="_blank" rel="noopener noreferrer">Full setup guide →</a>
            </div>
          </div>
        </section>

        {/* ── Capabilities ── */}
        <section id="capabilities" className="section section-inner">
          <div className="section-label">Capabilities</div>
          <h2 className="section-title">Everything an autonomous operator needs.</h2>
          <p className="section-desc">Opinionated, tactical, and resilient. OrcBot thinks ahead, delegates intelligently, and fixes itself when it breaks.</p>
          <div className="marquee-section">
            <div className="marquee-fade-wrap">
              <div className="marquee-track">
                {[
                  { icon: '🛡️', title: 'TForce Tactical Guard', desc: 'Real-time health monitor that detects loops, fatigue, and ghosting, injecting automated recovery plans into the reasoning loop.' },
                  { icon: '🐙', title: 'Recursive Helper Routing', desc: 'A sophisticated PromptRouter that intelligently activates related domain helpers (Browser -> Media) for seamless task execution.' },
                  { icon: '🔍', title: 'Deep Memory Recall', desc: 'Dual-layered search system combining metadata-filtered semantic embeddings with literal file-based log retrieval.' },
                  { icon: '🧠', title: 'Strategic Planning', desc: 'Simulates tasks before execution with roadmaps, contingencies, and loop protections built-in.' },
                  { icon: '🛡️', title: 'TForce Tactical Guard', desc: 'Real-time health monitor that detects loops, fatigue, and ghosting, injecting automated recovery plans into the reasoning loop.' },
                  { icon: '🐙', title: 'Recursive Helper Routing', desc: 'A sophisticated PromptRouter that intelligently activates related domain helpers (Browser -> Media) for seamless task execution.' },
                  { icon: '🔍', title: 'Deep Memory Recall', desc: 'Dual-layered search system combining metadata-filtered semantic embeddings with literal file-based log retrieval.' },
                  { icon: '🧠', title: 'Strategic Planning', desc: 'Simulates tasks before execution with roadmaps, contingencies, and loop protections built-in.' },
                ].map((cap, i) => (
                  <div className="marquee-card capability-card" key={i}>
                    <div className="capability-icon-wrap"><span className="capability-icon">{cap.icon}</span></div>
                    <h3>{cap.title}</h3>
                    <p>{cap.desc}</p>
                  </div>
                ))}
              </div>
            </div>
            <div className="marquee-fade-wrap">
              <div className="marquee-track marquee-track-reverse">
                {[
                  { icon: '⚡', title: 'Self-Evolving Skills', desc: 'Researches, writes, and installs its own TypeScript plugins when new capabilities are needed.' },
                  { icon: '🛡️', title: 'Guard Rails & Safety', desc: 'Loop detection, termination review, skill frequency limits, and deduplication protection.' },
                  { icon: '🧩', title: 'Smart Skill Routing', desc: 'Intent-based skill selection with configurable routing rules for optimal tool matching.' },
                  { icon: '🔒', title: 'Privacy First', desc: 'All logs, memories, configs, and context stay on your hardware. You own everything.' },
                  { icon: '⚡', title: 'Self-Evolving Skills', desc: 'Researches, writes, and installs its own TypeScript plugins when new capabilities are needed.' },
                  { icon: '🛡️', title: 'Guard Rails & Safety', desc: 'Loop detection, termination review, skill frequency limits, and deduplication protection.' },
                  { icon: '🧩', title: 'Smart Skill Routing', desc: 'Intent-based skill selection with configurable routing rules for optimal tool matching.' },
                  { icon: '🔒', title: 'Privacy First', desc: 'All logs, memories, configs, and context stay on your hardware. You own everything.' },
                ].map((cap, i) => (
                  <div className="marquee-card capability-card" key={i}>
                    <div className="capability-icon-wrap"><span className="capability-icon">{cap.icon}</span></div>
                    <h3>{cap.title}</h3>
                    <p>{cap.desc}</p>
                  </div>
                ))}
              </div>
            </div>
            <div className="marquee-cta">
              <Link to="/skills" className="btn btn-outline btn-sm">Explore all {'>'}30 built-in skills →</Link>
            </div>
          </div>
        </section>

        {/* ── How It Works ── */}
        <section id="how-it-works" className="section section-inner">
          <div className="section-label">How It Works</div>
          <h2 className="section-title">The autonomy loop, engineered for reliability.</h2>
          <p className="section-desc">Heartbeat-driven, stateful, and resilient — designed for overnight operations without babysitting.</p>
          <div className="steps-grid">
            {[
              { num: '01', title: 'Heartbeat fires', desc: 'Context-aware scheduling with smart backoff when idle — saves resources and avoids spam.' },
              { num: '02', title: 'Decide & plan', desc: 'Analyzes conversations, picks follow-ups, research tasks, outreach, or worker delegation.' },
              { num: '03', title: 'Parallel execution', desc: 'Complex tasks spawn isolated worker processes for parallel execution with IPC sync.' },
              { num: '04', title: 'Learn & repair', desc: 'Broken plugins self-repair; results log to memory; lessons persist to the knowledge base.' },
            ].map((step, i) => (
              <div className="step-item" key={i}>
                <div className="step-num">{step.num}</div>
                <div className="step-body"><h4>{step.title}</h4><p>{step.desc}</p></div>
              </div>
            ))}
          </div>
        </section>

        {/* ── Architecture ── */}
        <section id="architecture" className="section section-inner">
          <div className="section-label">Architecture</div>
          <h2 className="section-title">Local-first, modular, and fully swappable.</h2>
          <p className="section-desc">Every block can be replaced — bring your own model, channels, or tools. Nothing is locked in.</p>
          <div className="arch-grid">
            {[
              { color: '#5cffb3', title: 'Channels', items: ['Telegram', 'WhatsApp', 'Discord', 'Web Gateway', 'CLI / TUI'] },
              { color: '#5cc9ff', title: 'Core Engine', items: ['Decision Engine', 'Pipeline & Guards', 'Orchestrator', 'Smart Heartbeat', 'Action Queue', 'Memory + Vectors'] },
              { color: '#ffb347', title: 'Execution', items: ['Worker Processes', 'Skills Manager', 'Web Browser', 'Plugin System'] },
              { color: '#c77fff', title: 'Providers', items: ['OpenAI / Gemini / Claude', 'Bedrock / NVIDIA / OpenRouter', 'Search APIs', 'CAPTCHA Solver'] },
            ].map((col, i) => (
              <div className="arch-card" key={i} style={{ '--arch-color': col.color } as React.CSSProperties}>
                <div className="arch-title">{col.title}</div>
                <div className="arch-list">
                  {col.items.map((item, j) => (
                    <span key={j}><span className="arch-bullet">▸</span>{item}</span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* ── Docs ── */}
        <section id="docs" className="section section-inner">
          <div className="section-label">Documentation</div>
          <h2 className="section-title">Learn, customize, and master.</h2>
          <p className="section-desc">Guides that move fast — from first run to production ops.</p>
          <div className="docs-grid">
            {[
              { icon: '🚀', title: 'Getting Started', desc: 'Quick setup guide — running in under 5 minutes.', url: 'https://fredabila.github.io/orcbot/docs/getting-started.html' },
              { icon: '🏗️', title: 'Architecture', desc: 'Deep dive into modular design and component contracts.', url: 'https://fredabila.github.io/orcbot/docs/architecture.html' },
              { icon: '🧩', title: 'Skills & Plugins', desc: 'Core skills reference and how to author custom ones.', url: 'https://fredabila.github.io/orcbot/docs/skills.html' },
              { icon: '⚙️', title: 'Configuration', desc: 'Providers, channels, and every advanced setting.', url: 'https://fredabila.github.io/orcbot/docs/configuration.html' },
              { icon: '🐳', title: 'Docker Deployment', desc: 'Run OrcBot anywhere with Docker Compose.', url: 'https://fredabila.github.io/orcbot/docs/docker.html' },
              { icon: '📚', title: 'Full Documentation', desc: 'All guides, API references, and examples in one place.', url: 'https://fredabila.github.io/orcbot/docs/', featured: true },
            ].map((doc, i) => (
              <a href={doc.url} target="_blank" rel="noopener noreferrer" className={`doc-card ${(doc as any).featured ? 'featured' : ''}`} key={i}>
                <div className="doc-card-icon">{doc.icon}</div>
                <div className="doc-card-body"><h3>{doc.title}</h3><p>{doc.desc}</p></div>
                <span className="doc-card-arrow">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M7 17L17 7M17 7H7M17 7v10"/></svg>
                </span>
              </a>
            ))}
          </div>
        </section>

        {/* ── CTA ── */}
        <section className="cta-section section-inner">
          <div className="cta-glow" />
          <div className="cta-inner">
            <div className="cta-badge">Open Source &amp; Free Forever</div>
            <h2>Give your AI an operating system.</h2>
            <p>Autonomy, memory, and strategy — ready for production workflows, today.</p>
            <div className="cta-actions">
              <a className="btn btn-primary btn-lg" href="#install">Install OrcBot</a>
              <Link className="btn btn-outline btn-lg" to="/deploy">Deploy to Cloud</Link>
            </div>
          </div>
        </section>
      </main>

      {/* ── Footer ── */}
      <footer className="site-footer">
        <div className="footer-top">
          <div className="footer-brand">
            <Link to="/" className="logo footer-logo">
              <svg className="logo-mark" width="26" height="26" viewBox="0 0 28 28" fill="none">
                <rect width="28" height="28" rx="7" fill="#5cffb3" fillOpacity="0.15" />
                <path d="M8 14l4 4 8-8" stroke="#5cffb3" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"/>
                <circle cx="21" cy="7" r="2.5" fill="#5cffb3" />
              </svg>
              <span>OrcBot</span>
            </Link>
            <p className="footer-brand-desc">An autonomous AI operating system for operators. Local-first, memory-aware, and always on your hardware.</p>
            <div className="footer-socials">
              <a href="https://github.com/fredabila/orcbot" target="_blank" rel="noopener noreferrer" aria-label="GitHub">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z"/></svg>
              </a>
              <a href="https://twitter.com/orcbot_ai" target="_blank" rel="noopener noreferrer" aria-label="Twitter / X">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>
              </a>
            </div>
          </div>
          <div className="footer-cols">
            <div className="footer-col">
              <h4>Product</h4>
              <a href="#capabilities">Capabilities</a>
              <a href="#how-it-works">How It Works</a>
              <a href="#architecture">Architecture</a>
              <a href="#install">Install</a>
              <Link to="/deploy">Cloud Deploy</Link>
            </div>
            <div className="footer-col">
              <h4>Docs</h4>
              <a href="https://fredabila.github.io/orcbot/docs/getting-started.html" target="_blank" rel="noopener noreferrer">Getting Started</a>
              <a href="https://fredabila.github.io/orcbot/docs/configuration.html" target="_blank" rel="noopener noreferrer">Configuration</a>
              <a href="https://fredabila.github.io/orcbot/docs/skills.html" target="_blank" rel="noopener noreferrer">Skills &amp; Plugins</a>
              <a href="https://fredabila.github.io/orcbot/docs/architecture.html" target="_blank" rel="noopener noreferrer">Architecture</a>
              <a href="https://fredabila.github.io/orcbot/docs/" target="_blank" rel="noopener noreferrer">All Docs →</a>
            </div>
            <div className="footer-col">
              <h4>Project</h4>
              <a href="https://github.com/fredabila/orcbot" target="_blank" rel="noopener noreferrer">GitHub</a>
              <a href="https://github.com/fredabila/orcbot/releases" target="_blank" rel="noopener noreferrer">Changelog</a>
              <a href="https://github.com/fredabila/orcbot/issues" target="_blank" rel="noopener noreferrer">Issues</a>
              <a href="https://github.com/fredabila/orcbot/blob/main/CONTRIBUTING.md" target="_blank" rel="noopener noreferrer">Contributing</a>
            </div>
          </div>
        </div>
        <div className="footer-bottom">
          <p>&copy; {new Date().getFullYear()} OrcBot Project. Built for the autonomous era.</p>
          <div className="footer-bottom-links">
            <a href="https://github.com/fredabila/orcbot/blob/main/LICENSE" target="_blank" rel="noopener noreferrer">MIT License</a>
          </div>
        </div>
      </footer>
    </div>
  );
}

export default App;
