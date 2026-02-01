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
    <div className="app-container">
      <header>
        <div className="badge">v2.0.0 — The Strategic Era</div>
        <h1>OrcBot</h1>
        <p className="subtitle">The production-ready autonomous AI operating system. Pure intelligence, simulated for success.</p>
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

        <h2 className="section-title">Strategic Capabilities</h2>
        <div className="grid">
          <div className="card">
            <h3>Strategic Planning</h3>
            <p>OrcBot v2.0 simulates tasks before execution. It generates a roadmap with contingencies, avoiding loops and anticipating failures.</p>
          </div>
          <div className="card">
            <h3>Autonomous Immune System</h3>
            <p>Plugin failed? OrcBot fixes it. The agent automatically detects compilation errors in its own code and repairs them autonomously.</p>
          </div>
          <div className="card">
            <h3>Multi-Modal Hub</h3>
            <p>Native Telegram and WhatsApp integration. Send images, audio, or files—OrcBot downloads and analyzes them on the fly.</p>
          </div>
          <div className="card">
            <h3>Global CLI & Hybrid Core</h3>
            <p>Run locally for privacy and speed, or connect via cloud channels. OrcBot lives where you work.</p>
          </div>
          <div className="card">
            <h3>Self-Evolving Skills</h3>
            <p>The agent researches, writes, and installs its own TypeScript skills. It builds the tools it needs to satisfy your requests.</p>
          </div>
          <div className="card">
            <h3>Privacy First Architecture</h3>
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
