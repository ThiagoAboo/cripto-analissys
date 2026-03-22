import { useState, useEffect, useRef } from 'react';
import Select from 'react-select';
import Chart from './Chart';
import AIPrediction from './AIPrediction';
import { LineChart, Line, Tooltip, ResponsiveContainer } from 'recharts';

export default function App() {
  // 🟢 1. ESTADO PARA ARMAZENAR AS MOEDAS DINÂMICAS DA BINANCE
  const [availableCoins, setAvailableCoins] = useState([]);
  
  const [selectedCoins, setSelectedCoins] = useState(() => {
    const saved = localStorage.getItem('bot_selected_coins');
    return saved ? JSON.parse(saved) : [{ value: 'BTCBRL', label: 'BTC (BTCBRL)' }];
  });
  
  // 🟢 2. BUSCA TODAS AS MOEDAS COM PARIDADE EM REAL (BRL) NA BINANCE
  useEffect(() => {
    fetch('https://api.binance.com/api/v3/exchangeInfo')
      .then(res => res.json())
      .then(data => {
        const brlPairs = data.symbols
          .filter(s => s.quoteAsset === 'BRL' && s.status === 'TRADING')
          .map(s => ({
            value: s.symbol,
            label: `${s.baseAsset} (${s.symbol})`
          }));
        
        // Ordena por ordem alfabética para facilitar a busca
        brlPairs.sort((a, b) => a.label.localeCompare(b.label));
        setAvailableCoins(brlPairs);
      })
      .catch(err => console.error('Erro ao carregar pares BRL:', err));
  }, []);

  const [currentData, setCurrentData] = useState({}); 
  const wsRef = useRef(null);
  const livePricesRef = useRef({});
  const lastSignalRef = useRef({});
  const highestPricesRef = useRef({}); 
  const [reasonsLog, setReasonsLog] = useState({});

  // ESTADOS DE CONFIGURAÇÃO
  const [fee, setFee] = useState(() => Number(localStorage.getItem('bot_fee')) || 0.1);
  const [riskPct, setRiskPct] = useState(() => Number(localStorage.getItem('bot_risk_pct')) || 5);
  const [trailStop, setTrailStop] = useState(() => Number(localStorage.getItem('bot_trail_stop')) || 2);
  const [takeProfit, setTakeProfit] = useState(() => Number(localStorage.getItem('bot_tp')) || 5);
  const [minVol, setMinVol] = useState(() => Number(localStorage.getItem('bot_vol')) || 0.15);
  const [showCharts, setShowCharts] = useState(() => JSON.parse(localStorage.getItem('bot_show_charts') ?? 'true'));
  const [isRealMode, setIsRealMode] = useState(() => JSON.parse(localStorage.getItem('bot_real_mode') ?? 'false'));
  const [bnbReserve, setBnbReserve] = useState(() => Number(localStorage.getItem('bot_bnb_reserve')) || 0);
  const [aiInterval, setAiInterval] = useState(() => Number(localStorage.getItem('bot_ai_interval')) || 60);

  useEffect(() => {
    localStorage.setItem('bot_selected_coins', JSON.stringify(selectedCoins));
    localStorage.setItem('bot_fee', fee);
    localStorage.setItem('bot_risk_pct', riskPct);
    localStorage.setItem('bot_trail_stop', trailStop);
    localStorage.setItem('bot_tp', takeProfit);
    localStorage.setItem('bot_vol', minVol);
    localStorage.setItem('bot_show_charts', showCharts);
    localStorage.setItem('bot_real_mode', isRealMode);
    localStorage.setItem('bot_bnb_reserve', bnbReserve);
    localStorage.setItem('bot_ai_interval', aiInterval);
  }, [selectedCoins, fee, riskPct, trailStop, takeProfit, minVol, showCharts, isRealMode, bnbReserve, aiInterval]);

  // 🟢 3. CARTEIRA AGORA BASEADA EM BRL (R$ 5000 INICIAIS)
  const getInitialWallet = () => {
    const saved = localStorage.getItem('cryptoBotWalletBRL');
    return saved ? JSON.parse(saved) : { brl: 5000, balances: {}, entryPrices: {}, logs: [] };
  };
  const [wallet, setWallet] = useState(getInitialWallet);

  const [equityHistory, setEquityHistory] = useState(() => {
    const saved = localStorage.getItem('bot_equity_history_brl');
    const parsed = saved ? JSON.parse(saved) : null;
    return (parsed && parsed.length > 1) ? parsed : [{ time: 'Início', value: 5000 }, { time: 'Agora', value: 5000 }];
  });

  useEffect(() => { localStorage.setItem('cryptoBotWalletBRL', JSON.stringify(wallet)); }, [wallet]);
  useEffect(() => { localStorage.setItem('bot_equity_history_brl', JSON.stringify(equityHistory)); }, [equityHistory]);
  useEffect(() => { livePricesRef.current = currentData; }, [currentData]);

  const handleAiUpdate = (symbol, signal, reasons) => {
    setReasonsLog(prev => ({
      ...prev,
      [symbol]: { time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }), signal, reasons }
    }));
    handleBotAction(symbol, signal, "IA");
  };

  const handleBotAction = (symbol, signal, motivo = "IA") => {
    const currentPrice = livePricesRef.current[symbol]?.close;
    const openPrice = livePricesRef.current[symbol]?.open;
    if (!currentPrice || !openPrice) return;

    if (motivo === "IA" && lastSignalRef.current[symbol] === signal) return;
    if (motivo === "IA" && signal === 'COMPRAR') {
      const volatidadeAtual = (Math.abs(currentPrice - openPrice) / openPrice) * 100;
      if (volatidadeAtual < minVol) return; 
    }

    if (motivo === "IA") lastSignalRef.current[symbol] = signal;
    
    setWallet(prevWallet => {
      let newWallet = { ...prevWallet, balances: { ...prevWallet.balances }, entryPrices: { ...prevWallet.entryPrices }, logs: [...prevWallet.logs] };
      let coinBalance = newWallet.balances[symbol] || 0;
      let logMsg = "";
      let tradeClosed = false; 

      const hasBnbReserve = (newWallet.balances['BNBBRL'] || 0) >= bnbReserve && bnbReserve > 0;
      const taxaAplicada = hasBnbReserve ? (fee * 0.75) : fee; 
      const taxaDecimal = taxaAplicada / 100;
      const bonusMsg = hasBnbReserve ? " (Desc. BNB)" : "";

      if (signal === 'COMPRAR' && newWallet.brl >= 10) {
        let amountToRisk = newWallet.brl * (riskPct / 100);
        if (amountToRisk < 10) amountToRisk = 10; // Binance permite trades mínimos de R$10
        if (amountToRisk > newWallet.brl) amountToRisk = newWallet.brl;

        const custoTaxa = amountToRisk * taxaDecimal;
        const amountToBuy = (amountToRisk - custoTaxa) / currentPrice;
        
        newWallet.brl -= amountToRisk;
        newWallet.balances[symbol] = coinBalance + amountToBuy;
        newWallet.entryPrices[symbol] = currentPrice;
        highestPricesRef.current[symbol] = currentPrice;
        
        logMsg = `🟢 [COMPRA] R$ ${amountToRisk.toFixed(2)} em ${symbol}${bonusMsg} (Preço: R$ ${currentPrice.toFixed(2)})`;
      } 
      else if (signal === 'VENDER' && coinBalance > 0) {
        let amountToSell = coinBalance;
        let isPartialSell = false;

        if (symbol === 'BNBBRL' && bnbReserve > 0) {
          amountToSell = coinBalance - bnbReserve;
          if (amountToSell <= 0.00001) return prevWallet; 
          isPartialSell = true;
        }

        const valorBruto = amountToSell * currentPrice;
        const custoTaxa = valorBruto * taxaDecimal;
        const valorLiquido = valorBruto - custoTaxa;
        const lucroPrejuizo = valorLiquido - (amountToSell * (newWallet.entryPrices[symbol] || currentPrice));
        const pnlSinal = lucroPrejuizo >= 0 ? '+' : '';

        newWallet.brl += valorLiquido;
        newWallet.balances[symbol] = coinBalance - amountToSell;

        if (newWallet.balances[symbol] <= 0.00001) {
          newWallet.balances[symbol] = 0;
          delete newWallet.entryPrices[symbol];
          delete highestPricesRef.current[symbol];
        }
        
        logMsg = `🔴 [VENDA${isPartialSell ? ' PARCIAL' : ''}] ${symbol} via ${motivo}${bonusMsg} (R$ ${currentPrice.toFixed(2)}) | Resultado: ${pnlSinal}R$ ${lucroPrejuizo.toFixed(2)}`;
        tradeClosed = true;
      }

      // 🟢 4. PROTEÇÃO DE MEMÓRIA: LIMITADO A 20 ITENS
      if (logMsg) newWallet.logs = [logMsg, ...newWallet.logs].slice(0, 20);

      if (tradeClosed) {
        let tempTotal = newWallet.brl;
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

      if (!highestPricesRef.current[symbol] || currentPrice > highestPricesRef.current[symbol]) {
        highestPricesRef.current[symbol] = currentPrice;
      }

      const highestPrice = highestPricesRef.current[symbol];
      const drawdownFromTop = ((currentPrice - highestPrice) / highestPrice) * 100;
      const totalProfitPct = ((currentPrice - entryPrice) / entryPrice) * 100;

      if (drawdownFromTop <= -trailStop) {
        handleBotAction(symbol, 'VENDER', 'TRAILING STOP');
      } else if (totalProfitPct >= takeProfit) {
        handleBotAction(symbol, 'VENDER', 'TAKE PROFIT');
      }
    });
  }, [currentData, trailStop, takeProfit, wallet.balances]);

  const resetWallet = () => {
    if(window.confirm("Zerar carteira e histórico?")) {
      setWallet({ brl: 5000, balances: {}, entryPrices: {}, logs: [] });
      setEquityHistory([{ time: 'Início', value: 5000 }, { time: 'Agora', value: 5000 }]);
      highestPricesRef.current = {};
      lastSignalRef.current = {};
      setReasonsLog({});
    }
  };

  useEffect(() => {
    if (selectedCoins.length === 0) return;
    const ws = new WebSocket('ws://localhost:4000');
    wsRef.current = ws;
    ws.onopen = () => ws.send(JSON.stringify({ action: 'update_subscriptions', symbols: selectedCoins.map(c => c.value) }));
    ws.onmessage = (e) => {
      const data = JSON.parse(e.data);
      setCurrentData(prev => ({ ...prev, [data.symbol]: data }));
    };
    return () => ws.close();
  }, [selectedCoins]);

  let totalPortfolioValue = wallet.brl;
  Object.entries(wallet.balances).forEach(([s, a]) => { totalPortfolioValue += (a * (currentData[s]?.close || 0)); });
  const pnlPct = ((totalPortfolioValue - 5000) / 5000) * 100;
  
  const tradesFechados = wallet.logs.filter(l => l.includes('🔴'));
  const vitorias = tradesFechados.filter(l => l.includes('Resultado: +')).length;
  const winRate = tradesFechados.length > 0 ? (vitorias / tradesFechados.length) * 100 : 0;
  const failRate = tradesFechados.length > 0 ? 100 - winRate : 0;

  const scrollListStyle = { marginTop: '10px', padding: '5px', maxHeight: '80px', overflowY: 'auto', fontSize: '0.72rem', borderTop: '1px solid #333', backgroundColor: '#161616', borderRadius: '4px' };
  const CustomTooltip = ({ active, payload, label }) => {
    if (active && payload && payload.length) {
      return (
        <div style={{ backgroundColor: '#222', padding: '10px', border: '1px solid #444', borderRadius: '5px', zIndex: 9999 }}>
          <p style={{ color: '#aaa', margin: 0, fontSize: '0.8rem' }}>{label}</p>
          <p style={{ color: '#00ff88', margin: 0, fontWeight: 'bold' }}>R$ {payload[0].value.toFixed(2)}</p>
        </div>
      );
    }
    return null;
  };

  return (
    <div style={{ padding: '20px', backgroundColor: '#121212', color: '#fff', minHeight: '100vh', fontFamily: 'sans-serif' }}>
      
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
        <h1 style={{ margin: 0 }}>AI Crypto Terminal Pro</h1>
        <div style={{ display: 'flex', gap: '20px', alignItems: 'center' }}>
          
          <label style={{ fontSize: '0.85rem', color: '#aaa', cursor: 'pointer' }}>
            <input type="checkbox" checked={showCharts} onChange={e => setShowCharts(e.target.checked)} style={{ marginRight: '5px' }} />
            Exibir Gráficos
          </label>

          <label style={{ 
            fontSize: '0.85rem', color: isRealMode ? '#ff4444' : '#00d2ff', cursor: 'pointer', fontWeight: 'bold', 
            display: 'flex', alignItems: 'center', gap: '5px', backgroundColor: isRealMode ? 'rgba(255,68,68,0.1)' : 'rgba(0,210,255,0.1)',
            padding: '6px 12px', borderRadius: '6px', border: `1px solid ${isRealMode ? '#ff4444' : '#00d2ff'}`
          }}>
            <input type="checkbox" checked={isRealMode} onChange={e => setIsRealMode(e.target.checked)} style={{ display: 'none' }} />
            {isRealMode ? '🔥 MODO REAL (BINANCE)' : '🧪 MODO SIMULAÇÃO'}
          </label>

          <button onClick={resetWallet} style={{ backgroundColor: '#ff4444', color: '#fff', border: 'none', padding: '10px 15px', borderRadius: '5px', cursor: 'pointer', fontWeight: 'bold' }}>
            🔄 Resetar Sistema
          </button>
        </div>
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '15px', alignItems: 'flex-end', backgroundColor: '#1e1e1e', padding: '15px', borderRadius: '10px', border: '1px solid #333', marginBottom: '20px' }}>
        <div style={{ display: 'flex', flexDirection: 'column', flex: '1 1 120px' }}>
          <label style={{ fontSize: '0.75rem', color: '#888', marginBottom: '5px' }}>Taxa Corretagem (%)</label>
          <input type="number" value={fee} onChange={e => setFee(Number(e.target.value))} step="0.01" style={{ backgroundColor: '#121212', border: '1px solid #444', color: '#fff', padding: '8px', borderRadius: '5px' }} />
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', flex: '1 1 120px' }}>
          <label style={{ fontSize: '0.75rem', color: '#888', marginBottom: '5px', color: '#00d2ff' }}>Risco por Trade (%)</label>
          <input type="number" value={riskPct} onChange={e => setRiskPct(Number(e.target.value))} style={{ backgroundColor: '#121212', border: '1px solid #444', color: '#00d2ff', padding: '8px', borderRadius: '5px' }} />
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', flex: '1 1 120px' }}>
          <label style={{ fontSize: '0.75rem', color: '#888', marginBottom: '5px', color: '#ff4444' }}>Trailing Stop (%)</label>
          <input type="number" value={trailStop} onChange={e => setTrailStop(Number(e.target.value))} style={{ backgroundColor: '#121212', border: '1px solid #444', color: '#ff4444', padding: '8px', borderRadius: '5px' }} />
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', flex: '1 1 120px' }}>
          <label style={{ fontSize: '0.75rem', color: '#888', marginBottom: '5px' }}>Take Profit (%)</label>
          <input type="number" value={takeProfit} onChange={e => setTakeProfit(Number(e.target.value))} style={{ backgroundColor: '#121212', border: '1px solid #444', color: '#00ff88', padding: '8px', borderRadius: '5px' }} />
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', flex: '1 1 120px' }}>
          <label style={{ fontSize: '0.75rem', color: '#888', marginBottom: '5px' }}>Volatilidade Mín. (%)</label>
          <input type="number" value={minVol} onChange={e => setMinVol(Number(e.target.value))} step="0.05" style={{ backgroundColor: '#121212', border: '1px solid #444', color: '#ff9900', padding: '8px', borderRadius: '5px' }} />
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', flex: '1 1 120px' }}>
          <label style={{ fontSize: '0.75rem', color: '#f3ba2f', marginBottom: '5px', fontWeight: 'bold' }}>Reserva BNB (Qtd)</label>
          <input type="number" value={bnbReserve} onChange={e => setBnbReserve(Number(e.target.value))} step="0.1" style={{ backgroundColor: '#121212', border: '1px solid #444', color: '#f3ba2f', padding: '8px', borderRadius: '5px' }} />
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', flex: '1 1 120px' }}>
          <label style={{ fontSize: '0.75rem', color: '#b19cd9', marginBottom: '5px', fontWeight: 'bold' }}>Atualização IA (Seg)</label>
          <input type="number" value={aiInterval} onChange={e => setAiInterval(Number(e.target.value))} step="5" min="10" style={{ backgroundColor: '#121212', border: '1px solid #444', color: '#b19cd9', padding: '8px', borderRadius: '5px' }} />
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', flex: '2 1 250px' }}>
          <label style={{ fontSize: '0.75rem', color: '#888', marginBottom: '5px' }}>Moedas em Operação (Pares em BRL)</label>
          <Select 
            isMulti 
            options={availableCoins} 
            value={selectedCoins} 
            onChange={setSelectedCoins}
            placeholder={availableCoins.length > 0 ? "Selecione as moedas..." : "Carregando da Binance..."}
            styles={{
              control: (b) => ({ ...b, backgroundColor: '#121212', borderColor: '#444'}),
              menu: (b) => ({ ...b, backgroundColor: '#1e1e1e', zIndex: 999 }),
              option: (b, s) => ({ ...b, backgroundColor: s.isFocused ? '#333' : '#1e1e1e', color: '#fff' }),
              multiValue: (b) => ({ ...b, backgroundColor: '#333', minWidth: 'max-content' }),
              multiValueLabel: (b) => ({ ...b, color: '#fff' })
            }}
          />
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '20px', marginBottom: '20px' }}>
        <div style={{ backgroundColor: '#1e1e1e', padding: '15px 20px', borderRadius: '10px', border: '1px solid #333', height: '165px', boxSizing: 'border-box', display: 'flex', flexDirection: 'column', position: 'relative', overflow: 'hidden' }}>
          <div style={{ position: 'relative', zIndex: 10 }}>
            <span style={{ color: '#888', fontSize: '0.9rem' }}>Patrimônio Total</span>
            <h2 style={{ margin: '2px 0', textShadow: '1px 1px 3px rgba(0,0,0,0.8)' }}>R$ {totalPortfolioValue.toFixed(2)}</h2>
            <span style={{ color: pnlPct >= 0 ? '#00ff88' : '#ff4444', fontWeight: 'bold', fontSize: '0.85rem', textShadow: '1px 1px 3px rgba(0,0,0,0.8)' }}>
              PnL: {pnlPct >= 0 ? '+' : ''}{pnlPct.toFixed(2)}%
            </span>
          </div>
          <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: '75px', zIndex: 1, opacity: 0.35 }}>
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={equityHistory}>
                <Tooltip content={<CustomTooltip />} />
                <Line type="monotone" dataKey="value" stroke={pnlPct >= 0 ? "#00ff88" : "#ff4444"} strokeWidth={3} dot={false} isAnimationActive={true} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div style={{ backgroundColor: '#1e1e1e', padding: '20px', borderRadius: '10px', border: '1px solid #333', height: '165px', boxSizing: 'border-box', display: 'flex', flexDirection: 'column' }}>
          <span style={{ color: '#888', fontSize: '0.9rem' }}>Estratégia Ativa</span>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '5px' }}>
             <div style={{ color: '#00ff88', fontWeight: 'bold', fontSize: '0.85rem' }}>Win: {winRate.toFixed(1)}%</div>
             <div style={{ color: '#ff4444', fontWeight: 'bold', fontSize: '0.85rem' }}>Fail: {failRate.toFixed(1)}%</div>
             <div style={{ fontSize: '0.75rem', color: '#666' }}>{tradesFechados.length} trades</div>
          </div>
          <div className="custom-scroll" style={scrollListStyle}>
            {tradesFechados.length === 0 ? <div style={{ color: '#555', fontStyle: 'italic' }}>Aguardando fechamento...</div> : tradesFechados.map((trade, i) => (
                <div key={i} style={{ padding: '3px 0', borderBottom: '1px solid #222', color: trade.includes('+') ? '#00ff88' : '#ff4444', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {trade.split('|')[0].replace('🔴 [VENDA] ', '')} | {trade.split('|')[1]}
                </div>
            ))}
          </div>
        </div>

        <div style={{ backgroundColor: '#1e1e1e', padding: '20px', borderRadius: '10px', border: '1px solid #333', height: '165px', boxSizing: 'border-box', display: 'flex', flexDirection: 'column' }}>
          <span style={{ color: '#888', fontSize: '0.9rem' }}>Caixa Livre (BRL)</span>
          <h2 style={{ margin: '5px 0' }}>R$ {wallet.brl.toFixed(2)}</h2>
          <div className="custom-scroll" style={scrollListStyle}>
            {Object.keys(wallet.balances).filter(c => wallet.balances[c] > 0).length === 0 ? <div style={{ color: '#555', fontStyle: 'italic' }}>Nenhuma moeda em estoque.</div> : Object.entries(wallet.balances).map(([coin, amount]) => (
                amount > 0 && <div key={coin} style={{ display: 'flex', justifyContent: 'space-between', padding: '3px 0', borderBottom: '1px solid #222' }}><span style={{ color: '#ff9900', fontWeight: 'bold' }}>{coin.replace('BRL', '')}</span><span style={{ color: '#aaa' }}>{amount.toFixed(6)}</span></div>
            ))}
          </div>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: showCharts ? '1fr 2fr' : '1fr 1.2fr', gap: '20px' }}>
        
        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
          <div style={{ backgroundColor: '#1e1e1e', padding: '20px', borderRadius: '10px', border: '1px solid #333', height: 'fit-content' }}>
            <h4 style={{ margin: '0 0 15px 0', color: '#888', display: 'flex', alignItems: 'center', gap: '8px' }}>📝 Diário de Bordo</h4>
            <div className="custom-scroll" style={{ display: 'flex', flexDirection: 'column', gap: '8px', maxHeight: '400px', overflowY: 'auto', paddingRight: '5px' }}>
              {wallet.logs.length === 0 && <div style={{ color: '#555', fontSize: '0.8rem' }}>Aguardando sinais...</div>}
              {wallet.logs.map((log, i) => (
                <div key={i} style={{ fontSize: '0.78rem', padding: '10px', borderRadius: '6px', backgroundColor: '#161616', borderLeft: `4px solid ${log.includes('🟢') ? '#00ff88' : '#ff4444'}`, color: '#eee' }}>{log}</div>
              ))}
            </div>
          </div>

          <div style={{ backgroundColor: '#1e1e1e', padding: '20px', borderRadius: '10px', border: '1px solid #333', height: 'fit-content' }}>
            <h4 style={{ margin: '0 0 15px 0', color: '#888', display: 'flex', alignItems: 'center', gap: '8px' }}>🧠 Diário de Motivos (IA)</h4>
            <div className="custom-scroll" style={{ display: 'flex', flexDirection: 'column', gap: '10px', maxHeight: '300px', overflowY: 'auto', paddingRight: '5px' }}>
              {Object.keys(reasonsLog).length === 0 && <div style={{ color: '#555', fontSize: '0.8rem' }}>Aguardando processamento do Cérebro...</div>}
              {Object.entries(reasonsLog)
                .filter(([sym]) => selectedCoins.some(c => c.value === sym))
                .map(([sym, data]) => {
                  const isBuy = data.signal === 'COMPRAR';
                  return (
                    <div key={sym} style={{ backgroundColor: '#161616', padding: '10px', borderRadius: '6px', border: '1px solid #2a2a2a' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '5px' }}>
                        <strong style={{ color: '#ff9900', fontSize: '0.8rem' }}>{sym}</strong>
                        <span style={{ fontSize: '0.75rem', color: '#666' }}>{data.time}</span>
                      </div>
                      <div style={{ fontSize: '0.75rem', color: isBuy ? '#00ff88' : '#ff4444', fontWeight: 'bold', marginBottom: '5px' }}>
                        ➔ {data.signal}
                      </div>
                      <div style={{ fontSize: '0.7rem', color: '#aaa', fontStyle: 'italic' }}>
                        {data.reasons ? data.reasons.join(' | ') : 'Calculando...'}
                      </div>
                    </div>
                  )
              })}
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
          {selectedCoins.map(coin => (
            <div key={coin.value} style={{ backgroundColor: '#1e1e1e', padding: '20px', borderRadius: '10px', border: '1px solid #333', transition: 'all 0.3s' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
                <h3 style={{ margin: 0, color: '#ff9900' }}>{coin.label}</h3>
                <h3 style={{ margin: 0, color: currentData[coin.value]?.close >= currentData[coin.value]?.open ? '#00ff88' : '#ff4444', fontFamily: 'monospace' }}>
                  {currentData[coin.value] ? `R$ ${currentData[coin.value].close.toFixed(2)}` : 'Carregando...'}
                </h3>
              </div>
              
              <AIPrediction symbol={coin.value} onUpdate={handleAiUpdate} updateInterval={aiInterval} />
              
              {showCharts && <div style={{ marginTop: '15px', borderTop: '1px solid #2a2a2a', paddingTop: '15px' }}><Chart symbol={coin.value} liveData={currentData[coin.value]} /></div>}
            </div>
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