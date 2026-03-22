import { useState, useEffect } from 'react';

export default function AIPrediction({ symbol, onUpdate, updateInterval = 60 }) {
  const [prediction, setPrediction] = useState(null);

  useEffect(() => {
    const fetchPrediction = async () => {
      try {
        const res = await fetch(`http://localhost:5000/api/predict/${symbol}`);
        const data = await res.json();
        if (data && data.prediction) {
          setPrediction(data);
          onUpdate(symbol, data.prediction, data.reasons);
        }
      } catch (e) {
        console.error("Erro ao prever:", e);
      }
    };

    fetchPrediction(); // Faz a primeira previsão imediatamente
    
    // 🟢 NOVO: O intervalo agora é dinâmico e controlado pelo painel! (Segundos * 1000)
    const interval = setInterval(fetchPrediction, updateInterval * 1000); 
    
    return () => clearInterval(interval);
  }, [symbol, updateInterval]); // 🟢 Se você mudar o tempo no input, ele reinicia o motor na hora

  if (!prediction) return <div style={{color: '#888'}}>Aguardando IA...</div>;
  if (prediction.error) return <div style={{color: '#ff4444', fontWeight: 'bold'}}>❌ {prediction.error}</div>;

  const isBuy = prediction.prediction === 'COMPRAR';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: '10px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
        <span style={{ 
          backgroundColor: isBuy ? 'rgba(0,255,136,0.1)' : 'rgba(255,68,68,0.1)', 
          color: isBuy ? '#00ff88' : '#ff4444', 
          padding: '5px 10px', borderRadius: '4px', fontWeight: 'bold', border: `1px solid ${isBuy ? '#00ff88' : '#ff4444'}` 
        }}>
          SINAL: {prediction.prediction}
        </span>
        <span style={{ fontSize: '0.85rem', color: '#aaa' }}>Precisão: {prediction.accuracy}%</span>
      </div>
    </div>
  );
}