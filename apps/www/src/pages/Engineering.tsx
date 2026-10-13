import React, { useEffect } from 'react';
import Header from '../components/Header';
import '../index.css';
import './Engineering.css';

const Engineering = () => {
  useEffect(() => {
    window.scrollTo(0, 0);
    document.title = "Engineering Autonomy, OrcBot";
  }, []);

  const domains = [
    {
      title: 'Structural & Civil', desc: 'Orchestrating stress simulations, material sourcing, and compliance checks across global standards.', details: ['BIM Integration', 'Automated Compliance', 'Resource Optimization']
    }, {
      title: 'Mechanical & CAD', desc: 'Automating iterative design cycles. Let agents refine tolerances and run CFD simulations in parallel.', details: ['Generative Design', 'Tolerance Analysis', 'PLM Management']
    }, {
      title: 'Electrical & Systems', desc: 'Managing complex PCB layouts and power distribution logic with deterministic skill-based routing.', details: ['Circuit Validation', 'Power Analysis', 'FPGA Workflows']
    }, {
      title: 'Chemical & Bio', desc: 'Accelerating molecular discovery by orchestrating lab automation and synthesis planning.', details: ['Process Simulation', 'Safety Monitoring', 'Yield Optimization']
    }
  ];

  const technicalPillars = [
    {
      title: 'Deterministic Skills', subtitle: 'The Precision Layer', desc: 'Standard LLMs are probabilistic, they "guess" the next token. In engineering, guessing is failure. OrcBot offloads physical calculations to deterministic Skills (Python/C++/Rust) to ensure 1+1 always equals 2.'
    }, {
      title: 'Simulation Loop (HIL/SIL)', subtitle: 'Continuous Verification', desc: 'OrcBot orchestrates Hardware-in-the-Loop and Software-in-the-Loop simulations. Agents trigger FEA runs, parse results, adjust CAD geometry, and re-run simulations autonomously until safety factors are met.'
    }, {
      title: 'Protocol Orchestration', subtitle: 'Industrial Interoperability', desc: 'Native support for industrial protocols. OrcBot agents communicate with PLC systems via Modbus, OPC-UA, or ROS2, acting as the intelligent bridge to physical machine execution.'
    }
  ];

  const workflows = [
    {
      title: 'Generative Design Refinement', steps: [
        'Agent receives high-level load constraints and volume bounds.', 'Initial geometry is generated via specialized CAD-API skill.', 'SaaS Farm agents run parallel CFD (Fluid Dynamics) and Thermal simulations.', 'Agent analyzes "hot spots" and modifies the mesh topology.', 'Loop continues until weight is minimized and safety factor > 2.0.'
      ]
    }, {
      title: 'Autonomous Compliance & Safety', steps: [
        'Agent monitors live sensor data from a structural health system.', 'Anomalies trigger a "Deep Investigation" task.', 'Agent scrapes local building codes and historical maintenance logs.', 'Autonomous "Damage-Assessment" skill runs a stress-recalculation.', 'If risk is detected, agent orchestrates a maintenance ticket and alerts stakeholders.'
      ]
    }
  ];

  const deepDivePrompts = [
    {
      title: 'Thermal Management Optimization', context: 'Aerospace / Electronics', prompt: 'Analyze the current PCB layout for the flight controller. Given a peak power of 45W, determine if the existing copper pour is sufficient for heat dissipation. If not, propose a heat-pipe routing strategy.', result: 'Parses Gerber files → Runs thermal-calc skill → Identifies 95C hot spot → Routes 4mm heat pipe.'
    }, {
      title: 'Material Science Discovery', context: 'R&D / Synthesis', prompt: 'Research breakthroughs in high-entropy alloys for hydrogen storage. Extract chemical composition of top 3 performing alloys and simulate storage capacity at 700 bar.', result: 'Scrapes ArXiv/PubMed → Extracts stoichiometry → Runs physics-sim skill → Renders performance graph.'
    }, {
      title: 'BIM-to-Field Synchronization', context: 'Civil Engineering', prompt: 'Compare as-built laser scan with original BIM model. Identify duct placement deviations > 5cm. Calculate impact on plumbing and update schedule.', result: 'Ingests point cloud → Aligns to BIM → Detects 8cm offset → Adjusts Gantt chart → Notifies plumbing lead.'
    }
  ];

  return (
    <div className="app engineering-page">
      <Header scrolled={true} />

      <main className="section-inner">
        <header className="eng-hero">
          <div className="section-label">Engineering the Future</div>
          <h1 className="hero-title">Precision. Autonomy. Scale.</h1>
          <p className="section-desc">
            Vague prompts don't build bridges. OrcBot provides the deterministic framework where
            high-level reasoning meets absolute physical precision.
          </p>
        </header>

        {/* ── Technical Pillars ── */}
        <section className="eng-pillars-section">
          <div className="section-header-centered">
            <h2 className="section-title">The Engineering Pillars</h2>
            <p className="section-desc">The foundation of autonomous industrial intelligence.</p>
          </div>
          <div className="pillars-grid">
            {technicalPillars.map((p, i) => (
              <div key={i} className="pillar-card">
                <div className="p-content">
                  <span className="p-subtitle">{p.subtitle}</span>
                  <h3>{p.title}</h3>
                  <p>{p.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* ── The Verification Loop (Visualization) ── */}
        <section className="verification-loop-section">
          <div className="loop-container">
            <div className="loop-copy">
              <h2 className="section-title">The "Closed-Loop" Engineering Cycle</h2>
              <p>OrcBot executes a rigorous, deterministic loop that ensures safety and accuracy at every step.</p>
              <div className="loop-steps">
                {['Intent Perception', 'Skill-Based Execution', 'Validation & Feedback', 'Physical Synchronization'].map((step, i) => (
                  <div key={i} className="loop-step-item">
                    <span className="step-num">{i + 1}</span>
                    <span className="step-text">{step}</span>
                  </div>
                ))}
              </div>
            </div>
            <div className="loop-visual">
              <div className="visual-orb">
              </div>
            </div>
          </div>
        </section>

        {/* ── Advanced Workflows ── */}
        <section className="eng-workflows-section">
          <div className="section-header-left">
            <div className="section-label">Operational Depth</div>
            <h2 className="section-title">Advanced Workflows</h2>
          </div>
          <div className="workflow-cards">
            {workflows.map((w, i) => (
              <div key={i} className="workflow-card">
                <h3>{w.title}</h3>
                <div className="workflow-steps">
                  {w.steps.map((step, j) => (
                    <div key={j} className="workflow-step">
                      <span className="dot" />
                      <p>{step}</p>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* ── Domains ── */}
        <section className="eng-grid">
          {domains.map((d, i) => (
            <div key={i} className="eng-card">
              <h3>{d.title}</h3>
              <p>{d.desc}</p>
              <ul className="eng-details">
                {d.details.map((item, j) => (
                  <li key={j}><span className="dot" /> {item}</li>
                ))}
              </ul>
            </div>
          ))}
        </section>

        {/* ── Prompt Book Deep Dive ── */}
        <section className="prompt-book-section">
          <div className="section-header-left">
            <div className="section-label">The Engineering Prompt Book</div>
            <h2 className="section-title">High-Signal Scenarios</h2>
            <p className="section-desc">Testing the boundaries of autonomous engineering.</p>
          </div>

          <div className="prompt-list">
            {deepDivePrompts.map((p, i) => (
              <div key={i} className="prompt-item">
                <div className="p-header">
                  <span className="p-context">{p.context}</span>
                  <h3>{p.title}</h3>
                </div>
                <div className="p-body">
                  <div className="p-block">
                    <span className="p-label">AUTONOMOUS GOAL</span>
                    <p className="p-text">"{p.prompt}"</p>
                  </div>
                  <div className="p-block highlight">
                    <span className="p-label">DETERMINISTIC PATHWAY</span>
                    <p className="p-text">{p.result}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>

        <section className="cta-section">
          <div className="cta-box">
            <h2>Bridge the gap between vision and reality.</h2>
            <p>Deploy OrcBot for your engineering team and start building the future today.</p>
            <a href="/deploy" className="btn btn-primary">Start Engineering</a>
          </div>
        </section>
      </main>

      <footer className="footer-simple">
        <p>&copy; {new Date().getFullYear()} OrcBot Project. Built for the autonomous era.</p>
      </footer>
    </div>
  );
};

export default Engineering;
