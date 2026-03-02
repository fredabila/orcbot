import React, { useState } from 'react';

const Blueprints = [
  {
    id: 'researcher',
    name: 'The Lead Researcher',
    icon: '🔍',
    description: 'Expert web browsing, deep information ingestion, and long-term memory analysis.',
    features: ['Web Search & Browse', 'RAG Knowledge Store', 'Source Citations', 'Deep Synthesis'],
    price: '$19/mo'
  },
  {
    id: 'architect',
    name: 'The Code Architect',
    icon: '💻',
    description: 'Autonomous scripting, file management, and technical system automation.',
    features: ['Direct Command Line', 'File/Script Generation', 'Sudo Elevation', 'Architecture Planning'],
    price: '$49/mo'
  },
  {
    id: 'assistant',
    name: 'The Executive Assistant',
    icon: '📅',
    description: 'Email management, scheduling, and personal administrative efficiency.',
    features: ['Inbox Zero Management', 'Calendar Syncing', 'Daily Briefings', 'Personal Memory'],
    price: '$29/mo'
  }
];

const SaaSPage: React.FC = () => {
  const [selectedBlueprint, setSelectedBlueprint] = useState<string | null>(null);
  const [formData, setFormData] = useState({ name: '', token: '', userId: '' });
  const [status, setStatus] = useState<string | null>(null);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setStatus('Provisioning your bot... Please check your terminal to finalize.');
    console.log('SaaS Provisioning Request:', { ...formData, blueprint: selectedBlueprint });
    
    // In a real SaaS, this would call your backend API which runs saas/provision.ts
    // For this blueprint, we simulate the request.
  };

  return (
    <div style={{ maxWidth: '1000px', margin: '40px auto', padding: '20px', fontFamily: 'sans-serif', color: '#333' }}>
      <header style={{ textAlign: 'center', marginBottom: '60px' }}>
        <h1 style={{ fontSize: '2.5rem', marginBottom: '10px' }}>OrcBot SaaS Farm</h1>
        <p style={{ fontSize: '1.2rem', color: '#666' }}>Deploy your own 24/7 autonomous AI employee in seconds.</p>
      </header>

      <section style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '30px', marginBottom: '60px' }}>
        {Blueprints.map((bp) => (
          <div 
            key={bp.id} 
            onClick={() => setSelectedBlueprint(bp.id)}
            style={{ 
              border: `2px solid ${selectedBlueprint === bp.id ? '#007bff' : '#eee'}`,
              borderRadius: '12px',
              padding: '25px',
              cursor: 'pointer',
              transition: 'transform 0.2s, box-shadow 0.2s',
              backgroundColor: selectedBlueprint === bp.id ? '#f0f7ff' : '#fff',
              boxShadow: '0 4px 6px rgba(0,0,0,0.05)'
            }}
          >
            <div style={{ fontSize: '3rem', marginBottom: '15px' }}>{bp.icon}</div>
            <h3 style={{ fontSize: '1.5rem', marginBottom: '10px' }}>{bp.name}</h3>
            <p style={{ color: '#555', marginBottom: '20px', lineHeight: '1.5' }}>{bp.description}</p>
            <div style={{ marginBottom: '20px' }}>
              {bp.features.map(f => (
                <div key={f} style={{ fontSize: '0.9rem', marginBottom: '5px', color: '#444' }}>✅ {f}</div>
              ))}
            </div>
            <div style={{ fontSize: '1.2rem', fontWeight: 'bold', color: '#007bff' }}>{bp.price}</div>
          </div>
        ))}
      </section>

      {selectedBlueprint && (
        <section style={{ backgroundColor: '#f9f9f9', padding: '40px', borderRadius: '15px', border: '1px solid #ddd' }}>
          <h2 style={{ marginBottom: '30px' }}>Provision Your {selectedBlueprint.charAt(0).toUpperCase() + selectedBlueprint.slice(1)} Bot</h2>
          
          <form onSubmit={handleSubmit} style={{ display: 'grid', gap: '20px' }}>
            <div>
              <label style={{ display: 'block', marginBottom: '8px', fontWeight: 'bold' }}>Your Name / Organization</label>
              <input 
                type="text" 
                required 
                placeholder="e.g. Frederick's Studio"
                style={{ width: '100%', padding: '12px', borderRadius: '8px', border: '1px solid #ccc' }}
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              />
            </div>
            
            <div>
              <label style={{ display: 'block', marginBottom: '8px', fontWeight: 'bold' }}>Telegram Bot Token</label>
              <input 
                type="password" 
                required 
                placeholder="7728349182:AAF9..."
                style={{ width: '100%', padding: '12px', borderRadius: '8px', border: '1px solid #ccc' }}
                value={formData.token}
                onChange={(e) => setFormData({ ...formData, token: e.target.value })}
              />
              <small style={{ color: '#888' }}>Create your token via @BotFather on Telegram.</small>
            </div>

            <div>
              <label style={{ display: 'block', marginBottom: '8px', fontWeight: 'bold' }}>Your Personal Telegram ID</label>
              <input 
                type="text" 
                required 
                placeholder="8077489121"
                style={{ width: '100%', padding: '12px', borderRadius: '8px', border: '1px solid #ccc' }}
                value={formData.userId}
                onChange={(e) => setFormData({ ...formData, userId: e.target.value })}
              />
              <small style={{ color: '#888' }}>Message @userinfobot to find your unique ID.</small>
            </div>

            <button 
              type="submit"
              style={{ 
                backgroundColor: '#007bff', 
                color: '#fff', 
                padding: '15px', 
                borderRadius: '8px', 
                border: 'none', 
                fontSize: '1.1rem', 
                fontWeight: 'bold',
                cursor: 'pointer',
                marginTop: '10px'
              }}
            >
              Deploy My Bot Now
            </button>
          </form>

          {status && (
            <div style={{ marginTop: '20px', padding: '15px', backgroundColor: '#d4edda', color: '#155724', borderRadius: '8px' }}>
              {status}
            </div>
          )}
        </section>
      )}

      <footer style={{ marginTop: '80px', textAlign: 'center', color: '#888', fontSize: '0.9rem' }}>
        Powered by OrcBot Autonomous Engine &copy; 2026
      </footer>
    </div>
  );
};

export default SaaSPage;
