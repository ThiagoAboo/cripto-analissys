import React from 'react';

export default function SettingsModal({ isOpen, onClose, settings }) {
  if (!isOpen) return null;

  const {
    fee, riskPct, trailStop, takeProfit, bnbReserve,
    minVol, aiSettings, setAiSettings,
    setFee, setRiskPct, setTrailStop, setTakeProfit, setBnbReserve, setMinVol
  } = settings;

  const handleNumberInput = (setter, min, max) => (e) => {
    let val = Number(e.target.value);
    if (isNaN(val)) val = min;
    if (val < min) val = min;
    if (max !== undefined && val > max) val = max;
    setter(val);
  };

  return (
    <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.85)', zIndex: 9999, display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
      <div style={{ backgroundColor: '#1e1e1e', padding: '30px', borderRadius: '12px', width: '90%', maxWidth: '800px', border: '1px solid #444', position: 'relative' }}>
        <button onClick={onClose} style={{ position: 'absolute', top: '15px', right: '20px', background: 'transparent', border: 'none', color: '#fff', fontSize: '1.5rem', cursor: 'pointer' }}>✖</button>
        <h2 style={{ margin: '0 0 20px 0', color: '#00d2ff' }}>⚙️ Configurações do Cockpit</h2>
        
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '20px' }}>
          <div style={{ background: '#161616', padding: '15px', borderRadius: '8px', border: '1px solid #333' }}>
            <h4 style={{ margin: '0 0 10px 0', color: '#888' }}>💰 Financeiro & Risco</h4>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              <label style={{ fontSize: '0.8rem' }}>
                Taxa Corretora (%) 
                <input type="number" value={fee} onChange={handleNumberInput(setFee, 0, 10)} step="0.01" style={{ width: '100%', background: '#121212', border: '1px solid #444', color: '#fff', padding: '5px', marginTop: '5px' }} />
              </label>
              <label style={{ fontSize: '0.8rem' }}>
                Risco por Trade (%) 
                <input type="number" value={riskPct} onChange={handleNumberInput(setRiskPct, 0.1, 100)} step="0.5" style={{ width: '100%', background: '#121212', border: '1px solid #444', color: '#fff', padding: '5px', marginTop: '5px' }} />
              </label>
              <label style={{ fontSize: '0.8rem' }}>
                Trailing Stop (%) 
                <input type="number" value={trailStop} onChange={handleNumberInput(setTrailStop, 0.1, 50)} step="0.5" style={{ width: '100%', background: '#121212', border: '1px solid #444', color: '#fff', padding: '5px', marginTop: '5px' }} />
              </label>
              <label style={{ fontSize: '0.8rem' }}>
                Take Profit (%) 
                <input type="number" value={takeProfit} onChange={handleNumberInput(setTakeProfit, 0.1, 100)} step="0.5" style={{ width: '100%', background: '#121212', border: '1px solid #444', color: '#fff', padding: '5px', marginTop: '5px' }} />
              </label>
              <label style={{ fontSize: '0.8rem' }}>
                Reserva BNB (Qtd) 
                <input type="number" value={bnbReserve} onChange={handleNumberInput(setBnbReserve, 0, 1000)} step="0.1" style={{ width: '100%', background: '#121212', border: '1px solid #444', color: '#fff', padding: '5px', marginTop: '5px' }} />
              </label>
            </div>
          </div>

          <div style={{ background: '#161616', padding: '15px', borderRadius: '8px', border: '1px solid #333' }}>
            <h4 style={{ margin: '0 0 10px 0', color: '#888' }}>🧠 Motor de Inteligência Artificial</h4>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              <label style={{ fontSize: '0.8rem', color: '#ff9900' }}>
                Volatilidade Mín. p/ Compra (%) 
                <input type="number" value={minVol} onChange={handleNumberInput(setMinVol, 0, 20)} step="0.05" style={{ width: '100%', background: '#121212', border: '1px solid #444', color: '#fff', padding: '5px', marginTop: '5px' }} />
              </label>
              <label style={{ fontSize: '0.8rem' }}>
                Tempo de Raciocínio (Seg) 
                <input type="number" value={aiSettings.interval} onChange={e => setAiSettings({...aiSettings, interval: Math.max(5, Number(e.target.value))})} step="5" min="10" style={{ width: '100%', background: '#121212', border: '1px solid #444', color: '#fff', padding: '5px', marginTop: '5px' }} />
              </label>
              <label style={{ fontSize: '0.8rem' }}>
                Agressividade (Peso Compra) 
                <input type="number" value={aiSettings.agressivity} onChange={e => setAiSettings({...aiSettings, agressivity: Math.max(0.5, Number(e.target.value))})} step="0.5" style={{ width: '100%', background: '#121212', border: '1px solid #444', color: '#fff', padding: '5px', marginTop: '5px' }} />
              </label>
              <label style={{ fontSize: '0.8rem' }}>
                Profundidade da Árvore (Depth) 
                <input type="number" value={aiSettings.depth} onChange={e => setAiSettings({...aiSettings, depth: Math.min(15, Math.max(1, Number(e.target.value)))})} step="1" style={{ width: '100%', background: '#121212', border: '1px solid #444', color: '#fff', padding: '5px', marginTop: '5px' }} />
              </label>
              <label style={{ fontSize: '0.8rem', display: 'flex', alignItems: 'center', gap: '10px', marginTop: '10px' }}>
                <input type="checkbox" checked={aiSettings.useEma} onChange={e => setAiSettings({...aiSettings, useEma: e.target.checked})} />
                Trava de Inverno - Bloquear se menor EMA 200
              </label>
            </div>
          </div>
        </div>
        <button onClick={onClose} style={{ width: '100%', padding: '15px', marginTop: '20px', backgroundColor: '#00ff88', color: '#000', border: 'none', borderRadius: '8px', fontWeight: 'bold', fontSize: '1rem', cursor: 'pointer' }}>Salvar & Fechar</button>
      </div>
    </div>
  );
}