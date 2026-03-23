import React from 'react';
import { LineChart, Line, ResponsiveContainer } from 'recharts';

export default function WalletPanel({ formatMoney, totalPortfolioValue, pnlPct, equityHistory, winRate, tradesFechados, wallet, baseCurrency }) {
  const scrollListStyle = { marginTop: '10px', padding: '5px', maxHeight: '80px', overflowY: 'auto', fontSize: '0.72rem', borderTop: '1px solid #333', backgroundColor: '#161616', borderRadius: '4px' };

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '20px', marginBottom: '20px' }}>
      <div style={{ backgroundColor: '#1e1e1e', padding: '15px 20px', borderRadius: '10px', border: '1px solid #333', height: '165px', display: 'flex', flexDirection: 'column', position: 'relative', overflow: 'hidden' }}>
        <div style={{ position: 'relative', zIndex: 10 }}>
          <span style={{ color: '#888', fontSize: '0.9rem' }}>Patrimônio Total</span>
          <h2 style={{ margin: '2px 0' }}>{formatMoney(totalPortfolioValue)}</h2>
          <span style={{ color: pnlPct >= 0 ? '#00ff88' : '#ff4444', fontWeight: 'bold', fontSize: '0.85rem' }}>PnL: {pnlPct >= 0 ? '+' : ''}{pnlPct.toFixed(2)}%</span>
        </div>
        <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: '75px', zIndex: 1, opacity: 0.35 }}>
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={equityHistory}>
              <Line type="monotone" dataKey="value" stroke={pnlPct >= 0 ? "#00ff88" : "#ff4444"} strokeWidth={3} dot={false} isAnimationActive={true} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div style={{ backgroundColor: '#1e1e1e', padding: '20px', borderRadius: '10px', border: '1px solid #333', height: '165px', display: 'flex', flexDirection: 'column' }}>
        <span style={{ color: '#888', fontSize: '0.9rem' }}>Estratégia Ativa</span>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '5px' }}>
          <div style={{ color: '#00ff88', fontWeight: 'bold', fontSize: '0.85rem' }}>Win: {winRate.toFixed(1)}%</div>
          <div style={{ fontSize: '0.75rem', color: '#666' }}>{tradesFechados.length} trades</div>
        </div>
        <div className="custom-scroll" style={scrollListStyle}>
          {tradesFechados.length === 0 ? <div style={{ color: '#555', fontStyle: 'italic' }}>Aguardando...</div> : tradesFechados.map((trade, i) => (
            <div key={i} style={{ padding: '3px 0', borderBottom: '1px solid #222', color: trade.includes('+') ? '#00ff88' : '#ff4444', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {trade.split('|')[0].replace('🔴 [VENDA] ', '')} | {trade.split('|')[1]}
            </div>
          ))}
        </div>
      </div>

      <div style={{ backgroundColor: '#1e1e1e', padding: '20px', borderRadius: '10px', border: '1px solid #333', height: '165px', display: 'flex', flexDirection: 'column' }}>
        <span style={{ color: '#888', fontSize: '0.9rem' }}>Caixa Livre ({baseCurrency})</span>
        <h2 style={{ margin: '5px 0' }}>{formatMoney(wallet.quote)}</h2>
        <div className="custom-scroll" style={scrollListStyle}>
          {Object.keys(wallet.balances).filter(c => wallet.balances[c] > 0).length === 0 ? <div style={{ color: '#555', fontStyle: 'italic' }}>Estoque Vazio.</div> : Object.entries(wallet.balances).map(([coin, amount]) => (
            amount > 0 && <div key={coin} style={{ display: 'flex', justifyContent: 'space-between', padding: '3px 0', borderBottom: '1px solid #222' }}>
              <span style={{ color: '#ff9900', fontWeight: 'bold' }}>{coin.replace(baseCurrency, '')}</span>
              <span style={{ color: '#aaa' }}>{amount.toFixed(6)}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}