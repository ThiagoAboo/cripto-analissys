import { useEffect, useRef } from 'react';
import { createChart, CandlestickSeries, LineSeries, HistogramSeries } from 'lightweight-charts';

export default function Chart({ symbol, liveData }) {
  const chartContainerRef = useRef();
  const seriesRef = useRef(null);
  const smaSeriesRef = useRef(null);
  const volumeSeriesRef = useRef(null);

  useEffect(() => {
    const chart = createChart(chartContainerRef.current, {
      layout: { background: { type: 'transparent', color: '#161616' }, textColor: '#d1d4dc' },
      grid: { vertLines: { color: '#2a2a2a' }, horzLines: { color: '#2a2a2a' } },
      width: chartContainerRef.current.clientWidth,
      height: 300,
      timeScale: { timeVisible: true, secondsVisible: false },
    });

    const series = chart.addSeries(CandlestickSeries, {
      upColor: '#00ff88', downColor: '#ff4444', borderVisible: false, wickUpColor: '#00ff88', wickDownColor: '#ff4444'
    });
    seriesRef.current = series;

    const smaSeries = chart.addSeries(LineSeries, { color: '#2962FF', lineWidth: 2, crosshairMarkerVisible: false });
    smaSeriesRef.current = smaSeries;

    const volumeSeries = chart.addSeries(HistogramSeries, { color: '#26a69a', priceFormat: { type: 'volume' }, priceScaleId: '' });
    chart.priceScale('').applyOptions({ scaleMargins: { top: 0.8, bottom: 0 } });
    volumeSeriesRef.current = volumeSeries;

    fetch(`http://localhost:4000/api/candles/${symbol}`)
      .then(res => res.json())
      .then(data => {
        const d1m = data['1m'];
        if (!d1m) return;
        const uniqueCandles = [], uniqueSma = [], uniqueVolumes = [];
        d1m.forEach(d => {
          uniqueCandles.push({ time: d.time, open: d.open, high: d.high, low: d.low, close: d.close });
          if (d.sma !== null) uniqueSma.push({ time: d.time, value: d.sma });
          uniqueVolumes.push({ time: d.time, value: d.volume, color: d.close >= d.open ? 'rgba(0, 255, 136, 0.4)' : 'rgba(255, 68, 68, 0.4)' });
        });
        series.setData(uniqueCandles);
        smaSeries.setData(uniqueSma);
        volumeSeries.setData(uniqueVolumes);
      })
      .catch(err => {});

    return () => chart.remove();
  }, [symbol]);

  useEffect(() => {
    if (seriesRef.current && liveData && liveData.interval === '1m') {
      const time = Math.floor(liveData.time / 1000);
      try {
        seriesRef.current.update({ time, open: liveData.open, high: liveData.high, low: liveData.low, close: liveData.close });
        if (volumeSeriesRef.current) {
          volumeSeriesRef.current.update({ time, value: liveData.volume, color: liveData.close >= liveData.open ? 'rgba(0, 255, 136, 0.4)' : 'rgba(255, 68, 68, 0.4)' });
        }
      } catch (e) { }
    }
  }, [liveData]);

  // 🟢 CÁLCULO DA VARIAÇÃO NO TOPO DO GRÁFICO
  const variation = liveData ? (((liveData.close - liveData.open) / liveData.open) * 100).toFixed(2) : "0.00";

  return (
    <div style={{ position: 'relative' }}>
      <div ref={chartContainerRef} style={{ borderRadius: '8px', overflow: 'hidden', border: '1px solid #333' }} />
      {liveData && (
        <div style={{
          position: 'absolute', top: '10px', left: '10px', zIndex: 10,
          backgroundColor: 'rgba(0,0,0,0.7)', padding: '4px 8px', borderRadius: '4px',
          fontSize: '0.8rem', fontWeight: 'bold', border: `1px solid ${variation >= 0 ? '#00ff88' : '#ff4444'}`,
          color: variation >= 0 ? '#00ff88' : '#ff4444'
        }}>
          {variation >= 0 ? '▲' : '▼'} {Math.abs(variation)}% (1m)
        </div>
      )}
    </div>
  );
}