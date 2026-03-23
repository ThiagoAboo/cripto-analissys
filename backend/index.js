require('dotenv').config(); // Carrega variáveis de ambiente do arquivo .env

const express = require('express');
const cors = require('cors');
const WebSocket = require('ws');
const { Pool } = require('pg');
const { SMA } = require('technicalindicators');

const app = express();
app.use(cors());

const PORT = process.env.PORT || 4000;
const server = app.listen(PORT, () => {
  console.log(`🚀 Motor Backend (MTF + OrderBook + Variações) na porta ${PORT}`);
});

const wss = new WebSocket.Server({ server });

// Configuração do banco de dados usando variáveis de ambiente
const db = new Pool({
  user: process.env.DB_USER || 'admin',
  password: process.env.DB_PASSWORD || 'adminpassword',
  host: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT || 5433,
  database: process.env.DB_NAME || 'criptodb',
});

// Tabela de candles
db.query(`
  CREATE TABLE IF NOT EXISTS candles_mtf_v3 (
    symbol VARCHAR(20), interval VARCHAR(5), time BIGINT,
    open NUMERIC, high NUMERIC, low NUMERIC, close NUMERIC, volume NUMERIC,
    bid_volume NUMERIC, ask_volume NUMERIC,
    PRIMARY KEY (symbol, interval, time)
  );
`).then(() => console.log('🗄️ Banco MTF V3 pronto!')).catch(err => console.error(err));

// Mapa para controlar sincronizações em andamento (Promise por símbolo)
const syncingPromises = new Map();

/**
 * Sincroniza o histórico de um símbolo (velas de 1m, 5m, 15m, 1h, 1d)
 * Retorna uma Promise que resolve quando a sincronização for concluída.
 * Se já houver uma sincronização em andamento para o símbolo, retorna a mesma Promise.
 */
async function sincronizarHistorico(symbol) {
  // Se já existe uma sincronização em andamento, aguarda a mesma Promise
  if (syncingPromises.has(symbol)) {
    console.log(`⏳ Aguardando sincronização em andamento para ${symbol}...`);
    return syncingPromises.get(symbol);
  }

  // Cria a Promise da sincronização
  const syncPromise = (async () => {
    try {
      const tempos = ['1m', '5m', '15m', '1h', '1d'];
      console.log(`🔄 Iniciando sincronização de ${symbol}...`);
      for (let tf of tempos) {
        const response = await fetch(`https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=${tf}&limit=300`);
        const data = await response.json();
        for (let candle of data) {
          await db.query(`
            INSERT INTO candles_mtf_v3 (symbol, interval, time, open, high, low, close, volume, bid_volume, ask_volume)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 1, 1)
            ON CONFLICT (symbol, interval, time) DO NOTHING;
          `, [symbol, tf, candle[0], parseFloat(candle[1]), parseFloat(candle[2]), parseFloat(candle[3]), parseFloat(candle[4]), parseFloat(candle[5])]);
        }
      }
      console.log(`✅ Sincronização concluída para ${symbol}`);
    } catch (error) {
      console.error(`❌ Erro ao sincronizar ${symbol}:`, error.message);
      throw error; // repassa o erro para quem aguarda
    } finally {
      // Remove a Promise do mapa, independentemente do resultado
      syncingPromises.delete(symbol);
    }
  })();

  syncingPromises.set(symbol, syncPromise);
  return syncPromise;
}

/**
 * Rota que retorna velas dos múltiplos timeframes para um símbolo.
 * Se houver menos de 300 velas de 1m, dispara a sincronização (que pode ser compartilhada).
 */
app.get('/api/candles/:symbol', async (req, res) => {
  const symbol = req.params.symbol.toUpperCase();
  try {
    // Verifica se já existem dados suficientes para 1m
    const check = await db.query('SELECT COUNT(*) FROM candles_mtf_v3 WHERE symbol = $1 AND interval = $2', [symbol, '1m']);
    if (parseInt(check.rows[0].count) < 300) {
      await sincronizarHistorico(symbol); // aguarda a sincronização (compartilhada)
    }

    // Busca dados de todos os timeframes
    const tempos = ['1m', '5m', '15m', '1h', '1d'];
    let respostaFinal = {};

    for (let tf of tempos) {
      const result = await db.query(
        'SELECT time, open, high, low, close, volume, bid_volume, ask_volume FROM candles_mtf_v3 WHERE symbol = $1 AND interval = $2 ORDER BY time ASC',
        [symbol, tf]
      );
      const dados = result.rows;

      if (tf === '1m') {
        // Calcula SMA 20 para o timeframe de 1 minuto
        const precosFechamento = dados.map(candle => parseFloat(candle.close));
        const valoresSMA = SMA.calculate({ period: 20, values: precosFechamento });
        const offset = dados.length - valoresSMA.length;

        respostaFinal[tf] = dados.map((candle, index) => ({
          time: Math.floor(Number(candle.time) / 1000), // converte para segundos
          open: parseFloat(candle.open),
          high: parseFloat(candle.high),
          low: parseFloat(candle.low),
          close: parseFloat(candle.close),
          volume: parseFloat(candle.volume),
          bid_volume: parseFloat(candle.bid_volume),
          ask_volume: parseFloat(candle.ask_volume),
          sma: index >= offset ? valoresSMA[index - offset] : null
        }));
      } else {
        respostaFinal[tf] = dados.map((candle) => ({
          time: Math.floor(Number(candle.time) / 1000),
          open: parseFloat(candle.open),
          high: parseFloat(candle.high),
          low: parseFloat(candle.low),
          close: parseFloat(candle.close),
          volume: parseFloat(candle.volume),
          bid_volume: parseFloat(candle.bid_volume),
          ask_volume: parseFloat(candle.ask_volume)
        }));
      }
    }
    res.json(respostaFinal);
  } catch (error) {
    console.error('Erro na rota /api/candles:', error);
    res.status(500).json({ error: 'Falha ao buscar dados' });
  }
});

// WebSocket da Binance
const binanceWS = new WebSocket('wss://stream.binance.com:9443/ws');
let activeSubscriptions = new Set();
let currentBook = {};

binanceWS.on('open', () => console.log('✅ Conectado à Binance!'));
binanceWS.on('error', (err) => console.error('❌ Erro no WebSocket Binance:', err));

binanceWS.on('message', async (data) => {
  try {
    const message = JSON.parse(data);

    // Livro de ofertas (bookTicker)
    if (message.u && message.B && message.A) {
      const bookData = {
        bidQty: parseFloat(message.B),
        askQty: parseFloat(message.A),
        bidPrice: parseFloat(message.b),
        askPrice: parseFloat(message.a)
      };
      currentBook[message.s] = bookData;

      // Envia para todos os clientes WebSocket conectados
      wss.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
          client.send(JSON.stringify({ action: 'book', symbol: message.s, data: bookData }));
        }
      });
      return;
    }

    // Candlestick (kline)
    if (!message.k) return;
    const candle = message.k;
    const sym = message.s;
    const bookSnapshot = currentBook[sym] || { bidQty: 1, askQty: 1, bidPrice: 0, askPrice: 0 };

    const priceData = {
      action: 'kline',
      symbol: sym,
      interval: candle.i,
      time: candle.t,
      open: parseFloat(candle.o),
      high: parseFloat(candle.h),
      low: parseFloat(candle.l),
      close: parseFloat(candle.c),
      volume: parseFloat(candle.v),
      bid_volume: bookSnapshot.bidQty,
      ask_volume: bookSnapshot.askQty
    };

    // Envia para todos os clientes
    wss.clients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) client.send(JSON.stringify(priceData));
    });

    // Persiste apenas candles de 1 minuto no banco
    if (priceData.interval === '1m') {
      await db.query(`
        INSERT INTO candles_mtf_v3 (symbol, interval, time, open, high, low, close, volume, bid_volume, ask_volume)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        ON CONFLICT (symbol, interval, time) 
        DO UPDATE SET high = EXCLUDED.high, low = EXCLUDED.low, close = EXCLUDED.close, volume = EXCLUDED.volume,
        bid_volume = EXCLUDED.bid_volume, ask_volume = EXCLUDED.ask_volume;
      `, [priceData.symbol, priceData.interval, priceData.time, priceData.open, priceData.high, priceData.low, priceData.close, priceData.volume, priceData.bid_volume, priceData.ask_volume]);
    }
  } catch (err) {
    console.error('Erro ao processar mensagem da Binance:', err);
  }
});

// WebSocket Server (frontend)
wss.on('connection', (ws) => {
  ws.on('message', async (message) => {
    try {
      const request = JSON.parse(message);
      if (request.action === 'update_subscriptions') {
        let newSymbols = [];
        request.symbols.forEach(s => {
          newSymbols.push(`${s.toLowerCase()}@kline_1m`);
          newSymbols.push(`${s.toLowerCase()}@kline_5m`);
          newSymbols.push(`${s.toLowerCase()}@kline_15m`);
          newSymbols.push(`${s.toLowerCase()}@kline_1h`);
          newSymbols.push(`${s.toLowerCase()}@kline_1d`);
          newSymbols.push(`${s.toLowerCase()}@bookTicker`);
        });

        const toSubscribe = newSymbols.filter(s => !activeSubscriptions.has(s));
        const toUnsubscribe = [...activeSubscriptions].filter(s => !newSymbols.includes(s));

        if (toSubscribe.length > 0) {
          const baseSymbols = [...new Set(request.symbols.map(s => s.toUpperCase()))];
          // Garante que o histórico dos novos símbolos esteja disponível
          for (let bs of baseSymbols) {
            // Dispara a sincronização em segundo plano, sem aguardar
            sincronizarHistorico(bs).catch(err => console.error(`Falha na sincronização de ${bs}:`, err));
          }
          binanceWS.send(JSON.stringify({ method: 'SUBSCRIBE', params: toSubscribe, id: 1 }));
          toSubscribe.forEach(s => activeSubscriptions.add(s));
        }

        if (toUnsubscribe.length > 0) {
          binanceWS.send(JSON.stringify({ method: 'UNSUBSCRIBE', params: toUnsubscribe, id: 2 }));
          toUnsubscribe.forEach(s => activeSubscriptions.delete(s));
        }
      }
    } catch (err) {
      console.error('Erro ao processar mensagem do cliente:', err);
    }
  });
});

// Tratamento de encerramento limpo
process.on('SIGINT', () => {
  console.log('Encerrando servidores...');
  wss.close();
  binanceWS.close();
  server.close(() => {
    console.log('Servidor HTTP encerrado.');
    process.exit(0);
  });
});