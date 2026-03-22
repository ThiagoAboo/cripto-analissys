import { useState, useEffect, useRef } from 'react';
import Select from 'react-select';
import Chart from './Chart';
import AIPrediction from './AIPrediction';
import { LineChart, Line, Tooltip, ResponsiveContainer } from 'recharts';

export default function App() {
  // 🟢 SELETOR DE MOEDA BASE (USDT, BRL, BNB)
  const [baseCurrency, setBaseCurrency] = useState(() => localStorage.getItem('bot_base_currency') || 'USDT');
  const [availableCoins, setAvailableCoins] = useState([]);
  
  const [selectedCoins, setSelectedCoins] = useState(() => {
    const saved = localStorage.getItem(`bot_selected_coins_${baseCurrency}`);
    return saved ? JSON.parse(saved) : [{ value: `BTC${baseCurrency}`, label: `BTC (${baseCurrency})` }];
  });

  const [currentData, setCurrentData] = useState({}); 
  const [historyOpen, setHistoryOpen] = useState({}); // Aberturas 1h e 1d
  const wsRef = useRef(null);
  const livePricesRef = useRef({});
  const lastSignalRef = useRef({});
  const highestPricesRef = useRef({}); 
  const [reasonsLog, setReasonsLog] = useState({});

  const [fee, setFee] = useState(() => Number(localStorage.getItem('bot_fee')) || 0.1);
  const [riskPct, setRiskPct] = useState(() => Number(localStorage.getItem('bot_risk_pct')) || 5);
  const [trailStop, setTrailStop] = useState(() => Number(localStorage.getItem('bot_trail_stop')) || 2);
  const [takeProfit, setTakeProfit] = useState(() => Number(localStorage.getItem('bot_tp')) || 5);
  const [minVol, setMinVol] = useState(() => Number(localStorage.getItem('bot_vol')) || 0.15);
  const [showCharts, setShowCharts] = useState(() => JSON.parse(localStorage.getItem('bot_show_charts') ?? 'true'));
  const [isRealMode, setIsRealMode] = useState(() => JSON.parse(localStorage.getItem('bot_real_mode') ?? 'false'));
  const [bnbReserve, setBnbReserve] = useState(() => Number(localStorage.getItem('bot_bnb_reserve')) || 0);
  const [aiInterval, setAiInterval] = useState(() => Number(localStorage.getItem('bot_ai_interval')) || 60);

  // Formatação de Dinheiro Dinâmica
  const formatMoney = (value) => {
    if (baseCurrency === 'BRL') return `R$ ${value.toFixed(2)}`;
    if (baseCurrency === 'USDT') return `$ ${value.toFixed(2)}`;
    return `BNB ${value.toFixed(4)}`;
  };

  // 🟢 BUSCA MOEDAS BASEADAS NA SELEÇÃO
  useEffect(() => {
    fetch('https://api.binance.com/api/v3/exchangeInfo')
      .then(res => res.json())
      .then(data => {
        const pairs = data.symbols
          .filter(s => s.quoteAsset === baseCurrency && s.status === 'TRADING')
          .map(s => ({ value: s.symbol, label: `${s.baseAsset} (${s.symbol})` }));
        pairs.sort((a, b) => a.label.localeCompare(b.label));
        setAvailableCoins(pairs);
      });
  }, [baseCurrency]);

  useEffect(() => {
    localStorage.setItem('bot_base_currency', baseCurrency);
    localStorage.setItem(`bot_selected_coins_${baseCurrency}`, JSON.stringify(selectedCoins));
    localStorage.setItem('bot_fee', fee);
    localStorage.setItem('bot_risk_pct', riskPct);
    localStorage.setItem('bot_trail_stop', trailStop);
    localStorage.setItem('bot_tp', takeProfit);
    localStorage.setItem('bot_vol', minVol);
    localStorage.setItem('bot_show_charts', showCharts);
    localStorage.setItem('bot_real_mode', isRealMode);
    localStorage.setItem('bot_bnb_reserve', bnbReserve);
    localStorage.setItem('bot_ai_interval', aiInterval);
  }, [baseCurrency, selectedCoins, fee, riskPct, trailStop, takeProfit, minVol, showCharts, isRealMode, bnbReserve, aiInterval]);

  // 🟢 CARTEIRA INTELIGENTE COM BASE NA MOEDA
  const getInitialWallet = () => {
    const saved = localStorage.getItem(`cryptoWallet_${baseCurrency}`);
    const startAmount = baseCurrency === 'BRL' ? 5000 : baseCurrency === 'USDT' ? 1000 : 5;
    return saved ? JSON.parse(saved) : { quote: startAmount, balances: {}, entryPrices: {}, logs: [] };
  };
  const [wallet, setWallet] = useState(getInitialWallet);

  const [equityHistory, setEquityHistory] = useState(() => {
    const saved = localStorage.getItem(`equityHistory_${baseCurrency}`);
    const startAmount = baseCurrency === 'BRL' ? 5000 : baseCurrency === 'USDT' ? 1000 : 5;
    return (saved && JSON.parse(saved).length > 1) ? JSON.parse(saved) : [{ time: 'Início', value: startAmount }, { time: 'Agora', value: startAmount }];
  });

  useEffect(() => { localStorage.setItem(`cryptoWallet_${baseCurrency}`, JSON.stringify(wallet)); }, [wallet, baseCurrency]);
  useEffect(() => { localStorage.setItem(`equityHistory_${baseCurrency}`, JSON.stringify(equityHistory)); }, [equityHistory, baseCurrency]);
  useEffect(() => { livePricesRef.current = currentData; }, [currentData]);

  // Se trocar a moeda base, reseta a seleção de moedas
  const handleBaseCurrencyChange = (e) => {
    setBaseCurrency(e.target.value);
    setSelectedCoins([]);
    setCurrentData({});
    setHistoryOpen({});
    setWallet({ quote: e.target.value === 'BRL' ? 5000 : e.target.value === 'USDT' ? 1000 : 5, balances: {}, entryPrices: {}, logs: [] });
    setEquityHistory([{ time: 'Início', value: e.target.value === 'BRL' ? 5000 : e.target.value === 'USDT' ? 1000 : 5 }]);
  };

  const handleAiUpdate = (symbol, signal, reasons) => {
    setReasonsLog(prev => ({ ...prev, [symbol]: { time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }), signal, reasons } }));
    handleBotAction(symbol, signal, "IA");
  };

  const handleBotAction = (symbol, signal, motivo = "IA") => {
    const currentPrice = livePricesRef.current[symbol]?.close;
    const openPrice = livePricesRef.current[symbol]?.open;
    if (!currentPrice || !openPrice) return;

    if (motivo === "IA" && lastSignalRef.current[symbol] === signal) return;
    if (motivo === "IA" && signal === 'COMPRAR' && ((Math.abs(currentPrice - openPrice) / openPrice) * 100) < minVol) return; 
    if (motivo === "IA") lastSignalRef.current[symbol] = signal;
    
    setWallet(prevWallet => {
      let newWallet = { ...prevWallet, balances: { ...prevWallet.balances }, entryPrices: { ...prevWallet.entryPrices }, logs: [...prevWallet.logs] };
      let coinBalance = newWallet.balances[symbol] || 0;
      let logMsg = "";
      let tradeClosed = false; 

      const bnbSymbol = `BNB${baseCurrency}`;
      const hasBnbReserve = (newWallet.balances[bnbSymbol] || 0) >= bnbReserve && bnbReserve > 0;
      const taxaAplicada = hasBnbReserve ? (fee * 0.75) : fee; 
      const taxaDecimal = taxaAplicada / 100;
      const minTrade = baseCurrency === 'BRL' ? 10 : baseCurrency === 'USDT' ? 5 : 0.05;

      if (signal === 'COMPRAR' && newWallet.quote >= minTrade) {
        let amountToRisk = newWallet.quote * (riskPct / 100);
        if (amountToRisk < minTrade) amountToRisk = minTrade; 
        if (amountToRisk > newWallet.quote) amountToRisk = newWallet.quote;

        const custoTaxa = amountToRisk * taxaDecimal;
        newWallet.quote -= amountToRisk;
        newWallet.balances[symbol] = coinBalance + ((amountToRisk - custoTaxa) / currentPrice);
        newWallet.entryPrices[symbol] = currentPrice;
        highestPricesRef.current[symbol] = currentPrice;
        
        logMsg = `🟢 [COMPRA] ${formatMoney(amountToRisk)} em ${symbol} (Preço: ${formatMoney(currentPrice)})`;
      } 
      else if (signal === 'VENDER' && coinBalance > 0) {
        let amountToSell = coinBalance;
        if (symbol === bnbSymbol && bnbReserve > 0) {
          amountToSell = coinBalance - bnbReserve;
          if (amountToSell <= 0.00001) return prevWallet; 
        }

        const valorBruto = amountToSell * currentPrice;
        const valorLiquido = valorBruto - (valorBruto * taxaDecimal);
        const lucroPrejuizo = valorLiquido - (amountToSell * (newWallet.entryPrices[symbol] || currentPrice));

        newWallet.quote += valorLiquido;
        newWallet.balances[symbol] = coinBalance - amountToSell;
        if (newWallet.balances[symbol] <= 0.00001) {
          newWallet.balances[symbol] = 0;
          delete newWallet.entryPrices[symbol];
          delete highestPricesRef.current[symbol];
        }
        logMsg = `🔴 [VENDA] ${symbol} via ${motivo} (${formatMoney(currentPrice)}) | Resultado: ${lucroPrejuizo >= 0 ? '+' : ''}${formatMoney(lucroPrejuizo)}`;
        tradeClosed = true;
      }

      if (logMsg) newWallet.logs = [logMsg, ...newWallet.logs].slice(0, 20);

      if (tradeClosed) {
        let tempTotal = newWallet.quote;
        Object.entries(newWallet.balances).forEach(([s, a]) => { tempTotal += (a * (livePricesRef.current[s]?.close || 0)); });
        setEquityHistory(prev => [...prev, { time: new Date().toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'}), value: Number(tempTotal.toFixed(2)) }].slice(-20));
      }
      return newWallet;
    });
  };

  useEffect(() => {
    Object.entries(wallet.balances).forEach(([symbol, amount]) => {
      if (amount <= 0) return;
      const currentPrice = currentData[symbol]?.close;
      const entryPrice = wallet.entryPrices?.[symbol];
      if (!currentPrice || !entryPrice) return;

      if (!highestPricesRef.current[symbol] || currentPrice > highestPricesRef.current[symbol]) highestPricesRef.current[symbol] = currentPrice;
      if ((((currentPrice - highestPricesRef.current[symbol]) / highestPricesRef.current[symbol]) * 100) <= -trailStop) handleBotAction(symbol, 'VENDER', 'TRAILING STOP');
      else if ((((currentPrice - entryPrice) / entryPrice) * 100) >= takeProfit) handleBotAction(symbol, 'VENDER', 'TAKE PROFIT');
    });
  }, [currentData, trailStop, takeProfit, wallet.balances]);

  const resetWallet = () => {
    if(window.confirm("Zerar carteira e histórico?")) {
      const startAmount = baseCurrency === 'BRL' ? 5000 : baseCurrency === 'USDT' ? 1000 : 5;
      setWallet({ quote: startAmount, balances: {}, entryPrices: {}, logs: [] });
      setEquityHistory([{ time: 'Início', value: startAmount }, { time: 'Agora', value: startAmount }]);
      highestPricesRef.current = {}; lastSignalRef.current = {}; setReasonsLog({});
    }
  };

  useEffect(() => {
    if (selectedCoins.length === 0) return;
    const ws = new WebSocket('ws://localhost:4000');
    wsRef.current = ws;
    ws.onopen = () => ws.send(JSON.stringify({ action: 'update_subscriptions', symbols: selectedCoins.map(c => c.value) }));
    ws.onmessage = (e) => {
      const data = JSON.parse(e.data);
      if (data.interval === '1m') setCurrentData(prev => ({ ...prev, [data.symbol]: data }));
      else setHistoryOpen(prev => ({ ...prev, [`${data.symbol}_${data.interval}`]: data.open })); // Salva aberturas longas
    };
    return () => ws.close();
  }, [selectedCoins]);

  let totalPortfolioValue = wallet.quote;
  Object.entries(wallet.balances).forEach(([s, a]) => { totalPortfolioValue += (a * (currentData[s]?.close || 0)); });
  const startAmount = baseCurrency === 'BRL' ? 5000 : baseCurrency === 'USDT' ? 1000 : 5;
  const pnlPct = ((totalPortfolioValue - startAmount) / startAmount) * 100;
  
  const tradesFechados = wallet.logs.filter(l => l.includes('🔴'));
  const winRate = tradesFechados.length > 0 ? (tradesFechados.filter(l => l.includes('Resultado: +')).length / tradesFechados.length) * 100 : 0;

  const scrollListStyle = { marginTop: '10px', padding: '5px', maxHeight: '80px', overflowY: 'auto', fontSize: '0.72rem', borderTop: '1px solid #333', backgroundColor: '#161616', borderRadius: '4px' };

  // Função para Variação do Card
  const getVar = (sym, tf) => {
    const cur = currentData[sym]?.close;
    const op = tf === '1m' ? currentData[sym]?.open : historyOpen[`${sym}_${tf}`];
    return (cur && op) ? (((cur - op) / op) * 100).toFixed(2) : "0.00";
  };

  return (
    <div style={{ padding: '20px', backgroundColor: '#121212', color: '#fff', minHeight: '100vh', fontFamily: 'sans-serif' }}>
      
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
        <h1 style={{ margin: 0 }}>AI Crypto Terminal Pro</h1>
        <div style={{ display: 'flex', gap: '15px', alignItems: 'center' }}>
          
          <select value={baseCurrency} onChange={handleBaseCurrencyChange} style={{ padding: '8px', backgroundColor: '#1e1e1e', color: '#fff', border: '1px solid #444', borderRadius: '5px', fontWeight: 'bold' }}>
            <option value="USDT">Par: USDT</option>
            <option value="BRL">Par: BRL</option>
            <option value="BNB">Par: BNB</option>
          </select>

          <label style={{ fontSize: '0.85rem', color: '#aaa', cursor: 'pointer' }}>
            <input type="checkbox" checked={showCharts} onChange={e => setShowCharts(e.target.checked)} style={{ marginRight: '5px' }} />
            Exibir Gráficos
          </label>

          <label style={{ fontSize: '0.85rem', color: isRealMode ? '#ff4444' : '#00d2ff', cursor: 'pointer', fontWeight: 'bold', display: 'flex', alignItems: 'center', gap: '5px', backgroundColor: isRealMode ? 'rgba(255,68,68,0.1)' : 'rgba(0,210,255,0.1)', padding: '6px 12px', borderRadius: '6px', border: `1px solid ${isRealMode ? '#ff4444' : '#00d2ff'}` }}>
            <input type="checkbox" checked={isRealMode} onChange={e => setIsRealMode(e.target.checked)} style={{ display: 'none' }} />
            {isRealMode ? '🔥 MODO REAL (BINANCE)' : '🧪 MODO SIMULAÇÃO'}
          </label>

          <button onClick={resetWallet} style={{ backgroundColor: '#ff4444', color: '#fff', border: 'none', padding: '10px 15px', borderRadius: '5px', cursor: 'pointer', fontWeight: 'bold' }}>🔄 Resetar</button>
        </div>
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '15px', alignItems: 'flex-end', backgroundColor: '#1e1e1e', padding: '15px', borderRadius: '10px', border: '1px solid #333', marginBottom: '20px' }}>
        <div style={{ display: 'flex', flexDirection: 'column', flex: '1 1 100px' }}><label style={{ fontSize: '0.75rem', color: '#888', marginBottom: '5px' }}>Taxa (%)</label><input type="number" value={fee} onChange={e => setFee(Number(e.target.value))} step="0.01" style={{ backgroundColor: '#121212', border: '1px solid #444', color: '#fff', padding: '8px', borderRadius: '5px' }} /></div>
        <div style={{ display: 'flex', flexDirection: 'column', flex: '1 1 100px' }}><label style={{ fontSize: '0.75rem', color: '#00d2ff', marginBottom: '5px' }}>Risco/Trade (%)</label><input type="number" value={riskPct} onChange={e => setRiskPct(Number(e.target.value))} style={{ backgroundColor: '#121212', border: '1px solid #444', color: '#00d2ff', padding: '8px', borderRadius: '5px' }} /></div>
        <div style={{ display: 'flex', flexDirection: 'column', flex: '1 1 100px' }}><label style={{ fontSize: '0.75rem', color: '#ff4444', marginBottom: '5px' }}>Trail Stop (%)</label><input type="number" value={trailStop} onChange={e => setTrailStop(Number(e.target.value))} style={{ backgroundColor: '#121212', border: '1px solid #444', color: '#ff4444', padding: '8px', borderRadius: '5px' }} /></div>
        <div style={{ display: 'flex', flexDirection: 'column', flex: '1 1 100px' }}><label style={{ fontSize: '0.75rem', color: '#00ff88', marginBottom: '5px' }}>Take Profit (%)</label><input type="number" value={takeProfit} onChange={e => setTakeProfit(Number(e.target.value))} style={{ backgroundColor: '#121212', border: '1px solid #444', color: '#00ff88', padding: '8px', borderRadius: '5px' }} /></div>
        <div style={{ display: 'flex', flexDirection: 'column', flex: '1 1 100px' }}><label style={{ fontSize: '0.75rem', color: '#ff9900', marginBottom: '5px' }}>Volatilidade (%)</label><input type="number" value={minVol} onChange={e => setMinVol(Number(e.target.value))} step="0.05" style={{ backgroundColor: '#121212', border: '1px solid #444', color: '#ff9900', padding: '8px', borderRadius: '5px' }} /></div>
        <div style={{ display: 'flex', flexDirection: 'column', flex: '1 1 100px' }}><label style={{ fontSize: '0.75rem', color: '#f3ba2f', marginBottom: '5px' }}>Reserva BNB</label><input type="number" value={bnbReserve} onChange={e => setBnbReserve(Number(e.target.value))} step="0.1" style={{ backgroundColor: '#121212', border: '1px solid #444', color: '#f3ba2f', padding: '8px', borderRadius: '5px' }} /></div>
        <div style={{ display: 'flex', flexDirection: 'column', flex: '1 1 100px' }}><label style={{ fontSize: '0.75rem', color: '#b19cd9', marginBottom: '5px' }}>Tempo IA (s)</label><input type="number" value={aiInterval} onChange={e => setAiInterval(Number(e.target.value))} step="5" min="10" style={{ backgroundColor: '#121212', border: '1px solid #444', color: '#b19cd9', padding: '8px', borderRadius: '5px' }} /></div>
        <div style={{ display: 'flex', flexDirection: 'column', flex: '2 1 250px' }}>
          <label style={{ fontSize: '0.75rem', color: '#888', marginBottom: '5px' }}>Moedas (Par {baseCurrency})</label>
          <Select isMulti options={availableCoins} value={selectedCoins} onChange={setSelectedCoins} placeholder="Selecione..." styles={{ control: (b) => ({ ...b, backgroundColor: '#121212', borderColor: '#444'}), menu: (b) => ({ ...b, backgroundColor: '#1e1e1e', zIndex: 999 }), option: (b, s) => ({ ...b, backgroundColor: s.isFocused ? '#333' : '#1e1e1e', color: '#fff' }), multiValue: (b) => ({ ...b, backgroundColor: '#333' }), multiValueLabel: (b) => ({ ...b, color: '#fff' }) }} />
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '20px', marginBottom: '20px' }}>
        <div style={{ backgroundColor: '#1e1e1e', padding: '15px 20px', borderRadius: '10px', border: '1px solid #333', height: '165px', display: 'flex', flexDirection: 'column', position: 'relative', overflow: 'hidden' }}>
          <div style={{ position: 'relative', zIndex: 10 }}>
            <span style={{ color: '#888', fontSize: '0.9rem' }}>Patrimônio Total</span>
            <h2 style={{ margin: '2px 0' }}>{formatMoney(totalPortfolioValue)}</h2>
            <span style={{ color: pnlPct >= 0 ? '#00ff88' : '#ff4444', fontWeight: 'bold', fontSize: '0.85rem' }}>PnL: {pnlPct >= 0 ? '+' : ''}{pnlPct.toFixed(2)}%</span>
          </div>
          <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: '75px', zIndex: 1, opacity: 0.35 }}>
            <ResponsiveContainer width="100%" height="100%"><LineChart data={equityHistory}><Line type="monotone" dataKey="value" stroke={pnlPct >= 0 ? "#00ff88" : "#ff4444"} strokeWidth={3} dot={false} isAnimationActive={true} /></LineChart></ResponsiveContainer>
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
                <div key={i} style={{ padding: '3px 0', borderBottom: '1px solid #222', color: trade.includes('+') ? '#00ff88' : '#ff4444', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{trade.split('|')[0].replace('🔴 [VENDA] ', '')} | {trade.split('|')[1]}</div>
            ))}
          </div>
        </div>

        <div style={{ backgroundColor: '#1e1e1e', padding: '20px', borderRadius: '10px', border: '1px solid #333', height: '165px', display: 'flex', flexDirection: 'column' }}>
          <span style={{ color: '#888', fontSize: '0.9rem' }}>Caixa Livre ({baseCurrency})</span>
          <h2 style={{ margin: '5px 0' }}>{formatMoney(wallet.quote)}</h2>
          <div className="custom-scroll" style={scrollListStyle}>
            {Object.keys(wallet.balances).filter(c => wallet.balances[c] > 0).length === 0 ? <div style={{ color: '#555', fontStyle: 'italic' }}>Estoque Vazio.</div> : Object.entries(wallet.balances).map(([coin, amount]) => (
                amount > 0 && <div key={coin} style={{ display: 'flex', justifyContent: 'space-between', padding: '3px 0', borderBottom: '1px solid #222' }}><span style={{ color: '#ff9900', fontWeight: 'bold' }}>{coin.replace(baseCurrency, '')}</span><span style={{ color: '#aaa' }}>{amount.toFixed(6)}</span></div>
            ))}
          </div>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: showCharts ? '1fr 2.5fr' : '1fr 1.2fr', gap: '20px' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
          <div style={{ backgroundColor: '#1e1e1e', padding: '20px', borderRadius: '10px', border: '1px solid #333' }}>
            <h4 style={{ margin: '0 0 15px 0', color: '#888' }}>📝 Operações (20)</h4>
            <div className="custom-scroll" style={{ display: 'flex', flexDirection: 'column', gap: '8px', maxHeight: '400px', overflowY: 'auto' }}>
              {wallet.logs.length === 0 && <div style={{ color: '#555', fontSize: '0.8rem' }}>Aguardando...</div>}
              {wallet.logs.map((log, i) => (
                <div key={i} style={{ fontSize: '0.75rem', padding: '10px', borderRadius: '6px', backgroundColor: '#161616', borderLeft: `4px solid ${log.includes('🟢') ? '#00ff88' : '#ff4444'}`, color: '#eee' }}>{log}</div>
              ))}
            </div>
          </div>
          <div style={{ backgroundColor: '#1e1e1e', padding: '20px', borderRadius: '10px', border: '1px solid #333' }}>
            <h4 style={{ margin: '0 0 15px 0', color: '#888' }}>🧠 Diário IA</h4>
            <div className="custom-scroll" style={{ display: 'flex', flexDirection: 'column', gap: '10px', maxHeight: '300px', overflowY: 'auto' }}>
              {Object.keys(reasonsLog).length === 0 && <div style={{ color: '#555', fontSize: '0.8rem' }}>Aguardando Cérebro...</div>}
              {Object.entries(reasonsLog).filter(([sym]) => selectedCoins.some(c => c.value === sym)).map(([sym, data]) => (
                <div key={sym} style={{ backgroundColor: '#161616', padding: '10px', borderRadius: '6px', border: '1px solid #2a2a2a' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '5px' }}><strong style={{ color: '#ff9900', fontSize: '0.8rem' }}>{sym}</strong><span style={{ fontSize: '0.75rem', color: '#666' }}>{data.time}</span></div>
                  <div style={{ fontSize: '0.75rem', color: data.signal === 'COMPRAR' ? '#00ff88' : '#ff4444', fontWeight: 'bold' }}>➔ {data.signal}</div>
                  <div style={{ fontSize: '0.7rem', color: '#aaa', fontStyle: 'italic', marginTop:'5px' }}>{data.reasons ? data.reasons.join(' | ') : '...'}</div>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
          {selectedCoins.map(coin => {
            const d = currentData[coin.value];
            const v1m = getVar(coin.value, '1m');
            const v1h = getVar(coin.value, '1h');
            const v24h = getVar(coin.value, '1d');

            return (
              <div key={coin.value} style={{ backgroundColor: '#1e1e1e', padding: '20px', borderRadius: '10px', border: '1px solid #333' }}>
                
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '10px' }}>
                  <div>
                    <h3 style={{ margin: 0, color: '#ff9900' }}>{coin.label}</h3>
                    {/* 🟢 BADGES DE VARIAÇÃO NO CARD */}
                    <div style={{ display: 'flex', gap: '10px', marginTop: '10px', fontSize: '0.75rem' }}>
                      <span style={{ color: v1m >= 0 ? '#00ff88' : '#ff4444', backgroundColor: 'rgba(255,255,255,0.05)', padding: '4px 8px', borderRadius: '4px' }}>{v1m >= 0 ? '▲ subiu' : '▼ caiu'} {Math.abs(v1m)}%/min</span>
                      <span style={{ color: v1h >= 0 ? '#00ff88' : '#ff4444', backgroundColor: 'rgba(255,255,255,0.05)', padding: '4px 8px', borderRadius: '4px' }}>{v1h >= 0 ? '▲ subiu' : '▼ caiu'} {Math.abs(v1h)}%/hora</span>
                      <span style={{ color: v24h >= 0 ? '#00ff88' : '#ff4444', backgroundColor: 'rgba(255,255,255,0.05)', padding: '4px 8px', borderRadius: '4px' }}>{v24h >= 0 ? '▲ subiu' : '▼ caiu'} {Math.abs(v24h)}%/dia</span>
                    </div>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <h3 style={{ margin: 0, color: d?.close >= d?.open ? '#00ff88' : '#ff4444', fontFamily: 'monospace' }}>{d ? formatMoney(d.close) : '...'}</h3>
                  </div>
                </div>
                
                <AIPrediction symbol={coin.value} onUpdate={handleAiUpdate} updateInterval={aiInterval} />
                
                <div style={{ display: 'flex', gap: '15px', marginTop: '15px', borderTop: '1px solid #2a2a2a', paddingTop: '15px' }}>
                  {showCharts && <div style={{ flex: 3 }}><Chart symbol={coin.value} liveData={d} /></div>}
                  
                  {/* 🟢 O LIVRO DE OFERTAS AO LADO DO GRÁFICO */}
                  <div style={{ flex: 1, backgroundColor: '#161616', padding: '10px', borderRadius: '8px', border: '1px solid #333', minWidth: '180px' }}>
                    <h4 style={{ margin: '0 0 10px 0', color: '#888', fontSize: '0.8rem', textAlign: 'center' }}>📖 Livro de Ofertas</h4>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', fontSize: '0.75rem', fontFamily: 'monospace' }}>
                      <div style={{ backgroundColor: 'rgba(255,68,68,0.1)', padding: '8px', borderRadius: '4px', borderLeft: '2px solid #ff4444' }}>
                        <span style={{ color: '#aaa' }}>Venda (Ask)</span><br/>
                        <strong style={{ color: '#ff4444', fontSize: '0.9rem' }}>{d?.ask_price ? formatMoney(d.ask_price) : '...'}</strong><br/>
                        <span style={{ color: '#888' }}>Vol: {d?.ask_volume?.toFixed(2) || '...'}</span>
                      </div>
                      <div style={{ textAlign: 'center', color: '#555', fontSize: '0.6rem' }}>SPREAD</div>
                      <div style={{ backgroundColor: 'rgba(0,255,136,0.1)', padding: '8px', borderRadius: '4px', borderLeft: '2px solid #00ff88' }}>
                        <span style={{ color: '#aaa' }}>Compra (Bid)</span><br/>
                        <strong style={{ color: '#00ff88', fontSize: '0.9rem' }}>{d?.bid_price ? formatMoney(d.bid_price) : '...'}</strong><br/>
                        <span style={{ color: '#888' }}>Vol: {d?.bid_volume?.toFixed(2) || '...'}</span>
                      </div>
                    </div>
                  </div>
                </div>

            </div>
          )})}
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