import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import Header from '../components/Header';
import '../index.css';
import './SelfTraining.css';

const phases = [
  {
    title: '1. Capture',
    desc: 'Completed actions are converted into redacted trajectories. OrcBot keeps the task, tool sequence, delivery audit, and final user-facing answer, but strips secrets before persistence.'
  },
  {
    title: '2. Filter',
    desc: 'Only accepted trajectories survive into the training export. Status-only chatter, unresolved failures, and low-quality runs are stored for analysis but rejected from the dataset.'
  },
  {
    title: '3. Prepare',
    desc: 'When enough accepted examples exist, OrcBot writes a deterministic training manifest and JSONL export. This stays offline-safe: no live weight mutation happens here.'
  },
  {
    title: '4. Evaluate',
    desc: 'Candidate models are measured against accepted trajectories. The current evaluation runner scores lexical overlap and response fit so promotions are gated on evidence instead of optimism.'
  },
  {
    title: '5. Promote',
    desc: 'Admins explicitly register a trained candidate, review the evaluation, and promote it into OrcBot’s standard model configuration. Promotion is recorded with the previous model for rollback clarity.'
  }
];

const artifacts = [
  'self-training-trajectories.json: durable capture store',
  'self-training-trajectories.jsonl: accepted examples only',
  'self-training-job.json: offline job manifest',
  'self-training-eval-report.json: evaluation evidence',
  'self-training-launch.json: background launch audit',
  'self-training-candidates.json: registered model candidates',
  'self-training-promotion.json: latest promotion record'
];

const commands = [
  'get_self_training_status()',
  'prepare_self_training_job()',
  'run_self_training_eval(limit?, provider?, modelName?)',
  'build_self_training_launch_plan(commandTemplate?, cwd?, sessionId?)',
  'launch_self_training_job(commandTemplate?, cwd?, sessionId?, dryRun?)',
  'register_self_training_candidate(modelName, provider?, candidateId?, jobId?, notes?)',
  'promote_self_training_candidate(candidateId?, modelName?, provider?, dryRun?)'
];

const configSnippet = `selfTrainingEnabled: true
selfTrainingTrainOnIdle: true
selfTrainingMinQualityScore: 0.72
selfTrainingMinAcceptedExamples: 25
selfTrainingEvalPassThreshold: 0.55
selfTrainingPromotionMinAverageScore: 0.70
selfTrainingRequireEvalForPromotion: true
selfTrainingLaunchCommand: python trainer.py --manifest {jobManifestPath} --export {exportPath} --model {modelName}`;

export default function SelfTraining() {
  useEffect(() => {
    window.scrollTo(0, 0);
    document.title = 'Self-Training Sidecar — OrcBot';
  }, []);

  return (
    <div className="app self-training-page">
      <div className="bg-gradient-orbs" />
      <div className="noise-overlay" />

      <Header scrolled={true} />

      <main className="section-inner self-training-shell">
        <header className="self-training-hero">
          <div>
            <div className="section-label">Self-Training Sidecar</div>
            <h1 className="self-training-title">Teach OrcBot from real work without mutating the live model in place.</h1>
            <p className="section-desc self-training-lead">
              OrcBot now captures successful trajectories while it works, prepares offline training datasets, evaluates trained candidates,
              and lets admins promote stronger models through the normal config path. The design is intentionally conservative: offline first,
              redacted by default, and promotion-gated by evaluation evidence.
            </p>
            <div className="self-training-actions">
              <a className="btn btn-primary btn-lg" href="https://github.com/fredabila/orcbot" target="_blank" rel="noopener noreferrer">View the code</a>
              <Link className="btn btn-outline btn-lg" to="/deploy">Deploy OrcBot</Link>
            </div>
          </div>

          <aside className="self-training-panel">
            <span className="st-panel-kicker">Operating Principle</span>
            <h2>Capture → Filter → Prepare → Evaluate → Promote</h2>
            <p>
              This is not online fine-tuning inside the action loop. OrcBot separates learning data production from model rollout so failed or noisy actions cannot silently corrupt the live runtime.
            </p>
          </aside>
        </header>

        <section className="self-training-grid-section">
          <div className="section-header-left">
            <div className="section-label">Pipeline</div>
            <h2 className="section-title">A closed loop with hard safety edges.</h2>
          </div>
          <div className="self-training-grid">
            {phases.map((phase) => (
              <article key={phase.title} className="self-training-card">
                <h3>{phase.title}</h3>
                <p>{phase.desc}</p>
              </article>
            ))}
          </div>
        </section>

        <section className="self-training-columns">
          <article className="self-training-column">
            <div className="section-label">What Gets Written</div>
            <h2 className="section-title">Artifacts you can inspect directly.</h2>
            <ul className="self-training-list">
              {artifacts.map((artifact) => (
                <li key={artifact}>{artifact}</li>
              ))}
            </ul>
          </article>

          <article className="self-training-column">
            <div className="section-label">Admin Surface</div>
            <h2 className="section-title">Skills for the training lifecycle.</h2>
            <ul className="self-training-list self-training-code-list">
              {commands.map((command) => (
                <li key={command}><code>{command}</code></li>
              ))}
            </ul>
          </article>
        </section>

        <section className="self-training-deep-dive">
          <div className="section-header-left">
            <div className="section-label">Why This Design</div>
            <h2 className="section-title">Live model mutation is the wrong default.</h2>
          </div>
          <div className="deep-dive-copy">
            <p>
              OrcBot already learns operationally through memory, journals, configuration tuning, and plugin creation. Weight training is different: it changes the model substrate itself.
              That is why the self-training system is built as a sidecar. The agent can produce high-quality examples during normal work, but those examples only become a candidate model after an offline step and an explicit promotion.
            </p>
            <p>
              The current evaluation pass is intentionally deterministic and cheap. It is not a full benchmark harness, but it is enough to block obvious regressions and create a promotion paper trail.
              Once a candidate is registered, admins can promote it with a dry run first, inspect the exact config change, and then switch the runtime model through OrcBot’s existing hot-reload path.
            </p>
          </div>
        </section>

        <section className="self-training-config">
          <div className="section-label">Configuration</div>
          <h2 className="section-title">Baseline settings.</h2>
          <pre className="self-training-pre"><code>{configSnippet}</code></pre>
        </section>

        <section className="self-training-cta">
          <div className="cta-glow" />
          <div className="cta-inner">
            <div className="cta-badge">Production-minded autonomy</div>
            <h2>Train from evidence, not from vibes.</h2>
            <p>Use the sidecar to collect data continuously, then promote only when the candidate has earned it.</p>
            <div className="cta-actions">
              <a className="btn btn-primary btn-lg" href="https://github.com/fredabila/orcbot/blob/main/README.md" target="_blank" rel="noopener noreferrer">Read the README</a>
              <Link className="btn btn-outline btn-lg" to="/">Back Home</Link>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}