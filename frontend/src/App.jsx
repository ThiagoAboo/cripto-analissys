import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import Select from 'react-select';
import SettingsModal from './components/SettingsModal';
import WalletPanel from './components/WalletPanel';
import TradeLog from './components/TradeLog';
import AIDiary from './components/AIDiary';
import CoinCard from './components/CoinCard';
import useTradingLogic from './hooks/useTradingLogic';

export default function App() {
  // Estados de UI
  const [baseCurrency, setBaseCurrency] = useState(() => localStorage.getItem('bot_base_currency') || 'USDT');
  const [availableCoins, setAvailableCoins] = useState([]);
  const [selectedCoins, setSelectedCoins] = useState(() => {
    const saved = localStorage.getItem(`bot_selected_coins_${baseCurrency}`);
    return saved ? JSON.parse(saved) : [{ value: `BTC${baseCurrency}`, label: `BTC (${baseCurrency})` }];
  });
  const [currentData, setCurrentData] = useState({});
  const [orderBooks, setOrderBooks] = useState({});
  const [historyOpen, setHistoryOpen] = useState({});
  const wsRef = useRef(null);
  const [wsReady, setWsReady] = useState(false);

  // Configurações
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [fee, setFee] = useState(() => Number(localStorage.getItem('bot_fee')) || 0.1);
  const [riskPct, setRiskPct] = useState(() => Number(localStorage.getItem('bot_risk_pct')) || 5);
  const [trailStop, setTrailStop] = useState(() => Number(localStorage.getItem('bot_trail_stop')) || 2);
  const [takeProfit, setTakeProfit] = useState(() => Number(localStorage.getItem('bot_tp')) || 5);
  const [minVol, setMinVol] = useState(() => Number(localStorage.getItem('bot_vol')) || 0.05);
  const [bnbReserve, setBnbReserve] = useState(() => Number(localStorage.getItem('bot_bnb_reserve')) || 0);
  const [aiSettings, setAiSettings] = useState(() => {
    const saved = localStorage.getItem('bot_ai_settings');
    return saved ? JSON.parse(saved) : { interval: 30, depth: 5, agressivity: 2.0, useEma: true };
  });
  const [showCharts, setShowCharts] = useState(() => JSON.parse(localStorage.getItem('bot_show_charts') ?? 'true'));
  const [isRealMode, setIsRealMode] = useState(() => JSON.parse(localStorage.getItem('bot_real_mode') ?? 'false'));

  // Hook de lógica de trading
  const {
    wallet,
    equityHistory,
    reasonsLog,
    totalPortfolioValue,
    pnlPct,
    winRate,
    tradesFechados,
    handleAiUpdate,
    resetWallet,
    formatMoney,
  } = useTradingLogic({
    baseCurrency,
    selectedCoins,
    currentData,
    minVol,
    fee,
    riskPct,
    trailStop,
    takeProfit,
    bnbReserve,
  });

  // Persistir configurações (exceto carteira, já persistida no hook)
  useEffect(() => {
    localStorage.setItem('bot_base_currency', baseCurrency);
    localStorage.setItem(`bot_selected_coins_${baseCurrency}`, JSON.stringify(selectedCoins));
    localStorage.setItem('bot_fee', fee);
    localStorage.setItem('bot_risk_pct', riskPct);
    localStorage.setItem('bot_trail_stop', trailStop);
    localStorage.setItem('bot_tp', takeProfit);
    localStorage.setItem('bot_vol', minVol);
    localStorage.setItem('bot_bnb_reserve', bnbReserve);
    localStorage.setItem('bot_ai_settings', JSON.stringify(aiSettings));
    localStorage.setItem('bot_show_charts', showCharts);
    localStorage.setItem('bot_real_mode', isRealMode);
  }, [baseCurrency, selectedCoins, fee, riskPct, trailStop, takeProfit, minVol, bnbReserve, aiSettings, showCharts, isRealMode]);

  // Carregar pares disponíveis
  useEffect(() => {
    fetch('https://api.binance.com/api/v3/exchangeInfo')
      .then(res => res.json())
      .then(data => {
        const pairs = data.symbols
          .filter(s => s.quoteAsset === baseCurrency && s.status === 'TRADING')
          .map(s => ({ value: s.symbol, label: `${s.baseAsset} (${s.symbol})` }));
        pairs.sort((a, b) => a.label.localeCompare(b.label));
        setAvailableCoins(pairs);
      })
      .catch(console.error);
  }, [baseCurrency]);

  // Buscar histórico inicial de abertura para variações
  useEffect(() => {
    selectedCoins.forEach(coin => {
      fetch(`http://localhost:4000/api/candles/${coin.value}`)
        .then(res => res.json())
        .then(data => {
          if (data['1h'] && data['1h'].length > 0) {
            setHistoryOpen(prev => ({ ...prev, [`${coin.value}_1h`]: parseFloat(data['1h'][data['1h'].length - 1].open) }));
          }
          if (data['1d'] && data['1d'].length > 0) {
            setHistoryOpen(prev => ({ ...prev, [`${coin.value}_1d`]: parseFloat(data['1d'][data['1d'].length - 1].open) }));
          }
        }).catch(() => { });
    });
  }, [selectedCoins]);

  // WebSocket com reconexão automática
  useEffect(() => {
    if (selectedCoins.length === 0) return;

    let reconnectAttempts = 0;
    let reconnectTimeout;
    let ws = null;

    const connect = () => {
      ws = new WebSocket('ws://localhost:4000');
      wsRef.current = ws;

      ws.onopen = () => {
        console.log('WebSocket conectado');
        setWsReady(true);
        reconnectAttempts = 0;
        ws.send(JSON.stringify({ action: 'update_subscriptions', symbols: selectedCoins.map(c => c.value) }));
      };

      ws.onmessage = (e) => {
        try {
          const data = JSON.parse(e.data);
          if (data.action === 'book') {
            setOrderBooks(prev => ({ ...prev, [data.symbol]: data.data }));
          }
          else if (data.action === 'kline') {
            if (data.interval === '1m') setCurrentData(prev => ({ ...prev, [data.symbol]: data }));
            else setHistoryOpen(prev => ({ ...prev, [`${data.symbol}_${data.interval}`]: data.open }));
          }
        } catch (err) {
          console.error('Erro ao processar mensagem WebSocket:', err);
        }
      };

      ws.onclose = () => {
        console.log('WebSocket fechado, tentando reconectar...');
        setWsReady(false);
        const delay = Math.min(5000 * (reconnectAttempts + 1), 30000);
        reconnectTimeout = setTimeout(connect, delay);
        reconnectAttempts++;
      };

      ws.onerror = (err) => {
        console.error('Erro no WebSocket:', err);
        ws.close();
      };
    };

    connect();

    return () => {
      if (ws) ws.close();
      if (reconnectTimeout) clearTimeout(reconnectTimeout);
    };
  }, [selectedCoins]);

  // Cálculo de variação
  const getVar = useCallback((sym, tf) => {
    const cur = currentData[sym]?.close;
    const op = tf === '1m' ? currentData[sym]?.open : historyOpen[`${sym}_${tf}`];
    return (cur && op) ? (((cur - op) / op) * 100).toFixed(2) : "0.00";
  }, [currentData, historyOpen]);

  // Handler para mudar moeda base
  const handleBaseCurrencyChange = (e) => {
    setBaseCurrency(e.target.value);
    setSelectedCoins([]); setCurrentData({}); setHistoryOpen({}); setOrderBooks({});
    // A carteira será reinicializada pelo hook na próxima renderização, pois baseCurrency mudou
    // Mas o hook depende de baseCurrency, então ele vai resetar automaticamente? Não, precisamos forçar um reset.
    // Vamos chamar resetWallet? Mas resetWallet pede confirmação. Melhor recarregar a página? 
    // Ou podemos setar um estado que force o hook a reinicializar. A solução mais simples é recarregar a página.
    // Por simplicidade, vamos recarregar a página para garantir que tudo reinicie.
    window.location.reload();
  };

  return (
    <div style={{ padding: '20px', backgroundColor: '#121212', color: '#fff', minHeight: '100vh', fontFamily: 'sans-serif' }}>
      <SettingsModal
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
        settings={{
          fee, riskPct, trailStop, takeProfit, bnbReserve, minVol, aiSettings,
          setFee, setRiskPct, setTrailStop, setTakeProfit, setBnbReserve, setMinVol, setAiSettings
        }}
      />

      {/* HEADER */}
      <div style={{ display: 'flex', flexDirection: 'row', gap: '15px', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px', backgroundColor: '#1e1e1e', padding: '15px 25px', borderRadius: '10px', border: '1px solid #333' }}>
        <h1 style={{ margin: 0, fontSize: '1.5rem', display: 'flex', alignItems: 'center', gap: '15px' }}>
          <button onClick={() => setIsSettingsOpen(true)} style={{ background: 'transparent', border: 'none', color: '#aaa', fontSize: '1.5rem', cursor: 'pointer', padding: 0 }} title="Configurações">⚙️</button>
          AI Crypto Terminal Pro
        </h1>

        <div style={{ display: 'flex', gap: '15px', alignItems: 'center', flexWrap: 'wrap' }}>

          <select value={baseCurrency} onChange={handleBaseCurrencyChange} style={{ padding: '9px', backgroundColor: '#121212', color: '#fff', border: '1px solid #444', borderRadius: '5px', fontWeight: 'bold' }}>
            <option value="USDT">Par: USDT</option>
            <option value="BRL">Par: BRL</option>
            <option value="BNB">Par: BNB</option>
          </select>

          <label style={{ fontSize: '0.85rem', color: '#aaa', cursor: 'pointer' }}>
            <input type="checkbox" checked={showCharts} onChange={e => setShowCharts(e.target.checked)} style={{ marginRight: '5px' }} /> Gráficos
          </label>

          <label style={{ fontSize: '0.85rem', color: isRealMode ? '#ff4444' : '#00d2ff', cursor: 'pointer', fontWeight: 'bold', display: 'flex', alignItems: 'center', gap: '5px', backgroundColor: isRealMode ? 'rgba(255,68,68,0.1)' : 'rgba(0,210,255,0.1)', padding: '6px 12px', borderRadius: '6px', border: `1px solid ${isRealMode ? '#ff4444' : '#00d2ff'}` }}>
            <input type="checkbox" checked={isRealMode} onChange={e => setIsRealMode(e.target.checked)} style={{ display: 'none' }} />
            {isRealMode ? '🔥 MODO REAL' : '🧪 SIMULAÇÃO'}
          </label>

          <button onClick={resetWallet} style={{ backgroundColor: '#ff4444', color: '#fff', border: 'none', padding: '10px 15px', borderRadius: '5px', cursor: 'pointer', fontWeight: 'bold' }}>🔄 Reset</button>
        </div>
        <div>
          <Select isMulti options={availableCoins} value={selectedCoins} onChange={setSelectedCoins} placeholder="Selecione as Moedas..." styles={{ control: (b) => ({ ...b, backgroundColor: '#121212', borderColor: '#444', minWidth: '300px' }), menu: (b) => ({ ...b, backgroundColor: '#1e1e1e', zIndex: 999 }), option: (b, s) => ({ ...b, backgroundColor: s.isFocused ? '#333' : '#1e1e1e', color: '#fff' }), multiValue: (b) => ({ ...b, backgroundColor: '#333' }), multiValueLabel: (b) => ({ ...b, color: '#fff' }) }} />
        </div>
      </div>

      <WalletPanel
        formatMoney={formatMoney}
        totalPortfolioValue={totalPortfolioValue}
        pnlPct={pnlPct}
        equityHistory={equityHistory}
        winRate={winRate}
        tradesFechados={tradesFechados}
        wallet={wallet}
        baseCurrency={baseCurrency}
      />

      <div style={{ display: 'grid', gridTemplateColumns: showCharts ? '1fr 2.5fr' : '1fr 1.2fr', gap: '20px' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
          <TradeLog logs={wallet.logs} />
          <AIDiary reasonsLog={reasonsLog} selectedCoins={selectedCoins} />
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
          {selectedCoins.map(coin => (
            <CoinCard
              key={coin.value}
              coin={coin}
              currentData={currentData}
              orderBooks={orderBooks}
              getVar={getVar}
              formatMoney={formatMoney}
              showCharts={showCharts}
              onAiUpdate={handleAiUpdate}
              aiSettings={aiSettings}
            />
          ))}
        </div>
      </div>

      <style>{`
        .custom-scroll::-webkit-scrollbar { width: 4px; }
        .custom-scroll::-webkit-scrollbar-track { background: #121212; }
        .custom-scroll::-webkit-scrollbar-thumb { background: #333; borderRadius: 10px; }
        .custom-scroll::-webkit-scrollbar-thumb:hover { background: #444; }
      `}</style>
    </div>
  );
}