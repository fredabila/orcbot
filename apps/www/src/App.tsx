import { useState } from 'react';
import './index.css';

function App() {
  const [copied, setCopied] = useState(false);
  const installCmd = 'curl -sSL https://orcbot.ai/install.sh | bash';

  const copyToClipboard = () => {
    navigator.clipboard.writeText(installCmd);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="app-container">
      <header>
        <div className="badge">v1.1.0 — Global CLI Ready</div>
        <h1>OrcBot</h1>
        <p className="subtitle">The production-ready autonomous AI operating system. One command for global terminal access.</p>
      </header>

      <main>
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

        <h2 className="section-title">Capabilities</h2>
        <div className="grid">
          <div className="card">
            <h3>Global CLI Native</h3>
            <p>Installs globally on your OS. Run `orcbot` commands from any path. Full system access with zero cloud latency.</p>
          </div>
          <div className="card">
            <h3>Autonomous Browsing</h3>
            <p>Controlling browsers like a human. Navigating, extracting, and acting on the web with adaptive reasoning.</p>
          </div>
          <div className="card">
            <h3>Self-Evolving Skills</h3>
            <p>OrcBot can write its own TypeScript plugins to learn new capabilities on the fly. It grows with your needs.</p>
          </div>
          <div className="card">
            <h3>Persistent Context</h3>
            <p>Automatic journaling and long-term memory. It remembers what you did last week and uses it for today's tasks.</p>
          </div>
          <div className="card">
            <h3>Multi-Modal Input</h3>
            <p>Control via Terminal, Telegram, or even a local API. Your agent is always a message away.</p>
          </div>
          <div className="card">
            <h3>Privacy First</h3>
            <p>All logs, memories, and configurations stay on your hardware. You own your data and your agent's identity.</p>
          </div>
        </div>

        <div className="social-links">
          <a href="https://github.com/fredabila/orcbot">GitHub</a>
          <a href="https://twitter.com/orcbot_ai">Twitter</a>
          <a href="#">Documentation</a>
        </div>
      </main>

      <footer style={{ paddingBottom: '40px', color: '#444', fontSize: '0.8rem' }}>
        &copy; {new Date().getFullYear()} OrcBot Project. Purely Autonomous.
      </footer>
    </div>
  );
}

export default App;
