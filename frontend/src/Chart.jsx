import { useEffect, useRef } from 'react';
import { createChart, CandlestickSeries, LineSeries, HistogramSeries } from 'lightweight-charts'; // 🟢 CORREÇÃO 1: Importamos o HistogramSeries aqui

export default function Chart({ symbol, liveData }) {
  const chartContainerRef = useRef();
  const seriesRef = useRef(null);
  const smaSeriesRef = useRef(null);
  const volumeSeriesRef = useRef(null);

  useEffect(() => {
    const chart = createChart(chartContainerRef.current, {
      layout: { background: { type: 'solid', color: '#1e1e1e' }, textColor: '#d1d4dc' },
      grid: { vertLines: { color: '#333' }, horzLines: { color: '#333' } },
      width: 600,
      height: 400,
      timeScale: { timeVisible: true, secondsVisible: false },
    });

    const series = chart.addSeries(CandlestickSeries, {
      upColor: '#00ff88', downColor: '#ff4444', borderVisible: false, wickUpColor: '#00ff88', wickDownColor: '#ff4444'
    });
    seriesRef.current = series;

    const smaSeries = chart.addSeries(LineSeries, {
      color: '#2962FF', lineWidth: 2, crosshairMarkerVisible: false,
    });
    smaSeriesRef.current = smaSeries;

    // 🟢 CORREÇÃO 2: Usamos addSeries() e passamos o HistogramSeries como argumento
    const volumeSeries = chart.addSeries(HistogramSeries, {
      color: '#26a69a',
      priceFormat: { type: 'volume' },
      priceScaleId: '', // Faz ele ficar sobreposto como overlay
    });
    chart.priceScale('').applyOptions({
      scaleMargins: { top: 0.8, bottom: 0 }, // O volume ocupa apenas os 20% inferiores da tela
    });
    volumeSeriesRef.current = volumeSeries;

    fetch(`http://localhost:4000/api/candles/${symbol}`)
      .then(res => {
        if (!res.ok) throw new Error("Erro na resposta do servidor");
        return res.json();
      })
      .then(data => {
        const dados1m = data['1m'];
        if (!dados1m || dados1m.length === 0) return;

        const uniqueCandles = [];
        const uniqueSma = [];
        const uniqueVolumes = [];
        const seenTimes = new Set();

        dados1m.forEach(d => {
          if (!seenTimes.has(d.time)) {
            seenTimes.add(d.time);

            uniqueCandles.push({ time: d.time, open: d.open, high: d.high, low: d.low, close: d.close });
            if (d.sma !== null) uniqueSma.push({ time: d.time, value: d.sma });

            // Define se a barra de volume é verde ou vermelha dependendo da vela
            uniqueVolumes.push({
              time: d.time,
              value: d.volume,
              color: d.close >= d.open ? 'rgba(0, 255, 136, 0.4)' : 'rgba(255, 68, 68, 0.4)'
            });
          }
        });

        uniqueCandles.sort((a, b) => a.time - b.time);
        uniqueSma.sort((a, b) => a.time - b.time);
        uniqueVolumes.sort((a, b) => a.time - b.time);

        if (uniqueCandles.length > 0) {
          series.setData(uniqueCandles);
          smaSeries.setData(uniqueSma);
          volumeSeries.setData(uniqueVolumes);
        }
      })
      .catch(err => console.error(`❌ Erro no fetch do ${symbol}:`, err));

    return () => chart.remove();
  }, [symbol]);

  useEffect(() => {
    if (seriesRef.current && liveData && liveData.interval === '1m') {
      const variacao = ((liveData.close - liveData.open) / liveData.open) * 100;
      const icone = variacao >= 0 ? '▲' : '▼';
      const cor = variacao >= 0 ? '#00ff88' : '#ff4444';

      const formattedTime = Math.floor(liveData.time / 1000);
      try {
        seriesRef.current.update({ time: formattedTime, open: liveData.open, high: liveData.high, low: liveData.low, close: liveData.close });

        if (volumeSeriesRef.current && liveData.volume) {
          volumeSeriesRef.current.update({
            time: formattedTime,
            value: liveData.volume,
            color: liveData.close >= liveData.open ? 'rgba(0, 255, 136, 0.4)' : 'rgba(255, 68, 68, 0.4)'
          });
        }
      } catch (e) { }
    }
  }, [liveData]);

  return <div ref={chartContainerRef} style={{ marginTop: '2rem', border: '1px solid #333', borderRadius: '8px', overflow: 'hidden', minWidth: 0, minHeight: 0 }} />;
}