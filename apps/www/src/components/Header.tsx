import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';

interface HeaderProps {
  scrolled?: boolean;
}

const Header: React.FC<HeaderProps> = ({ scrolled: initialScrolled = false }) => {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [scrolled, setScrolled] = useState(initialScrolled);

  useEffect(() => {
    if (initialScrolled) return;
    const onScroll = () => setScrolled(window.scrollY > 20);
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, [initialScrolled]);

  return (
    <nav className={`nav ${scrolled ? 'nav-scrolled' : ''}`}>
      <Link to="/" className="logo" onClick={() => setMobileMenuOpen(false)}>
        <svg className="logo-mark" width="28" height="28" viewBox="0 0 28 28" fill="none">
          <rect width="28" height="28" rx="7" fill="#5cffb3" fillOpacity="0.15" />
          <path d="M8 14l4 4 8-8" stroke="#5cffb3" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"/>
          <circle cx="21" cy="7" r="2.5" fill="#5cffb3" />
        </svg>
        <span className="logo-text">OrcBot</span>
      </Link>

      <button className="mobile-toggle" onClick={() => setMobileMenuOpen(!mobileMenuOpen)} aria-label="Toggle menu">
        <span className={`hamburger ${mobileMenuOpen ? 'open' : ''}`} />
      </button>

      <div className={`nav-center ${mobileMenuOpen ? 'open' : ''}`}>
        <Link to="/" onClick={() => setMobileMenuOpen(false)}>Home</Link>
        <Link to="/skills" onClick={() => setMobileMenuOpen(false)}>Skills</Link>
        <Link to="/self-training" onClick={() => setMobileMenuOpen(false)}>Self-Training</Link>
        <Link to="/robotics" onClick={() => setMobileMenuOpen(false)}>Robotics</Link>
        <Link to="/engineering" onClick={() => setMobileMenuOpen(false)}>Engineering</Link>
        <Link to="/saas" onClick={() => setMobileMenuOpen(false)}>SaaS Farm</Link>
        <Link to="/deploy" onClick={() => setMobileMenuOpen(false)}>Deploy</Link>
        <a href="https://docs.orcbot.buzzchat.site/" target="_blank" rel="noopener noreferrer" onClick={() => setMobileMenuOpen(false)}>Docs</a>
      </div>

      <div className="nav-end">
        <a className="nav-btn ghost" href="https://docs.orcbot.buzzchat.site/" target="_blank" rel="noopener noreferrer">Docs</a>
        <a className="nav-btn primary" href="https://github.com/fredabila/orcbot" target="_blank" rel="noopener noreferrer">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor"><path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z"/></svg>
          GitHub
        </a>
      </div>
    </nav>
  );
};

export default Header;
