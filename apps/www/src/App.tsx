import { useState, useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import './index.css';

function App() {
  const [copied, setCopied] = useState(false);
  const [activeTab, setActiveTab] = useState<'bash' | 'powershell' | 'docker'>('bash');
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const heroRef = useRef<HTMLDivElement>(null);

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

  useEffect(() => {
    const handleScroll = () => {
      if (heroRef.current) {
        const offset = window.scrollY * 0.25;
        heroRef.current.style.transform = `translateY(${offset}px)`;
      }
    };
    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  return (
    <div className="app">
      <div className="noise-overlay" />

      <header className="hero">
        <div className="hero-bg" ref={heroRef}>
          <div className="gradient-orb orb-1" />
          <div className="gradient-orb orb-2" />
          <div className="gradient-orb orb-3" />
          <div className="grid-lines" />
        </div>

        <nav className="nav">
          <Link to="/" className="logo">
            <span className="logo-icon">⬡</span>
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

        <div className="hero-content">
          <div className="hero-badge">
            <span className="badge-pulse" />
            v2.0 — The Strategic Era
          </div>

          <h1 className="hero-title">
            Autonomy that<br />
            <span className="gradient-text">actually ships.</span>
          </h1>

          <p className="hero-subtitle">
            The production-ready autonomous AI operating system. OrcBot simulates, plans,
            executes, and self-repairs — all while keeping your data local and private.
          </p>

          <div className="hero-actions">
            <a className="btn btn-primary btn-lg" href="#install">
              Get Started
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14M12 5l7 7-7 7"/></svg>
            </a>
            <a className="btn btn-outline btn-lg" href="https://fredabila.github.io/orcbot/docs/" target="_blank" rel="noopener noreferrer">
              Read the Docs
            </a>
          </div>

          <div className="hero-metrics">
            {[
              { value: '6+', label: 'LLM Providers' },
              { value: '30+', label: 'Built-in Skills' },
              { value: '4', label: 'Chat Channels' },
              { value: '∞', label: 'Plugin Extensibility' },
            ].map((m, i) => (
              <div className="metric" key={i}>
                <span className="metric-value">{m.value}</span>
                <span className="metric-label">{m.label}</span>
              </div>
            ))}
          </div>
        </div>
      </header>

      <main>
        {/* Install Section */}
        <section id="install" className="install-section">
          <div className="terminal">
            <div className="terminal-chrome">
              <div className="terminal-dots">
                <span /><span /><span />
              </div>
              <div className="terminal-tabs">
                {(['bash', 'powershell', 'docker'] as const).map(tab => (
                  <button
                    key={tab}
                    className={`terminal-tab ${activeTab === tab ? 'active' : ''}`}
                    onClick={() => setActiveTab(tab)}
                  >
                    {tab === 'bash' ? '🐧 Linux / Mac' : tab === 'powershell' ? '🪟 Windows' : '🐳 Docker'}
                  </button>
                ))}
              </div>
            </div>
            <div className="terminal-body">
              <span className="terminal-prompt">❯</span>
              <code className="terminal-cmd">{commands[activeTab]}</code>
              <button className="terminal-copy" onClick={copyToClipboard}>
                {copied ? '✓ Copied' : 'Copy'}
              </button>
            </div>
          </div>
        </section>

        {/* Capabilities */}
        <section id="capabilities" className="section">
          <div className="section-label">Capabilities</div>
          <h2 className="section-title">Everything an autonomous agent needs.</h2>
          <p className="section-desc">Built for operators who want an employee-grade agent that never sleeps.</p>

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
              <div className="capability-card" key={i} style={{ animationDelay: `${i * 0.06}s` }}>
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
          <h2 className="section-title">The autonomy loop.</h2>
          <p className="section-desc">Heartbeat-driven, stateful, and resilient — designed for overnight operations.</p>

          <div className="steps-row">
            {[
              { num: '01', title: 'Heartbeat fires', desc: 'Context-aware scheduling with exponential backoff when idle to save resources.' },
              { num: '02', title: 'Decision & planning', desc: 'Analyzes conversations, picks follow-ups, research, outreach, or delegation tasks.' },
              { num: '03', title: 'Multi-agent execution', desc: 'Complex tasks spawn worker processes for parallel execution with IPC coordination.' },
              { num: '04', title: 'Learn & self-repair', desc: 'Broken plugins get repaired, results logged to memory, lessons saved for the future.' },
            ].map((step, i) => (
              <div className="step-item" key={i}>
                <div className="step-num">{step.num}</div>
                {i < 3 && <div className="step-connector" />}
                <h4>{step.title}</h4>
                <p>{step.desc}</p>
              </div>
            ))}
          </div>
        </section>

        {/* Architecture */}
        <section id="architecture" className="section">
          <div className="section-label">Architecture</div>
          <h2 className="section-title">Local-first, modular design.</h2>
          <p className="section-desc">Every component is swappable. Bring your own LLM, channels, or tools.</p>

          <div className="arch-diagram">
            {[
              { title: 'Channels', items: ['Telegram', 'WhatsApp', 'Discord', 'Web Gateway', 'CLI / TUI'], color: 'cyan' },
              { title: 'Core Engine', items: ['Decision Engine', 'Pipeline & Guards', 'Orchestrator', 'Smart Heartbeat', 'Action Queue', 'Memory + Vectors'], color: 'purple' },
              { title: 'Execution', items: ['Worker Processes', 'Skills Manager', 'Web Browser', 'Plugin System'], color: 'green' },
              { title: 'Providers', items: ['OpenAI / Gemini / Claude', 'Bedrock / NVIDIA / OpenRouter', 'Search APIs', 'CAPTCHA Solver'], color: 'orange' },
            ].map((col, i) => (
              <div className={`arch-col arch-${col.color}`} key={i}>
                <div className="arch-col-title">{col.title}</div>
                {col.items.map((item, j) => (
                  <div className="arch-item" key={j}>{item}</div>
                ))}
              </div>
            ))}
          </div>

          <div className="arch-flow">
            <span>Channels</span><span className="flow-arrow">→</span>
            <span>Core Engine</span><span className="flow-arrow">→</span>
            <span>Execution</span><span className="flow-arrow">→</span>
            <span>Providers</span>
          </div>
        </section>

        {/* Docs */}
        <section id="docs" className="section">
          <div className="section-label">Documentation</div>
          <h2 className="section-title">Learn, customize, master.</h2>
          <p className="section-desc">Comprehensive guides to get you from zero to production.</p>

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
          <div className="cta-glow" />
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
