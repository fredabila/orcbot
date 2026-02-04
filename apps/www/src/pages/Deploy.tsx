import { useState } from 'react';
import { Link } from 'react-router-dom';
import '../index.css';
import './Deploy.css';

type Provider = 'digitalocean' | 'aws' | 'railway' | 'hetzner' | 'local';

const providers: { id: Provider; name: string; icon: string; available: boolean }[] = [
  { id: 'digitalocean', name: 'DigitalOcean', icon: '🌊', available: true },
  { id: 'aws', name: 'AWS EC2', icon: '☁️', available: false },
  { id: 'railway', name: 'Railway', icon: '🚂', available: false },
  { id: 'hetzner', name: 'Hetzner', icon: '🖥️', available: false },
  { id: 'local', name: 'Local Server', icon: '💻', available: false },
];

function Deploy() {
  const [selectedProvider, setSelectedProvider] = useState<Provider>('digitalocean');
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);

  const copyToClipboard = (text: string, index: number) => {
    navigator.clipboard.writeText(text);
    setCopiedIndex(index);
    setTimeout(() => setCopiedIndex(null), 2000);
  };

  const digitalOceanSteps = [
    {
      title: 'Create a Droplet',
      description: 'Log into DigitalOcean and create a new Droplet with these recommended specs:',
      details: [
        '**OS**: Ubuntu 22.04 LTS (recommended)',
        '**Plan**: Basic - $6/mo (1GB RAM, 1 vCPU) with Lightpanda, or $12/mo (2GB RAM) with Chrome',
        '**Datacenter**: Choose closest to your users',
        '**Authentication**: SSH Keys (recommended) or Password',
      ],
      code: null,
    },
    {
      title: 'Connect to your Droplet',
      description: 'SSH into your new server using the IP address from DigitalOcean dashboard:',
      code: 'ssh root@YOUR_DROPLET_IP',
    },
    {
      title: 'Update system packages',
      description: 'Always start with a fresh system update:',
      code: `apt update && apt upgrade -y`,
    },
    {
      title: 'Install Node.js 20 LTS',
      description: 'OrcBot requires Node.js 18+ (we recommend 20 LTS):',
      code: `curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
apt install -y nodejs
node --version`,
    },
    {
      title: 'Install OrcBot globally',
      description: 'Clone the repo and install OrcBot as a global CLI tool:',
      code: `git clone https://github.com/fredabila/orcbot.git
cd orcbot
npm install
npm run build
npm install -g .`,
    },
    {
      title: 'Run the setup wizard',
      description: 'Configure your API keys and preferences:',
      code: `orcbot setup`,
    },
    {
      title: 'Install Lightpanda (recommended for low-memory VPS)',
      description: 'Lightpanda is a lightweight browser using 9x less RAM than Chrome - perfect for $6/mo droplets:',
      code: `# Install Lightpanda
orcbot lightpanda install

# Start in background
orcbot lightpanda start -b

# Enable as default browser
orcbot lightpanda enable

# Check status
orcbot lightpanda status`,
    },
    {
      title: 'Alternative: Install Chrome dependencies',
      description: 'Skip this if using Lightpanda. Only needed for Playwright/Chrome browser automation:',
      code: `apt install -y wget gnupg ca-certificates fonts-liberation \\
  libappindicator3-1 libasound2t64 libatk-bridge2.0-0 libatk1.0-0 \\
  libcups2 libdbus-1-3 libdrm2 libgbm1 libgtk-3-0 libnspr4 \\
  libnss3 libxcomposite1 libxdamage1 libxrandr2 xdg-utils`,
    },
    {
      title: 'Run in background (simple option)',
      description: 'Start OrcBot in the background without systemd:',
      code: `orcbot run --background

# View logs
tail -f ~/.orcbot/foreground.log

# Stop
pkill -f "orcbot run --background-child"`,
    },
    {
      title: 'Create a systemd service (optional but recommended)',
      description: 'For auto-restart and running OrcBot as a background service:',
      code: `cat > /etc/systemd/system/orcbot.service << 'EOF'
[Unit]
Description=OrcBot Autonomous Agent
After=network.target

[Service]
Type=simple
User=root
WorkingDirectory=/root/orcbot
ExecStart=/usr/bin/node /root/orcbot/dist/cli/index.js run
Restart=always
RestartSec=10
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable orcbot
systemctl start orcbot`,
    },
    {
      title: 'Create Lightpanda systemd service (if using Lightpanda)',
      description: 'Auto-start Lightpanda browser on boot:',
      code: `cat > /etc/systemd/system/lightpanda.service << 'EOF'
[Unit]
Description=Lightpanda Browser Server
Before=orcbot.service

[Service]
Type=simple
User=root
ExecStart=/root/.orcbot/lightpanda/lightpanda serve --host 127.0.0.1 --port 9222
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable lightpanda
systemctl start lightpanda`,
    },
    {
      title: 'Check status and logs',
      description: 'Verify OrcBot is running correctly:',
      code: `# Check service status
systemctl status orcbot

# View live logs
journalctl -u orcbot -f

# Or run interactively
orcbot run`,
    },
    {
      title: 'Configure firewall (optional)',
      description: 'If you plan to expose any ports (not required for basic operation):',
      code: `ufw allow OpenSSH
ufw enable`,
    },
  ];

  return (
    <div className="app deploy-page">
      <header className="deploy-header">
        <nav className="nav">
          <Link to="/" className="logo">OrcBot</Link>
          <div className="nav-links">
            <Link to="/#capabilities">Capabilities</Link>
            <Link to="/#install">Quick Install</Link>
            <Link to="/deploy" className="active">Deploy</Link>
          </div>
          <a className="nav-cta" href="https://github.com/fredabila/orcbot">GitHub</a>
        </nav>

        <div className="deploy-hero">
          <div className="badge">Server Deployment</div>
          <h1>Deploy OrcBot to the cloud</h1>
          <p className="subtitle">
            Step-by-step guides to run OrcBot 24/7 on your favorite cloud provider. 
            Perfect for autonomous operations that never sleep.
          </p>
        </div>
      </header>

      <main className="deploy-main">
        <section className="provider-selector">
          <h2>Choose your provider</h2>
          <div className="provider-grid">
            {providers.map((provider) => (
              <button
                key={provider.id}
                className={`provider-card ${selectedProvider === provider.id ? 'selected' : ''} ${!provider.available ? 'coming-soon' : ''}`}
                onClick={() => provider.available && setSelectedProvider(provider.id)}
                disabled={!provider.available}
              >
                <span className="provider-icon">{provider.icon}</span>
                <span className="provider-name">{provider.name}</span>
                {!provider.available && <span className="coming-soon-badge">Coming Soon</span>}
              </button>
            ))}
          </div>
        </section>

        {selectedProvider === 'digitalocean' && (
          <section className="deployment-guide">
            <div className="guide-header">
              <h2>🌊 DigitalOcean Deployment Guide</h2>
              <p>Deploy OrcBot to a DigitalOcean Droplet in about 15 minutes.</p>
              <div className="requirements">
                <h4>Requirements</h4>
                <ul>
                  <li>DigitalOcean account (<a href="https://m.do.co/c/your-referral" target="_blank" rel="noopener noreferrer">Sign up here</a>)</li>
                  <li>SSH client (Terminal on Mac/Linux, PowerShell or PuTTY on Windows)</li>
                  <li>OpenAI or Google Gemini API key</li>
                  <li>Optional: Telegram Bot Token for messaging</li>
                </ul>
              </div>
            </div>

            <div className="steps-container">
              {digitalOceanSteps.map((step, index) => (
                <div key={index} className="step-card">
                  <div className="step-number">{String(index + 1).padStart(2, '0')}</div>
                  <div className="step-content">
                    <h3>{step.title}</h3>
                    <p>{step.description}</p>
                    
                    {step.details && (
                      <ul className="step-details">
                        {step.details.map((detail, i) => (
                          <li key={i} dangerouslySetInnerHTML={{ __html: detail.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>') }} />
                        ))}
                      </ul>
                    )}
                    
                    {step.code && (
                      <div className="code-block">
                        <pre><code>{step.code}</code></pre>
                        <button 
                          className="copy-btn"
                          onClick={() => copyToClipboard(step.code!, index)}
                        >
                          {copiedIndex === index ? '✓ Copied' : 'Copy'}
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>

            <div className="post-deploy">
              <h3>🎉 You're all set!</h3>
              <p>Your OrcBot is now running 24/7 on DigitalOcean. Here are some next steps:</p>
              <div className="next-steps-grid">
                <div className="next-step">
                  <h4>Configure Telegram</h4>
                  <p>Run <code>orcbot setup</code> to add your Telegram bot token for messaging.</p>
                </div>
                <div className="next-step">
                  <h4>Add API Keys</h4>
                  <p>Configure Serper, Brave Search, or 2Captcha for enhanced capabilities.</p>
                </div>
                <div className="next-step">
                  <h4>Monitor Logs</h4>
                  <p>Use <code>journalctl -u orcbot -f</code> to watch your agent in action.</p>
                </div>
                <div className="next-step">
                  <h4>Create Custom Skills</h4>
                  <p>Drop TypeScript files in <code>~/.orcbot/plugins/</code> to extend capabilities.</p>
                </div>
              </div>
            </div>

            <div className="troubleshooting">
              <h3>Troubleshooting</h3>
              <div className="trouble-item">
                <h4>Chromium fails to launch</h4>
                <p>Try using Lightpanda instead: <code>orcbot lightpanda install && orcbot lightpanda enable</code>. It uses 9x less RAM and doesn't need system dependencies.</p>
              </div>
              <div className="trouble-item">
                <h4>Lightpanda won't connect</h4>
                <p>Make sure it's running: <code>orcbot lightpanda status</code>. Start it with <code>orcbot lightpanda start -b</code> for background mode.</p>
              </div>
              <div className="trouble-item">
                <h4>OrcBot won't start after reboot</h4>
                <p>Ensure the systemd service is enabled: <code>systemctl enable orcbot</code>. If using Lightpanda, also enable it: <code>systemctl enable lightpanda</code></p>
              </div>
              <div className="trouble-item">
                <h4>Out of memory errors</h4>
                <p>Switch to Lightpanda (<code>orcbot lightpanda enable</code>) which uses 9x less RAM, or add swap: <code>fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile</code></p>
              </div>
            </div>
          </section>
        )}

        <section className="cta-section">
          <h2>Need help deploying?</h2>
          <p>Join our community for support and deployment assistance.</p>
          <div className="cta-buttons">
            <a href="https://github.com/fredabila/orcbot/discussions" className="primary-btn">GitHub Discussions</a>
            <a href="https://twitter.com/orcbot_ai" className="ghost-btn">Follow Updates</a>
          </div>
        </section>
      </main>

      <footer>
        &copy; {new Date().getFullYear()} OrcBot Project. Built for the autonomous era.
      </footer>
    </div>
  );
}

export default Deploy;
