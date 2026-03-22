const express = require('express');
const cors = require('cors');
const WebSocket = require('ws');
const { Pool } = require('pg');
const { SMA } = require('technicalindicators');

const app = express();
app.use(cors());

const PORT = 4000;
const server = app.listen(PORT, () => {
  console.log(`🚀 Motor Backend (MTF + Volume + OrderBook) na porta ${PORT}`);
});

const wss = new WebSocket.Server({ server });

const db = new Pool({
  user: 'admin',
  password: 'adminpassword',
  host: 'localhost',
  port: 5433,
  database: 'criptodb',
});

// 🟢 MUDANÇA 1: Tabela V3 agora com as colunas do Livro de Ofertas
db.query(`
  CREATE TABLE IF NOT EXISTS candles_mtf_v3 (
    symbol VARCHAR(20),
    interval VARCHAR(5),
    time BIGINT,
    open NUMERIC, high NUMERIC, low NUMERIC, close NUMERIC, volume NUMERIC,
    bid_volume NUMERIC, ask_volume NUMERIC,
    PRIMARY KEY (symbol, interval, time)
  );
`).then(() => console.log('🗄️ Banco MTF V3 (Com Order Book) pronto!'))
  .catch(err => console.error('Erro no Banco de Dados:', err));

async function sincronizarHistorico(symbol) {
  const tempos = ['1m', '5m', '15m', '1h', '1d'];
  for (let tf of tempos) {
    try {
      console.log(`⏳ Auto-sincronizando ${symbol} em ${tf}...`);
      const response = await fetch(`https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=${tf}&limit=1000`);
      const data = await response.json();

      let inseridos = 0;
      for (let candle of data) {
        // A Binance não dá o Order Book do passado na API pública gratuita.
        // Portanto, preenchemos o passado com "1" e "1" (Neutro/50%) para não confundir a IA.
        await db.query(`
          INSERT INTO candles_mtf_v3 (symbol, interval, time, open, high, low, close, volume, bid_volume, ask_volume)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 1, 1)
          ON CONFLICT (symbol, interval, time) DO NOTHING;
        `, [symbol, tf, candle[0], parseFloat(candle[1]), parseFloat(candle[2]), parseFloat(candle[3]), parseFloat(candle[4]), parseFloat(candle[5])]);
        inseridos++;
      }
      console.log(`✅ [${symbol} - ${tf}] ${inseridos} velas salvas.`);
    } catch (error) {
      console.error(`❌ Erro ao auto-sincronizar ${symbol} em ${tf}:`, error);
    }
  }
}

app.get('/api/candles/:symbol', async (req, res) => {
  const symbol = req.params.symbol.toUpperCase();
  try {
    const check = await db.query('SELECT COUNT(*) FROM candles_mtf_v3 WHERE symbol = $1 AND interval = $2', [symbol, '1m']);

    if (parseInt(check.rows[0].count) < 100) {
      await sincronizarHistorico(symbol);
    }

    const tempos = ['1m', '5m', '15m'];
    let respostaFinal = {};

    for (let tf of tempos) {
      const result = await db.query(
        'SELECT time, open, high, low, close, volume, bid_volume, ask_volume FROM candles_mtf_v3 WHERE symbol = $1 AND interval = $2 ORDER BY time ASC',
        [symbol, tf]
      );

      const dados = result.rows;
      const precosFechamento = dados.map(candle => parseFloat(candle.close));
      const valoresSMA = SMA.calculate({ period: 20, values: precosFechamento });
      const offset = dados.length - valoresSMA.length;

      respostaFinal[tf] = dados.map((candle, index) => ({
        time: Math.floor(Number(candle.time) / 1000),
        open: parseFloat(candle.open), high: parseFloat(candle.high), low: parseFloat(candle.low), close: parseFloat(candle.close),
        volume: parseFloat(candle.volume),
        bid_volume: parseFloat(candle.bid_volume), // 🟢 Entregando o Order Book
        ask_volume: parseFloat(candle.ask_volume),
        sma: index >= offset ? valoresSMA[index - offset] : null
      }));
    }
    res.json(respostaFinal);
  } catch (error) {
    res.status(500).json({ error: 'Falha ao buscar dados' });
  }
});

const binanceWS = new WebSocket('wss://stream.binance.com:9443/ws');
let activeSubscriptions = new Set();
let currentBook = {}; // 🟢 Memória RAM ultra-rápida para o Order Book

binanceWS.on('open', () => console.log('✅ Conectado à Binance! (Modo Order Book Ativado)'));

binanceWS.on('message', async (data) => {
  const message = JSON.parse(data);

  // 🟢 1. Se a mensagem for do Livro de Ofertas (@bookTicker)
  // u = Update ID, B = Bid Qty (Compradores), A = Ask Qty (Vendedores)
  if (message.u && message.B && message.A) {
    currentBook[message.s] = {
      bid: parseFloat(message.B),
      ask: parseFloat(message.A)
    };
    return; // Atualiza a memória e sai, não precisa enviar para o React ainda
  }

  // 🟢 2. Se a mensagem for de Vela (@kline)
  if (!message.k) return;

  const candle = message.k;
  const sym = message.s;
  // Pega a fotografia do livro de ofertas naquele exato milissegundo
  const bookSnapshot = currentBook[sym] || { bid: 1, ask: 1 };

  const priceData = {
    symbol: sym, interval: candle.i, time: candle.t,
    open: parseFloat(candle.o), high: parseFloat(candle.h), low: parseFloat(candle.l), close: parseFloat(candle.c),
    volume: parseFloat(candle.v),
    bid_volume: bookSnapshot.bid,
    ask_volume: bookSnapshot.ask
  };

  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) client.send(JSON.stringify(priceData));
  });

  try {
    await db.query(`
      INSERT INTO candles_mtf_v3 (symbol, interval, time, open, high, low, close, volume, bid_volume, ask_volume)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      ON CONFLICT (symbol, interval, time) 
      DO UPDATE SET high = EXCLUDED.high, low = EXCLUDED.low, close = EXCLUDED.close, volume = EXCLUDED.volume,
      bid_volume = EXCLUDED.bid_volume, ask_volume = EXCLUDED.ask_volume;
    `, [priceData.symbol, priceData.interval, priceData.time, priceData.open, priceData.high, priceData.low, priceData.close, priceData.volume, priceData.bid_volume, priceData.ask_volume]);
  } catch (error) { }
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
        newSymbols.push(`${s.toLowerCase()}@bookTicker`); // 🟢 Assinando o fluxo dos Tubarões
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