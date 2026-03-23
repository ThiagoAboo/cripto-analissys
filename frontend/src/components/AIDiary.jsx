import React from 'react';

export default function AIDiary({ reasonsLog, selectedCoins }) {
  return (
    <div style={{ backgroundColor: '#1e1e1e', padding: '20px', borderRadius: '10px', border: '1px solid #333' }}>
      <h4 style={{ margin: '0 0 15px 0', color: '#888' }}>🧠 Diário IA</h4>
      <div className="custom-scroll" style={{ display: 'flex', flexDirection: 'column', gap: '10px', maxHeight: '300px', overflowY: 'auto' }}>
        {Object.keys(reasonsLog).length === 0 && <div style={{ color: '#555', fontSize: '0.8rem' }}>Aguardando Cérebro...</div>}
        {Object.entries(reasonsLog).filter(([sym]) => selectedCoins.some(c => c.value === sym)).map(([sym, data]) => (
          <div key={sym} style={{ backgroundColor: '#161616', padding: '10px', borderRadius: '6px', border: '1px solid #2a2a2a' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '5px' }}>
              <strong style={{ color: '#ff9900', fontSize: '0.8rem' }}>{sym}</strong>
              <span style={{ fontSize: '0.75rem', color: '#666' }}>{data.time}</span>
            </div>
            <div style={{ fontSize: '0.75rem', color: data.signal === 'COMPRAR' ? '#00ff88' : '#ff4444', fontWeight: 'bold' }}>
              ➔ {data.signal}
            </div>
            <div style={{ fontSize: '0.7rem', color: '#aaa', fontStyle: 'italic', marginTop:'5px' }}>
              {data.reasons ? data.reasons.join(' | ') : '...'}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}