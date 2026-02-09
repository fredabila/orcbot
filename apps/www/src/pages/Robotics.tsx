import { useState, useEffect } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import '../index.css';
import './Robotics.css';

/* ── helpers ────────────────────────────────────────────────── */

function CodeBlock({ lang, children }: { lang: string; children: string }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard.writeText(children);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  return (
    <div className="rb-code-block">
      <div className="rb-code-header">
        <span className="rb-code-lang">{lang}</span>
        <button className="rb-code-copy" onClick={copy}>{copied ? 'Copied' : 'Copy'}</button>
      </div>
      <pre><code>{children}</code></pre>
    </div>
  );
}

/* ── guide metadata ──────────────────────────────────────────── */

type GuideId = 'pi-robot' | 'arduino' | 'humanoid';

interface GuideMeta {
  id: GuideId;
  icon: string;
  tab: string;
  tabSub: string;
  badge?: string;
  title: React.ReactNode;
  subtitle: string;
  meta: { icon: string; label: string }[];
  toc: { num: string; label: string; id: string }[];
}

const guides: GuideMeta[] = [
  {
    id: 'pi-robot',
    icon: '🤖',
    tab: 'Raspberry Pi Robot',
    tabSub: 'Full Build Guide',
    title: <>Build an <em>AI-Powered Robot</em> with OrcBot</>,
    subtitle: 'A comprehensive, hands-on guide for students and makers. Go from parts on a desk to an autonomous robot you command over Telegram — step by step.',
    meta: [
      { icon: '📖', label: '~45 min read' },
      { icon: '🔧', label: 'Full build guide' },
      { icon: '💰', label: '~$120–160 budget' },
      { icon: '🎓', label: 'Student friendly' },
    ],
    toc: [
      { num: '01', label: 'Overview & How It Works', id: 'overview' },
      { num: '02', label: 'Shopping List (BOM)', id: 'bom' },
      { num: '03', label: 'Tools You\'ll Need', id: 'tools' },
      { num: '04', label: 'Software Prerequisites', id: 'software' },
      { num: '05', label: 'Build the Chassis', id: 'chassis' },
      { num: '06', label: 'Set Up the Raspberry Pi', id: 'pi-setup' },
      { num: '07', label: 'Build the Hardware Bridge', id: 'bridge' },
      { num: '08', label: 'Create OrcBot Skills', id: 'skills' },
      { num: '09', label: 'Safety & Emergency Stop', id: 'safety' },
      { num: '10', label: 'Test in Simulation', id: 'simulation' },
      { num: '11', label: 'Connect Real Hardware', id: 'real-hw' },
      { num: '12', label: 'Deploy & Operate', id: 'deploy' },
      { num: '13', label: 'Camera Vision', id: 'camera' },
      { num: '14', label: 'ROS2 Integration', id: 'ros2' },
      { num: '15', label: 'MQTT Fleet Control', id: 'mqtt' },
      { num: '16', label: 'Troubleshooting', id: 'troubleshoot' },
      { num: '17', label: 'Learning Resources', id: 'resources' },
      { num: '18', label: 'Architecture Reference', id: 'arch-ref' },
    ],
  },
  {
    id: 'arduino',
    icon: '⚡',
    tab: 'Arduino Starter Kit',
    tabSub: 'Beginner Friendly',
    badge: 'new',
    title: <>Build Smart Hardware with <em>Arduino &amp; OrcBot</em></>,
    subtitle: 'Use an Arduino starter kit as your gateway to AI-controlled hardware. OrcBot sends serial commands, Arduino drives the components — no Raspberry Pi required.',
    meta: [
      { icon: '📖', label: '~30 min read' },
      { icon: '⚡', label: 'Arduino Uno/Nano' },
      { icon: '💰', label: '~$30–60 budget' },
      { icon: '🎓', label: 'Beginner friendly' },
    ],
    toc: [
      { num: '01', label: 'How Arduino + OrcBot Work Together', id: 'a-overview' },
      { num: '02', label: 'What\'s in a Starter Kit', id: 'a-kit' },
      { num: '03', label: 'Extra Parts You\'ll Need', id: 'a-extras' },
      { num: '04', label: 'Software Setup', id: 'a-software' },
      { num: '05', label: 'The Serial Bridge Pattern', id: 'a-serial' },
      { num: '06', label: 'Arduino Sketch — Command Receiver', id: 'a-sketch' },
      { num: '07', label: 'Python Serial Bridge for OrcBot', id: 'a-bridge' },
      { num: '08', label: 'OrcBot Skills for Arduino', id: 'a-skills' },
      { num: '09', label: 'Project 1 — Smart LED Controller', id: 'a-led' },
      { num: '10', label: 'Project 2 — Ultrasonic Sentry', id: 'a-sentry' },
      { num: '11', label: 'Project 3 — Servo Arm', id: 'a-servo' },
      { num: '12', label: 'Safety & Best Practices', id: 'a-safety' },
      { num: '13', label: 'Troubleshooting', id: 'a-troubleshoot' },
      { num: '14', label: 'Next Steps', id: 'a-next' },
    ],
  },
  {
    id: 'humanoid',
    icon: '🦾',
    tab: 'Humanoid Companion',
    tabSub: 'Advanced Build',
    badge: 'new',
    title: <>Build a <em>Humanoid Robotic Companion</em> with OrcBot</>,
    subtitle: 'An advanced project guide to building a full-body humanoid robot with speech, sign language, vision, walking, and AI cognition — all orchestrated by OrcBot.',
    meta: [
      { icon: '📖', label: '~60 min read' },
      { icon: '🦾', label: '22+ DOF humanoid' },
      { icon: '💰', label: '~$800–2,500 budget' },
      { icon: '🎓', label: 'Intermediate+' },
    ],
    toc: [
      { num: '01', label: 'Vision & Architecture', id: 'h-overview' },
      { num: '02', label: 'Choosing a Humanoid Platform', id: 'h-platform' },
      { num: '03', label: 'Bill of Materials', id: 'h-bom' },
      { num: '04', label: 'Mechanical Assembly', id: 'h-assembly' },
      { num: '05', label: 'Electronics & Wiring', id: 'h-electronics' },
      { num: '06', label: 'Motion Controller Bridge', id: 'h-motion' },
      { num: '07', label: 'Walking & Balance', id: 'h-walking' },
      { num: '08', label: 'Arm & Hand Control', id: 'h-arms' },
      { num: '09', label: 'Speech — Voice & Hearing', id: 'h-speech' },
      { num: '10', label: 'Sign Language', id: 'h-sign' },
      { num: '11', label: 'Computer Vision & Face', id: 'h-vision' },
      { num: '12', label: 'Cognition — OrcBot Brain', id: 'h-cognition' },
      { num: '13', label: 'OrcBot Humanoid Skills', id: 'h-skills' },
      { num: '14', label: 'Safety & Ethics', id: 'h-safety' },
      { num: '15', label: 'Simulation & Testing', id: 'h-simulation' },
      { num: '16', label: 'Deployment & Operation', id: 'h-deploy' },
      { num: '17', label: 'Troubleshooting', id: 'h-troubleshoot' },
      { num: '18', label: 'Resources & Community', id: 'h-resources' },
    ],
  },
];

const VALID_GUIDES = new Set<GuideId>(guides.map(g => g.id));

export default function Robotics() {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [searchParams, setSearchParams] = useSearchParams();

  const rawGuide = searchParams.get('guide') as GuideId | null;
  const activeGuide: GuideId = rawGuide && VALID_GUIDES.has(rawGuide) ? rawGuide : 'pi-robot';
  const guide = guides.find(g => g.id === activeGuide)!;

  const switchGuide = (id: GuideId) => {
    setSearchParams(id === 'pi-robot' ? {} : { guide: id }, { replace: true });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  // Sync document title
  useEffect(() => {
    document.title = `${guide.tab} — OrcBot Robotics`;
  }, [guide.tab]);

  return (
    <div className="app robotics-page">
      <div className="backdrop" />
      <div className="noise-overlay" />

      {/* ── Nav ──────────────────────────────────────────────── */}
      <header className="robotics-hero" id="top">
        <nav className="nav">
          <Link to="/" className="logo">
            <span className="logo-icon">▲</span>
            <span className="logo-text">OrcBot</span>
          </Link>
          <button className="mobile-toggle" onClick={() => setMobileMenuOpen(!mobileMenuOpen)} aria-label="Toggle menu">
            <span className={`hamburger ${mobileMenuOpen ? 'open' : ''}`} />
          </button>
          <div className={`nav-center ${mobileMenuOpen ? 'open' : ''}`}>
            <Link to="/" onClick={() => setMobileMenuOpen(false)}>Home</Link>
            <Link to="/deploy" onClick={() => setMobileMenuOpen(false)}>Deploy</Link>
            <Link to="/robotics" onClick={() => setMobileMenuOpen(false)}>Robotics</Link>
            <a href="https://fredabila.github.io/orcbot/docs/" target="_blank" rel="noopener noreferrer" onClick={() => setMobileMenuOpen(false)}>Docs</a>
          </div>
          <div className="nav-end">
            <a className="nav-btn ghost" href="https://fredabila.github.io/orcbot/docs/" target="_blank" rel="noopener noreferrer">Docs</a>
            <a className="nav-btn primary" href="https://github.com/fredabila/orcbot" target="_blank" rel="noopener noreferrer">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z" /></svg>
              GitHub
            </a>
          </div>
        </nav>

        <div className="robotics-hero-bg" />
        <div className="robotics-hero-content">
          <div className="robotics-badge">
            <span className="robotics-badge-dot" />
            Hardware &amp; Robotics Guide
          </div>
          <h1 className="robotics-title">
            {guide.title}
          </h1>
          <p className="robotics-subtitle">
            {guide.subtitle}
          </p>
          <div className="robotics-meta">
            {guide.meta.map((m, i) => (
              <span className="robotics-meta-item" key={i}><span className="meta-icon">{m.icon}</span> {m.label}</span>
            ))}
          </div>
        </div>
      </header>

      {/* ── Guide Tabs ──────────────────────────────────── */}
      <div className="guide-tabs-container">
        <div className="guide-tabs">
          {guides.map(g => (
            <button
              key={g.id}
              className={`guide-tab${activeGuide === g.id ? ' active' : ''}`}
              onClick={() => switchGuide(g.id)}
            >
              <span className="guide-tab-icon">{g.icon}</span>
              <span className="guide-tab-info">
                <span className="guide-tab-title">{g.tab}</span>
                <span className="guide-tab-sub">{g.tabSub}</span>
              </span>
              {g.badge && <span className={`guide-tab-badge ${g.badge}`}>{g.badge}</span>}
            </button>
          ))}
        </div>
      </div>

      {/* ── Table of Contents ───────────────────────────────── */}
      <div className="toc-container">
        <div className="toc-card">
          <div className="toc-title">Table of Contents</div>
          <div className="toc-grid">
            {guide.toc.map(t => (
              <a className="toc-link" href={`#${t.id}`} key={t.id}>
                <span className="toc-num">{t.num}</span>
                {t.label}
              </a>
            ))}
          </div>
        </div>
      </div>

      {/* ── Main Content ────────────────────────────────────── */}
      <main className="robotics-main">

        {activeGuide === 'pi-robot' && (<>

        {/* ── 1. Overview ──────────────────────────────────── */}
        <section className="content-section" id="overview">
          <div className="content-section-label">Phase 0</div>
          <h2>Overview &amp; How It Works</h2>
          <p>Traditional robots run pre-programmed routines. This project is different — the robot <strong>thinks before it acts</strong>. OrcBot receives a goal, breaks it into steps, executes those steps using skills, handles errors, and reports results.</p>

          <div className="arch-diagram">
            <pre>{`  ┌───────────────────────────────────────────────────────┐
  │                   YOUR PHONE                          │
  │               (Telegram / WhatsApp)                   │
  └─────────────────────────┬─────────────────────────────┘
                            │  "Inspect the room"
                            ▼
  ┌───────────────────────────────────────────────────────┐
  │              ORCBOT CORE (Raspberry Pi)                │
  │                                                       │
  │  1. Strategic Planner  →  plans multi-step sequence   │
  │  2. Decision Engine    →  picks tools per step        │
  │  3. Memory System      →  remembers observations      │
  │  4. Guard Rails        →  prevents unsafe loops       │
  └─────────────────────────┬─────────────────────────────┘
                            │  robot_move(direction="forward")
                            ▼
  ┌───────────────────────────────────────────────────────┐
  │           HARDWARE BRIDGE (Python / Flask)             │
  │                                                       │
  │  • Validates commands (speed, range)                  │
  │  • Translates to GPIO / I2C / serial                  │
  │  • Reads sensors, returns data                        │
  │  • Emergency stop always available                    │
  └─────────────────────────┬─────────────────────────────┘
                            │  GPIO / I2C / Serial
                            ▼
  ┌───────────────────────────────────────────────────────┐
  │                  PHYSICAL ROBOT                        │
  │     Motors ← L298N  ·  Sensors → HC-SR04  ·  Battery  │
  └───────────────────────────────────────────────────────┘`}</pre>
          </div>

          <h3>Why This Architecture?</h3>
          <p>OrcBot <strong>never touches hardware directly</strong>. It calls a Hardware Bridge — a small, separate service that validates every command before sending it to motors and sensors. This gives you:</p>
          <div className="safety-layers" style={{ marginTop: 12 }}>
            {[
              { title: 'Safety', desc: 'The bridge enforces speed limits, timeouts, and emergency stops regardless of what the AI decides.' },
              { title: 'Separation', desc: 'You can test OrcBot\'s planning without a real robot, and test the robot without OrcBot.' },
              { title: 'Flexibility', desc: 'Swap the bridge from a wheeled robot to a drone to a robotic arm without changing OrcBot.' },
            ].map((item, i) => (
              <div className="safety-layer" key={i}>
                <h4 style={{ margin: 0, marginBottom: 4 }}>{item.title}</h4>
                <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>{item.desc}</p>
              </div>
            ))}
          </div>
        </section>

        {/* ── 2. BOM ───────────────────────────────────────── */}
        <section className="content-section" id="bom">
          <div className="content-section-label">Phase 0</div>
          <h2>Shopping List (Bill of Materials)</h2>

          <h3>Core Components (Required)</h3>
          <div className="bom-table-wrap">
            <table className="bom-table">
              <thead><tr><th>#</th><th>Component</th><th>Purpose</th><th>Est. Cost</th></tr></thead>
              <tbody>
                {[
                  ['1', 'Raspberry Pi 4B (4 GB+)', 'Runs OrcBot + bridge', '$55–75'],
                  ['2', 'MicroSD Card (32 GB+, Class 10)', 'Pi storage', '$8–12'],
                  ['3', 'USB-C Power Supply (5 V 3 A)', 'Power the Pi on desk', '$10'],
                  ['4', '2WD Robot Chassis Kit', 'Frame, wheels, caster', '$12–20'],
                  ['5', '2× DC Gear Motors (3-6 V)', 'Drive wheels', 'Included'],
                  ['6', 'L298N Motor Driver Module', 'Motor speed & direction', '$3–6'],
                  ['7', 'HC-SR04 Ultrasonic Sensor', 'Obstacle detection', '$2–4'],
                  ['8', 'Jumper Wires (assorted)', 'Connections', '$5'],
                  ['9', 'Mini Breadboard', 'Prototyping', '$2–3'],
                  ['10', '4× AA Battery Holder + Batteries', 'Motor power (6 V)', '$8'],
                  ['11', 'USB Power Bank (5 V 2 A+)', 'Mobile Pi power', '$15–25'],
                ].map(r => (
                  <tr key={r[0]}><td>{r[0]}</td><td>{r[1]}</td><td>{r[2]}</td><td>{r[3]}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="bom-total">💰 Estimated core total: $120–160</div>

          <h3>Optional Upgrades</h3>
          <div className="bom-table-wrap">
            <table className="bom-table">
              <thead><tr><th>Component</th><th>Purpose</th><th>Est. Cost</th></tr></thead>
              <tbody>
                {[
                  ['Pi Camera Module v2 / USB webcam', 'Visual inspection, navigation', '$15–30'],
                  ['Servo Motor (SG90)', 'Pan camera / arm joint', '$3–5'],
                  ['PCA9685 Servo Driver Board', 'Multi-servo via I2C', '$5–8'],
                  ['MPU6050 IMU Module', 'Orientation sensing', '$3–5'],
                  ['IR Obstacle Sensors (×2)', 'Edge / line detection', '$2–4'],
                  ['OLED Display (SSD1306)', 'Onboard status display', '$5–8'],
                  ['Physical E-Stop Button', 'Hardware cutoff', '$3–5'],
                ].map((r, i) => (
                  <tr key={i}><td>{r[0]}</td><td>{r[1]}</td><td>{r[2]}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        {/* ── 3. Tools ─────────────────────────────────────── */}
        <section className="content-section" id="tools">
          <div className="content-section-label">Phase 0</div>
          <h2>Tools You'll Need</h2>

          <h3>Physical Tools</h3>
          <div className="tools-grid">
            {[
              { icon: '🔧', name: 'Small Phillips Screwdriver', desc: 'Chassis assembly' },
              { icon: '✂️', name: 'Wire Strippers', desc: 'Prepare wires for connections' },
              { icon: '🔥', name: 'Soldering Iron (optional)', desc: 'Motor wire connections — tape works for prototyping' },
              { icon: '📏', name: 'Multimeter (optional)', desc: 'Debug voltage and connections' },
              { icon: '🔫', name: 'Hot Glue Gun or Zip Ties', desc: 'Mount sensors to chassis' },
              { icon: '🩹', name: 'Electrical Tape', desc: 'Insulate wire connections' },
            ].map((t, i) => (
              <div className="tool-card" key={i}>
                <div className="tool-card-icon">{t.icon}</div>
                <div><h5>{t.name}</h5><p>{t.desc}</p></div>
              </div>
            ))}
          </div>

          <h3>Software Tools (all free)</h3>
          <div className="tools-grid">
            {[
              { icon: '💾', name: 'Raspberry Pi Imager', desc: 'Flash the Pi\'s SD card' },
              { icon: '💻', name: 'VS Code + Remote SSH', desc: 'Edit code on Pi from your laptop' },
              { icon: '🟢', name: 'Node.js 18+', desc: 'Run OrcBot on the Pi' },
              { icon: '🐍', name: 'Python 3.9+', desc: 'Run the hardware bridge' },
              { icon: '📦', name: 'Git', desc: 'Clone repositories' },
            ].map((t, i) => (
              <div className="tool-card" key={i}>
                <div className="tool-card-icon">{t.icon}</div>
                <div><h5>{t.name}</h5><p>{t.desc}</p></div>
              </div>
            ))}
          </div>
        </section>

        {/* ── 4. Software Prerequisites ────────────────────── */}
        <section className="content-section" id="software">
          <div className="content-section-label">Phase 1</div>
          <h2>Software Prerequisites</h2>
          <p>Set up everything on the Raspberry Pi before touching hardware.</p>

          <h3>Flash Raspberry Pi OS</h3>
          <div className="phase-steps">
            <div className="phase-step"><div className="phase-step-num">1</div><div className="phase-step-content"><h5>Download Raspberry Pi Imager</h5><p>Get it from raspberrypi.com/software</p></div></div>
            <div className="phase-step"><div className="phase-step-num">2</div><div className="phase-step-content"><h5>Select Raspberry Pi OS (64-bit, Lite)</h5><p>You don't need a desktop — headless is lighter and faster</p></div></div>
            <div className="phase-step"><div className="phase-step-num">3</div><div className="phase-step-content"><h5>Configure in Settings (⚙)</h5><p>Set hostname to <code>orcbot-robot</code>, enable SSH, configure Wi-Fi, set timezone</p></div></div>
            <div className="phase-step"><div className="phase-step-num">4</div><div className="phase-step-content"><h5>Flash and Boot</h5><p>Insert SD card into Pi, power on, wait 2–3 minutes</p></div></div>
          </div>

          <CodeBlock lang="bash">{`# Connect via SSH
ssh pi@orcbot-robot.local`}</CodeBlock>

          <h3>Install Node.js</h3>
          <CodeBlock lang="bash">{`# Install Node.js 20 LTS
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs

# Verify
node --version   # v20.x.x
npm --version    # 10.x.x`}</CodeBlock>

          <h3>Install OrcBot</h3>
          <CodeBlock lang="bash">{`cd ~
git clone https://github.com/fredabila/orcbot.git
cd orcbot
npm install
npm run build
mkdir -p ~/.orcbot`}</CodeBlock>

          <h3>Configure OrcBot</h3>
          <CodeBlock lang="yaml">{`# ~/.orcbot/orcbot.config.yaml

# LLM Provider (pick one)
openaiApiKey: "sk-your-openai-key-here"
model: "gpt-4o-mini"

# Telegram bot (get from @BotFather)
telegramToken: "your-telegram-bot-token"

# Agent settings
maxStepsPerAction: 15
maxMessagesPerAction: 3
sudoMode: false`}</CodeBlock>

          <h3>Install Python Dependencies</h3>
          <CodeBlock lang="bash">{`sudo apt-get install -y python3-pip python3-venv
python3 -m venv ~/robot-bridge-env
source ~/robot-bridge-env/bin/activate
pip install flask RPi.GPIO gpiozero`}</CodeBlock>
        </section>

        {/* ── 5. Build the Chassis ─────────────────────────── */}
        <section className="content-section" id="chassis">
          <div className="content-section-label">Phase 2</div>
          <h2>Build the Robot Chassis</h2>

          <h3>Assembly Steps</h3>
          <div className="phase-steps">
            {[
              { title: 'Mount the motors', desc: 'Attach DC motors to the bottom plate using brackets and screws. Shafts point outward.' },
              { title: 'Attach the wheels', desc: 'Push-fit each wheel onto a motor shaft. Add tape if loose.' },
              { title: 'Mount the caster wheel', desc: 'Attach the ball caster to the front of the bottom plate — steering is via differential drive.' },
              { title: 'Add standoffs', desc: 'Screw brass standoffs into corner holes — these create space for electronics between plates.' },
              { title: 'Plan your layout', desc: 'Bottom: L298N motor driver + battery. Top: Raspberry Pi + breadboard + sensors.' },
            ].map((s, i) => (
              <div className="phase-step" key={i}>
                <div className="phase-step-num">{i + 1}</div>
                <div className="phase-step-content"><h5>{s.title}</h5><p>{s.desc}</p></div>
              </div>
            ))}
          </div>

          <h3>Wiring Diagram</h3>
          <div className="arch-diagram">
            <pre>{`                    RASPBERRY PI GPIO
                    ┌──────────────┐
                    │  3.3V  5V    │
                    │  GPIO2 5V    │
                    │  GPIO3 GND   │
                    │  GPIO4 GPIO14│
                    │  GND   GPIO15│
                    │  GPIO17 ...  │
                    │  GPIO27 ...  │
                    │  GPIO22 ...  │
                    │  3.3V  ...   │
                    └──────┬───────┘
                           │
         ┌─────────────────┼──────────────────┐
         │                 │                  │
    ULTRASONIC         L298N MOTOR         LED/BUZZER
    (HC-SR04)          DRIVER              (optional)
    ┌────────┐        ┌──────────┐
    │VCC→5V  │        │12V→Batt+ │
    │GND→GND │        │GND→Batt- │        Pi GPIO → LED → GND
    │TRIG→G23│        │  & Pi GND│
    │ECHO→G24│        │IN1→GPIO17│
    │(voltage│        │IN2→GPIO27│
    │divider)│        │IN3→GPIO22│
    └────────┘        │IN4→GPIO10│
                      │ENA→GPIO18│  (PWM speed)
                      │ENB→GPIO25│  (PWM speed)
                      │OUT1→MotL+│
                      │OUT2→MotL-│
                      │OUT3→MotR+│
                      │OUT4→MotR-│
                      └──────────┘`}</pre>
          </div>

          <h3>Motor Driver Connections</h3>
          <div className="wiring-table-wrap">
            <table className="wiring-table">
              <thead><tr><th>L298N Pin</th><th>Connect To</th><th>Purpose</th></tr></thead>
              <tbody>
                {[
                  ['12V (VCC)', 'Battery pack + (6V)', 'Power motors'],
                  ['GND', 'Battery − AND Pi GND', 'Common ground'],
                  ['IN1', 'Pi GPIO 17', 'Left motor direction A'],
                  ['IN2', 'Pi GPIO 27', 'Left motor direction B'],
                  ['IN3', 'Pi GPIO 22', 'Right motor direction A'],
                  ['IN4', 'Pi GPIO 10', 'Right motor direction B'],
                  ['ENA', 'Pi GPIO 18', 'Left motor speed (PWM)'],
                  ['ENB', 'Pi GPIO 25', 'Right motor speed (PWM)'],
                ].map((r, i) => (
                  <tr key={i}><td>{r[0]}</td><td>{r[1]}</td><td>{r[2]}</td></tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="callout callout-warning">
            <span className="callout-icon">⚠️</span>
            <strong>Remove the jumper caps</strong> on ENA and ENB pins. This lets you control speed via PWM instead of running at full speed.
          </div>

          <h3>Ultrasonic Sensor (HC-SR04)</h3>
          <div className="wiring-table-wrap">
            <table className="wiring-table">
              <thead><tr><th>HC-SR04 Pin</th><th>Connect To</th><th>Notes</th></tr></thead>
              <tbody>
                <tr><td>VCC</td><td>Pi 5V</td><td></td></tr>
                <tr><td>GND</td><td>Pi GND</td><td></td></tr>
                <tr><td>TRIG</td><td>Pi GPIO 23</td><td></td></tr>
                <tr><td>ECHO</td><td>Pi GPIO 24 via voltage divider</td><td>5V → 3.3V protection!</td></tr>
              </tbody>
            </table>
          </div>

          <div className="callout callout-warning">
            <span className="callout-icon">⚡</span>
            <strong>Voltage divider required!</strong> The HC-SR04 outputs 5V on ECHO but Pi GPIO is 3.3V. Use a 1kΩ + 2kΩ resistor divider to drop the signal safely.
          </div>

          <div className="arch-diagram">
            <pre>{`Voltage divider for ECHO pin:

ECHO ──── 1kΩ resistor ──┬── GPIO 24
                          │
                       2kΩ resistor
                          │
                         GND

This drops 5V → ~3.3V (safe for Pi)`}</pre>
          </div>
        </section>

        {/* ── 6. Pi Setup ──────────────────────────────────── */}
        <section className="content-section" id="pi-setup">
          <div className="content-section-label">Phase 3</div>
          <h2>Set Up the Raspberry Pi</h2>

          <h3>Enable Interfaces</h3>
          <CodeBlock lang="bash">{`sudo raspi-config
# Interface Options → I2C → Enable
# Interface Options → SPI → Enable
# Reboot when prompted`}</CodeBlock>

          <h3>Test Your Wiring</h3>
          <p>Run this <strong>before</strong> writing any bridge code to verify everything is connected correctly.</p>

          <CodeBlock lang="python">{`#!/usr/bin/env python3
"""Quick hardware test — verify wiring is correct."""

import RPi.GPIO as GPIO
import time

# Motor A (Left)
IN1, IN2, ENA = 17, 27, 18
# Motor B (Right)
IN3, IN4, ENB = 22, 10, 25
# Ultrasonic
TRIG, ECHO = 23, 24

GPIO.setmode(GPIO.BCM)
GPIO.setwarnings(False)

for pin in [IN1, IN2, IN3, IN4, ENA, ENB]:
    GPIO.setup(pin, GPIO.OUT)
    GPIO.output(pin, GPIO.LOW)

GPIO.setup(TRIG, GPIO.OUT)
GPIO.setup(ECHO, GPIO.IN)

pwm_a = GPIO.PWM(ENA, 1000)
pwm_b = GPIO.PWM(ENB, 1000)
pwm_a.start(0)
pwm_b.start(0)

def test_distance():
    GPIO.output(TRIG, True)
    time.sleep(0.00001)
    GPIO.output(TRIG, False)
    start = stop = time.time()
    while GPIO.input(ECHO) == 0:
        start = time.time()
        if time.time() - stop > 0.1: return -1
    while GPIO.input(ECHO) == 1:
        stop = time.time()
        if stop - start > 0.1: return -1
    return round((stop - start) * 34300 / 2, 1)

try:
    print("=== ULTRASONIC TEST ===")
    for i in range(3):
        print(f"  Distance: {test_distance()} cm")
        time.sleep(0.5)

    print("\\n=== MOTOR TEST (lift robot!) ===")
    input("  Press ENTER...")
    for label, i1, i2, pwm in [("LEFT", IN1, IN2, pwm_a), ("RIGHT", IN3, IN4, pwm_b)]:
        GPIO.output(i1, GPIO.HIGH)
        pwm.ChangeDutyCycle(50)
        time.sleep(1)
        pwm.ChangeDutyCycle(0)
        GPIO.output(i1, GPIO.LOW)
        print(f"  {label} motor ✓")

    print("\\n✅ ALL TESTS COMPLETE")
finally:
    pwm_a.stop(); pwm_b.stop(); GPIO.cleanup()`}</CodeBlock>

          <div className="callout callout-info">
            <span className="callout-icon">💡</span>
            <strong>Motors don't spin?</strong> Check battery, verify IN1–IN4 wiring, ensure ENA/ENB jumpers are removed.<br />
            <strong>Sensor reads -1?</strong> Check TRIG/ECHO wires and the voltage divider.<br />
            <strong>Wrong direction?</strong> Swap the two motor wires on the L298N output terminals.
          </div>
        </section>

        {/* ── 7. Hardware Bridge ────────────────────────────── */}
        <section className="content-section" id="bridge">
          <div className="content-section-label">Phase 4</div>
          <h2>Build the Hardware Bridge</h2>
          <p>The bridge is a Python Flask REST API that accepts high-level commands from OrcBot and translates them into GPIO signals. This is the critical safety layer.</p>

          <CodeBlock lang="python">{`#!/usr/bin/env python3
"""
OrcBot Hardware Bridge — REST API for safe robot control.
Safety: speed clamping, obstacle checks, watchdog, e-stop.
"""

from flask import Flask, request, jsonify
import RPi.GPIO as GPIO
import time, threading, logging, signal, atexit
from datetime import datetime

app = Flask(__name__)
log = logging.getLogger('bridge')
logging.basicConfig(level=logging.INFO, format='%(asctime)s [%(levelname)s] %(message)s')

# ── Config ──
MOTOR_LEFT  = {'IN1': 17, 'IN2': 27, 'ENA': 18}
MOTOR_RIGHT = {'IN3': 22, 'IN4': 10, 'ENB': 25}
ULTRASONIC  = {'TRIG': 23, 'ECHO': 24}
MAX_SPEED, MIN_SPEED = 80, 20
MAX_DURATION, WATCHDOG_TIMEOUT, OBSTACLE_MIN_CM = 5.0, 10, 15

# ── GPIO Setup ──
GPIO.setmode(GPIO.BCM); GPIO.setwarnings(False)
for p in [17, 27, 22, 10, 18, 25]:
    GPIO.setup(p, GPIO.OUT); GPIO.output(p, GPIO.LOW)
GPIO.setup(23, GPIO.OUT); GPIO.setup(24, GPIO.IN)
pwm_l = GPIO.PWM(18, 1000); pwm_r = GPIO.PWM(25, 1000)
pwm_l.start(0); pwm_r.start(0)

state = {'moving': False, 'direction': 'stopped', 'speed': 0,
         'last_cmd': time.time(), 'e_stopped': False, 'cmds': 0}
lock = threading.Lock()

def stop_motors():
    pwm_l.ChangeDutyCycle(0); pwm_r.ChangeDutyCycle(0)
    for p in [17, 27, 22, 10]: GPIO.output(p, GPIO.LOW)
    with lock: state.update(moving=False, direction='stopped', speed=0)

def measure_distance():
    GPIO.output(23, True); time.sleep(0.00001); GPIO.output(23, False)
    t = time.time(); start = stop = t
    while GPIO.input(24) == 0:
        start = time.time()
        if start - t > 0.1: return -1
    while GPIO.input(24) == 1:
        stop = time.time()
        if stop - start > 0.1: return -1
    return round((stop - start) * 34300 / 2, 1)

# Watchdog thread
def watchdog():
    while True:
        time.sleep(1)
        with lock:
            if state['moving'] and time.time() - state['last_cmd'] > WATCHDOG_TIMEOUT:
                log.warning("WATCHDOG — stopping"); stop_motors()
threading.Thread(target=watchdog, daemon=True).start()

@app.route('/health')
def health(): return jsonify(status='ok')

@app.route('/status')
def status():
    d = measure_distance()
    with lock:
        return jsonify(moving=state['moving'], direction=state['direction'],
            speed=state['speed'], e_stopped=state['e_stopped'],
            obstacle_cm=d, obstacle_warning=0 < d < OBSTACLE_MIN_CM)

@app.route('/move', methods=['POST'])
def move():
    with lock:
        if state['e_stopped']: return jsonify(error='E-STOP active'), 403
        state['last_cmd'] = time.time(); state['cmds'] += 1
    d = request.json or {}
    direction = d.get('direction', 'forward')
    speed = max(MIN_SPEED, min(int(d.get('speed', 40)), MAX_SPEED))
    dur = max(0.1, min(float(d.get('duration', 1.0)), MAX_DURATION))
    if direction == 'forward':
        dist = measure_distance()
        if 0 < dist < OBSTACLE_MIN_CM:
            return jsonify(error=f'Obstacle at {dist}cm'), 409
    # Set motor directions + speed ...
    fwd = direction in ('forward', 'left', 'right')
    bwd = direction == 'backward'
    GPIO.output(17, fwd); GPIO.output(27, bwd)
    GPIO.output(22, fwd); GPIO.output(10, bwd)
    ls = speed * 0.3 if direction == 'left' else speed
    rs = speed * 0.3 if direction == 'right' else speed
    pwm_l.ChangeDutyCycle(ls); pwm_r.ChangeDutyCycle(rs)
    with lock: state.update(moving=True, direction=direction, speed=speed)
    threading.Thread(target=lambda: (time.sleep(dur), stop_motors()), daemon=True).start()
    return jsonify(status='moving', direction=direction, speed=speed, duration=dur)

@app.route('/stop', methods=['POST'])
def stop(): stop_motors(); return jsonify(status='stopped')

@app.route('/e-stop', methods=['POST'])
def e_stop():
    stop_motors()
    with lock: state['e_stopped'] = True
    return jsonify(status='e-stopped')

@app.route('/e-stop/reset', methods=['POST'])
def e_stop_reset():
    with lock: state['e_stopped'] = False
    return jsonify(status='reset')

@app.route('/sensor/distance')
def sensor_dist():
    readings = [d for _ in range(3) if (d := measure_distance()) > 0 or not time.sleep(0.05)]
    if not readings: return jsonify(error='Sensor timeout'), 500
    avg = round(sum(readings) / len(readings), 1)
    return jsonify(distance_cm=avg, obstacle_warning=avg < OBSTACLE_MIN_CM)

@app.route('/rotate', methods=['POST'])
def rotate():
    with lock:
        if state['e_stopped']: return jsonify(error='E-STOP active'), 403
        state['last_cmd'] = time.time(); state['cmds'] += 1
    d = request.json or {}
    angle = int(d.get('angle', 90))
    speed = max(MIN_SPEED, min(int(d.get('speed', 40)), MAX_SPEED))
    dur = min(abs(angle) / 90 * (40 / speed), MAX_DURATION)
    cw = angle > 0
    GPIO.output(17, cw); GPIO.output(27, not cw)
    GPIO.output(22, not cw); GPIO.output(10, cw)
    pwm_l.ChangeDutyCycle(speed); pwm_r.ChangeDutyCycle(speed)
    threading.Thread(target=lambda: (time.sleep(dur), stop_motors()), daemon=True).start()
    return jsonify(status='rotating', angle=angle)

def cleanup(*a):
    stop_motors(); pwm_l.stop(); pwm_r.stop(); GPIO.cleanup()
atexit.register(cleanup)
signal.signal(signal.SIGTERM, cleanup)

if __name__ == '__main__':
    log.info(f"Bridge starting — MAX_SPEED={MAX_SPEED}, WATCHDOG={WATCHDOG_TIMEOUT}s")
    app.run(host='0.0.0.0', port=5050, debug=False)`}</CodeBlock>

          <h3>Test the Bridge</h3>
          <CodeBlock lang="bash">{`# Terminal 1: Start bridge
source ~/robot-bridge-env/bin/activate
sudo python3 ~/robot-bridge/bridge.py

# Terminal 2: Test endpoints
curl http://localhost:5050/health
curl http://localhost:5050/sensor/distance
curl http://localhost:5050/status

# Move forward (LIFT ROBOT FIRST!)
curl -X POST http://localhost:5050/move \\
  -H "Content-Type: application/json" \\
  -d '{"direction": "forward", "speed": 40, "duration": 1}'

# Emergency stop
curl -X POST http://localhost:5050/e-stop`}</CodeBlock>
        </section>

        {/* ── 8. OrcBot Skills ─────────────────────────────── */}
        <section className="content-section" id="skills">
          <div className="content-section-label">Phase 5</div>
          <h2>Create OrcBot Skills</h2>
          <p>Skills connect OrcBot to the bridge. Place this file in <code>~/.orcbot/plugins/skills/robot-control/index.js</code></p>

          <CodeBlock lang="javascript">{`/**
 * OrcBot Robot Control Skill — connects to the Hardware Bridge API.
 */
const BRIDGE_URL = process.env.ROBOT_BRIDGE_URL || 'http://localhost:5050';

async function callBridge(path, method = 'GET', body = null) {
  const opts = { method, headers: { 'Content-Type': 'application/json' } };
  if (body) opts.body = JSON.stringify(body);
  try {
    const res = await fetch(\`\${BRIDGE_URL}\${path}\`, opts);
    const data = await res.json();
    return res.ok ? { success: true, ...data } : { success: false, error: data.error };
  } catch (e) {
    return { success: false, error: \`Bridge unreachable: \${e.message}\` };
  }
}

module.exports = [
  {
    name: 'robot_move',
    description: 'Move the robot (forward/backward/left/right) with speed and duration.',
    usage: 'robot_move(direction, speed?, duration?)',
    handler: async (args) => callBridge('/move', 'POST', {
      direction: args.direction, speed: parseInt(args.speed || '40'),
      duration: parseFloat(args.duration || '1.0')
    })
  },
  {
    name: 'robot_rotate',
    description: 'Rotate in place. Positive angle = clockwise.',
    usage: 'robot_rotate(angle, speed?)',
    handler: async (args) => callBridge('/rotate', 'POST', {
      angle: parseInt(args.angle || '90'), speed: parseInt(args.speed || '40')
    })
  },
  {
    name: 'robot_stop',
    description: 'Stop all movement immediately.',
    usage: 'robot_stop()',
    handler: async () => callBridge('/stop', 'POST')
  },
  {
    name: 'robot_e_stop',
    description: 'EMERGENCY STOP — halt and block further commands.',
    usage: 'robot_e_stop()',
    handler: async () => callBridge('/e-stop', 'POST')
  },
  {
    name: 'robot_e_stop_reset',
    description: 'Reset emergency stop to allow commands again.',
    usage: 'robot_e_stop_reset()',
    handler: async () => callBridge('/e-stop/reset', 'POST')
  },
  {
    name: 'robot_status',
    description: 'Get robot status: movement, sensors, warnings.',
    usage: 'robot_status()',
    handler: async () => callBridge('/status')
  },
  {
    name: 'robot_distance',
    description: 'Measure distance to nearest obstacle (cm).',
    usage: 'robot_distance()',
    handler: async () => callBridge('/sensor/distance')
  }
];`}</CodeBlock>
        </section>

        {/* ── 9. Safety ────────────────────────────────────── */}
        <section className="content-section" id="safety">
          <div className="content-section-label">Critical</div>
          <h2>Safety &amp; Emergency Stop</h2>
          <p><strong>Safety is not optional in robotics.</strong> This system has four layers of protection:</p>

          <div className="safety-layers">
            {[
              {
                num: 'Layer 1', title: 'Hardware Bridge Safety', items: [
                  'Speed clamping — all speeds limited to 80%',
                  'Duration clamping — no command runs longer than 5 seconds',
                  'Obstacle checking — forward movement blocked if obstacle < 15cm',
                  'Watchdog timer — motors auto-stop if no command in 10 seconds',
                  'E-stop endpoint — overrides everything',
                ]
              },
              {
                num: 'Layer 2', title: 'OrcBot Guard Rails', items: [
                  'Skill frequency limits — can\'t spam same command 15+ times',
                  'Pattern loop detection — breaks repetitive cycles',
                  'Step limits — actions terminate after N steps',
                  'Termination review — second LLM pass confirms completion',
                ]
              },
              {
                num: 'Layer 3', title: 'Physical Safety (You Build)', items: [
                  'Physical E-stop button — cuts battery to motors, no software involved',
                  'Battery inline fuse (5A) — prevents fires',
                  'Bumper switch — microswitch triggers stop on contact',
                ]
              },
              {
                num: 'Layer 4', title: 'Testing Discipline', items: [
                  '✅ Test bridge API with curl (no motors connected)',
                  '✅ Test motors with robot lifted off ground',
                  '✅ Test OrcBot → bridge with robot in the air',
                  '✅ Ground test in confined area (cardboard arena)',
                  '✅ Operate normally with supervision',
                ]
              },
            ].map((layer, i) => (
              <div className="safety-layer" key={i}>
                <div className="safety-layer-num">{layer.num}</div>
                <h4>{layer.title}</h4>
                <ul>{layer.items.map((it, j) => <li key={j}>{it}</li>)}</ul>
              </div>
            ))}
          </div>

          <h3>Physical E-Stop Wiring</h3>
          <div className="arch-diagram">
            <pre>{`                          ┌─────────┐
Battery + ───── FUSE ─────┤ E-STOP  ├───── L298N 12V
                          │ (button)│
                          └─────────┘

Normal:    button closed = power flows to motors
Emergency: press button  = power cut (Pi stays on USB)`}</pre>
          </div>
        </section>

        {/* ── 10. Simulation ───────────────────────────────── */}
        <section className="content-section" id="simulation">
          <div className="content-section-label">Phase 6</div>
          <h2>Test in Simulation First</h2>
          <p>Use a mock bridge on your laptop — no Pi or motors needed — to test OrcBot's planning logic.</p>

          <CodeBlock lang="python">{`#!/usr/bin/env python3
"""Mock bridge — simulates robot behavior without GPIO."""

from flask import Flask, request, jsonify
import time, random, math

app = Flask(__name__)

state = {'x': 0.0, 'y': 0.0, 'heading': 0.0,
         'moving': False, 'e_stopped': False}

@app.route('/health')
def health(): return jsonify(status='ok', mock=True)

@app.route('/status')
def status():
    return jsonify(**state, obstacle_cm=round(random.uniform(20, 200), 1))

@app.route('/move', methods=['POST'])
def move():
    if state['e_stopped']: return jsonify(error='E-STOP'), 403
    d = request.json or {}
    direction, speed = d.get('direction', 'forward'), int(d.get('speed', 40))
    dur = float(d.get('duration', 1.0))
    dist = speed * dur * 0.01
    if direction == 'forward':
        state['x'] += dist * math.cos(math.radians(state['heading']))
        state['y'] += dist * math.sin(math.radians(state['heading']))
    return jsonify(status='moving', direction=direction, position=f"({state['x']:.1f}, {state['y']:.1f})")

@app.route('/rotate', methods=['POST'])
def rotate():
    angle = int((request.json or {}).get('angle', 90))
    state['heading'] = (state['heading'] + angle) % 360
    return jsonify(status='rotating', heading=state['heading'])

@app.route('/stop', methods=['POST'])
def stop(): state['moving'] = False; return jsonify(status='stopped')

@app.route('/e-stop', methods=['POST'])
def e_stop(): state['e_stopped'] = True; return jsonify(status='e-stopped')

@app.route('/e-stop/reset', methods=['POST'])
def reset(): state['e_stopped'] = False; return jsonify(status='reset')

@app.route('/sensor/distance')
def dist(): d = round(random.uniform(10, 300), 1); return jsonify(distance_cm=d)

if __name__ == '__main__':
    print("Mock bridge on :5050"); app.run(port=5050)`}</CodeBlock>

          <h3>Test the Full Loop</h3>
          <CodeBlock lang="bash">{`# Terminal 1: Mock bridge
python3 mock_bridge.py

# Terminal 2: OrcBot
ROBOT_BRIDGE_URL=http://localhost:5050 npm run dev

# Terminal 3: Test via Telegram
# → "Check the robot's status"
# → "Move forward slowly for 2 seconds"
# → "Patrol: forward 3s, rotate 90°, check distance, repeat 3 times"`}</CodeBlock>
        </section>

        {/* ── 11. Real Hardware ─────────────────────────────── */}
        <section className="content-section" id="real-hw">
          <div className="content-section-label">Phase 7</div>
          <h2>Connect to Real Hardware</h2>
          <p>Once mock testing works, switch to the real bridge on the Pi.</p>

          <h3>First Real-World Test (Supervised)</h3>
          <div className="test-checklist">
            {[
              'Lift robot off the ground (put on a box)',
              'Send via Telegram: "Move forward at speed 30 for 1 second"',
              'Verify wheels spin in the correct direction',
              'Send: "Check the distance sensor"',
              'Put your hand in front of sensor — verify reading changes',
              'Send: "Emergency stop the robot"',
              'Verify: motors stop, further commands are blocked',
              'Send: "Reset the emergency stop"',
            ].map((item, i) => (
              <div className="test-check" key={i}>
                <span className="test-check-icon">✓</span>
                <span>{item}</span>
              </div>
            ))}
          </div>

          <h3>Ground Test</h3>
          <div className="test-checklist">
            {[
              'Place robot on floor in clear area (2m × 2m minimum)',
              'Place obstacle ~30cm ahead',
              'Send: "Move forward at speed 30 for 3 seconds"',
              'Robot should stop automatically when obstacle < 15cm',
              'Send: "Check status" — observe obstacle warning',
            ].map((item, i) => (
              <div className="test-check" key={i}>
                <span className="test-check-icon">✓</span>
                <span>{item}</span>
              </div>
            ))}
          </div>
        </section>

        {/* ── 12. Deploy ───────────────────────────────────── */}
        <section className="content-section" id="deploy">
          <div className="content-section-label">Phase 8</div>
          <h2>Deploy &amp; Operate</h2>
          <p>Run everything as system services so it starts on boot.</p>

          <h3>Systemd Services</h3>
          <CodeBlock lang="ini">{`# /etc/systemd/system/robot-bridge.service
[Unit]
Description=OrcBot Hardware Bridge
After=network.target

[Service]
Type=simple
User=root
WorkingDirectory=/home/pi/robot-bridge
ExecStart=/home/pi/robot-bridge-env/bin/python bridge.py
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target`}</CodeBlock>

          <CodeBlock lang="ini">{`# /etc/systemd/system/orcbot.service
[Unit]
Description=OrcBot AI Agent
After=network.target robot-bridge.service
Wants=robot-bridge.service

[Service]
Type=simple
User=pi
WorkingDirectory=/home/pi/orcbot
ExecStart=/usr/bin/node dist/cli/index.js start
Restart=always
Environment=ROBOT_BRIDGE_URL=http://localhost:5050

[Install]
WantedBy=multi-user.target`}</CodeBlock>

          <CodeBlock lang="bash">{`sudo systemctl daemon-reload
sudo systemctl enable robot-bridge orcbot
sudo systemctl start robot-bridge orcbot

# View logs
sudo journalctl -u robot-bridge -f
sudo journalctl -u orcbot -f`}</CodeBlock>

          <h3>Scheduled Patrols</h3>
          <div className="callout callout-success">
            <span className="callout-icon">🕐</span>
            Send via Telegram: <em>"Schedule a patrol every 30 minutes: move forward 3 seconds, rotate 90°, check distance, report status back to me"</em>
          </div>
        </section>

        {/* ── 13. Camera ───────────────────────────────────── */}
        <section className="content-section" id="camera">
          <div className="content-section-label">Advanced</div>
          <h2>Camera Vision &amp; Navigation</h2>
          <p>Add visual perception for obstacle identification and inspection tasks.</p>

          <h3>Camera Endpoint (add to bridge.py)</h3>
          <CodeBlock lang="python">{`import subprocess, base64

@app.route('/camera/capture')
def camera_capture():
    path = '/tmp/robot_capture.jpg'
    try:
        subprocess.run(['libcamera-still', '-o', path, '--width', '640',
            '--height', '480', '-t', '1000', '--nopreview'], timeout=10)
        with open(path, 'rb') as f:
            img = base64.b64encode(f.read()).decode()
        return jsonify(status='captured', image_base64=img)
    except Exception as e:
        return jsonify(error=str(e)), 500`}</CodeBlock>

          <h3>OrcBot Vision Skill</h3>
          <CodeBlock lang="javascript">{`{
  name: 'robot_look',
  description: 'Capture + analyze a photo from the robot camera.',
  usage: 'robot_look(prompt?)',
  handler: async (args, context) => {
    const result = await callBridge('/camera/capture');
    if (!result.success) return result;
    const fs = require('fs'), path = require('path');
    const imgPath = path.join(require('os').homedir(), '.orcbot', 'robot-camera.jpg');
    fs.writeFileSync(imgPath, Buffer.from(result.image_base64, 'base64'));
    const prompt = args.prompt || 'Describe what the robot sees. Identify obstacles, people, objects.';
    if (context?.agent?.llm?.analyzeMedia) {
      const analysis = await context.agent.llm.analyzeMedia(imgPath, prompt);
      return { success: true, analysis, imagePath: imgPath };
    }
    return { success: true, message: 'Photo saved', imagePath: imgPath };
  }
}`}</CodeBlock>
        </section>

        {/* ── 14. ROS2 ─────────────────────────────────────── */}
        <section className="content-section" id="ros2">
          <div className="content-section-label">Advanced</div>
          <h2>ROS2 Integration</h2>
          <p>For sophisticated robotics (SLAM, path planning, multi-sensor fusion), use ROS2 as the bridge layer.</p>

          <div className="arch-diagram">
            <pre>{`OrcBot  →  HTTP  →  ROS2 Bridge Node  →  /cmd_vel  →  Motor Driver Node
                                       →  /e_stop   →  Safety Node
                                       ←  /odom     ←  Odometry
                                       ←  /scan     ←  LIDAR (optional)`}</pre>
          </div>

          <CodeBlock lang="bash">{`# Install ROS2 Humble on Ubuntu 22.04
sudo apt install ros-humble-ros-base
source /opt/ros/humble/setup.bash`}</CodeBlock>
        </section>

        {/* ── 15. MQTT ─────────────────────────────────────── */}
        <section className="content-section" id="mqtt">
          <div className="content-section-label">Advanced</div>
          <h2>MQTT for Multi-Robot Fleets</h2>
          <p>Control multiple robots from a single OrcBot instance using publish/subscribe messaging.</p>

          <h3>Topic Structure</h3>
          <div className="arch-diagram">
            <pre>{`fleet/robot-01/command       # OrcBot publishes commands
fleet/robot-01/status        # Robot publishes telemetry
fleet/robot-01/e-stop        # Emergency stop channel
fleet/robot-02/command       # Second robot
fleet/broadcast/e-stop       # Stop ALL robots`}</pre>
          </div>

          <CodeBlock lang="bash">{`# Install Mosquitto MQTT broker
sudo apt install mosquitto mosquitto-clients
sudo systemctl enable mosquitto
sudo systemctl start mosquitto`}</CodeBlock>
        </section>

        {/* ── 16. Troubleshooting ──────────────────────────── */}
        <section className="content-section" id="troubleshoot">
          <div className="content-section-label">Reference</div>
          <h2>Troubleshooting</h2>

          <div className="trouble-table-wrap">
            <table className="trouble-table">
              <thead><tr><th>Problem</th><th>Cause</th><th>Fix</th></tr></thead>
              <tbody>
                {[
                  ['Motors don\'t spin', 'No battery power', 'Check battery connections & voltage with multimeter'],
                  ['Wrong direction', 'Wires swapped', 'Swap motor wires on L298N output terminals'],
                  ['Only one motor', 'Bad GPIO connection', 'Re-check IN/EN pin wiring, run test script'],
                  ['Sensor reads -1', 'Timeout / bad wiring', 'Check TRIG/ECHO pins, verify voltage divider'],
                  ['Wildly wrong readings', 'Missing voltage divider', 'Add 1kΩ + 2kΩ resistor divider on ECHO pin'],
                  ['Bridge won\'t start', 'GPIO permission', 'Run with sudo or add pi to gpio group'],
                  ['Can\'t reach bridge', 'Wrong URL / firewall', 'Check ROBOT_BRIDGE_URL, verify with curl'],
                  ['Robot oscillates', 'Commands too rapid', 'Increase duration, reduce speed'],
                  ['OrcBot loops', 'Task too vague', 'Be specific: "move forward 2 seconds"'],
                  ['Motors overheat', 'Speed/duration too high', 'Lower MAX_SPEED, add cooling pauses'],
                ].map((r, i) => (
                  <tr key={i}><td>{r[0]}</td><td>{r[1]}</td><td>{r[2]}</td></tr>
                ))}
              </tbody>
            </table>
          </div>

          <h3>Debugging Commands</h3>
          <CodeBlock lang="bash">{`# Check bridge
curl http://localhost:5050/health

# Monitor logs
sudo journalctl -u robot-bridge -f

# Check I2C devices (PCA9685, MPU6050, etc.)
sudo i2cdetect -y 1

# Test motor driver directly
sudo python3 ~/test_motors.py`}</CodeBlock>
        </section>

        {/* ── 17. Learning Resources ──────────────────────── */}
        <section className="content-section" id="resources">
          <div className="content-section-label">Reference</div>
          <h2>Learning Resources</h2>

          <h3>Beginner</h3>
          <div className="resources-grid">
            {[
              { title: 'Raspberry Pi Docs', desc: 'Pi setup, GPIO basics', url: 'https://www.raspberrypi.com/documentation/' },
              { title: 'GPIO Zero Docs', desc: 'Simplified Python GPIO library', url: 'https://gpiozero.readthedocs.io/' },
              { title: 'Flask Quickstart', desc: 'Building REST APIs in Python', url: 'https://flask.palletsprojects.com/' },
              { title: 'L298N Tutorial', desc: 'Motor driver wiring and control', url: 'https://lastminuteengineers.com/l298n-dc-motor-arduino-tutorial/' },
            ].map((r, i) => (
              <a className="resource-card" href={r.url} target="_blank" rel="noopener noreferrer" key={i}>
                <h5>{r.title}</h5>
                <p>{r.desc}</p>
                <span className="resource-link">Visit →</span>
              </a>
            ))}
          </div>

          <h3>Intermediate</h3>
          <div className="resources-grid">
            {[
              { title: 'ROS2 Tutorials', desc: 'Robot Operating System framework', url: 'https://docs.ros.org/en/humble/Tutorials.html' },
              { title: 'MQTT Essentials', desc: 'Publish/subscribe messaging for IoT', url: 'https://www.hivemq.com/mqtt-essentials/' },
              { title: 'OpenCV on Pi', desc: 'Computer vision on Raspberry Pi', url: 'https://pyimagesearch.com/category/raspberry-pi/' },
            ].map((r, i) => (
              <a className="resource-card" href={r.url} target="_blank" rel="noopener noreferrer" key={i}>
                <h5>{r.title}</h5>
                <p>{r.desc}</p>
                <span className="resource-link">Visit →</span>
              </a>
            ))}
          </div>

          <h3>Advanced</h3>
          <div className="resources-grid">
            {[
              { title: 'Navigation2 (ROS2)', desc: 'Autonomous path planning', url: 'https://navigation.ros.org/' },
              { title: 'SLAM Toolbox', desc: 'Simultaneous Localization and Mapping', url: 'https://github.com/SteveMacenski/slam_toolbox' },
              { title: 'Spinning Up (RL)', desc: 'Reinforcement learning for robotics', url: 'https://spinningup.openai.com/' },
            ].map((r, i) => (
              <a className="resource-card" href={r.url} target="_blank" rel="noopener noreferrer" key={i}>
                <h5>{r.title}</h5>
                <p>{r.desc}</p>
                <span className="resource-link">Visit →</span>
              </a>
            ))}
          </div>
        </section>

        {/* ── 18. Architecture Reference ──────────────────── */}
        <section className="content-section" id="arch-ref">
          <div className="content-section-label">Reference</div>
          <h2>Architecture Reference</h2>

          <h3>System Diagram</h3>
          <div className="arch-diagram">
            <pre>{` ┌────────────────────────────────────────────────────────────────┐
 │                        OrcBot System                          │
 │                                                               │
 │  ┌──────────┐    ┌──────────────┐    ┌────────────────────┐  │
 │  │ Telegram  │    │  OrcBot Core │    │  Hardware Bridge   │  │
 │  │ WhatsApp  │◄──►│  • Planner   │──► │  • Validation      │  │
 │  │ Discord   │    │  • Memory    │    │  • GPIO Control    │  │
 │  └──────────┘    │  • Skills    │    │  • Sensor Reading  │  │
 │                   │  • Guards    │    │  • Watchdog        │  │
 │                   └──────────────┘    │  • E-Stop          │  │
 │                                       └────────┬───────────┘  │
 │                                                │              │
 │                                       ┌────────▼───────────┐  │
 │                                       │  Physical Robot     │  │
 │                                       │  Motors · Sensors   │  │
 │                                       │  Camera · Battery   │  │
 │                                       └────────────────────┘  │
 └────────────────────────────────────────────────────────────────┘`}</pre>
          </div>

          <h3>Safety Enforcement Chain</h3>
          <div className="arch-diagram">
            <pre>{`User Command ("move fast")
    │
    ▼
OrcBot Planner → robot_move(speed=80, duration=2)
    │
    ▼
Guard Rails → loop check, frequency check, step limit
    │
    ▼
Hardware Bridge → clamps to MAX_SPEED, checks obstacle
    │
    ▼
Watchdog Timer → auto-stops if no heartbeat
    │
    ▼
Physical E-Stop → cuts battery power (overrides all)`}</pre>
          </div>
        </section>

        {/* ── Pi Robot Summary Banner ───────────────────────── */}
        <div className="summary-banner">
          <h2>You built an AI-powered robot.</h2>
          <p>From parts on a desk to an autonomous system you command with natural language. Here's what you now have:</p>
          <div className="summary-chips">
            {[
              { icon: '🤖', label: 'Physical Robot' },
              { icon: '🛡️', label: 'Safety Bridge' },
              { icon: '🧠', label: 'AI Intelligence' },
              { icon: '💬', label: 'Telegram Control' },
              { icon: '📷', label: 'Camera Vision' },
              { icon: '🔄', label: 'Fleet Ready' },
            ].map((c, i) => (
              <span className="summary-chip" key={i}>
                <span className="chip-icon">{c.icon}</span>
                {c.label}
              </span>
            ))}
          </div>
        </div>

        </>)}

        {/* ═══════════════════════════════════════════════════════ */}
        {/* ═══         ARDUINO STARTER KIT GUIDE               ═══ */}
        {/* ═══════════════════════════════════════════════════════ */}

        {activeGuide === 'arduino' && (<>

        {/* ── A1. Overview ─────────────────────────────────── */}
        <section className="content-section" id="a-overview">
          <div className="content-section-label">Concept</div>
          <h2>How Arduino + OrcBot Work Together</h2>
          <p>Your Arduino doesn't run OrcBot — it's a <strong>hardware bridge</strong>. OrcBot runs on your laptop (or a Raspberry Pi) and sends commands over USB serial to the Arduino. The Arduino receives those commands and controls LEDs, servos, motors, and sensors.</p>

          <div className="arch-diagram">
            <pre>{`  ┌───────────────────────────────────────────────────────┐
  │              YOUR LAPTOP / RASPBERRY PI                │
  │                                                       │
  │  OrcBot Agent                                         │
  │  ├── Telegram / WhatsApp / Discord                    │
  │  ├── Decision Engine (picks actions)                  │
  │  └── Serial Bridge (Python)                           │
  │         │                                             │
  └─────────┼─────────────────────────────────────────────┘
            │  USB Cable (Serial @ 9600 baud)
            ▼
  ┌───────────────────────────────────────────────────────┐
  │                   ARDUINO UNO / NANO                   │
  │                                                       │
  │  Command Parser (loop)                                │
  │  ├── LED control       (digitalWrite)                 │
  │  ├── Servo control     (Servo library)                │
  │  ├── Motor control     (L293D shield or L298N)        │
  │  ├── Sensor reading    (analogRead / digitalRead)     │
  │  └── Response sender   (Serial.println JSON)          │
  │                                                       │
  │  Pins: 5V native — no voltage dividers needed!        │
  └───────────────────────────────────────────────────────┘`}</pre>
          </div>

          <h3>Why Arduino + OrcBot?</h3>
          <div className="safety-layers" style={{ marginTop: 12 }}>
            {[
              { title: 'Cheap', desc: 'Arduino starter kits are $25–60. Most include everything you need to get started.' },
              { title: 'Simple', desc: '5V logic — no voltage dividers. Plug sensors and actuators straight into the pins.' },
              { title: 'Real-Time', desc: 'Arduino handles precise timing for servos and PWM. OrcBot handles the thinking.' },
              { title: 'Portable', desc: 'OrcBot runs on any computer. Connect the Arduino via USB and you\'re ready.' },
            ].map((item, i) => (
              <div className="safety-layer" key={i}>
                <h4 style={{ margin: 0, marginBottom: 4 }}>{item.title}</h4>
                <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>{item.desc}</p>
              </div>
            ))}
          </div>
        </section>

        {/* ── A2. What's in a Kit ──────────────────────────── */}
        <section className="content-section" id="a-kit">
          <div className="content-section-label">Inventory</div>
          <h2>What's in a Typical Starter Kit</h2>
          <p>Most Arduino starter kits (Elegoo, SunFounder, official Arduino) include these components. Check your kit's inventory — you likely have everything listed below.</p>

          <div className="bom-table-wrap">
            <table className="bom-table">
              <thead><tr><th>#</th><th>Component</th><th>Qty</th><th>We'll Use For</th></tr></thead>
              <tbody>
                {[
                  ['1', 'Arduino Uno R3 (or Nano)', '1', 'Main controller board'],
                  ['2', 'USB-A to USB-B cable', '1', 'Power + serial communication'],
                  ['3', 'Breadboard (830 tie-points)', '1', 'Prototyping circuits'],
                  ['4', 'Jumper wires (M-M, M-F)', '~65', 'All connections'],
                  ['5', 'LEDs (red, green, yellow, blue)', '~15', 'Status indicators, smart lighting'],
                  ['6', 'Resistors (220Ω, 1kΩ, 10kΩ)', '~30', 'Current limiting, pull-ups'],
                  ['7', 'Push buttons', '~5', 'Manual triggers, e-stop'],
                  ['8', 'Servo motor (SG90)', '1–2', 'Pan/tilt, arm joints'],
                  ['9', 'HC-SR04 Ultrasonic sensor', '1', 'Distance measurement'],
                  ['10', 'Piezo buzzer', '1', 'Audio feedback, alerts'],
                  ['11', 'Potentiometer (10kΩ)', '1–2', 'Analog input, tuning'],
                  ['12', 'Photoresistor (LDR)', '1–2', 'Light sensing'],
                  ['13', 'RGB LED', '1', 'Multi-color status'],
                  ['14', 'LCD display (16×2, optional)', '1', 'Status display'],
                ].map(r => (
                  <tr key={r[0]}><td>{r[0]}</td><td>{r[1]}</td><td>{r[2]}</td><td>{r[3]}</td></tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="callout callout-info">
            <span className="callout-icon">💡</span>
            <strong>Don't have a kit yet?</strong> The <a href="https://store.arduino.cc/products/arduino-starter-kit-multi-language" target="_blank" rel="noopener noreferrer">Official Arduino Starter Kit</a> (~$80) or the <a href="https://www.elegoo.com/products/elegoo-uno-r3-project-super-starter-kit" target="_blank" rel="noopener noreferrer">Elegoo Super Starter Kit</a> (~$35) both work great.
          </div>
        </section>

        {/* ── A3. Extra Parts ──────────────────────────────── */}
        <section className="content-section" id="a-extras">
          <div className="content-section-label">Inventory</div>
          <h2>Extra Parts You'll Need</h2>
          <p>A few things starter kits don't include that you'll want for OrcBot integration.</p>

          <div className="bom-table-wrap">
            <table className="bom-table">
              <thead><tr><th>Component</th><th>Purpose</th><th>Est. Cost</th></tr></thead>
              <tbody>
                {[
                  ['Computer (laptop/desktop)', 'Runs OrcBot + Python serial bridge', 'You have this'],
                  ['L293D Motor Shield (optional)', 'Drive DC motors for a wheeled robot', '$8–12'],
                  ['DC motors + wheels (optional)', 'For a mobile robot project', '$10–15'],
                  ['9V battery + snap connector', 'Portable Arduino power', '$3–5'],
                ].map((r, i) => (
                  <tr key={i}><td>{r[0]}</td><td>{r[1]}</td><td>{r[2]}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        {/* ── A4. Software Setup ───────────────────────────── */}
        <section className="content-section" id="a-software">
          <div className="content-section-label">Setup</div>
          <h2>Software Setup</h2>

          <h3>1. Arduino IDE</h3>
          <p>Download from <a href="https://www.arduino.cc/en/software" target="_blank" rel="noopener noreferrer">arduino.cc/en/software</a>. Install and connect your board via USB.</p>
          <div className="phase-steps">
            <div className="phase-step"><div className="phase-step-num">1</div><div className="phase-step-content"><h5>Select your board</h5><p>Tools → Board → Arduino Uno (or Nano)</p></div></div>
            <div className="phase-step"><div className="phase-step-num">2</div><div className="phase-step-content"><h5>Select port</h5><p>Tools → Port → the COM port that appears (Windows: COM3+, Mac: /dev/cu.usbmodem*, Linux: /dev/ttyACM0)</p></div></div>
            <div className="phase-step"><div className="phase-step-num">3</div><div className="phase-step-content"><h5>Upload test sketch</h5><p>File → Examples → 01.Basics → Blink. Click Upload. The onboard LED should blink.</p></div></div>
          </div>

          <h3>2. OrcBot on Your Computer</h3>
          <CodeBlock lang="bash">{`# Clone and build OrcBot
git clone https://github.com/fredabila/orcbot.git
cd orcbot
npm install
npm run build

# Create config directory
mkdir -p ~/.orcbot`}</CodeBlock>

          <h3>3. Python Serial Bridge Dependencies</h3>
          <CodeBlock lang="bash">{`# Create a virtual environment
python3 -m venv ~/arduino-bridge-env

# Activate it
# macOS/Linux:
source ~/arduino-bridge-env/bin/activate
# Windows:
# arduino-bridge-env\\Scripts\\activate

# Install dependencies
pip install flask pyserial`}</CodeBlock>
        </section>

        {/* ── A5. Serial Bridge Pattern ────────────────────── */}
        <section className="content-section" id="a-serial">
          <div className="content-section-label">Architecture</div>
          <h2>The Serial Bridge Pattern</h2>
          <p>The key insight: <strong>OrcBot speaks HTTP, Arduino speaks Serial</strong>. We need a Python bridge that translates between them.</p>

          <div className="arch-diagram">
            <pre>{`┌──────────┐     HTTP      ┌──────────────┐    Serial     ┌──────────┐
│  OrcBot  │──────────────►│ Python Flask │──────────────►│ Arduino  │
│  Agent   │◄──────────────│   Bridge     │◄──────────────│ Uno/Nano │
└──────────┘  JSON resp.   └──────────────┘  JSON lines   └──────────┘
                             port 5050          9600 baud`}</pre>
          </div>

          <h3>Communication Protocol</h3>
          <p>We use a simple <strong>line-based JSON protocol</strong> over serial:</p>
          <div className="bom-table-wrap">
            <table className="bom-table">
              <thead><tr><th>Direction</th><th>Format</th><th>Example</th></tr></thead>
              <tbody>
                <tr><td>Computer → Arduino</td><td><code>{'{"cmd":"...", "args":{...}}'}</code></td><td><code>{'{"cmd":"led","args":{"pin":13,"state":1}}'}</code></td></tr>
                <tr><td>Arduino → Computer</td><td><code>{'{"ok":true, "data":{...}}'}</code></td><td><code>{'{"ok":true,"data":{"distance_cm":24.5}}'}</code></td></tr>
              </tbody>
            </table>
          </div>

          <div className="callout callout-info">
            <span className="callout-icon">💡</span>
            <strong>Why JSON?</strong> It's human-readable, easy to parse on both ends, and lets us add new commands without changing the protocol.
          </div>
        </section>

        {/* ── A6. Arduino Sketch ────────────────────────────── */}
        <section className="content-section" id="a-sketch">
          <div className="content-section-label">Arduino Code</div>
          <h2>Arduino Sketch — Command Receiver</h2>
          <p>Upload this to your Arduino. It listens for JSON commands on serial and executes them.</p>

          <CodeBlock lang="cpp">{`/*
 * OrcBot Arduino Command Receiver
 * Listens for JSON commands on Serial, controls hardware.
 * Upload via Arduino IDE.
 */

#include <Servo.h>
#include <ArduinoJson.h>  // Install: Sketch → Library Manager → "ArduinoJson"

// ── Pin assignments ──
const int LED_PINS[]     = {2, 3, 4, 5, 6, 7};
const int NUM_LEDS       = 6;
const int BUZZER_PIN     = 8;
const int SERVO_PIN      = 9;
const int TRIG_PIN       = 10;
const int ECHO_PIN       = 11;
const int BUTTON_PIN     = 12;
const int ONBOARD_LED    = 13;

Servo myServo;
bool servoAttached = false;

void setup() {
  Serial.begin(9600);
  while (!Serial) { ; }  // Wait for serial (Leonardo/Micro)

  // Configure pins
  for (int i = 0; i < NUM_LEDS; i++) {
    pinMode(LED_PINS[i], OUTPUT);
    digitalWrite(LED_PINS[i], LOW);
  }
  pinMode(ONBOARD_LED, OUTPUT);
  pinMode(BUZZER_PIN, OUTPUT);
  pinMode(TRIG_PIN, OUTPUT);
  pinMode(ECHO_PIN, INPUT);
  pinMode(BUTTON_PIN, INPUT_PULLUP);

  // Ready signal
  digitalWrite(ONBOARD_LED, HIGH);
  Serial.println("{\\"ok\\":true,\\"data\\":{\\"msg\\":\\"OrcBot Arduino ready\\"}}");
}

void loop() {
  if (Serial.available()) {
    String line = Serial.readStringUntil('\\n');
    line.trim();
    if (line.length() == 0) return;

    StaticJsonDocument<256> doc;
    DeserializationError err = deserializeJson(doc, line);
    if (err) {
      Serial.println("{\\"ok\\":false,\\"error\\":\\"JSON parse error\\"}");
      return;
    }

    const char* cmd = doc["cmd"];
    JsonObject args = doc["args"];

    if (strcmp(cmd, "led") == 0) {
      cmdLed(args);
    } else if (strcmp(cmd, "led_all") == 0) {
      cmdLedAll(args);
    } else if (strcmp(cmd, "servo") == 0) {
      cmdServo(args);
    } else if (strcmp(cmd, "buzz") == 0) {
      cmdBuzz(args);
    } else if (strcmp(cmd, "distance") == 0) {
      cmdDistance();
    } else if (strcmp(cmd, "button") == 0) {
      cmdButton();
    } else if (strcmp(cmd, "status") == 0) {
      cmdStatus();
    } else if (strcmp(cmd, "ping") == 0) {
      Serial.println("{\\"ok\\":true,\\"data\\":{\\"msg\\":\\"pong\\"}}");
    } else {
      Serial.println("{\\"ok\\":false,\\"error\\":\\"unknown command\\"}");
    }
  }
}

void cmdLed(JsonObject& args) {
  int pin = args["pin"] | 13;
  int state = args["state"] | 0;
  // Validate pin is in LED_PINS or ONBOARD_LED
  bool valid = (pin == ONBOARD_LED);
  for (int i = 0; i < NUM_LEDS; i++) {
    if (LED_PINS[i] == pin) valid = true;
  }
  if (!valid) {
    Serial.println("{\\"ok\\":false,\\"error\\":\\"invalid LED pin\\"}");
    return;
  }
  digitalWrite(pin, state ? HIGH : LOW);
  Serial.print("{\\"ok\\":true,\\"data\\":{\\"pin\\":");
  Serial.print(pin);
  Serial.print(",\\"state\\":");
  Serial.print(state);
  Serial.println("}}");
}

void cmdLedAll(JsonObject& args) {
  int state = args["state"] | 0;
  for (int i = 0; i < NUM_LEDS; i++) {
    digitalWrite(LED_PINS[i], state ? HIGH : LOW);
  }
  Serial.print("{\\"ok\\":true,\\"data\\":{\\"leds\\":");
  Serial.print(NUM_LEDS);
  Serial.print(",\\"state\\":");
  Serial.print(state);
  Serial.println("}}");
}

void cmdServo(JsonObject& args) {
  int angle = args["angle"] | 90;
  angle = constrain(angle, 0, 180);
  if (!servoAttached) { myServo.attach(SERVO_PIN); servoAttached = true; }
  myServo.write(angle);
  Serial.print("{\\"ok\\":true,\\"data\\":{\\"angle\\":");
  Serial.print(angle);
  Serial.println("}}");
}

void cmdBuzz(JsonObject& args) {
  int freq = args["freq"] | 1000;
  int dur  = args["duration"] | 200;
  dur = constrain(dur, 50, 3000);
  tone(BUZZER_PIN, freq, dur);
  Serial.print("{\\"ok\\":true,\\"data\\":{\\"freq\\":");
  Serial.print(freq);
  Serial.print(",\\"duration\\":");
  Serial.print(dur);
  Serial.println("}}");
}

void cmdDistance() {
  digitalWrite(TRIG_PIN, LOW);
  delayMicroseconds(2);
  digitalWrite(TRIG_PIN, HIGH);
  delayMicroseconds(10);
  digitalWrite(TRIG_PIN, LOW);
  long dur = pulseIn(ECHO_PIN, HIGH, 30000);  // 30ms timeout
  if (dur == 0) {
    Serial.println("{\\"ok\\":false,\\"error\\":\\"sensor timeout\\"}");
    return;
  }
  float cm = dur * 0.034 / 2.0;
  Serial.print("{\\"ok\\":true,\\"data\\":{\\"distance_cm\\":");
  Serial.print(cm, 1);
  Serial.println("}}");
}

void cmdButton() {
  int state = digitalRead(BUTTON_PIN);
  Serial.print("{\\"ok\\":true,\\"data\\":{\\"pressed\\":");
  Serial.print(state == LOW ? "true" : "false");
  Serial.println("}}");
}

void cmdStatus() {
  Serial.print("{\\"ok\\":true,\\"data\\":{\\"uptime_ms\\":");
  Serial.print(millis());
  Serial.print(",\\"free_ram\\":");
  extern int __heap_start, *__brkval;
  int v;
  Serial.print((int)&v - (__brkval == 0 ? (int)&__heap_start : (int)__brkval));
  Serial.println("}}");
}`}</CodeBlock>

          <div className="callout callout-warning">
            <span className="callout-icon">⚠️</span>
            <strong>Install ArduinoJson first!</strong> In Arduino IDE: Sketch → Include Library → Manage Libraries → search "ArduinoJson" by Benoit Blanchon → Install.
          </div>
        </section>

        {/* ── A7. Python Serial Bridge ─────────────────────── */}
        <section className="content-section" id="a-bridge">
          <div className="content-section-label">Bridge Code</div>
          <h2>Python Serial Bridge for OrcBot</h2>
          <p>This Flask app translates OrcBot's HTTP skill calls into serial commands for the Arduino.</p>

          <CodeBlock lang="python">{`#!/usr/bin/env python3
"""
OrcBot Arduino Serial Bridge
Translates HTTP requests to Serial commands for Arduino.
"""

from flask import Flask, request, jsonify
import serial
import json
import time
import threading
import logging
import sys
import glob

app = Flask(__name__)
log = logging.getLogger('arduino-bridge')
logging.basicConfig(level=logging.INFO,
    format='%(asctime)s [%(levelname)s] %(message)s')

# ── Auto-detect Arduino port ──
def find_arduino():
    """Try common serial port patterns."""
    patterns = [
        '/dev/ttyACM*', '/dev/ttyUSB*',       # Linux
        '/dev/cu.usbmodem*', '/dev/cu.usbserial*',  # macOS
    ]
    for pattern in patterns:
        ports = glob.glob(pattern)
        if ports:
            return ports[0]
    # Windows: try COM3-COM10
    for i in range(3, 11):
        try:
            s = serial.Serial(f'COM{i}', timeout=0.1)
            s.close()
            return f'COM{i}'
        except serial.SerialException:
            continue
    return None

PORT = sys.argv[1] if len(sys.argv) > 1 else find_arduino()
BAUD = 9600

if not PORT:
    log.error("No Arduino found! Plug in USB and retry.")
    log.error("Or specify port: python arduino_bridge.py /dev/ttyACM0")
    sys.exit(1)

# ── Serial connection ──
ser = serial.Serial(PORT, BAUD, timeout=2)
time.sleep(2)  # Arduino resets on serial connect — wait for boot
lock = threading.Lock()

# Read the "ready" message
startup = ser.readline().decode().strip()
log.info(f"Arduino says: {startup}")

def send_command(cmd: str, args: dict = None) -> dict:
    """Send a JSON command to Arduino and return the response."""
    msg = json.dumps({"cmd": cmd, "args": args or {}})
    with lock:
        ser.reset_input_buffer()
        ser.write((msg + "\\n").encode())
        ser.flush()
        # Wait for response (with timeout)
        line = ser.readline().decode().strip()
    if not line:
        return {"ok": False, "error": "No response (timeout)"}
    try:
        return json.loads(line)
    except json.JSONDecodeError:
        return {"ok": False, "error": f"Bad response: {line}"}

# ── HTTP Endpoints ──
@app.route('/health')
def health():
    resp = send_command('ping')
    return jsonify(status='ok', arduino=resp.get('ok', False), port=PORT)

@app.route('/status')
def status():
    return jsonify(**send_command('status'))

@app.route('/led', methods=['POST'])
def led():
    d = request.json or {}
    return jsonify(**send_command('led', {
        'pin': int(d.get('pin', 13)),
        'state': int(d.get('state', 1))
    }))

@app.route('/led/all', methods=['POST'])
def led_all():
    d = request.json or {}
    return jsonify(**send_command('led_all', {
        'state': int(d.get('state', 1))
    }))

@app.route('/servo', methods=['POST'])
def servo():
    d = request.json or {}
    return jsonify(**send_command('servo', {
        'angle': int(d.get('angle', 90))
    }))

@app.route('/buzz', methods=['POST'])
def buzz():
    d = request.json or {}
    return jsonify(**send_command('buzz', {
        'freq': int(d.get('freq', 1000)),
        'duration': int(d.get('duration', 200))
    }))

@app.route('/distance')
def distance():
    return jsonify(**send_command('distance'))

@app.route('/button')
def button():
    return jsonify(**send_command('button'))

if __name__ == '__main__':
    log.info(f"Arduino Bridge on :5050 — serial port {PORT}")
    app.run(host='0.0.0.0', port=5050, debug=False)`}</CodeBlock>

          <h3>Test the Bridge</h3>
          <CodeBlock lang="bash">{`# Start the bridge (auto-detects Arduino port)
source ~/arduino-bridge-env/bin/activate
python arduino_bridge.py

# In another terminal, test:
curl http://localhost:5050/health
curl http://localhost:5050/status
curl -X POST http://localhost:5050/led -H "Content-Type: application/json" -d '{"pin":13,"state":1}'
curl http://localhost:5050/distance
curl -X POST http://localhost:5050/servo -H "Content-Type: application/json" -d '{"angle":45}'
curl -X POST http://localhost:5050/buzz -H "Content-Type: application/json" -d '{"freq":440,"duration":500}'`}</CodeBlock>
        </section>

        {/* ── A8. OrcBot Skills ────────────────────────────── */}
        <section className="content-section" id="a-skills">
          <div className="content-section-label">Integration</div>
          <h2>OrcBot Skills for Arduino</h2>
          <p>Save as <code>~/.orcbot/plugins/skills/arduino-control/index.js</code></p>

          <CodeBlock lang="javascript">{`/**
 * OrcBot Arduino Control Skills
 * Connects to the Arduino Serial Bridge API.
 */
const BRIDGE = process.env.ROBOT_BRIDGE_URL || 'http://localhost:5050';

async function call(path, method = 'GET', body = null) {
  const opts = { method, headers: { 'Content-Type': 'application/json' } };
  if (body) opts.body = JSON.stringify(body);
  try {
    const res = await fetch(\`\${BRIDGE}\${path}\`, opts);
    return await res.json();
  } catch (e) {
    return { ok: false, error: \`Bridge unreachable: \${e.message}\` };
  }
}

module.exports = [
  {
    name: 'arduino_led',
    description: 'Turn an LED on or off. Pin 13 = onboard LED, pins 2-7 = breadboard LEDs.',
    usage: 'arduino_led(pin, state)  — state: 1=on, 0=off',
    handler: async (args) => call('/led', 'POST', {
      pin: parseInt(args.pin || '13'),
      state: parseInt(args.state || '1')
    })
  },
  {
    name: 'arduino_led_all',
    description: 'Turn all breadboard LEDs on or off at once.',
    usage: 'arduino_led_all(state)  — state: 1=on, 0=off',
    handler: async (args) => call('/led/all', 'POST', {
      state: parseInt(args.state || '1')
    })
  },
  {
    name: 'arduino_servo',
    description: 'Move servo to angle (0–180 degrees).',
    usage: 'arduino_servo(angle)',
    handler: async (args) => call('/servo', 'POST', {
      angle: parseInt(args.angle || '90')
    })
  },
  {
    name: 'arduino_buzz',
    description: 'Play a tone on the piezo buzzer.',
    usage: 'arduino_buzz(freq?, duration?)  — freq in Hz, duration in ms',
    handler: async (args) => call('/buzz', 'POST', {
      freq: parseInt(args.freq || '1000'),
      duration: parseInt(args.duration || '200')
    })
  },
  {
    name: 'arduino_distance',
    description: 'Measure distance using the HC-SR04 ultrasonic sensor.',
    usage: 'arduino_distance()',
    handler: async () => call('/distance')
  },
  {
    name: 'arduino_button',
    description: 'Check if the push button is pressed.',
    usage: 'arduino_button()',
    handler: async () => call('/button')
  },
  {
    name: 'arduino_status',
    description: 'Get Arduino status: uptime and free memory.',
    usage: 'arduino_status()',
    handler: async () => call('/status')
  }
];`}</CodeBlock>
        </section>

        {/* ── A9. Project 1 — Smart LED ────────────────────── */}
        <section className="content-section" id="a-led">
          <div className="content-section-label">Project 1</div>
          <h2>Smart LED Controller</h2>
          <p>Your first AI-controlled hardware project. Wire up 6 LEDs on a breadboard and let OrcBot control them via Telegram.</p>

          <h3>Wiring</h3>
          <div className="wiring-table-wrap">
            <table className="wiring-table">
              <thead><tr><th>Component</th><th>Arduino Pin</th><th>Notes</th></tr></thead>
              <tbody>
                {[
                  ['LED 1 (red)', 'Pin 2 → 220Ω → LED → GND', ''],
                  ['LED 2 (red)', 'Pin 3 → 220Ω → LED → GND', ''],
                  ['LED 3 (yellow)', 'Pin 4 → 220Ω → LED → GND', ''],
                  ['LED 4 (yellow)', 'Pin 5 → 220Ω → LED → GND', ''],
                  ['LED 5 (green)', 'Pin 6 → 220Ω → LED → GND', ''],
                  ['LED 6 (green)', 'Pin 7 → 220Ω → LED → GND', ''],
                ].map((r, i) => (
                  <tr key={i}><td>{r[0]}</td><td>{r[1]}</td><td>{r[2]}</td></tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="arch-diagram">
            <pre>{`Arduino Pin 2 ──── 220Ω ──── LED(+) ──── GND
Arduino Pin 3 ──── 220Ω ──── LED(+) ──── GND
  ...                                (repeat for pins 4–7)

Long leg (+) = anode (from resistor)
Short leg (−) = cathode (to GND rail)`}</pre>
          </div>

          <h3>Try It</h3>
          <CodeBlock lang="bash">{`# Start OrcBot with bridge running
ROBOT_BRIDGE_URL=http://localhost:5050 npm run dev

# Via Telegram:
# "Turn on all the LEDs"
# "Turn off LED on pin 4"
# "Flash the red LEDs 3 times"
# "Create a light sequence: turn on each LED one by one, then all off"`}</CodeBlock>
        </section>

        {/* ── A10. Project 2 — Ultrasonic Sentry ──────────── */}
        <section className="content-section" id="a-sentry">
          <div className="content-section-label">Project 2</div>
          <h2>Ultrasonic Sentry</h2>
          <p>Build a distance-monitoring sentry. When something gets too close, the buzzer sounds and OrcBot sends you a Telegram alert.</p>

          <h3>Wiring</h3>
          <div className="wiring-table-wrap">
            <table className="wiring-table">
              <thead><tr><th>HC-SR04 Pin</th><th>Arduino Pin</th><th>Notes</th></tr></thead>
              <tbody>
                <tr><td>VCC</td><td>5V</td><td>Arduino supplies 5V natively — no divider!</td></tr>
                <tr><td>GND</td><td>GND</td><td></td></tr>
                <tr><td>TRIG</td><td>Pin 10</td><td></td></tr>
                <tr><td>ECHO</td><td>Pin 11</td><td>5V safe — Arduino is 5V logic</td></tr>
              </tbody>
            </table>
          </div>

          <div className="callout callout-success">
            <span className="callout-icon">✅</span>
            <strong>No voltage divider needed!</strong> Unlike the Raspberry Pi (3.3V logic), the Arduino Uno runs at 5V. The HC-SR04's ECHO output connects directly.
          </div>

          <h3>Try It</h3>
          <CodeBlock lang="bash">{`# Via Telegram:
# "Check the distance sensor"
# "Monitor the area — alert me if anything comes within 20cm"
# "Sound the buzzer for 1 second"
# "Every 5 seconds, check the distance and report back"`}</CodeBlock>
        </section>

        {/* ── A11. Project 3 — Servo Arm ──────────────────── */}
        <section className="content-section" id="a-servo">
          <div className="content-section-label">Project 3</div>
          <h2>Servo Arm</h2>
          <p>Mount the SG90 servo on top of your breadboard. OrcBot can point it at different angles — great for a camera pan, a pointer, or a mini robotic arm.</p>

          <h3>Wiring</h3>
          <div className="wiring-table-wrap">
            <table className="wiring-table">
              <thead><tr><th>Servo Wire</th><th>Arduino Pin</th><th>Color</th></tr></thead>
              <tbody>
                <tr><td>Signal</td><td>Pin 9</td><td>Orange or Yellow</td></tr>
                <tr><td>VCC</td><td>5V</td><td>Red</td></tr>
                <tr><td>GND</td><td>GND</td><td>Brown or Black</td></tr>
              </tbody>
            </table>
          </div>

          <div className="callout callout-warning">
            <span className="callout-icon">⚠️</span>
            <strong>Power note:</strong> A single SG90 is fine on USB power. If you add more servos, use an external 5V supply — USB can't deliver enough current for multiple servos.
          </div>

          <h3>Try It</h3>
          <CodeBlock lang="bash">{`# Via Telegram:
# "Point the servo to 0 degrees"
# "Sweep: 0 → 90 → 180 → 90 → 0"
# "When something comes within 30cm, point the servo at it and buzz"
# "Scan left to right slowly, check distance at each position"`}</CodeBlock>

          <h3>Combine All Three!</h3>
          <div className="callout callout-success">
            <span className="callout-icon">🧩</span>
            <strong>Multi-project challenge:</strong> Tell OrcBot: <em>"Set up a security system — sweep the servo, check distance at each position. If anything is closer than 25cm, sound the buzzer and flash all LEDs. Report the distance reading to me."</em>
          </div>
        </section>

        {/* ── A12. Safety ──────────────────────────────────── */}
        <section className="content-section" id="a-safety">
          <div className="content-section-label">Safety</div>
          <h2>Safety &amp; Best Practices</h2>

          <div className="safety-layers">
            {[
              {
                num: 'Rule 1', title: 'Current Limits', items: [
                  'Always use 220Ω resistors with LEDs — direct connection burns them out',
                  'Arduino pins output max 40mA — don\'t drive motors directly from GPIO',
                  'Use a motor shield (L293D) or transistor for anything that draws real current',
                ]
              },
              {
                num: 'Rule 2', title: 'Serial Safety', items: [
                  'The Arduino sketch validates every command — unknown commands are rejected',
                  'The Python bridge adds a thread lock — no concurrent serial writes',
                  'Servo angles are constrained to 0–180°; buzz duration capped at 3 seconds',
                ]
              },
              {
                num: 'Rule 3', title: 'Power Management', items: [
                  'USB power is fine for LEDs + 1 servo + sensor',
                  'For DC motors: use external power supply through a motor shield',
                  'Never connect 9V batteries directly to Arduino inputs — only to the barrel jack',
                ]
              },
              {
                num: 'Rule 4', title: 'Testing Order', items: [
                  '✅ Upload sketch, test via Serial Monitor in Arduino IDE first',
                  '✅ Start Python bridge, test with curl',
                  '✅ Then connect OrcBot and test via Telegram',
                  '✅ Add complexity one component at a time',
                ]
              },
            ].map((layer, i) => (
              <div className="safety-layer" key={i}>
                <div className="safety-layer-num">{layer.num}</div>
                <h4>{layer.title}</h4>
                <ul>{layer.items.map((it, j) => <li key={j}>{it}</li>)}</ul>
              </div>
            ))}
          </div>
        </section>

        {/* ── A13. Troubleshooting ─────────────────────────── */}
        <section className="content-section" id="a-troubleshoot">
          <div className="content-section-label">Reference</div>
          <h2>Troubleshooting</h2>

          <div className="trouble-table-wrap">
            <table className="trouble-table">
              <thead><tr><th>Problem</th><th>Cause</th><th>Fix</th></tr></thead>
              <tbody>
                {[
                  ['Port not found', 'Arduino not plugged in / drivers', 'Check USB cable, install CH340 drivers (clone boards)'],
                  ['"No response" from bridge', 'Arduino reset on serial connect', 'Bridge waits 2s on startup — if still failing, increase delay'],
                  ['JSON parse error on Arduino', 'Message too long / corrupted', 'Keep command JSON under 200 chars; check baud rate is 9600'],
                  ['LED doesn\'t light', 'Wrong polarity / missing resistor', 'Long leg = +. Check 220Ω resistor is in series.'],
                  ['Servo jitters', 'Insufficient power / noise', 'Add 100µF capacitor across servo VCC/GND; use external 5V'],
                  ['Sensor reads 0', 'Wires swapped / too close', 'Swap TRIG/ECHO; min range is ~2cm'],
                  ['OrcBot can\'t reach bridge', 'Bridge not running / wrong URL', 'Verify with curl http://localhost:5050/health'],
                  ['Multiple Arduinos', 'Wrong COM port', 'Specify port: python arduino_bridge.py COM5'],
                ].map((r, i) => (
                  <tr key={i}><td>{r[0]}</td><td>{r[1]}</td><td>{r[2]}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        {/* ── A14. Next Steps ──────────────────────────────── */}
        <section className="content-section" id="a-next">
          <div className="content-section-label">What's Next</div>
          <h2>Next Steps</h2>
          <p>You've connected OrcBot to physical hardware with an Arduino. Here's where to go next:</p>

          <div className="resources-grid">
            {[
              { title: 'Add a Motor Shield', desc: 'Get an L293D shield and build a wheeled robot that OrcBot can drive around.' },
              { title: 'LCD Status Display', desc: 'Show the current OrcBot command and sensor readings on a 16×2 LCD.' },
              { title: 'Wireless with ESP32', desc: 'Replace USB serial with WiFi — run the bridge over the network using an ESP32.' },
              { title: 'Full Pi Robot Build', desc: 'Ready for the next level? Switch to the Raspberry Pi Robot guide for GPIO, camera vision, and ROS2.' },
            ].map((r, i) => (
              <div className="resource-card" key={i}>
                <h5>{r.title}</h5>
                <p>{r.desc}</p>
              </div>
            ))}
          </div>
        </section>

        {/* ── Arduino Summary Banner ────────────────────────── */}
        <div className="summary-banner">
          <h2>You connected OrcBot to real hardware.</h2>
          <p>With an Arduino starter kit and a few lines of code, you've built AI-controlled physical devices. Here's what you now have:</p>
          <div className="summary-chips">
            {[
              { icon: '⚡', label: 'Arduino Bridge' },
              { icon: '💡', label: 'Smart LEDs' },
              { icon: '📡', label: 'Distance Sensor' },
              { icon: '🔧', label: 'Servo Control' },
              { icon: '🔊', label: 'Audio Feedback' },
              { icon: '💬', label: 'Telegram Control' },
            ].map((c, i) => (
              <span className="summary-chip" key={i}>
                <span className="chip-icon">{c.icon}</span>
                {c.label}
              </span>
            ))}
          </div>
        </div>

        </>)}

        {/* ═══════════════════════════════════════════════════════ */}
        {/* ═══      HUMANOID ROBOTIC COMPANION GUIDE           ═══ */}
        {/* ═══════════════════════════════════════════════════════ */}

        {activeGuide === 'humanoid' && (<>

        {/* ── H1. Vision & Architecture ────────────────────── */}
        <section className="content-section" id="h-overview">
          <div className="content-section-label">Concept</div>
          <h2>Vision &amp; Architecture</h2>
          <p>This project builds a <strong>full-body humanoid robot</strong> — a bipedal companion with articulated arms, hands, a head with vision and hearing, and a voice. OrcBot serves as the cognitive brain: it perceives, reasons, plans, and acts through the robot's body.</p>

          <div className="arch-diagram">
            <pre>{`  ┌───────────────────────────────────────────────────────────┐
  │                    HUMAN OPERATOR                         │
  │           Telegram / WhatsApp / Discord / Voice           │
  └────────────────────────────┬──────────────────────────────┘
                               │
  ┌────────────────────────────▼──────────────────────────────┐
  │                    ORCBOT BRAIN (SBC)                      │
  │                                                           │
  │  ┌────────────┐  ┌────────────┐  ┌──────────────────────┐│
  │  │  Decision   │  │  Memory    │  │  Multimodal I/O      ││
  │  │  Engine     │  │  System    │  │  • Speech-to-Text    ││
  │  │  • Planner  │  │  • Short   │  │  • Text-to-Speech    ││
  │  │  • Guard    │  │  • Episodic│  │  • Vision (YOLO/CV)  ││
  │  │    Rails    │  │  • Long    │  │  • Sign Language     ││
  │  └──────┬─────┘  └────────────┘  └──────────────────────┘│
  │         │                                                 │
  └─────────┼─────────────────────────────────────────────────┘
            │  REST / Serial / ROS2
  ┌─────────▼─────────────────────────────────────────────────┐
  │                  MOTION CONTROLLER                         │
  │                                                           │
  │  ┌──────────┐  ┌──────────┐  ┌────────────┐  ┌────────┐ │
  │  │ Servo Bus │  │ IMU /    │  │ Inverse    │  │ Gait   │ │
  │  │ (PCA9685  │  │ Gyro     │  │ Kinematics │  │ Engine │ │
  │  │  or TTL)  │  │ (MPU6050)│  │            │  │        │ │
  │  └──────────┘  └──────────┘  └────────────┘  └────────┘ │
  └─────────┬─────────────────────────────────────────────────┘
            │
  ┌─────────▼─────────────────────────────────────────────────┐
  │                  PHYSICAL HUMANOID                         │
  │                                                           │
  │  Head: Camera, Mic, Speaker, OLED face                    │
  │  Torso: SBC, IMU, Battery, Power distribution             │
  │  Arms: 3 DOF each (shoulder pitch/roll, elbow)            │
  │  Hands: 5-finger gripper or 2-finger per hand             │
  │  Legs: 6 DOF each (hip pitch/roll/yaw, knee, ankle ×2)   │
  │  Feet: Force sensors, rubber soles                        │
  └───────────────────────────────────────────────────────────┘`}</pre>
          </div>

          <h3>How It All Connects</h3>
          <div className="safety-layers" style={{ marginTop: 12 }}>
            {[
              { title: 'Cognition', desc: 'OrcBot receives goals (voice, text, vision), plans multi-step actions, and sends commands to the motion controller. It remembers what it sees and what it\'s done.' },
              { title: 'Perception', desc: 'Camera for object/face recognition, microphone for speech understanding, touch/force sensors for grip feedback. All feed back into OrcBot\'s decision loop.' },
              { title: 'Expression', desc: 'Text-to-speech for spoken responses, servo-driven hands for sign language, OLED or LED face for emotion display. The robot communicates naturally.' },
              { title: 'Movement', desc: 'Servo bus controls 22+ degrees of freedom. An IMU provides balance feedback. Inverse kinematics translates "reach for the cup" into joint angles.' },
            ].map((item, i) => (
              <div className="safety-layer" key={i}>
                <h4 style={{ margin: 0, marginBottom: 4 }}>{item.title}</h4>
                <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>{item.desc}</p>
              </div>
            ))}
          </div>
        </section>

        {/* ── H2. Platform ─────────────────────────────────── */}
        <section className="content-section" id="h-platform">
          <div className="content-section-label">Decision</div>
          <h2>Choosing a Humanoid Platform</h2>
          <p>You can build from scratch or start with a kit. Here are the major options ranked by difficulty and cost.</p>

          <div className="bom-table-wrap">
            <table className="bom-table">
              <thead><tr><th>Platform</th><th>DOF</th><th>Cost</th><th>Difficulty</th><th>Best For</th></tr></thead>
              <tbody>
                {[
                  ['3D-Printed (InMoov)', '22–30+', '$500–1,200', '★★★★★', 'Full customization, large scale (~1m tall)'],
                  ['Robotis OP3 / Mini', '20', '$1,500–12,000', '★★★', 'Research-grade, ROS2-native, walk-ready'],
                  ['LewanSoul / Hiwonder', '17–19', '$200–600', '★★', 'Pre-built frame, TTL servos, fast start'],
                  ['SG90 Servo DIY Frame', '12–18', '$80–250', '★★★★', 'Cheapest, educational, no walking'],
                  ['Unitree H1 / G1', '23–43', '$16,000+', '★★', 'Production-grade, advanced locomotion'],
                ].map((r, i) => (
                  <tr key={i}><td>{r[0]}</td><td>{r[1]}</td><td>{r[2]}</td><td>{r[3]}</td><td>{r[4]}</td></tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="callout callout-info">
            <span className="callout-icon">💡</span>
            <strong>Recommended starting point:</strong> The <a href="https://inmoov.fr/" target="_blank" rel="noopener noreferrer">InMoov project</a> (3D-printed, open-source) or a <strong>Hiwonder humanoid kit</strong> with serial bus servos. This guide uses a generic 17–22 DOF humanoid as the reference design. All code works with any servo-based platform.
          </div>

          <h3>Degrees of Freedom Map</h3>
          <div className="arch-diagram">
            <pre>{`                    ┌─────┐
                    │ Head │  2 DOF (pan + tilt)
                    └──┬──┘
                       │
              ┌────────┼────────┐
              │     ┌──┴──┐     │
         Left │     │Torso│     │ Right
         Arm  │     │(IMU)│     │ Arm
         3DOF │     └──┬──┘     │ 3DOF
              │        │        │
              │   Left │ Right  │
              │   Leg  │ Leg    │
              │   6DOF │ 6DOF   │
              │        │        │
              └────────┴────────┘

Total: 2 (head) + 6 (arms) + 12 (legs) = 20 DOF minimum
+ Hands: 2–10 DOF depending on gripper design
= 22–30 DOF typical humanoid`}</pre>
          </div>
        </section>

        {/* ── H3. BOM ──────────────────────────────────────── */}
        <section className="content-section" id="h-bom">
          <div className="content-section-label">Inventory</div>
          <h2>Bill of Materials</h2>

          <h3>Compute &amp; Control</h3>
          <div className="bom-table-wrap">
            <table className="bom-table">
              <thead><tr><th>#</th><th>Component</th><th>Purpose</th><th>Est. Cost</th></tr></thead>
              <tbody>
                {[
                  ['1', 'Raspberry Pi 5 (8 GB) or Jetson Nano', 'Main brain — runs OrcBot + vision', '$80–150'],
                  ['2', 'PCA9685 Servo Driver (×2) or Serial Bus Board', 'Controls 16+ servos per board', '$10–30'],
                  ['3', 'MPU6050 / BNO055 IMU', 'Balance and orientation sensing', '$5–30'],
                  ['4', 'Arduino Mega (optional)', 'Real-time servo coordination sub-controller', '$15–25'],
                  ['5', 'MicroSD Card (64 GB+, A2)', 'OS + OrcBot + models', '$12–18'],
                  ['6', 'USB-C Power Supply (5V 5A)', 'Desk power for brain', '$15'],
                ].map(r => (
                  <tr key={r[0]}><td>{r[0]}</td><td>{r[1]}</td><td>{r[2]}</td><td>{r[3]}</td></tr>
                ))}
              </tbody>
            </table>
          </div>

          <h3>Actuators</h3>
          <div className="bom-table-wrap">
            <table className="bom-table">
              <thead><tr><th>#</th><th>Component</th><th>Qty</th><th>Purpose</th><th>Est. Cost</th></tr></thead>
              <tbody>
                {[
                  ['7', 'High-torque servos (MG996R / DS3218)', '12–16', 'Legs, shoulders, hips (20kg·cm+)', '$60–160'],
                  ['8', 'Micro servos (SG90 / MG90S)', '6–10', 'Head, wrists, fingers', '$12–30'],
                  ['9', 'Serial bus servos (LX-16A / STS3215)', '17–22', 'Alternative: daisy-chain, feedback', '$150–400'],
                ].map(r => (
                  <tr key={r[0]}><td>{r[0]}</td><td>{r[1]}</td><td>{r[2]}</td><td>{r[3]}</td><td>{r[4]}</td></tr>
                ))}
              </tbody>
            </table>
          </div>

          <h3>Perception &amp; Expression</h3>
          <div className="bom-table-wrap">
            <table className="bom-table">
              <thead><tr><th>#</th><th>Component</th><th>Purpose</th><th>Est. Cost</th></tr></thead>
              <tbody>
                {[
                  ['10', 'USB Camera (wide-angle) or Pi Camera', 'Object/face/gesture recognition', '$15–40'],
                  ['11', 'USB Microphone (ReSpeaker or similar)', 'Speech recognition, voice commands', '$10–30'],
                  ['12', 'Speaker (3W, amplified)', 'Text-to-speech voice output', '$5–15'],
                  ['13', 'OLED Display 1.3" (SH1106) for face', 'Emotion display (eyes, expressions)', '$8–12'],
                  ['14', 'LED Ring (NeoPixel, optional)', 'Status indicators, mood lighting', '$5–10'],
                ].map(r => (
                  <tr key={r[0]}><td>{r[0]}</td><td>{r[1]}</td><td>{r[2]}</td><td>{r[3]}</td></tr>
                ))}
              </tbody>
            </table>
          </div>

          <h3>Structure &amp; Power</h3>
          <div className="bom-table-wrap">
            <table className="bom-table">
              <thead><tr><th>#</th><th>Component</th><th>Purpose</th><th>Est. Cost</th></tr></thead>
              <tbody>
                {[
                  ['15', '3D-printed frame or aluminum bracket kit', 'Skeleton / structure', '$50–300'],
                  ['16', 'LiPo Battery (11.1V 2200mAh) + BMS', 'Portable power for servos', '$25–50'],
                  ['17', 'Buck converter (5V 5A) for SBC', 'Regulated power from LiPo', '$5–10'],
                  ['18', 'Power distribution board', 'Clean power to all subsystems', '$5–15'],
                  ['19', 'Force-sensitive resistors (×2, feet)', 'Ground contact / balance feedback', '$5–10'],
                  ['20', 'Wiring, connectors, standoffs, screws', 'Assembly hardware', '$15–25'],
                ].map(r => (
                  <tr key={r[0]}><td>{r[0]}</td><td>{r[1]}</td><td>{r[2]}</td><td>{r[3]}</td></tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="bom-total">💰 Estimated total range: $800–2,500 (varies by platform and servo choice)</div>
        </section>

        {/* ── H4. Assembly ─────────────────────────────────── */}
        <section className="content-section" id="h-assembly">
          <div className="content-section-label">Build</div>
          <h2>Mechanical Assembly</h2>
          <p>Build from the legs up. Each limb is assembled, tested, then attached to the torso.</p>

          <h3>Assembly Order</h3>
          <div className="phase-steps">
            {[
              { title: '1. Build the feet & ankles', desc: 'Each foot has 2 DOF (pitch + roll). Mount force-sensitive resistors under each sole. Use the largest servo brackets at the bottom for stability.' },
              { title: '2. Build the legs', desc: 'Each leg: hip (3 DOF — pitch, roll, yaw) + knee (1 DOF pitch). Connect with aluminum U-brackets or 3D-printed links. Test balance at each joint.' },
              { title: '3. Build the torso frame', desc: 'Mount the SBC (Pi/Jetson), IMU, battery, and power distribution here. This is the center of mass — keep it low and centered.' },
              { title: '4. Build the arms', desc: 'Each arm: shoulder (2 DOF — pitch, roll) + elbow (1 DOF). Mount high-torque servos at shoulders. Wrist rotation is optional but adds expressiveness.' },
              { title: '5. Build the hands', desc: 'Start simple: 2-finger gripper per hand (1 servo each). Upgrade to 5-finger later with tendon-driven design or micro servos.' },
              { title: '6. Build the head', desc: 'Pan + tilt neck (2 servos). Mount camera, microphone, speaker, and OLED face display. Route all cables through the neck channel.' },
              { title: '7. Final integration', desc: 'Connect all limbs to torso. Route servo cables. Mount battery with velcro for easy swap. Do a power-on test of every joint individually.' },
            ].map((s, i) => (
              <div className="phase-step" key={i}>
                <div className="phase-step-num">{i + 1}</div>
                <div className="phase-step-content"><h5>{s.title}</h5><p>{s.desc}</p></div>
              </div>
            ))}
          </div>

          <div className="callout callout-warning">
            <span className="callout-icon">⚠️</span>
            <strong>Test each joint before full assembly!</strong> It's much harder to debug a wiring issue once the frame is fully built. Connect each servo to the PCA9685, sweep it through its range, and mark the center position.
          </div>
        </section>

        {/* ── H5. Electronics ──────────────────────────────── */}
        <section className="content-section" id="h-electronics">
          <div className="content-section-label">Build</div>
          <h2>Electronics &amp; Wiring</h2>

          <h3>Power Architecture</h3>
          <div className="arch-diagram">
            <pre>{`  ┌─────────────────────────────────────────────────────┐
  │               LiPo Battery (11.1V)                  │
  │                     │                               │
  │          ┌──────────┼──────────┐                    │
  │          │          │          │                    │
  │     ┌────▼────┐ ┌───▼───┐ ┌───▼────┐              │
  │     │Buck 5V  │ │Buck 6V│ │Direct  │              │
  │     │(SBC)    │ │(Servos│ │11.1V   │              │
  │     │Pi/Jetson│ │PCA9685│ │(High-  │              │
  │     └─────────┘ └───────┘ │torque  │              │
  │                           │servos) │              │
  │                           └────────┘              │
  │                                                    │
  │  E-STOP switch in series with battery main lead    │
  └─────────────────────────────────────────────────────┘`}</pre>
          </div>

          <h3>Servo Bus Wiring (PCA9685)</h3>
          <div className="wiring-table-wrap">
            <table className="wiring-table">
              <thead><tr><th>Channel</th><th>Servo</th><th>Location</th></tr></thead>
              <tbody>
                {[
                  ['Board 1, Ch 0–1', 'Head pan / tilt', 'Neck'],
                  ['Board 1, Ch 2–4', 'Left shoulder pitch, roll + elbow', 'Left arm'],
                  ['Board 1, Ch 5–7', 'Right shoulder pitch, roll + elbow', 'Right arm'],
                  ['Board 1, Ch 8–9', 'Left hand + right hand grippers', 'Hands'],
                  ['Board 1, Ch 10–15', 'Left leg (hip×3, knee, ankle×2)', 'Left leg'],
                  ['Board 2, Ch 0–5', 'Right leg (hip×3, knee, ankle×2)', 'Right leg'],
                  ['Board 2, Ch 6–7', 'Wrist rotation (optional)', 'Wrists'],
                ].map((r, i) => (
                  <tr key={i}><td>{r[0]}</td><td>{r[1]}</td><td>{r[2]}</td></tr>
                ))}
              </tbody>
            </table>
          </div>

          <CodeBlock lang="python">{`# Test all servos — sweep each joint through its range
# Run this BEFORE mounting servos to verify channels

import time
from adafruit_pca9685 import PCA9685
from adafruit_motor import servo as servo_lib
import board, busio

i2c = busio.I2C(board.SCL, board.SDA)
# Board 1 at default address 0x40
pca1 = PCA9685(i2c, address=0x40)
pca1.frequency = 50
# Board 2 at address 0x41 (solder A0 pad)
pca2 = PCA9685(i2c, address=0x41)
pca2.frequency = 50

def test_channel(pca, channel, name):
    s = servo_lib.Servo(pca.channels[channel])
    print(f"Testing {name} (ch {channel})...")
    for angle in [90, 45, 135, 90]:
        s.angle = angle
        time.sleep(0.5)
    print(f"  ✓ {name} OK")

# Head
test_channel(pca1, 0, "Head Pan")
test_channel(pca1, 1, "Head Tilt")
# Left arm
test_channel(pca1, 2, "L Shoulder Pitch")
test_channel(pca1, 3, "L Shoulder Roll")
test_channel(pca1, 4, "L Elbow")
# ... continue for all channels`}</CodeBlock>
        </section>

        {/* ── H6. Motion Controller ────────────────────────── */}
        <section className="content-section" id="h-motion">
          <div className="content-section-label">Core Code</div>
          <h2>Motion Controller Bridge</h2>
          <p>The motion controller is a Flask API that translates high-level commands ("wave left arm", "walk forward") into coordinated servo sequences. This is the most complex bridge because it handles <strong>inverse kinematics</strong> and <strong>synchronized multi-joint movement</strong>.</p>

          <CodeBlock lang="python">{`#!/usr/bin/env python3
"""
OrcBot Humanoid Motion Controller
Coordinates 22+ servos for walking, gestures, and expressions.
"""

from flask import Flask, request, jsonify
import time, threading, math, json, logging
from dataclasses import dataclass, field

app = Flask(__name__)
log = logging.getLogger('humanoid')
logging.basicConfig(level=logging.INFO,
    format='%(asctime)s [%(levelname)s] %(message)s')

# ── Joint Configuration ──
@dataclass
class Joint:
    name: str
    channel: int          # PCA9685 channel
    board: int            # 0 or 1
    min_angle: float      # Mechanical limit
    max_angle: float      # Mechanical limit
    center: float         # Neutral position
    current: float = 90.0
    speed: float = 1.0    # Degrees per step

JOINTS = {
    # Head
    'head_pan':          Joint('head_pan',     0, 0, 30, 150, 90),
    'head_tilt':         Joint('head_tilt',    1, 0, 60, 120, 90),
    # Left arm
    'l_shoulder_pitch':  Joint('l_shoulder_pitch', 2, 0, 0, 180, 90),
    'l_shoulder_roll':   Joint('l_shoulder_roll',  3, 0, 30, 150, 90),
    'l_elbow':           Joint('l_elbow',          4, 0, 30, 150, 90),
    'l_hand':            Joint('l_hand',           8, 0, 30, 150, 90),
    # Right arm
    'r_shoulder_pitch':  Joint('r_shoulder_pitch', 5, 0, 0, 180, 90),
    'r_shoulder_roll':   Joint('r_shoulder_roll',  6, 0, 30, 150, 90),
    'r_elbow':           Joint('r_elbow',          7, 0, 30, 150, 90),
    'r_hand':            Joint('r_hand',           9, 0, 30, 150, 90),
    # Left leg
    'l_hip_yaw':         Joint('l_hip_yaw',   10, 0, 60, 120, 90),
    'l_hip_roll':        Joint('l_hip_roll',   11, 0, 60, 120, 90),
    'l_hip_pitch':       Joint('l_hip_pitch',  12, 0, 30, 150, 90),
    'l_knee':            Joint('l_knee',       13, 0, 30, 150, 90),
    'l_ankle_pitch':     Joint('l_ankle_pitch',14, 0, 60, 120, 90),
    'l_ankle_roll':      Joint('l_ankle_roll', 15, 0, 70, 110, 90),
    # Right leg
    'r_hip_yaw':         Joint('r_hip_yaw',    0, 1, 60, 120, 90),
    'r_hip_roll':        Joint('r_hip_roll',    1, 1, 60, 120, 90),
    'r_hip_pitch':       Joint('r_hip_pitch',   2, 1, 30, 150, 90),
    'r_knee':            Joint('r_knee',        3, 1, 30, 150, 90),
    'r_ankle_pitch':     Joint('r_ankle_pitch', 4, 1, 60, 120, 90),
    'r_ankle_roll':      Joint('r_ankle_roll',  5, 1, 70, 110, 90),
}

state = {'e_stopped': False, 'pose': 'stand', 'moving': False}
lock = threading.Lock()

# ── Simulated servo control (replace with PCA9685 on real hardware) ──
def set_servo(joint: Joint, angle: float):
    """Move a servo to the target angle, respecting limits."""
    angle = max(joint.min_angle, min(angle, joint.max_angle))
    joint.current = angle
    # On real hardware:
    # boards[joint.board].channels[joint.channel].duty_cycle = angle_to_duty(angle)
    log.debug(f"{joint.name} → {angle:.1f}°")

def move_joints(targets: dict, duration: float = 1.0, steps: int = 20):
    """Smoothly interpolate multiple joints to target angles."""
    if state['e_stopped']:
        return False
    state['moving'] = True
    delay = duration / steps
    start_angles = {name: JOINTS[name].current for name in targets}
    for step in range(1, steps + 1):
        if state['e_stopped']:
            state['moving'] = False
            return False
        t = step / steps
        # Ease-in-out interpolation
        t = t * t * (3 - 2 * t)
        for name, target in targets.items():
            current = start_angles[name] + (target - start_angles[name]) * t
            set_servo(JOINTS[name], current)
        time.sleep(delay)
    state['moving'] = False
    return True

# ── Preset Poses ──
POSES = {
    'stand': {j: JOINTS[j].center for j in JOINTS},
    'sit': {
        **{j: JOINTS[j].center for j in JOINTS},
        'l_hip_pitch': 45, 'r_hip_pitch': 45,
        'l_knee': 90, 'r_knee': 90,
    },
    'wave': {
        'r_shoulder_pitch': 150, 'r_shoulder_roll': 60,
        'r_elbow': 45, 'r_hand': 150,
    },
    'arms_up': {
        'l_shoulder_pitch': 170, 'r_shoulder_pitch': 170,
        'l_elbow': 170, 'r_elbow': 170,
    },
    'bow': {
        **{j: JOINTS[j].center for j in JOINTS},
        'l_hip_pitch': 60, 'r_hip_pitch': 60,
        'head_tilt': 70,
    },
}

# ── Endpoints ──
@app.route('/health')
def health():
    return jsonify(status='ok', joints=len(JOINTS), e_stopped=state['e_stopped'])

@app.route('/status')
def status():
    positions = {n: j.current for n, j in JOINTS.items()}
    return jsonify(**state, positions=positions)

@app.route('/pose', methods=['POST'])
def pose():
    d = request.json or {}
    name = d.get('name', 'stand')
    duration = min(float(d.get('duration', 1.5)), 5.0)
    if name not in POSES:
        return jsonify(error=f'Unknown pose: {name}', available=list(POSES.keys())), 400
    with lock:
        if state['e_stopped']:
            return jsonify(error='E-STOP active'), 403
    ok = move_joints(POSES[name], duration)
    state['pose'] = name
    return jsonify(status='posed', pose=name, success=ok)

@app.route('/joint', methods=['POST'])
def joint():
    d = request.json or {}
    name = d.get('name')
    angle = float(d.get('angle', 90))
    dur = min(float(d.get('duration', 0.5)), 3.0)
    if name not in JOINTS:
        return jsonify(error=f'Unknown joint: {name}'), 400
    ok = move_joints({name: angle}, dur)
    return jsonify(status='moved', joint=name, angle=angle, success=ok)

@app.route('/joints', methods=['POST'])
def joints():
    d = request.json or {}
    targets = d.get('targets', {})
    dur = min(float(d.get('duration', 1.0)), 5.0)
    invalid = [n for n in targets if n not in JOINTS]
    if invalid:
        return jsonify(error=f'Unknown joints: {invalid}'), 400
    ok = move_joints(targets, dur)
    return jsonify(status='moved', targets=list(targets.keys()), success=ok)

@app.route('/gesture', methods=['POST'])
def gesture():
    """Execute a gesture — a sequence of poses with timing."""
    d = request.json or {}
    name = d.get('name', 'wave')
    gestures = {
        'wave': [
            ({'r_shoulder_pitch': 150, 'r_elbow': 45}, 0.5),
            ({'r_hand': 150}, 0.3),
            ({'r_hand': 30}, 0.3),
            ({'r_hand': 150}, 0.3),
            ({'r_hand': 30}, 0.3),
            ({'r_shoulder_pitch': 90, 'r_elbow': 90, 'r_hand': 90}, 0.5),
        ],
        'nod': [
            ({'head_tilt': 70}, 0.3),
            ({'head_tilt': 110}, 0.3),
            ({'head_tilt': 70}, 0.3),
            ({'head_tilt': 90}, 0.3),
        ],
        'shake_head': [
            ({'head_pan': 60}, 0.3),
            ({'head_pan': 120}, 0.3),
            ({'head_pan': 60}, 0.3),
            ({'head_pan': 90}, 0.3),
        ],
        'shrug': [
            ({'l_shoulder_pitch': 120, 'r_shoulder_pitch': 120,
              'l_shoulder_roll': 60, 'r_shoulder_roll': 120}, 0.5),
            ({j: JOINTS[j].center for j in ['l_shoulder_pitch', 'r_shoulder_pitch',
              'l_shoulder_roll', 'r_shoulder_roll']}, 0.5),
        ],
    }
    if name not in gestures:
        return jsonify(error=f'Unknown gesture', available=list(gestures.keys())), 400
    for targets, dur in gestures[name]:
        if not move_joints(targets, dur):
            return jsonify(status='interrupted', gesture=name), 409
    return jsonify(status='completed', gesture=name)

@app.route('/e-stop', methods=['POST'])
def e_stop():
    state['e_stopped'] = True
    state['moving'] = False
    # Immediately relax all servos (cut PWM)
    return jsonify(status='e-stopped')

@app.route('/e-stop/reset', methods=['POST'])
def e_stop_reset():
    state['e_stopped'] = False
    return jsonify(status='reset')

if __name__ == '__main__':
    log.info(f"Humanoid Motion Controller — {len(JOINTS)} joints")
    app.run(host='0.0.0.0', port=5050, debug=False)`}</CodeBlock>
        </section>

        {/* ── H7. Walking ──────────────────────────────────── */}
        <section className="content-section" id="h-walking">
          <div className="content-section-label">Locomotion</div>
          <h2>Walking &amp; Balance</h2>
          <p>Bipedal walking is the hardest part of a humanoid build. Start with static balance, then move to dynamic gaits.</p>

          <h3>Walking Progression</h3>
          <div className="phase-steps">
            {[
              { title: 'Static stand', desc: 'All joints at center, verify the robot balances without tipping. Adjust center-of-mass by repositioning the battery.' },
              { title: 'Weight shift', desc: 'Shift weight to one foot by moving hip roll. The IMU provides feedback — stop when tilt exceeds ±5°.' },
              { title: 'Single-leg lift', desc: 'While balanced on one foot, lift the other by bending knee and hip. Hold for 2 seconds.' },
              { title: 'Step in place', desc: 'Alternate lifting left and right foot. This is the "march in place" gait — no forward movement yet.' },
              { title: 'Forward step', desc: 'During leg lift, swing the hip forward (pitch). Plant foot, shift weight, repeat. This is a static walking gait.' },
              { title: 'Dynamic gait (advanced)', desc: 'Use ZMP (Zero Moment Point) or preview control to generate smooth walking. This typically requires ROS2 + a walk engine like ROBOTIS framework.' },
            ].map((s, i) => (
              <div className="phase-step" key={i}>
                <div className="phase-step-num">{i + 1}</div>
                <div className="phase-step-content"><h5>{s.title}</h5><p>{s.desc}</p></div>
              </div>
            ))}
          </div>

          <CodeBlock lang="python">{`# Add to motion controller — basic static walk gait
# This is a simplified 4-phase walk cycle

WALK_CYCLE = [
    # Phase 1: Shift weight to right foot
    {'l_hip_roll': 80, 'r_hip_roll': 80, 'l_ankle_roll': 80, 'r_ankle_roll': 80},
    # Phase 2: Lift left leg, swing forward
    {'l_hip_pitch': 70, 'l_knee': 60, 'l_ankle_pitch': 70},
    # Phase 3: Plant left foot, shift weight left
    {'l_hip_pitch': 90, 'l_knee': 90, 'l_ankle_pitch': 90,
     'l_hip_roll': 100, 'r_hip_roll': 100, 'l_ankle_roll': 100, 'r_ankle_roll': 100},
    # Phase 4: Lift right leg, swing forward
    {'r_hip_pitch': 70, 'r_knee': 60, 'r_ankle_pitch': 70},
    # Phase 5: Plant right foot, return to center
    {'r_hip_pitch': 90, 'r_knee': 90, 'r_ankle_pitch': 90,
     'l_hip_roll': 90, 'r_hip_roll': 90, 'l_ankle_roll': 90, 'r_ankle_roll': 90},
]

@app.route('/walk', methods=['POST'])
def walk():
    d = request.json or {}
    steps = min(int(d.get('steps', 2)), 10)
    speed = max(0.3, min(float(d.get('speed', 0.5)), 1.0))
    if state['e_stopped']:
        return jsonify(error='E-STOP active'), 403
    for _ in range(steps):
        for phase in WALK_CYCLE:
            if not move_joints(phase, speed):
                return jsonify(status='interrupted'), 409
    move_joints(POSES['stand'], 0.5)
    return jsonify(status='walked', steps=steps)`}</CodeBlock>

          <div className="callout callout-warning">
            <span className="callout-icon">⚠️</span>
            <strong>Always test walking with a safety harness or someone spotting!</strong> A falling humanoid robot can damage itself and its surroundings. Use a suspended bar or string through the torso during gait development.
          </div>
        </section>

        {/* ── H8. Arms & Hands ─────────────────────────────── */}
        <section className="content-section" id="h-arms">
          <div className="content-section-label">Manipulation</div>
          <h2>Arm &amp; Hand Control</h2>
          <p>Arms use <strong>inverse kinematics</strong> (IK) — you tell OrcBot "reach this point in space" and IK calculates the required joint angles.</p>

          <CodeBlock lang="python">{`# Simple 2-DOF arm IK (shoulder + elbow in the same plane)
import math

UPPER_ARM = 15.0  # cm — shoulder to elbow
FOREARM   = 12.0  # cm — elbow to hand

def arm_ik(x: float, y: float, side: str = 'right') -> dict:
    """
    Calculate shoulder pitch and elbow angle to reach (x, y) in cm.
    x = forward distance, y = height from shoulder.
    Returns dict of joint angles.
    """
    dist = math.sqrt(x**2 + y**2)
    if dist > UPPER_ARM + FOREARM:
        return {'error': 'Target out of reach'}

    # Law of cosines for elbow angle
    cos_elbow = (UPPER_ARM**2 + FOREARM**2 - dist**2) / (2 * UPPER_ARM * FOREARM)
    cos_elbow = max(-1, min(1, cos_elbow))
    elbow_angle = math.degrees(math.acos(cos_elbow))

    # Shoulder angle
    angle_to_target = math.degrees(math.atan2(y, x))
    cos_shoulder = (UPPER_ARM**2 + dist**2 - FOREARM**2) / (2 * UPPER_ARM * dist)
    cos_shoulder = max(-1, min(1, cos_shoulder))
    shoulder_angle = angle_to_target + math.degrees(math.acos(cos_shoulder))

    prefix = 'r' if side == 'right' else 'l'
    return {
        f'{prefix}_shoulder_pitch': round(shoulder_angle, 1),
        f'{prefix}_elbow': round(180 - elbow_angle, 1),
    }

# Usage:
# targets = arm_ik(20, 10, 'right')
# move_joints(targets, duration=1.0)`}</CodeBlock>

          <h3>Hand Gripping</h3>
          <p>With a simple 2-finger gripper, the hand has one degree of freedom: open (30°) and closed (150°). For manipulation tasks, OrcBot can plan grip sequences.</p>

          <CodeBlock lang="python">{`@app.route('/reach', methods=['POST'])
def reach():
    d = request.json or {}
    x = float(d.get('x', 20))
    y = float(d.get('y', 0))
    side = d.get('side', 'right')
    grip = d.get('grip', None)  # 'open', 'close', or None

    targets = arm_ik(x, y, side)
    if 'error' in targets:
        return jsonify(**targets), 400

    ok = move_joints(targets, 1.0)
    if grip and ok:
        hand = f"{side[0]}_hand"
        angle = 30 if grip == 'open' else 150
        move_joints({hand: angle}, 0.5)

    return jsonify(status='reached', side=side, x=x, y=y)`}</CodeBlock>
        </section>

        {/* ── H9. Speech ───────────────────────────────────── */}
        <section className="content-section" id="h-speech">
          <div className="content-section-label">Communication</div>
          <h2>Speech — Voice &amp; Hearing</h2>
          <p>Give your robot a voice and ears. OrcBot decides <strong>what</strong> to say; the speech system handles <strong>how</strong>.</p>

          <h3>Text-to-Speech (TTS)</h3>
          <CodeBlock lang="python">{`# Add to the motion controller bridge

import subprocess

@app.route('/speak', methods=['POST'])
def speak():
    d = request.json or {}
    text = d.get('text', '')
    if not text:
        return jsonify(error='No text provided'), 400

    # Option 1: pico2wave (lightweight, offline)
    try:
        wav = '/tmp/orcbot_speech.wav'
        subprocess.run(['pico2wave', '-w', wav, text], timeout=10)
        subprocess.Popen(['aplay', wav])
        return jsonify(status='speaking', text=text[:100])
    except FileNotFoundError:
        pass

    # Option 2: espeak (more robotic, very lightweight)
    try:
        subprocess.Popen(['espeak', '-s', '140', '-p', '50', text])
        return jsonify(status='speaking', engine='espeak')
    except FileNotFoundError:
        return jsonify(error='No TTS engine installed'), 500

# Install: sudo apt install libttspico-utils espeak alsa-utils`}</CodeBlock>

          <h3>Speech-to-Text (STT)</h3>
          <CodeBlock lang="python">{`# Continuous listening with Vosk (offline, lightweight)
# pip install vosk sounddevice

import queue, json as js
import sounddevice as sd
from vosk import Model, KaldiRecognizer

# Download model: https://alphacephei.com/vosk/models
# Use vosk-model-small-en-us-0.15 (~40MB)
model = Model('/home/pi/vosk-model-small-en-us')
recognizer = KaldiRecognizer(model, 16000)
audio_queue = queue.Queue()

def audio_callback(indata, frames, time_info, status):
    audio_queue.put(bytes(indata))

# Start listening in background
stream = sd.RawInputStream(samplerate=16000, blocksize=8000,
    dtype='int16', channels=1, callback=audio_callback)

@app.route('/listen', methods=['POST'])
def listen():
    """Listen for speech and return transcription."""
    d = request.json or {}
    timeout = min(float(d.get('timeout', 5)), 15)
    stream.start()
    text = ''
    end_time = time.time() + timeout
    while time.time() < end_time:
        data = audio_queue.get(timeout=1)
        if recognizer.AcceptWaveform(data):
            result = js.loads(recognizer.Result())
            text = result.get('text', '')
            if text:
                break
    stream.stop()
    return jsonify(status='heard', text=text)`}</CodeBlock>

          <div className="callout callout-info">
            <span className="callout-icon">💡</span>
            <strong>Cloud alternative:</strong> For higher accuracy, pipe audio to OpenAI Whisper or Google Speech-to-Text. But Vosk works offline, which is crucial for a portable robot.
          </div>
        </section>

        {/* ── H10. Sign Language ───────────────────────────── */}
        <section className="content-section" id="h-sign">
          <div className="content-section-label">Communication</div>
          <h2>Sign Language</h2>
          <p>Sign language combines hand shapes (handforms), arm positions, and movement. With servo-driven hands and arms, the robot can produce basic signs. With camera + ML, it can also <strong>read</strong> signs.</p>

          <h3>Producing Signs (Robot → Human)</h3>
          <CodeBlock lang="python">{`# American Sign Language (ASL) basic alphabet and phrases
# Each sign is a pose sequence: arm position + hand shape

ASL_SIGNS = {
    # Simple signs using shoulder/elbow/hand
    'hello': [
        # Flat hand near forehead, move outward
        ({'r_shoulder_pitch': 140, 'r_shoulder_roll': 70,
          'r_elbow': 130, 'r_hand': 30}, 0.5),
        ({'r_shoulder_pitch': 130, 'r_shoulder_roll': 90,
          'r_elbow': 150, 'r_hand': 30}, 0.5),
    ],
    'thank_you': [
        # Hand from chin forward
        ({'r_shoulder_pitch': 130, 'r_elbow': 120, 'r_hand': 30}, 0.4),
        ({'r_shoulder_pitch': 110, 'r_elbow': 140, 'r_hand': 60}, 0.4),
    ],
    'yes': [
        # Fist nod (simulate with hand closed + head nod)
        ({'r_hand': 150, 'head_tilt': 75}, 0.3),
        ({'head_tilt': 105}, 0.3),
        ({'head_tilt': 75}, 0.3),
        ({'head_tilt': 90, 'r_hand': 90}, 0.3),
    ],
    'no': [
        # Index + middle finger snap to thumb (simplified: head shake)
        ({'head_pan': 65}, 0.25),
        ({'head_pan': 115}, 0.25),
        ({'head_pan': 65}, 0.25),
        ({'head_pan': 90}, 0.25),
    ],
    'please': [
        # Flat hand on chest, circular motion
        ({'r_shoulder_pitch': 100, 'r_elbow': 80, 'r_hand': 30}, 0.4),
        ({'r_shoulder_pitch': 110, 'r_elbow': 70}, 0.4),
        ({'r_shoulder_pitch': 100, 'r_elbow': 80}, 0.4),
    ],
    'help': [
        # Fist on open palm, lift
        ({'l_shoulder_pitch': 100, 'l_hand': 30,
          'r_shoulder_pitch': 100, 'r_hand': 150}, 0.4),
        ({'l_shoulder_pitch': 130, 'r_shoulder_pitch': 130}, 0.5),
    ],
}

@app.route('/sign', methods=['POST'])
def sign():
    d = request.json or {}
    word = d.get('word', '').lower()
    if word not in ASL_SIGNS:
        return jsonify(error=f'Unknown sign: {word}',
                       available=list(ASL_SIGNS.keys())), 400
    for targets, dur in ASL_SIGNS[word]:
        if not move_joints(targets, dur):
            return jsonify(status='interrupted'), 409
    move_joints(POSES['stand'], 0.5)
    return jsonify(status='signed', word=word)`}</CodeBlock>

          <h3>Reading Signs (Human → Robot)</h3>
          <CodeBlock lang="python">{`# Sign language recognition using MediaPipe Hands + a simple classifier
# pip install mediapipe opencv-python scikit-learn

import cv2
import mediapipe as mp
import numpy as np

mp_hands = mp.solutions.hands
hands = mp_hands.Hands(static_image_mode=False, max_num_hands=2,
                       min_detection_confidence=0.7)

@app.route('/read_sign')
def read_sign():
    """Capture a frame and attempt to recognize a hand sign."""
    cap = cv2.VideoCapture(0)
    ret, frame = cap.read()
    cap.release()
    if not ret:
        return jsonify(error='Camera unavailable'), 500

    rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
    result = hands.process(rgb)

    if not result.multi_hand_landmarks:
        return jsonify(status='no_hands_detected')

    # Extract landmark positions (21 points per hand)
    landmarks = []
    for lm in result.multi_hand_landmarks[0].landmark:
        landmarks.extend([lm.x, lm.y, lm.z])

    # In production: feed landmarks into a trained sklearn/tflite classifier
    # For now, return the raw landmarks for OrcBot to interpret via LLM
    return jsonify(
        status='detected',
        hands=len(result.multi_hand_landmarks),
        landmarks=landmarks[:63],  # First hand only
        note='Feed to classifier or LLM for interpretation'
    )`}</CodeBlock>

          <div className="callout callout-info">
            <span className="callout-icon">💡</span>
            <strong>Expanding the vocabulary:</strong> Record landmark data for each sign you want the robot to recognize, train a simple KNN or SVM classifier with scikit-learn, and load it in the <code>/read_sign</code> endpoint.
          </div>
        </section>

        {/* ── H11. Vision ──────────────────────────────────── */}
        <section className="content-section" id="h-vision">
          <div className="content-section-label">Perception</div>
          <h2>Computer Vision &amp; Face</h2>

          <h3>Object &amp; Face Detection</h3>
          <CodeBlock lang="python">{`# Vision module — YOLO + face recognition
# pip install ultralytics opencv-python face-recognition

from ultralytics import YOLO
import cv2, base64

# Use YOLOv8 Nano for speed on Pi/Jetson
yolo = YOLO('yolov8n.pt')  # Download ~6MB model

@app.route('/vision/detect')
def detect():
    """Detect objects in camera view."""
    cap = cv2.VideoCapture(0)
    ret, frame = cap.read()
    cap.release()
    if not ret:
        return jsonify(error='Camera unavailable'), 500

    results = yolo(frame, verbose=False)[0]
    detections = []
    for box in results.boxes:
        cls = results.names[int(box.cls)]
        conf = float(box.conf)
        x1, y1, x2, y2 = [int(v) for v in box.xyxy[0]]
        detections.append({
            'object': cls, 'confidence': round(conf, 2),
            'bbox': [x1, y1, x2, y2]
        })

    return jsonify(status='detected', objects=detections,
                   count=len(detections))

@app.route('/vision/faces')
def detect_faces():
    """Detect and recognize faces."""
    import face_recognition
    cap = cv2.VideoCapture(0)
    ret, frame = cap.read()
    cap.release()
    if not ret:
        return jsonify(error='Camera unavailable'), 500

    rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
    locations = face_recognition.face_locations(rgb)
    encodings = face_recognition.face_encodings(rgb, locations)

    faces = []
    for loc, enc in zip(locations, encodings):
        top, right, bottom, left = loc
        faces.append({
            'bbox': [left, top, right, bottom],
            'encoding_hash': hash(enc.tobytes()) % (10**8),
        })

    return jsonify(status='detected', faces=faces, count=len(faces))`}</CodeBlock>

          <h3>Expressive Face Display</h3>
          <CodeBlock lang="python">{`# OLED face expressions (SH1106 1.3" or SSD1306)
# pip install luma.oled Pillow

from luma.oled.device import sh1106
from luma.core.interface.serial import i2c as luma_i2c
from PIL import Image, ImageDraw

oled_serial = luma_i2c(port=1, address=0x3C)
oled = sh1106(oled_serial, width=128, height=64)

def draw_face(expression='neutral'):
    img = Image.new('1', (128, 64), 0)
    draw = ImageDraw.Draw(img)

    faces = {
        'neutral':  {'l_eye': (30, 20, 15), 'r_eye': (85, 20, 15), 'mouth': 'line'},
        'happy':    {'l_eye': (30, 22, 13), 'r_eye': (85, 22, 13), 'mouth': 'smile'},
        'sad':      {'l_eye': (30, 18, 13), 'r_eye': (85, 18, 13), 'mouth': 'frown'},
        'surprised':{'l_eye': (30, 18, 18), 'r_eye': (85, 18, 18), 'mouth': 'o'},
        'angry':    {'l_eye': (30, 22, 12), 'r_eye': (85, 22, 12), 'mouth': 'line'},
        'thinking': {'l_eye': (30, 20, 15), 'r_eye': (85, 20, 8),  'mouth': 'squiggle'},
        'sleeping': {'l_eye': (30, 24, 0),  'r_eye': (85, 24, 0),  'mouth': 'line'},
    }
    f = faces.get(expression, faces['neutral'])

    # Eyes
    for eye_key in ['l_eye', 'r_eye']:
        cx, cy, r = f[eye_key]
        if r > 0:
            draw.ellipse([cx-r, cy-r, cx+r, cy+r], fill=1)
        else:
            draw.line([(cx-10, cy), (cx+10, cy)], fill=1, width=2)

    # Mouth
    if f['mouth'] == 'smile':
        draw.arc([35, 35, 90, 58], 0, 180, fill=1, width=2)
    elif f['mouth'] == 'frown':
        draw.arc([35, 45, 90, 65], 180, 360, fill=1, width=2)
    elif f['mouth'] == 'o':
        draw.ellipse([52, 42, 72, 58], outline=1, width=2)
    elif f['mouth'] == 'squiggle':
        draw.line([(40, 50), (50, 45), (60, 50), (70, 45), (80, 50)], fill=1, width=2)
    else:
        draw.line([(40, 50), (85, 50)], fill=1, width=2)

    oled.display(img)

@app.route('/face', methods=['POST'])
def face():
    d = request.json or {}
    expr = d.get('expression', 'neutral')
    draw_face(expr)
    return jsonify(status='set', expression=expr)`}</CodeBlock>
        </section>

        {/* ── H12. Cognition ───────────────────────────────── */}
        <section className="content-section" id="h-cognition">
          <div className="content-section-label">Brain</div>
          <h2>Cognition — The OrcBot Brain</h2>
          <p>This is where it all comes together. OrcBot's decision engine coordinates all subsystems — it sees via the camera, hears via the mic, thinks via the LLM, and acts through the motion controller.</p>

          <h3>Cognitive Loop</h3>
          <div className="arch-diagram">
            <pre>{`┌─────────────────────────────────────────────────────────┐
│                  OrcBot Decision Engine                  │
│                                                         │
│  1. PERCEIVE                                            │
│     • Camera: "I see a person standing 2m away"         │
│     • Microphone: "They said: Hello, how are you?"      │
│     • Sensors: "IMU stable, battery 85%"                │
│                                                         │
│  2. REMEMBER                                            │
│     • Short memory: recent observations                 │
│     • Episodic: "Last time I saw this person, they      │
│       asked me to wave"                                 │
│     • Profile: "This is Alex, they prefer sign lang"    │
│                                                         │
│  3. DECIDE                                              │
│     LLM processes context → selects skills:             │
│     • humanoid_speak("Hello Alex! I'm doing well")      │
│     • humanoid_gesture("wave")                          │
│     • humanoid_face("happy")                            │
│                                                         │
│  4. ACT                                                 │
│     Skills execute in parallel where safe:              │
│     • Speech + face expression = parallel               │
│     • Walk + gesture = sequential (balance)             │
│                                                         │
│  5. OBSERVE                                             │
│     Check results, save to memory, continue or stop     │
└─────────────────────────────────────────────────────────┘`}</pre>
          </div>

          <h3>Behavior Modes</h3>
          <div className="safety-layers">
            {[
              { title: 'Companion Mode', desc: 'The robot follows conversations, responds to voice, makes eye contact (tracks faces with head pan/tilt), and uses appropriate gestures. This is the default interactive mode.' },
              { title: 'Patrol Mode', desc: 'The robot walks a defined path, scans for objects/people with the camera, and reports findings via Telegram. Useful for surveillance or exploration.' },
              { title: 'Assistant Mode', desc: 'Wait for voice commands, execute tasks (fetch, point, guide), report completion. Ideal for structured environments like labs or classrooms.' },
              { title: 'Learning Mode', desc: 'OrcBot observes demonstrations (via camera + speech), forms episodic memories, and can reproduce learned sequences. This is how you teach it new gestures or routines.' },
            ].map((item, i) => (
              <div className="safety-layer" key={i}>
                <h4 style={{ margin: 0, marginBottom: 4 }}>{item.title}</h4>
                <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>{item.desc}</p>
              </div>
            ))}
          </div>
        </section>

        {/* ── H13. Skills ──────────────────────────────────── */}
        <section className="content-section" id="h-skills">
          <div className="content-section-label">Integration</div>
          <h2>OrcBot Humanoid Skills Plugin</h2>
          <p>Save as <code>~/.orcbot/plugins/humanoid-control.ts</code> — this gives OrcBot full control of the humanoid body.</p>

          <CodeBlock lang="typescript">{`/**
 * OrcBot Humanoid Companion Skills
 * Full-body control: movement, speech, vision, sign language, expression.
 */

const BRIDGE = process.env.ROBOT_BRIDGE_URL || 'http://localhost:5050';

interface BridgeResult {
  status?: string;
  error?: string;
  [key: string]: any;
}

async function call(path: string, method = 'GET', body?: any): Promise<BridgeResult> {
  const opts: RequestInit = { method, headers: { 'Content-Type': 'application/json' } };
  if (body) opts.body = JSON.stringify(body);
  try {
    const res = await fetch(\`\${BRIDGE}\${path}\`, opts);
    return await res.json();
  } catch (e: any) {
    return { error: \`Bridge unreachable: \${e.message}\` };
  }
}

// ── Movement & Posture ──
export const humanoid_pose = {
  name: 'humanoid_pose',
  description: 'Set a body pose: stand, sit, wave, arms_up, bow.',
  usage: 'humanoid_pose(name, duration?)',
  handler: async (args: any) => call('/pose', 'POST', {
    name: args.name || 'stand',
    duration: parseFloat(args.duration || '1.5')
  })
};

export const humanoid_joint = {
  name: 'humanoid_joint',
  description: 'Move a single joint to an angle. Joints: head_pan, head_tilt, l/r_shoulder_pitch, l/r_shoulder_roll, l/r_elbow, l/r_hand, l/r_hip_yaw/roll/pitch, l/r_knee, l/r_ankle_pitch/roll.',
  usage: 'humanoid_joint(name, angle, duration?)',
  handler: async (args: any) => call('/joint', 'POST', {
    name: args.name, angle: parseFloat(args.angle || '90'),
    duration: parseFloat(args.duration || '0.5')
  })
};

export const humanoid_gesture = {
  name: 'humanoid_gesture',
  description: 'Perform a gesture: wave, nod, shake_head, shrug.',
  usage: 'humanoid_gesture(name)',
  handler: async (args: any) => call('/gesture', 'POST', { name: args.name || 'wave' })
};

export const humanoid_walk = {
  name: 'humanoid_walk',
  description: 'Walk forward a number of steps.',
  usage: 'humanoid_walk(steps?, speed?)',
  handler: async (args: any) => call('/walk', 'POST', {
    steps: parseInt(args.steps || '2'),
    speed: parseFloat(args.speed || '0.5')
  })
};

export const humanoid_reach = {
  name: 'humanoid_reach',
  description: 'Reach a hand to a position (x=forward cm, y=height cm). Optionally grip open/close.',
  usage: 'humanoid_reach(x, y, side?, grip?)',
  handler: async (args: any) => call('/reach', 'POST', {
    x: parseFloat(args.x || '20'), y: parseFloat(args.y || '0'),
    side: args.side || 'right', grip: args.grip
  })
};

// ── Speech ──
export const humanoid_speak = {
  name: 'humanoid_speak',
  description: 'Speak text aloud through the robot\\'s speaker.',
  usage: 'humanoid_speak(text)',
  handler: async (args: any) => call('/speak', 'POST', { text: args.text })
};

export const humanoid_listen = {
  name: 'humanoid_listen',
  description: 'Listen for speech and transcribe it.',
  usage: 'humanoid_listen(timeout?)',
  handler: async (args: any) => call('/listen', 'POST', {
    timeout: parseFloat(args.timeout || '5')
  })
};

// ── Sign Language ──
export const humanoid_sign = {
  name: 'humanoid_sign',
  description: 'Perform a sign language gesture: hello, thank_you, yes, no, please, help.',
  usage: 'humanoid_sign(word)',
  handler: async (args: any) => call('/sign', 'POST', { word: args.word })
};

export const humanoid_read_sign = {
  name: 'humanoid_read_sign',
  description: 'Use the camera to read and interpret a hand sign.',
  usage: 'humanoid_read_sign()',
  handler: async () => call('/read_sign')
};

// ── Vision ──
export const humanoid_see = {
  name: 'humanoid_see',
  description: 'Detect objects in the robot\\'s camera view using YOLO.',
  usage: 'humanoid_see()',
  handler: async () => call('/vision/detect')
};

export const humanoid_faces = {
  name: 'humanoid_faces',
  description: 'Detect faces in camera view.',
  usage: 'humanoid_faces()',
  handler: async () => call('/vision/faces')
};

// ── Expression ──
export const humanoid_face = {
  name: 'humanoid_face',
  description: 'Change facial expression: neutral, happy, sad, surprised, angry, thinking, sleeping.',
  usage: 'humanoid_face(expression)',
  handler: async (args: any) => call('/face', 'POST', {
    expression: args.expression || 'neutral'
  })
};

// ── Safety ──
export const humanoid_status = {
  name: 'humanoid_status',
  description: 'Get robot status: pose, joint positions, e-stop state.',
  usage: 'humanoid_status()',
  handler: async () => call('/status')
};

export const humanoid_e_stop = {
  name: 'humanoid_e_stop',
  description: 'EMERGENCY STOP — freeze all joints immediately.',
  usage: 'humanoid_e_stop()',
  handler: async () => call('/e-stop', 'POST')
};

export const humanoid_e_stop_reset = {
  name: 'humanoid_e_stop_reset',
  description: 'Reset emergency stop to allow movement again.',
  usage: 'humanoid_e_stop_reset()',
  handler: async () => call('/e-stop/reset', 'POST')
};`}</CodeBlock>
        </section>

        {/* ── H14. Safety ──────────────────────────────────── */}
        <section className="content-section" id="h-safety">
          <div className="content-section-label">Critical</div>
          <h2>Safety &amp; Ethics</h2>
          <p><strong>A humanoid robot is physically capable of harm.</strong> Safety engineering is non-negotiable.</p>

          <div className="safety-layers">
            {[
              {
                num: 'Layer 1', title: 'Hardware Safety', items: [
                  'Physical E-stop button — cuts servo power, SBC stays on for logging',
                  'Current-limiting fuses on each servo bus',
                  'Torque limits in firmware — servos can\'t apply more than configured force',
                  'Collision padding — foam on hands, arms, and head',
                  'Tether/harness during walking development',
                ]
              },
              {
                num: 'Layer 2', title: 'Motion Controller Safety', items: [
                  'All joint angles clamped to mechanical limits — impossible to self-damage',
                  'Speed limiting — smooth interpolation, no sudden jerks',
                  'Watchdog timer — motors relax if no command for 10 seconds',
                  'IMU tilt guard — auto-sit if body tilt exceeds 15°',
                  'Obstacle distance check before walking',
                ]
              },
              {
                num: 'Layer 3', title: 'OrcBot Guard Rails', items: [
                  'Skill frequency limits — can\'t spam walk commands',
                  'Step limit per action — prevents runaway movement',
                  'Termination review — second LLM pass confirms task completion',
                  'Communication cooldown — prevents infinite movement loops',
                ]
              },
              {
                num: 'Layer 4', title: 'Ethical Guidelines', items: [
                  'The robot must announce itself — never pretend to be human',
                  'Voice interactions must be logged for accountability',
                  'Camera data is processed locally — never streamed without consent',
                  'No autonomous decisions about physical contact with humans',
                  'Operator must be reachable via Telegram during autonomous operation',
                ]
              },
            ].map((layer, i) => (
              <div className="safety-layer" key={i}>
                <div className="safety-layer-num">{layer.num}</div>
                <h4>{layer.title}</h4>
                <ul>{layer.items.map((it, j) => <li key={j}>{it}</li>)}</ul>
              </div>
            ))}
          </div>
        </section>

        {/* ── H15. Simulation ──────────────────────────────── */}
        <section className="content-section" id="h-simulation">
          <div className="content-section-label">Testing</div>
          <h2>Simulation &amp; Testing</h2>
          <p>Test everything in software before powering on the physical robot.</p>

          <h3>Mock Motion Controller</h3>
          <CodeBlock lang="python">{`#!/usr/bin/env python3
"""Mock humanoid bridge — no real hardware needed."""

from flask import Flask, request, jsonify
import time, random

app = Flask(__name__)
joints = {name: 90.0 for name in [
    'head_pan', 'head_tilt',
    'l_shoulder_pitch', 'l_shoulder_roll', 'l_elbow', 'l_hand',
    'r_shoulder_pitch', 'r_shoulder_roll', 'r_elbow', 'r_hand',
    'l_hip_yaw', 'l_hip_roll', 'l_hip_pitch', 'l_knee',
    'l_ankle_pitch', 'l_ankle_roll',
    'r_hip_yaw', 'r_hip_roll', 'r_hip_pitch', 'r_knee',
    'r_ankle_pitch', 'r_ankle_roll',
]}
state = {'e_stopped': False, 'pose': 'stand', 'moving': False}

@app.route('/health')
def health(): return jsonify(status='ok', mock=True, joints=len(joints))

@app.route('/status')
def status(): return jsonify(**state, positions=joints)

@app.route('/pose', methods=['POST'])
def pose():
    name = (request.json or {}).get('name', 'stand')
    state['pose'] = name
    return jsonify(status='posed', pose=name, success=True)

@app.route('/joint', methods=['POST'])
def joint():
    d = request.json or {}
    name = d.get('name', 'head_pan')
    angle = float(d.get('angle', 90))
    if name in joints: joints[name] = angle
    return jsonify(status='moved', joint=name, angle=angle)

@app.route('/joints', methods=['POST'])
def multi():
    for k, v in (request.json or {}).get('targets', {}).items():
        if k in joints: joints[k] = float(v)
    return jsonify(status='moved')

@app.route('/gesture', methods=['POST'])
def gesture():
    return jsonify(status='completed',
                   gesture=(request.json or {}).get('name', 'wave'))

@app.route('/walk', methods=['POST'])
def walk():
    steps = (request.json or {}).get('steps', 2)
    return jsonify(status='walked', steps=steps)

@app.route('/speak', methods=['POST'])
def speak():
    text = (request.json or {}).get('text', '')
    print(f"🔊 Robot says: {text}")
    return jsonify(status='speaking', text=text[:100])

@app.route('/listen', methods=['POST'])
def listen():
    return jsonify(status='heard', text='simulated speech input')

@app.route('/sign', methods=['POST'])
def sign():
    return jsonify(status='signed',
                   word=(request.json or {}).get('word', 'hello'))

@app.route('/read_sign')
def read_sign():
    return jsonify(status='detected', hands=1, note='mock')

@app.route('/vision/detect')
def detect():
    return jsonify(status='detected', objects=[
        {'object': 'person', 'confidence': 0.92, 'bbox': [100, 50, 300, 400]},
        {'object': 'cup', 'confidence': 0.85, 'bbox': [400, 200, 450, 300]},
    ])

@app.route('/vision/faces')
def faces():
    return jsonify(status='detected', faces=[
        {'bbox': [120, 60, 280, 250], 'encoding_hash': 12345678}
    ])

@app.route('/face', methods=['POST'])
def face():
    return jsonify(status='set',
                   expression=(request.json or {}).get('expression', 'neutral'))

@app.route('/reach', methods=['POST'])
def reach():
    d = request.json or {}
    return jsonify(status='reached', x=d.get('x'), y=d.get('y'))

@app.route('/e-stop', methods=['POST'])
def e_stop():
    state['e_stopped'] = True
    return jsonify(status='e-stopped')

@app.route('/e-stop/reset', methods=['POST'])
def e_stop_reset():
    state['e_stopped'] = False
    return jsonify(status='reset')

if __name__ == '__main__':
    print("Mock humanoid on :5050")
    app.run(port=5050)`}</CodeBlock>

          <h3>Test the Full Loop</h3>
          <CodeBlock lang="bash">{`# Terminal 1: Mock bridge
python3 mock_humanoid.py

# Terminal 2: OrcBot
ROBOT_BRIDGE_URL=http://localhost:5050 npm run dev

# Terminal 3: Test via Telegram
# "Wave at me"
# "Say hello and smile"
# "Walk forward 3 steps, then look around"
# "Sign 'thank you' in sign language"
# "What do you see? Describe the objects in front of you"
# "Switch to companion mode and have a conversation"`}</CodeBlock>
        </section>

        {/* ── H16. Deployment ──────────────────────────────── */}
        <section className="content-section" id="h-deploy">
          <div className="content-section-label">Production</div>
          <h2>Deployment &amp; Operation</h2>

          <h3>Systemd Services</h3>
          <CodeBlock lang="ini">{`# /etc/systemd/system/humanoid-bridge.service
[Unit]
Description=OrcBot Humanoid Motion Controller
After=network.target

[Service]
Type=simple
User=root
WorkingDirectory=/home/pi/humanoid-bridge
ExecStart=/home/pi/humanoid-env/bin/python motion_controller.py
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target`}</CodeBlock>

          <CodeBlock lang="ini">{`# /etc/systemd/system/orcbot-humanoid.service
[Unit]
Description=OrcBot AI Brain (Humanoid)
After=network.target humanoid-bridge.service
Wants=humanoid-bridge.service

[Service]
Type=simple
User=pi
WorkingDirectory=/home/pi/orcbot
ExecStart=/usr/bin/node dist/cli/index.js start
Environment=ROBOT_BRIDGE_URL=http://localhost:5050
Restart=always

[Install]
WantedBy=multi-user.target`}</CodeBlock>

          <CodeBlock lang="bash">{`sudo systemctl daemon-reload
sudo systemctl enable humanoid-bridge orcbot-humanoid
sudo systemctl start humanoid-bridge orcbot-humanoid

# Monitor
sudo journalctl -u humanoid-bridge -f
sudo journalctl -u orcbot-humanoid -f`}</CodeBlock>

          <h3>Daily Operation Checklist</h3>
          <div className="test-checklist">
            {[
              'Check battery voltage — charge if below 10.5V (for 3S LiPo)',
              'Inspect servo connections — no loose wires',
              'Run curl http://localhost:5050/health — confirm bridge is up',
              'Test E-stop button — verify it cuts servo power',
              'Run a simple pose test: curl -X POST localhost:5050/pose -d \'{"name":"wave"}\'',
              'Verify Telegram connection — send a test message to the bot',
            ].map((item, i) => (
              <div className="test-check" key={i}>
                <span className="test-check-icon">✓</span>
                <span>{item}</span>
              </div>
            ))}
          </div>
        </section>

        {/* ── H17. Troubleshooting ─────────────────────────── */}
        <section className="content-section" id="h-troubleshoot">
          <div className="content-section-label">Reference</div>
          <h2>Troubleshooting</h2>

          <div className="trouble-table-wrap">
            <table className="trouble-table">
              <thead><tr><th>Problem</th><th>Cause</th><th>Fix</th></tr></thead>
              <tbody>
                {[
                  ['Servo jitters/buzzes', 'Insufficient power or noisy supply', 'Use dedicated servo power supply, add 100µF capacitor per servo group'],
                  ['Robot tips over', 'Center of mass too high', 'Move battery lower, add ankle weights, reduce walk speed'],
                  ['Servos overheat', 'Holding heavy load at extreme angle', 'Reduce hold time, add counterweights, use higher-torque servos'],
                  ['PCA9685 not detected', 'I2C not enabled or wrong address', 'Run i2cdetect -y 1, enable I2C in raspi-config, check A0 solder bridge'],
                  ['Speech unclear', 'Speaker too quiet or distorted', 'Add amplifier module, reduce TTS speed, use pico2wave over espeak'],
                  ['Vosk slow on Pi', 'Model too large', 'Use vosk-model-small-en-us (~40MB), upgrade to Pi 5 or Jetson'],
                  ['YOLO too slow', 'Pi 4 can\'t run fast enough', 'Use yolov8n (nano), drop to 320px input, or use Jetson Nano with GPU'],
                  ['Walk is unstable', 'Gait timing or weight shift wrong', 'Slow down, increase weight-shift phase, add foot force sensors'],
                  ['Sign is incorrect', 'Wrong servo mapping', 'Recalibrate joint centers, test each arm joint range individually'],
                  ['E-stop doesn\'t work', 'Switch not wired correctly', 'E-stop must be in series with servo power, NOT the SBC power'],
                ].map((r, i) => (
                  <tr key={i}><td>{r[0]}</td><td>{r[1]}</td><td>{r[2]}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        {/* ── H18. Resources ───────────────────────────────── */}
        <section className="content-section" id="h-resources">
          <div className="content-section-label">Reference</div>
          <h2>Resources &amp; Community</h2>

          <h3>Humanoid Platforms</h3>
          <div className="resources-grid">
            {[
              { title: 'InMoov', desc: 'Open-source 3D-printable humanoid robot', url: 'https://inmoov.fr/' },
              { title: 'Robotis OP3', desc: 'Research-grade humanoid kit with ROS support', url: 'https://emanual.robotis.com/docs/en/platform/op3/introduction/' },
              { title: 'Hiwonder TonyPi', desc: 'Affordable humanoid kit with serial bus servos', url: 'https://www.hiwonder.com/' },
            ].map((r, i) => (
              <a className="resource-card" href={r.url} target="_blank" rel="noopener noreferrer" key={i}>
                <h5>{r.title}</h5>
                <p>{r.desc}</p>
                <span className="resource-link">Visit →</span>
              </a>
            ))}
          </div>

          <h3>Software Libraries</h3>
          <div className="resources-grid">
            {[
              { title: 'MediaPipe', desc: 'Google\'s ML for hand/pose/face detection', url: 'https://mediapipe.dev/' },
              { title: 'Vosk STT', desc: 'Offline speech recognition', url: 'https://alphacephei.com/vosk/' },
              { title: 'Ultralytics YOLO', desc: 'State-of-the-art object detection', url: 'https://docs.ultralytics.com/' },
              { title: 'face_recognition', desc: 'Simple and accurate face recognition', url: 'https://github.com/ageitgey/face_recognition' },
            ].map((r, i) => (
              <a className="resource-card" href={r.url} target="_blank" rel="noopener noreferrer" key={i}>
                <h5>{r.title}</h5>
                <p>{r.desc}</p>
                <span className="resource-link">Visit →</span>
              </a>
            ))}
          </div>

          <h3>Learning &amp; Community</h3>
          <div className="resources-grid">
            {[
              { title: 'Robotics StackExchange', desc: 'Q&A for robotics engineering', url: 'https://robotics.stackexchange.com/' },
              { title: 'ROS2 Docs', desc: 'Robot Operating System framework', url: 'https://docs.ros.org/en/humble/' },
              { title: 'Adafruit Learning', desc: 'Electronics and servo tutorials', url: 'https://learn.adafruit.com/' },
            ].map((r, i) => (
              <a className="resource-card" href={r.url} target="_blank" rel="noopener noreferrer" key={i}>
                <h5>{r.title}</h5>
                <p>{r.desc}</p>
                <span className="resource-link">Visit →</span>
              </a>
            ))}
          </div>
        </section>

        {/* ── Humanoid Summary Banner ───────────────────────── */}
        <div className="summary-banner">
          <h2>You built a humanoid robotic companion.</h2>
          <p>A robot that walks, talks, sees, signs, and thinks — powered by OrcBot's AI brain. Here's what you now have:</p>
          <div className="summary-chips">
            {[
              { icon: '🦾', label: '22+ DOF Body' },
              { icon: '🗣️', label: 'Speech & Voice' },
              { icon: '🤟', label: 'Sign Language' },
              { icon: '👁️', label: 'Computer Vision' },
              { icon: '🧠', label: 'AI Cognition' },
              { icon: '🚶', label: 'Bipedal Walking' },
            ].map((c, i) => (
              <span className="summary-chip" key={i}>
                <span className="chip-icon">{c.icon}</span>
                {c.label}
              </span>
            ))}
          </div>
        </div>

        </>)}

        {/* ── Shared Footer ─────────────────────────────────── */}
        <div className="cta-actions" style={{ textAlign: 'center', padding: '40px 0' }}>
          <a className="btn btn-primary btn-lg" href="https://github.com/fredabila/orcbot" target="_blank" rel="noopener noreferrer">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z" /></svg>
            Star on GitHub
          </a>
          <Link className="btn btn-outline btn-lg" to="/">
            Back to Home
          </Link>
        </div>

        {/* ── Footer ───────────────────────────────────────── */}
        <div className="footer-links">
          <a href="https://github.com/fredabila/orcbot" target="_blank" rel="noopener noreferrer">GitHub</a>
          <Link to="/">Home</Link>
          <Link to="/deploy">Deploy</Link>
          <a href="https://fredabila.github.io/orcbot/docs/" target="_blank" rel="noopener noreferrer">Documentation</a>
        </div>
      </main>

      <footer>
        <p>&copy; {new Date().getFullYear()} OrcBot Project. Built for the autonomous era.</p>
      </footer>
    </div>
  );
}
