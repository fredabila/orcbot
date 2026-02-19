import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Routes, Route } from 'react-router-dom'
import './index.css'
import App from './App.tsx'
import Deploy from './pages/Deploy.tsx'
import Robotics from './pages/Robotics.tsx'
import Skills from './pages/Skills.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<App />} />
        <Route path="/deploy" element={<Deploy />} />
        <Route path="/robotics" element={<Robotics />} />
        <Route path="/skills" element={<Skills />} />
      </Routes>
    </BrowserRouter>
  </StrictMode>,
)
