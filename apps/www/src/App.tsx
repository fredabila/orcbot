import { useState } from 'react';
import './index.css';

function App() {
  const [copied, setCopied] = useState(false);
  const installCmd = 'curl -sSL https://orcbot.vercel.app/install.sh | bash';

  const copyToClipboard = () => {
    navigator.clipboard.writeText(installCmd);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="app">
      <header className="hero">
        <nav className="nav">
          <div className="logo">OrcBot</div>
          <div className="nav-links">
            <a href="#capabilities">Capabilities</a>
            <a href="#autonomy">Autonomy</a>
            <a href="#install">Install</a>
          </div>
          <a className="nav-cta" href="https://github.com/fredabila/orcbot">GitHub</a>
        </nav>

        <div className="hero-grid">
          <div className="hero-copy">
            <div className="badge">v2.0.0 — The Strategic Era</div>
            <h1>Autonomy that actually ships.</h1>
            <p className="subtitle">
              OrcBot is the production-ready autonomous AI OS. It simulates, plans, executes, and repairs itself while staying private and local-first.
            </p>
            <div className="hero-actions">
              <a className="primary-btn" href="#install">Install OrcBot</a>
              <a className="ghost-btn" href="#capabilities">Explore Capabilities</a>
            </div>
            <div className="stats">
              <div>
                <span className="stat">Smart</span>
                <span className="stat-label">Heartbeat with backoff</span>
              </div>
              <div>
                <span className="stat">Multi</span>
                <span className="stat-label">Agent orchestration</span>
              </div>
              <div>
                <span className="stat">Local</span>
                <span className="stat-label">Memory & configs</span>
              </div>
            </div>
          </div>
        </div>
      </header>

      <main>
        <section id="install" className="install-panel">
          <div className="terminal-container">
            <div className="terminal-header">
              <div className="dot red"></div>
              <div className="dot yellow"></div>
              <div className="dot green"></div>
              <div className="terminal-title">global-install — production</div>
            </div>
            <div className="terminal-body">
              <div>
                <span className="prompt">❯</span>
                <span className="command">{installCmd}</span>
              </div>
              <button className="copy-button" onClick={copyToClipboard}>
                {copied ? 'Copied' : 'Copy'}
              </button>
            </div>
          </div>
        </section>

        <section id="capabilities" className="section">
          <div className="section-header">
            <h2>Strategic capabilities</h2>
            <p>Built for operators who want an employee-grade agent that never sleeps.</p>
          </div>
          <div className="grid">
            <div className="card">
              <h3>Strategic Planning</h3>
              <p>OrcBot simulates tasks before execution, generating roadmaps with contingencies and loop protection.</p>
            </div>
            <div className="card">
              <h3>Multi-Agent Orchestration</h3>
              <p>Spawn worker processes for parallel tasks. Real Node.js child processes with IPC coordination.</p>
            </div>
            <div className="card">
              <h3>Smart Heartbeat</h3>
              <p>Context-aware autonomy with exponential backoff, productivity tracking, and action-oriented tasks.</p>
            </div>
            <div className="card">
              <h3>Resilient Web Search</h3>
              <p>Smart fallback from API providers (Serper, Brave) to browser-based search when keys aren't configured.</p>
            </div>
            <div className="card">
              <h3>Self-Evolving Skills</h3>
              <p>The agent researches, writes, and installs its own TypeScript skills when needed.</p>
            </div>
            <div className="card">
              <h3>Privacy First</h3>
              <p>Logs, memories, and configs stay on your hardware. You own the data and identity.</p>
            </div>
          </div>
        </section>

        <section id="autonomy" className="section autonomy">
          <div className="section-header">
            <h2>Autonomy loop</h2>
            <p>Heartbeat-driven, stateful, and resilient — designed for overnight operations.</p>
          </div>
          <div className="timeline">
            <div className="timeline-step">
              <span>01</span>
              <h4>Smart heartbeat triggers</h4>
              <p>Context-aware scheduling with exponential backoff when idle to save resources.</p>
            </div>
            <div className="timeline-step">
              <span>02</span>
              <h4>Action selection</h4>
              <p>Analyzes recent conversations to choose follow-ups, research, outreach, or delegation.</p>
            </div>
            <div className="timeline-step">
              <span>03</span>
              <h4>Multi-agent execution</h4>
              <p>Complex tasks spawn worker processes for parallel execution with IPC coordination.</p>
            </div>
            <div className="timeline-step">
              <span>04</span>
              <h4>Self-repair & learning</h4>
              <p>Broken plugins are repaired, results logged to memory, and lessons saved for future.</p>
            </div>
          </div>
        </section>

        <section className="section architecture">
          <div className="section-header">
            <h2>Infrastructure architecture</h2>
            <p>Local-first core with modular channels, tools, and providers.</p>
          </div>
          <div className="architecture-map">
            <div className="arch-column">
              <h4>Channels</h4>
              <div className="arch-node">Telegram</div>
              <div className="arch-node">WhatsApp</div>
              <div className="arch-node">CLI / TUI</div>
            </div>
            <div className="arch-column">
              <h4>Core</h4>
              <div className="arch-node emphasis">Agent Core</div>
              <div className="arch-node">DecisionEngine</div>
              <div className="arch-node">AgentOrchestrator</div>
              <div className="arch-node">Smart Heartbeat</div>
              <div className="arch-node">Action Queue</div>
              <div className="arch-node">Memory + Profiles</div>
            </div>
            <div className="arch-column">
              <h4>Execution</h4>
              <div className="arch-node">Worker Processes</div>
              <div className="arch-node">Skills Manager</div>
              <div className="arch-node">Web Browser</div>
              <div className="arch-node">Plugins</div>
            </div>
            <div className="arch-column">
              <h4>Providers</h4>
              <div className="arch-node">OpenAI / Gemini / Bedrock</div>
              <div className="arch-node">Search (API + Browser)</div>
              <div className="arch-node">CAPTCHA Solver</div>
            </div>
          </div>
          <div className="architecture-flow">
            <span>Channels</span>
            <span>→</span>
            <span>Agent Core</span>
            <span>→</span>
            <span>Skills & Tools</span>
            <span>→</span>
            <span>External Providers</span>
          </div>
        </section>

        <section className="section cta">
          <div>
            <h2>Give your AI an operating system.</h2>
            <p>OrcBot ships with autonomy, memory, and strategy — ready for production workflows.</p>
          </div>
          <a className="primary-btn" href="#install">Install OrcBot</a>
        </section>

        <div className="social-links">
          <a href="https://github.com/fredabila/orcbot">GitHub</a>
          <a href="https://twitter.com/orcbot_ai">Twitter</a>
          <a href="https://fredabila.github.io/orcbot/docs/">Documentation</a>
        </div>
      </main>

      <footer>
        &copy; {new Date().getFullYear()} OrcBot Project. Built for the autonomous era.
      </footer>
    </div>
  );
}

export default App;
