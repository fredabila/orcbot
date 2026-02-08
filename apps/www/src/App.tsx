import { useState } from 'react';
import { Link } from 'react-router-dom';
import './index.css';

function App() {
  const [copied, setCopied] = useState(false);
  const [activeTab, setActiveTab] = useState<'bash' | 'powershell' | 'docker'>('bash');
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

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
      <div className="backdrop" />
      <div className="noise-overlay" />

      <header className="hero" id="top">
        <nav className="nav">
          <Link to="/" className="logo">
            <span className="logo-icon">▲</span>
            <span className="logo-text">OrcBot</span>
          </Link>

          <button
            className="mobile-toggle"
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            aria-label="Toggle menu"
          >
            <span className={`hamburger ${mobileMenuOpen ? 'open' : ''}`} />
          </button>

          <div className={`nav-center ${mobileMenuOpen ? 'open' : ''}`}>
            <a href="#capabilities" onClick={() => setMobileMenuOpen(false)}>Capabilities</a>
            <a href="#how-it-works" onClick={() => setMobileMenuOpen(false)}>How It Works</a>
            <a href="#architecture" onClick={() => setMobileMenuOpen(false)}>Architecture</a>
            <a href="#docs" onClick={() => setMobileMenuOpen(false)}>Docs</a>
            <Link to="/deploy" onClick={() => setMobileMenuOpen(false)}>Deploy</Link>
          </div>

          <div className="nav-end">
            <a className="nav-btn ghost" href="https://fredabila.github.io/orcbot/docs/" target="_blank" rel="noopener noreferrer">Docs</a>
            <a className="nav-btn primary" href="https://github.com/fredabila/orcbot" target="_blank" rel="noopener noreferrer">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z"/></svg>
              GitHub
            </a>
          </div>
        </nav>
        <div className="hero-grid">
          <div className="hero-copy">
            <div className="hero-badge">
              <span className="badge-dot" />
              Strategic Autonomy, v2.0
            </div>

            <h1 className="hero-title">
              OrcBot is the
              <span className="hero-title-em">autonomous AI OS</span>
              for operators.
            </h1>

            <p className="hero-subtitle">
              Plan, execute, self-repair, and keep everything local. OrcBot is built for
              real operations — multi-agent, memory-aware, and always on your hardware.
            </p>

            <div className="hero-actions">
              <a className="btn btn-primary btn-lg" href="#install">
                Install OrcBot
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14M12 5l7 7-7 7"/></svg>
              </a>
              <a className="btn btn-outline btn-lg" href="https://fredabila.github.io/orcbot/docs/" target="_blank" rel="noopener noreferrer">
                Documentation
              </a>
            </div>

            <div className="hero-strip">
              <div>
                <span className="strip-title">LLM Providers</span>
                <span className="strip-value">6+</span>
              </div>
              <div>
                <span className="strip-title">Built-in Skills</span>
                <span className="strip-value">30+</span>
              </div>
              <div>
                <span className="strip-title">Chat Channels</span>
                <span className="strip-value">4</span>
              </div>
              <div>
                <span className="strip-title">Plugin Extensibility</span>
                <span className="strip-value">Infinite</span>
              </div>
            </div>
          </div>

          <div className="hero-panel">
            <div className="panel-header">
              <div>
                <p className="panel-kicker">Ops Console</p>
                <h3>Autonomy Control</h3>
              </div>
              <span className="status-pill">Live</span>
            </div>

            <div className="panel-card">
              <div className="panel-line">
                <span>Heartbeat</span>
                <strong>Adaptive, 15m</strong>
              </div>
              <div className="panel-line">
                <span>Workers</span>
                <strong>Orchestrated</strong>
              </div>
              <div className="panel-line">
                <span>Privacy</span>
                <strong>Local-first</strong>
              </div>
              <div className="panel-line">
                <span>Failures</span>
                <strong>Self-repairing</strong>
              </div>
            </div>

            <div className="panel-grid">
              {[
                { label: 'Decision Engine', value: 'Simulation + Guardrails' },
                { label: 'Memory Core', value: 'Episodic + Vector' },
                { label: 'Execution', value: 'Skills + Browser' },
                { label: 'Channels', value: 'Telegram / WhatsApp / Discord' },
              ].map((item, idx) => (
                <div className="panel-chip" key={idx}>
                  <span>{item.label}</span>
                  <strong>{item.value}</strong>
                </div>
              ))}
            </div>
          </div>
        </div>
      </header>

      <main>
        {/* Install Section */}
        <section id="install" className="install-section">
          <div className="install-shell">
            <div className="install-head">
              <div>
                <p className="section-label">Install</p>
                <h2 className="section-title">Launch your agent in minutes.</h2>
                <p className="section-desc">Pick a target and copy the command. OrcBot ships with sane defaults and a guided setup.</p>
              </div>
              <div className="install-tabs">
                {(['bash', 'powershell', 'docker'] as const).map(tab => (
                  <button
                    key={tab}
                    className={`install-tab ${activeTab === tab ? 'active' : ''}`}
                    onClick={() => setActiveTab(tab)}
                  >
                    {tab === 'bash' ? 'Linux / Mac' : tab === 'powershell' ? 'Windows' : 'Docker'}
                  </button>
                ))}
              </div>
            </div>

            <div className="install-terminal">
              <span className="terminal-prompt">$</span>
              <code className="terminal-cmd">{commands[activeTab]}</code>
              <button className="terminal-copy" onClick={copyToClipboard}>
                {copied ? 'Copied' : 'Copy'}
              </button>
            </div>
          </div>
        </section>

        {/* Capabilities */}
        <section id="capabilities" className="section">
          <div className="section-label">Capabilities</div>
          <h2 className="section-title">Everything an autonomous operator needs.</h2>
          <p className="section-desc">OrcBot is opinionated, tactical, and resilient. It thinks ahead and fixes itself when it breaks.</p>

          <div className="capabilities-grid">
            {[
              { icon: '🧠', title: 'Strategic Planning', desc: 'Simulates tasks before execution with roadmaps, contingencies, and loop protections.' },
              { icon: '👥', title: 'Multi-Agent Orchestration', desc: 'Spawns worker processes for parallel tasks with IPC coordination and task chaining.' },
              { icon: '💓', title: 'Smart Heartbeat', desc: 'Context-aware autonomy with exponential backoff and productivity tracking.' },
              { icon: '🔍', title: 'Resilient Web Search', desc: 'Smart fallback chain: API providers to browser-based search when keys aren\'t configured.' },
              { icon: '⚡', title: 'Self-Evolving Skills', desc: 'Researches, writes, and installs its own TypeScript plugins when capabilities are needed.' },
              { icon: '🛡️', title: 'Guard Rails & Safety', desc: 'Loop detection, termination review, skill frequency limits, and dedup protection.' },
              { icon: '🧩', title: 'Smart Skill Routing', desc: 'Intent-based skill selection with configurable routing rules for optimal tool matching.' },
              { icon: '🔒', title: 'Privacy First', desc: 'All logs, memories, and configs stay on your hardware. You own everything.' },
            ].map((cap, i) => (
              <div className="capability-card" key={i} style={{ animationDelay: `${i * 0.04}s` }}>
                <div className="capability-icon">{cap.icon}</div>
                <h3>{cap.title}</h3>
                <p>{cap.desc}</p>
              </div>
            ))}
          </div>
        </section>

        {/* How It Works */}
        <section id="how-it-works" className="section">
          <div className="section-label">How It Works</div>
          <h2 className="section-title">The autonomy loop, engineered for reliability.</h2>
          <p className="section-desc">Heartbeat-driven, stateful, and resilient — designed for overnight operations.</p>

          <div className="steps-grid">
            {[
              { num: '01', title: 'Heartbeat fires', desc: 'Context-aware scheduling with exponential backoff when idle to save resources.' },
              { num: '02', title: 'Decision & planning', desc: 'Analyzes conversations, picks follow-ups, research, outreach, or delegation tasks.' },
              { num: '03', title: 'Multi-agent execution', desc: 'Complex tasks spawn worker processes for parallel execution with IPC coordination.' },
              { num: '04', title: 'Learn & self-repair', desc: 'Broken plugins get repaired, results logged to memory, lessons saved for the future.' },
            ].map((step, i) => (
              <div className="step-item" key={i}>
                <div className="step-num">{step.num}</div>
                <div className="step-body">
                  <h4>{step.title}</h4>
                  <p>{step.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* Architecture */}
        <section id="architecture" className="section">
          <div className="section-label">Architecture</div>
          <h2 className="section-title">Local-first, modular, and swappable.</h2>
          <p className="section-desc">Every block can be replaced — bring your own model, channels, or tools.</p>

          <div className="arch-grid">
            {[
              { title: 'Channels', items: ['Telegram', 'WhatsApp', 'Discord', 'Web Gateway', 'CLI / TUI'] },
              { title: 'Core Engine', items: ['Decision Engine', 'Pipeline & Guards', 'Orchestrator', 'Smart Heartbeat', 'Action Queue', 'Memory + Vectors'] },
              { title: 'Execution', items: ['Worker Processes', 'Skills Manager', 'Web Browser', 'Plugin System'] },
              { title: 'Providers', items: ['OpenAI / Gemini / Claude', 'Bedrock / NVIDIA / OpenRouter', 'Search APIs', 'CAPTCHA Solver'] },
            ].map((col, i) => (
              <div className="arch-card" key={i}>
                <div className="arch-title">{col.title}</div>
                <div className="arch-list">
                  {col.items.map((item, j) => (
                    <span key={j}>{item}</span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* Docs */}
        <section id="docs" className="section">
          <div className="section-label">Documentation</div>
          <h2 className="section-title">Learn, customize, and master.</h2>
          <p className="section-desc">Guides that move fast, from first run to production ops.</p>

          <div className="docs-grid">
            {[
              { icon: '🚀', title: 'Getting Started', desc: 'Quick setup guide to get running in minutes.', url: 'https://fredabila.github.io/orcbot/docs/getting-started.html' },
              { icon: '🏗️', title: 'Architecture', desc: 'Deep dive into modular design and components.', url: 'https://fredabila.github.io/orcbot/docs/architecture.html' },
              { icon: '🧩', title: 'Skills & Plugins', desc: 'Core skills and how to create custom ones.', url: 'https://fredabila.github.io/orcbot/docs/skills.html' },
              { icon: '⚙️', title: 'Configuration', desc: 'Providers, channels, and advanced settings.', url: 'https://fredabila.github.io/orcbot/docs/configuration.html' },
              { icon: '🐳', title: 'Docker Deployment', desc: 'Run OrcBot anywhere with Docker Compose.', url: 'https://fredabila.github.io/orcbot/docs/docker.html' },
              { icon: '📚', title: 'Full Documentation', desc: 'Browse all guides, API references, and examples.', url: 'https://fredabila.github.io/orcbot/docs/', featured: true },
            ].map((doc, i) => (
              <a href={doc.url} target="_blank" rel="noopener noreferrer" className={`doc-card ${(doc as any).featured ? 'featured' : ''}`} key={i}>
                <div className="doc-card-icon">{doc.icon}</div>
                <h3>{doc.title}</h3>
                <p>{doc.desc}</p>
                <span className="doc-card-arrow">→</span>
              </a>
            ))}
          </div>
        </section>

        {/* CTA */}
        <section className="cta-banner">
          <div className="cta-inner">
            <h2>Give your AI an operating system.</h2>
            <p>Autonomy, memory, and strategy — ready for production workflows.</p>
            <div className="cta-actions">
              <a className="btn btn-primary btn-lg" href="#install">Install OrcBot</a>
              <Link className="btn btn-outline btn-lg" to="/deploy">Deploy to Cloud</Link>
            </div>
          </div>
        </section>

        <div className="footer-links">
          <a href="https://github.com/fredabila/orcbot" target="_blank" rel="noopener noreferrer">GitHub</a>
          <a href="https://twitter.com/orcbot_ai" target="_blank" rel="noopener noreferrer">Twitter</a>
          <a href="https://fredabila.github.io/orcbot/docs/" target="_blank" rel="noopener noreferrer">Documentation</a>
        </div>
      </main>

      <footer>
        <p>&copy; {new Date().getFullYear()} OrcBot Project. Built for the autonomous era.</p>
      </footer>
    </div>
  );
}

export default App;
