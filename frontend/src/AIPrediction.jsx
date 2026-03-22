import { useState, useEffect } from 'react';

export default function AIPrediction({ symbol, onUpdate, updateInterval = 60 }) {
  const [prediction, setPrediction] = useState(null);

  useEffect(() => {
    const fetchPrediction = async () => {
      try {
        const res = await fetch(`http://localhost:5000/api/predict/${symbol}`);
        const data = await res.json();
        
        // 🟢 CORREÇÃO: Agora a tela atualiza o estado MESMO se a IA retornar um {error}
        if (data) {
          setPrediction(data);
          // Só tenta repassar para o App.jsx se a previsão for válida e não um erro
          if (data.prediction) {
            onUpdate(symbol, data.prediction, data.reasons);
          }
        }
      } catch (e) {
        console.error("Erro ao prever:", e);
      }
    };

    fetchPrediction(); 
    
    const interval = setInterval(fetchPrediction, updateInterval * 1000); 
    
    return () => clearInterval(interval);
  }, [symbol, updateInterval]); 

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