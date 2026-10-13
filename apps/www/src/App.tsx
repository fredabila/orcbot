import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import Header from './components/Header';
import './index.css';

// The hero opens on the one thing that is actually characteristic of OrcBot: the
// action loop itself. Every stage and detail below is the real documented loop
// (heartbeat, simulation pre-plan, memory recall, tool execution, the signature
// guardrail, the review gate, conclusion plus cleanup). The caption says plainly
// that the run is an example, so nothing here reads as a captured measurement.
function AgentTrace() {
  const steps = [
    { time: '00:00', label: 'Heartbeat fires', detail: 'picks the highest-priority queued action', tone: '' },
    { time: '00:01', label: 'Simulation', detail: 'pre-plans the steps before anything runs', tone: '' },
    { time: '00:04', label: 'Memory recall', detail: 'episodic matches injected into the prompt', tone: '' },
    { time: '00:07', label: 'Decide and execute', detail: 'browser_navigate, then extract_data', tone: '' },
    { time: '00:12', label: 'Guardrail holds', detail: 'identical call seen 3 times, step skipped', tone: 'warn' },
    { time: '00:18', label: 'Review gate', detail: 'a second pass confirms the goal is met', tone: '' },
    { time: '00:19', label: 'Conclusion written', detail: 'episodic summary saved, step memories cleared', tone: 'ok' },
  ];

  return (
    <figure className="trace" aria-label="Example OrcBot run">
      <figcaption className="trace-cap">Example run, one task start to finish</figcaption>
      <ol className="trace-list">
        {steps.map((s, i) => (
          <li className={`trace-row ${s.tone}`} key={i}>
            <span className="trace-time">{s.time}</span>
            <span className="trace-label">{s.label}</span>
            <span className="trace-detail">{s.detail}</span>
          </li>
        ))}
      </ol>
    </figure>
  );
}

function App() {
  const [copied, setCopied] = useState(false);
  const [activeTab, setActiveTab] = useState<'bash' | 'powershell' | 'docker'>('bash');

  const commands = {
    bash: 'curl -sSL https://orcbot.vercel.app/install.sh | bash', powershell: 'iwr https://orcbot.vercel.app/install.ps1 | iex', docker: 'docker compose -f docker-compose.minimal.yml up -d', };

  const copyToClipboard = () => {
    navigator.clipboard.writeText(commands[activeTab]);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="app">
      <Header />

      {/* ── Hero ── */}
      <header className="hero">
        <div className="hero-grid">
          <div className="hero-copy">
            <h1 className="hero-title">
              Plans the work,<br />
              runs the tools,<br />
              checks the result.
            </h1>

            <p className="hero-subtitle">
              OrcBot runs a full action loop on your own hardware. It picks the
              highest-priority task, recalls what it learned last time, executes
              tools, and reviews its own result before it stops.
            </p>

            <div className="hero-actions">
              <a className="btn btn-primary btn-lg" href="#install">Install OrcBot</a>
              <a className="btn btn-outline btn-lg" href="https://github.com/fredabila/orcbot" target="_blank" rel="noopener noreferrer">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor"><path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z"/></svg>
                Read the source
              </a>
            </div>
          </div>

          <div className="hero-media">
            <AgentTrace />
          </div>
        </div>

        <div className="integrations-row">
          <span className="int-label">Built for Harmony</span>
          <div className="int-chips">
            {['OpenAI', 'Gemini', 'Claude', 'Mistral', 'NVIDIA', 'Bedrock', 'Telegram', 'WhatsApp', 'Discord', 'Playwright', 'Docker'].map((n) => (
              <span className="int-chip" key={n}>{n}</span>
            ))}
          </div>
        </div>
      </header>

      <main>
        {/* ── The Vision ── */}
        <section id="vision" className="section section-inner vision-section">
          <div className="section-label">Our Story</div>
          <h2 className="section-title">A World Built for Autonomy.</h2>
          <p className="section-desc">
            We believe the future isn't just about tools; it's about orchestration.
            OrcBot provides a sandbox where agents don't just run, they live, remember, and evolve. It's an environment designed for them to handle the complexity
            of your world perfectly, so you can focus on the big picture.
          </p>
          <div className="vision-grid">
            {[
              { title: 'The Digital Orchard', desc: 'A sustainable environment where agents plant seeds of productivity and harvest results.' }, { title: 'Carefree Autonomy', desc: 'Agents operate with peace of mind, knowing their memory and safety are handled by OrcBot.' }, { title: 'Harmonious Orchestration', desc: 'Multiple agents working in sync, sharing knowledge like a digital community.' }, ].map((v, i) => (
              <div key={i} className="vision-card">
                <h3>{v.title}</h3>
                <p>{v.desc}</p>
              </div>
            ))}
          </div>
        </section>

        {/* ── Install ── */}
        <section id="install" className="install-section section-inner">
          <div className="install-shell">
            <div className="install-head">
              <div>
                <p className="section-label">Invite them in</p>
                <h2 className="section-title">Open the gateway.</h2>
                <p className="section-desc">Setting up OrcBot is like giving your agent the keys to their new home. Fast, simple, and respectful of their privacy.</p>
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
              <span>Requires Node.js 18 or newer</span>
              <a href="https://docs.orcbot.buzzchat.site/getting-started.html" target="_blank" rel="noopener noreferrer">Read the full setup guide</a>
            </div>
          </div>
        </section>

        {/* ── Capabilities ── */}
        <section id="capabilities" className="section section-inner">
          <div className="section-label">Capabilities</div>
          <h2 className="section-title">Everything an autonomous operator needs.</h2>
          <p className="section-desc">Opinionated, tactical, and resilient. OrcBot thinks ahead, delegates intelligently, and fixes itself when it breaks.</p>
          <div className="marquee-section">
            <div className="marquee-grid">
              {[
                { title: 'TForce Tactical Guard', desc: 'Real-time health monitor that detects loops, fatigue, and ghosting, injecting automated recovery plans into the reasoning loop.' },
                { title: 'Recursive Helper Routing', desc: 'A sophisticated PromptRouter that intelligently activates related domain helpers (Browser -> Media) for seamless task execution.' },
                { title: 'Deep Memory Recall', desc: 'Dual-layered search system combining metadata-filtered semantic embeddings with literal file-based log retrieval.' },
                { title: 'Strategic Planning', desc: 'Simulates tasks before execution with roadmaps, contingencies, and loop protections built-in.' },
                { title: 'Self-Evolving Skills', desc: 'Researches, writes, and installs its own TypeScript plugins when new capabilities are needed.' },
                { title: 'Self-Training Sidecar', desc: 'Captures accepted trajectories, prepares offline datasets, evaluates candidates, and promotes new models under admin control.' },
                { title: 'Guard Rails & Safety', desc: 'Loop detection, termination review, skill frequency limits, and deduplication protection.' },
                { title: 'Smart Skill Routing', desc: 'Intent-based skill selection with configurable routing rules for optimal tool matching.' },
                { title: 'Privacy First', desc: 'All logs, memories, configs, and context stay on your hardware. You own everything.' },
              ].map((cap, i) => (
                <div className="marquee-card capability-card" key={i}>
                  <h3>{cap.title}</h3>
                  <p>{cap.desc}</p>
                </div>
              ))}
            </div>
            <div className="marquee-cta">
              <Link to="/skills" className="btn btn-outline btn-sm">See all 235 built-in skills</Link>
            </div>
          </div>
        </section>

        {/* ── How It Works ── */}
        <section id="how-it-works" className="section section-inner">
          <div className="section-label">How It Works</div>
          <h2 className="section-title">The autonomy loop, engineered for reliability.</h2>
          <p className="section-desc">Heartbeat-driven, stateful, and resilient, designed for overnight operations without babysitting.</p>
          <div className="steps-grid">
            {[
              { num: '01', title: 'Heartbeat fires', desc: 'Context-aware scheduling with smart backoff when idle, saves resources and avoids spam.' }, { num: '02', title: 'Decide & plan', desc: 'Analyzes conversations, picks follow-ups, research tasks, outreach, or worker delegation.' }, { num: '03', title: 'Parallel execution', desc: 'Complex tasks spawn isolated worker processes for parallel execution with IPC sync.' }, { num: '04', title: 'Learn & repair', desc: 'Broken plugins self-repair; results log to memory; lessons persist to the knowledge base.' }, ].map((step, i) => (
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
          <p className="section-desc">Every block can be replaced. Five messaging channels, seven LLM providers, three memory tiers, and 235 built-in skills, none of them locked in.</p>
          <div className="arch-grid">
            {[
              { color: '#5cffb3', title: 'Channels', items: ['Telegram', 'WhatsApp', 'Discord', 'Web Gateway', 'CLI / TUI'] }, { color: '#5cc9ff', title: 'Core Engine', items: ['Decision Engine', 'Pipeline & Guards', 'Orchestrator', 'Smart Heartbeat', 'Action Queue', 'Memory + Vectors'] }, { color: '#ffb347', title: 'Execution', items: ['Worker Processes', 'Skills Manager', 'Web Browser', 'Plugin System'] }, { color: '#5cc9ff', title: 'Providers', items: ['OpenAI / Gemini / Claude', 'Bedrock / NVIDIA / OpenRouter', 'Search APIs', 'CAPTCHA Solver'] }, ].map((col, i) => (
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
          <p className="section-desc">Guides that move fast, from first run to production ops.</p>
          <div className="docs-grid">
            {[
              { title: 'Getting Started', desc: 'Quick setup guide, running in under 5 minutes.', url: 'https://docs.orcbot.buzzchat.site/getting-started.html' }, { title: 'Architecture', desc: 'Deep dive into modular design and component contracts.', url: 'https://docs.orcbot.buzzchat.site/architecture.html' }, { title: 'Skills & Plugins', desc: 'Core skills reference and how to author custom ones.', url: 'https://docs.orcbot.buzzchat.site/skills.html' }, { title: 'Self-Training', desc: 'How OrcBot captures trajectories, evaluates candidates, and promotes models safely.', url: '/self-training' }, { title: 'Configuration', desc: 'Providers, channels, and every advanced setting.', url: 'https://docs.orcbot.buzzchat.site/configuration.html' }, { title: 'Docker Deployment', desc: 'Run OrcBot anywhere with Docker Compose.', url: 'https://docs.orcbot.buzzchat.site/docker.html' }, { title: 'Full Documentation', desc: 'All guides, API references, and examples in one place.', url: 'https://docs.orcbot.buzzchat.site/', featured: true }, ].map((doc, i) => (
              doc.url.startsWith('/') ? (
                <Link to={doc.url} className={`doc-card ${(doc as any).featured ? 'featured' : ''}`} key={i}>
                  <div className="doc-card-body"><h3>{doc.title}</h3><p>{doc.desc}</p></div>
                  <span className="doc-card-arrow">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M7 17L17 7M17 7H7M17 7v10"/></svg>
                  </span>
                </Link>
              ) : (
                <a href={doc.url} target="_blank" rel="noopener noreferrer" className={`doc-card ${(doc as any).featured ? 'featured' : ''}`} key={i}>
                  <div className="doc-card-body"><h3>{doc.title}</h3><p>{doc.desc}</p></div>
                  <span className="doc-card-arrow">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M7 17L17 7M17 7H7M17 7v10"/></svg>
                  </span>
                </a>
              )
            ))}
          </div>
        </section>

        {/* ── CTA ── */}
        <section className="cta-section section-inner">
          <div className="cta-inner">
            <div className="cta-badge">Open Source &amp; Free Forever</div>
            <h2>Give your AI an operating system.</h2>
            <p>Autonomy, memory, and strategy, ready for production workflows, today.</p>
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
              <img className="logo-mark logo-img" src="/orcbot.jpeg" alt="OrcBot logo" />
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
              <Link to="/self-training">Self-Training</Link>
              <Link to="/deploy">Cloud Deploy</Link>
            </div>
            <div className="footer-col">
              <h4>Docs</h4>
              <a href="https://docs.orcbot.buzzchat.site/getting-started.html" target="_blank" rel="noopener noreferrer">Getting Started</a>
              <a href="https://docs.orcbot.buzzchat.site/configuration.html" target="_blank" rel="noopener noreferrer">Configuration</a>
              <a href="https://docs.orcbot.buzzchat.site/skills.html" target="_blank" rel="noopener noreferrer">Skills &amp; Plugins</a>
              <a href="https://docs.orcbot.buzzchat.site/architecture.html" target="_blank" rel="noopener noreferrer">Architecture</a>
              <a href="https://docs.orcbot.buzzchat.site/" target="_blank" rel="noopener noreferrer">All docs</a>
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
