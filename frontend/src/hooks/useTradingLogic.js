import { useState, useEffect, useRef, useCallback, useMemo } from 'react';

export default function useTradingLogic({ baseCurrency, selectedCoins, currentData, minVol, fee, riskPct, trailStop, takeProfit, bnbReserve }) {
  const livePricesRef = useRef({});
  const lastSignalRef = useRef({});
  const highestPricesRef = useRef({});
  const [reasonsLog, setReasonsLog] = useState({});
  
  // Carteira
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

  // Persistir carteira e histórico
  useEffect(() => {
    localStorage.setItem(`cryptoWallet_${baseCurrency}`, JSON.stringify(wallet));
  }, [wallet, baseCurrency]);

  useEffect(() => {
    localStorage.setItem(`equityHistory_${baseCurrency}`, JSON.stringify(equityHistory));
  }, [equityHistory, baseCurrency]);

  // Atualizar referência de preços
  useEffect(() => {
    livePricesRef.current = currentData;
  }, [currentData]);

  const formatMoney = useCallback((value) => {
    if (baseCurrency === 'BRL') return `R$ ${value.toFixed(2)}`;
    if (baseCurrency === 'USDT') return `$ ${value.toFixed(2)}`;
    return `BNB ${value.toFixed(4)}`;
  }, [baseCurrency]);

  // Função principal de execução de trades
  const handleBotAction = useCallback((symbol, signal, motivo = "IA") => {
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
      let taxaAplicada = fee;
      // Verifica se há BNB suficiente para pagar taxa com desconto
      if (bnbReserve > 0 && (newWallet.balances[bnbSymbol] || 0) >= bnbReserve) {
        taxaAplicada = fee * 0.75;
        // Em um cenário real, você debitaria o BNB do saldo. Para simulação, apenas reduzimos a taxa.
      }
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
        logMsg = `🔴 [VENDA] ${symbol} via ${motivo} (${formatMoney(currentPrice)}) | Res: ${lucroPrejuizo >= 0 ? '+' : ''}${formatMoney(lucroPrejuizo)}`;
        tradeClosed = true;
      }

      if (logMsg) newWallet.logs = [logMsg, ...newWallet.logs].slice(0, 200);

      if (tradeClosed) {
        let tempTotal = newWallet.quote;
        Object.entries(newWallet.balances).forEach(([s, a]) => { tempTotal += (a * (livePricesRef.current[s]?.close || 0)); });
        setEquityHistory(prev => [...prev, { time: new Date().toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'}), value: Number(tempTotal.toFixed(2)) }].slice(-20));
      }
      return newWallet;
    });
  }, [baseCurrency, fee, riskPct, minVol, bnbReserve, formatMoney]);

  const handleAiUpdate = useCallback((symbol, signal, reasons) => {
    setReasonsLog(prev => ({ ...prev, [symbol]: { time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }), signal, reasons } }));
    handleBotAction(symbol, signal, "IA");
  }, [handleBotAction]);

  // Gerenciamento de stops (trailing e take profit)
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
  }, [currentData, trailStop, takeProfit, wallet.balances, handleBotAction]);

  // Função para resetar a carteira
  const resetWallet = useCallback(() => {
    if(window.confirm("Zerar carteira e histórico?")) {
      const startAmount = baseCurrency === 'BRL' ? 5000 : baseCurrency === 'USDT' ? 1000 : 5;
      setWallet({ quote: startAmount, balances: {}, entryPrices: {}, logs: [] });
      setEquityHistory([{ time: 'Início', value: startAmount }, { time: 'Agora', value: startAmount }]);
      highestPricesRef.current = {}; lastSignalRef.current = {}; setReasonsLog({});
    }
  }, [baseCurrency]);

  // Métricas
  const totalPortfolioValue = useMemo(() => {
    let total = wallet.quote;
    Object.entries(wallet.balances).forEach(([s, a]) => {
      total += (a * (currentData[s]?.close || 0));
    });
    return total;
  }, [wallet, currentData]);

  const startAmount = baseCurrency === 'BRL' ? 5000 : baseCurrency === 'USDT' ? 1000 : 5;
  const pnlPct = ((totalPortfolioValue - startAmount) / startAmount) * 100;
  const tradesFechados = wallet.logs.filter(l => l.includes('🔴'));
  const winRate = tradesFechados.length > 0 ? (tradesFechados.filter(l => l.includes('+')).length / tradesFechados.length) * 100 : 0;

  return {
    wallet,
    equityHistory,
    reasonsLog,
    totalPortfolioValue,
    pnlPct,
    winRate,
    tradesFechados,
    handleBotAction,
    handleAiUpdate,
    resetWallet,
    formatMoney,
  };
}