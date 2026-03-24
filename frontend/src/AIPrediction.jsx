import { useState, useEffect, useCallback, useRef } from 'react';

export default function AIPrediction({ symbol, onUpdate, aiSettings }) {
  const [prediction, setPrediction] = useState(null);

  const intervalRef = useRef(null);
  const inFlightRef = useRef(false);
  const mountedRef = useRef(true);

  const fetchPrediction = useCallback(async () => {
    if (inFlightRef.current) return;

    inFlightRef.current = true;

    try {
      const params = new URLSearchParams({
        depth: String(aiSettings.depth),
        agressivity: String(aiSettings.agressivity),
        ema: String(aiSettings.useEma),
      });

      const res = await fetch(
        `http://localhost:5000/api/predict/${symbol}?${params.toString()}`,
      );

      const data = await res.json();

      if (!mountedRef.current) return;

      if (data && !data.error) {
        setPrediction(data);

        if (data.prediction) {
          onUpdate(symbol, data.prediction, data.reasons);
        }
      } else if (data?.error) {
        setPrediction({ error: data.error });
      } else {
        setPrediction({ error: 'Resposta inválida da IA' });
      }
    } catch (e) {
      console.error('Erro ao prever:', e);

      if (mountedRef.current) {
        setPrediction({ error: 'Falha na conexão com a IA' });
      }
    } finally {
      inFlightRef.current = false;
    }
  }, [symbol, aiSettings, onUpdate]);

  useEffect(() => {
    mountedRef.current = true;

    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    fetchPrediction();

    if (intervalRef.current) {
      clearInterval(intervalRef.current);
    }

    const safeInterval = Math.max(5, Number(aiSettings.interval) || 30);

    intervalRef.current = setInterval(() => {
      fetchPrediction();
    }, safeInterval * 1000);

    return () => {
      clearInterval(intervalRef.current);
    };
  }, [fetchPrediction, aiSettings.interval]);

  if (!prediction) {
    return (
      <div
        style={{
          marginTop: '10px',
          padding: '12px',
          backgroundColor: '#161616',
          border: '1px solid #333',
          borderRadius: '8px',
          color: '#888',
          fontSize: '0.85rem',
        }}
      >
        Aguardando IA...
      </div>
    );
  }

  if (prediction.error) {
    return (
      <div
        style={{
          marginTop: '10px',
          padding: '12px',
          backgroundColor: 'rgba(255, 68, 68, 0.08)',
          border: '1px solid #5a2a2a',
          borderRadius: '8px',
          color: '#ff8a8a',
          fontSize: '0.85rem',
        }}
      >
        ❌ {prediction.error}
      </div>
    );
  }

  const isBuy = prediction.prediction === 'COMPRAR';

  return (
    <div
      style={{
        marginTop: '10px',
        padding: '12px',
        borderRadius: '8px',
        border: `1px solid ${isBuy ? '#00ff88' : '#ff4444'}`,
        backgroundColor: isBuy
          ? 'rgba(0,255,136,0.08)'
          : 'rgba(255,68,68,0.08)',
      }}
    >
      <div
        style={{
          fontWeight: 'bold',
          color: isBuy ? '#00ff88' : '#ff4444',
          marginBottom: '6px',
        }}
      >
        SINAL: {prediction.prediction}
      </div>

      <div style={{ fontSize: '0.8rem', color: '#bbb' }}>
        Precisão: {prediction.accuracy}%
      </div>
    </div>
  );
}