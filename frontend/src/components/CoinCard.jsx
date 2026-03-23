import React from 'react';
import Chart from '../Chart';
import AIPrediction from '../AIPrediction';

export default function CoinCard({ coin, currentData, orderBooks, getVar, formatMoney, showCharts, onAiUpdate, aiSettings }) {
  const d = currentData[coin.value];
  const book = orderBooks[coin.value];
  const v1m = getVar(coin.value, '1m');
  const v1h = getVar(coin.value, '1h');
  const v24h = getVar(coin.value, '1d');

  return (
    <div style={{ backgroundColor: '#1e1e1e', padding: '20px', borderRadius: '10px', border: '1px solid #333' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '10px' }}>
        <div>
          <h3 style={{ margin: 0, color: '#ff9900' }}>{coin.label}</h3>
          <div style={{ display: 'flex', gap: '10px', marginTop: '10px', fontSize: '0.75rem' }}>
            <span style={{ color: v1m >= 0 ? '#00ff88' : '#ff4444', backgroundColor: 'rgba(255,255,255,0.05)', padding: '4px 8px', borderRadius: '4px' }}>
              {v1m >= 0 ? '▲ subiu' : '▼ caiu'} {Math.abs(v1m)}%/min
            </span>
            <span style={{ color: v1h >= 0 ? '#00ff88' : '#ff4444', backgroundColor: 'rgba(255,255,255,0.05)', padding: '4px 8px', borderRadius: '4px' }}>
              {v1h >= 0 ? '▲ subiu' : '▼ caiu'} {Math.abs(v1h)}%/hora
            </span>
            <span style={{ color: v24h >= 0 ? '#00ff88' : '#ff4444', backgroundColor: 'rgba(255,255,255,0.05)', padding: '4px 8px', borderRadius: '4px' }}>
              {v24h >= 0 ? '▲ subiu' : '▼ caiu'} {Math.abs(v24h)}%/dia
            </span>
          </div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <h3 style={{ margin: 0, color: d?.close >= d?.open ? '#00ff88' : '#ff4444', fontFamily: 'monospace' }}>
            {d ? formatMoney(d.close) : '...'}
          </h3>
        </div>
      </div>

      <AIPrediction symbol={coin.value} onUpdate={onAiUpdate} aiSettings={aiSettings} />

      <div style={{ display: 'flex', gap: '15px', marginTop: '15px', borderTop: '1px solid #2a2a2a', paddingTop: '15px' }}>
        {showCharts && <div style={{ flex: 3 }}><Chart symbol={coin.value} liveData={d} /></div>}
        
        <div style={{ flex: 1, backgroundColor: '#161616', padding: '10px', borderRadius: '8px', border: '1px solid #333', minWidth: '180px' }}>
          <h4 style={{ margin: '0 0 10px 0', color: '#888', fontSize: '0.8rem', textAlign: 'center' }}>📖 Livro de Ofertas</h4>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', fontSize: '0.75rem', fontFamily: 'monospace' }}>
            <div style={{ backgroundColor: 'rgba(255,68,68,0.1)', padding: '8px', borderRadius: '4px', borderLeft: '2px solid #ff4444' }}>
              <span style={{ color: '#aaa' }}>Venda (Ask)</span><br/>
              <strong style={{ color: '#ff4444', fontSize: '0.9rem' }}>{book?.askPrice ? formatMoney(book.askPrice) : '...'}</strong><br/>
              <span style={{ color: '#888' }}>Vol: {book?.askQty?.toFixed(2) || '...'}</span>
            </div>
            <div style={{ textAlign: 'center', color: '#555', fontSize: '0.6rem' }}>SPREAD</div>
            <div style={{ backgroundColor: 'rgba(0,255,136,0.1)', padding: '8px', borderRadius: '4px', borderLeft: '2px solid #00ff88' }}>
              <span style={{ color: '#aaa' }}>Compra (Bid)</span><br/>
              <strong style={{ color: '#00ff88', fontSize: '0.9rem' }}>{book?.bidPrice ? formatMoney(book.bidPrice) : '...'}</strong><br/>
              <span style={{ color: '#888' }}>Vol: {book?.bidQty?.toFixed(2) || '...'}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}