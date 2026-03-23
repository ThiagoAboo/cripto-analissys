import { useState, useEffect, useCallback, useRef } from 'react';

export default function AIPrediction({ symbol, onUpdate, aiSettings }) {
  const [prediction, setPrediction] = useState(null);
  const intervalRef = useRef(null);

  const fetchPrediction = useCallback(async () => {
    try {
      const params = new URLSearchParams({
        depth: aiSettings.depth,
        agressivity: aiSettings.agressivity,
        ema: aiSettings.useEma
      });

      const res = await fetch(`http://localhost:5000/api/predict/${symbol}?${params}`);
      const data = await res.json();

      if (data && !data.error) {
        setPrediction(data);
        if (data.prediction) {
          onUpdate(symbol, data.prediction, data.reasons);
        }
      } else if (data.error) {
        setPrediction({ error: data.error });
      }
    } catch (e) {
      console.error("Erro ao prever:", e);
      setPrediction({ error: "Falha na conexão com a IA" });
    }
  }, [symbol, aiSettings, onUpdate]);

  useEffect(() => {
    fetchPrediction();
    if (intervalRef.current) clearInterval(intervalRef.current);
    intervalRef.current = setInterval(fetchPrediction, aiSettings.interval * 1000);
    return () => clearInterval(intervalRef.current);
  }, [fetchPrediction, aiSettings.interval]);

  if (!prediction) return <div style={{color: '#888'}}>Aguardando IA...</div>;
  if (prediction.error) return <div style={{color: '#ff4444', fontWeight: 'bold'}}>❌ {prediction.error}</div>;

  const isBuy = prediction.prediction === 'COMPRAR';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: '10px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
        <span style={{
          backgroundColor: isBuy ? 'rgba(0,255,136,0.1)' : 'rgba(255,68,68,0.1)',
          color: isBuy ? '#00ff88' : '#ff4444',
          padding: '5px 10px', borderRadius: '4px', fontWeight: 'bold',
          border: `1px solid ${isBuy ? '#00ff88' : '#ff4444'}`
        }}>
          SINAL: {prediction.prediction}
        </span>
        <span style={{ fontSize: '0.85rem', color: '#aaa' }}>Precisão: {prediction.accuracy}%</span>
      </div>
    </div>
  );
}