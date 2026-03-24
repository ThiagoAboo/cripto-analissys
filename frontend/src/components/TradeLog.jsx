import React from 'react';

export default function TradeLog({ logs }) {
  const visibleLogs = logs.slice(0, 20);

  return (
    <div
      style={{
        backgroundColor: '#1e1e1e',
        padding: '20px',
        borderRadius: '10px',
        border: '1px solid #333',
      }}
    >
      <h4 style={{ margin: '0 0 15px 0', color: '#888' }}>
        Operações ({visibleLogs.length})
      </h4>

      <div
        className="custom-scroll"
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: '8px',
          maxHeight: '400px',
          overflowY: 'auto',
        }}
      >
        {visibleLogs.length === 0 && (
          <div style={{ color: '#555', fontSize: '0.8rem' }}>Aguardando...</div>
        )}

        {visibleLogs.map((log, i) => {
          const isBuy = log.includes('[COMPRA]');
          const isSell = log.includes('[VENDA]');

          return (
            <div
              key={i}
              style={{
                fontSize: '0.75rem',
                padding: '10px',
                borderRadius: '6px',
                backgroundColor: '#161616',
                borderLeft: `4px solid ${
                  isBuy ? '#00ff88' : isSell ? '#ff4444' : '#666'
                }`,
                color: '#eee',
              }}
            >
              {log}
            </div>
          );
        })}
      </div>
    </div>
  );
}