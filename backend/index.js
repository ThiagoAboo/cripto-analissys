const express = require('express');
const cors = require('cors');
const WebSocket = require('ws');
const { Pool } = require('pg');
const { SMA } = require('technicalindicators');

const app = express();
app.use(cors());

const PORT = 4000;
const server = app.listen(PORT, () => {
  console.log(`🚀 Motor Backend (MTF + OrderBook + Variações) na porta ${PORT}`);
});

const wss = new WebSocket.Server({ server });

const db = new Pool({
  user: 'admin',
  password: 'adminpassword',
  host: 'localhost',
  port: 5433,
  database: 'criptodb',
});

db.query(`
  CREATE TABLE IF NOT EXISTS candles_mtf_v3 (
    symbol VARCHAR(20), interval VARCHAR(5), time BIGINT,
    open NUMERIC, high NUMERIC, low NUMERIC, close NUMERIC, volume NUMERIC,
    bid_volume NUMERIC, ask_volume NUMERIC,
    PRIMARY KEY (symbol, interval, time)
  );
`).then(() => console.log('🗄️ Banco MTF V3 pronto!')).catch(err => console.error(err));

async function sincronizarHistorico(symbol) {
  const tempos = ['1m', '5m', '15m', '1h', '1d'];
  for (let tf of tempos) {
    try {
      const response = await fetch(`https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=${tf}&limit=300`);
      const data = await response.json();
      for (let candle of data) {
        await db.query(`
          INSERT INTO candles_mtf_v3 (symbol, interval, time, open, high, low, close, volume, bid_volume, ask_volume)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 1, 1)
          ON CONFLICT (symbol, interval, time) DO NOTHING;
        `, [symbol, tf, candle[0], parseFloat(candle[1]), parseFloat(candle[2]), parseFloat(candle[3]), parseFloat(candle[4]), parseFloat(candle[5])]);
      }
    } catch (error) { }
  }
}

app.get('/api/candles/:symbol', async (req, res) => {
  const symbol = req.params.symbol.toUpperCase();
  try {
    const check = await db.query('SELECT COUNT(*) FROM candles_mtf_v3 WHERE symbol = $1 AND interval = $2', [symbol, '1m']);
    if (parseInt(check.rows[0].count) < 300) await sincronizarHistorico(symbol);

    const tempos = ['1m', '5m', '15m', '1h', '1d'];
    let respostaFinal = {};

    for (let tf of tempos) {
      const result = await db.query(
        'SELECT time, open, high, low, close, volume, bid_volume, ask_volume FROM candles_mtf_v3 WHERE symbol = $1 AND interval = $2 ORDER BY time ASC',
        [symbol, tf]
      );
      const dados = result.rows;
      
      if (tf === '1m') {
        const precosFechamento = dados.map(candle => parseFloat(candle.close));
        const valoresSMA = SMA.calculate({ period: 20, values: precosFechamento });
        const offset = dados.length - valoresSMA.length;
        
        respostaFinal[tf] = dados.map((candle, index) => ({
          time: Math.floor(Number(candle.time) / 1000), // 🟢 1m em Segundos
          open: parseFloat(candle.open), high: parseFloat(candle.high), low: parseFloat(candle.low), close: parseFloat(candle.close),
          volume: parseFloat(candle.volume), bid_volume: parseFloat(candle.bid_volume), ask_volume: parseFloat(candle.ask_volume),
          sma: index >= offset ? valoresSMA[index - offset] : null
        }));
      } else {
        // 🟢 A CORREÇÃO: Agora os outros tempos também são formatados em Segundos!
        respostaFinal[tf] = dados.map((candle) => ({
          time: Math.floor(Number(candle.time) / 1000), 
          open: parseFloat(candle.open), high: parseFloat(candle.high), low: parseFloat(candle.low), close: parseFloat(candle.close),
          volume: parseFloat(candle.volume), bid_volume: parseFloat(candle.bid_volume), ask_volume: parseFloat(candle.ask_volume)
        }));
      }
    }
    res.json(respostaFinal);
  } catch (error) { res.status(500).json({ error: 'Falha ao buscar dados' }); }
});

const binanceWS = new WebSocket('wss://stream.binance.com:9443/ws');
let activeSubscriptions = new Set();
let currentBook = {}; 

binanceWS.on('open', () => console.log('✅ Conectado à Binance!'));

binanceWS.on('message', async (data) => {
  const message = JSON.parse(data);

  // 🟢 EXPRESSO: Envia o Livro de Ofertas instantaneamente para o Front
  if (message.u && message.B && message.A) {
    const bookData = {
      bidQty: parseFloat(message.B), askQty: parseFloat(message.A),
      bidPrice: parseFloat(message.b), askPrice: parseFloat(message.a) 
    };
    currentBook[message.s] = bookData;
    
    wss.clients.forEach(client => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(JSON.stringify({ action: 'book', symbol: message.s, data: bookData }));
      }
    });
    return; 
  }

  if (!message.k) return;
  const candle = message.k;
  const sym = message.s;
  const bookSnapshot = currentBook[sym] || { bidQty: 1, askQty: 1, bidPrice: 0, askPrice: 0 };

  const priceData = {
    action: 'kline',
    symbol: sym, interval: candle.i, time: candle.t,
    open: parseFloat(candle.o), high: parseFloat(candle.h), low: parseFloat(candle.l), close: parseFloat(candle.c),
    volume: parseFloat(candle.v),
    bid_volume: bookSnapshot.bidQty, ask_volume: bookSnapshot.askQty
  };

  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) client.send(JSON.stringify(priceData));
  });

  if(priceData.interval === '1m') {
      try {
        await db.query(`
          INSERT INTO candles_mtf_v3 (symbol, interval, time, open, high, low, close, volume, bid_volume, ask_volume)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
          ON CONFLICT (symbol, interval, time) 
          DO UPDATE SET high = EXCLUDED.high, low = EXCLUDED.low, close = EXCLUDED.close, volume = EXCLUDED.volume,
          bid_volume = EXCLUDED.bid_volume, ask_volume = EXCLUDED.ask_volume;
        `, [priceData.symbol, priceData.interval, priceData.time, priceData.open, priceData.high, priceData.low, priceData.close, priceData.volume, priceData.bid_volume, priceData.ask_volume]);
      } catch (error) { }
  }
});

wss.on('connection', (ws) => {
  ws.on('message', async (message) => {
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
        for (let bs of baseSymbols) await sincronizarHistorico(bs);
        binanceWS.send(JSON.stringify({ method: 'SUBSCRIBE', params: toSubscribe, id: 1 }));
        toSubscribe.forEach(s => activeSubscriptions.add(s));
      }

      if (toUnsubscribe.length > 0) {
        binanceWS.send(JSON.stringify({ method: 'UNSUBSCRIBE', params: toUnsubscribe, id: 2 }));
        toUnsubscribe.forEach(s => activeSubscriptions.delete(s));
      }
    }
  });
});