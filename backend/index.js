require('dotenv').config();

const express = require('express');
const cors = require('cors');
const WebSocket = require('ws');
const { Pool } = require('pg');
const { SMA } = require('technicalindicators');

const app = express();
app.use(cors());

const PORT = process.env.PORT || 4000;
const TIMEFRAMES = ['1m', '5m', '15m', '1h', '1d'];
const BINANCE_WS_URL = 'wss://stream.binance.com:9443/ws';

const server = app.listen(PORT, () => {
  console.log(`🚀 Motor Backend (MTF + OrderBook + Variações) na porta ${PORT}`);
});

const wss = new WebSocket.Server({ server });

const db = new Pool({
  user: process.env.DB_USER || 'admin',
  password: process.env.DB_PASSWORD || 'adminpassword',
  host: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT || 5433,
  database: process.env.DB_NAME || 'criptodb',
});

let shuttingDown = false;
let binanceWS = null;
let activeSubscriptions = new Set();
const syncingPromises = new Map();
const currentBook = {};

db.query(`
  CREATE TABLE IF NOT EXISTS candles_mtf_v3 (
    symbol VARCHAR(20),
    interval VARCHAR(5),
    time BIGINT,
    open NUMERIC,
    high NUMERIC,
    low NUMERIC,
    close NUMERIC,
    volume NUMERIC,
    bid_volume NUMERIC,
    ask_volume NUMERIC,
    PRIMARY KEY (symbol, interval, time)
  );
`)
  .then(() => console.log('✅ Banco MTF V3 pronto!'))
  .catch((err) => console.error('Erro ao preparar banco:', err));

function toNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function mapRowToCandle(row) {
  return {
    time: Math.floor(toNumber(row.time) / 1000),
    open: toNumber(row.open),
    high: toNumber(row.high),
    low: toNumber(row.low),
    close: toNumber(row.close),
    volume: toNumber(row.volume),
    bid_volume: toNumber(row.bid_volume),
    ask_volume: toNumber(row.ask_volume),
  };
}

function applySMA20(rows) {
  const candles = rows.map(mapRowToCandle);
  const closes = candles.map((c) => c.close);
  const smaValues = SMA.calculate({ period: 20, values: closes });
  const offset = candles.length - smaValues.length;

  return candles.map((candle, index) => ({
    ...candle,
    sma: index >= offset ? Number(smaValues[index - offset].toFixed(8)) : null,
  }));
}

async function bulkInsertCandles(symbol, interval, candles) {
  if (!Array.isArray(candles) || candles.length === 0) return;

  const values = [];
  const params = [];
  let p = 1;

  for (const candle of candles) {
    values.push(
      `($${p++}, $${p++}, $${p++}, $${p++}, $${p++}, $${p++}, $${p++}, $${p++}, $${p++}, $${p++})`,
    );

    params.push(
      symbol,
      interval,
      toNumber(candle[0]),
      toNumber(candle[1]),
      toNumber(candle[2]),
      toNumber(candle[3]),
      toNumber(candle[4]),
      toNumber(candle[5]),
      1,
      1,
    );
  }

  await db.query(
    `
      INSERT INTO candles_mtf_v3
      (symbol, interval, time, open, high, low, close, volume, bid_volume, ask_volume)
      VALUES ${values.join(', ')}
      ON CONFLICT (symbol, interval, time) DO NOTHING;
    `,
    params,
  );
}

async function sincronizarHistorico(symbol) {
  if (syncingPromises.has(symbol)) {
    console.log(`⏳ Aguardando sincronização em andamento para ${symbol}...`);
    return syncingPromises.get(symbol);
  }

  const syncPromise = (async () => {
    try {
      console.log(`📥 Iniciando sincronização de ${symbol}...`);

      for (const tf of TIMEFRAMES) {
        const response = await fetch(
          `https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=${tf}&limit=300`,
        );

        if (!response.ok) {
          throw new Error(`Binance respondeu ${response.status} para ${symbol}/${tf}`);
        }

        const data = await response.json();

        if (!Array.isArray(data)) {
          throw new Error(`Resposta inválida da Binance para ${symbol}/${tf}`);
        }

        await bulkInsertCandles(symbol, tf, data);
      }

      console.log(`✅ Sincronização concluída para ${symbol}`);
    } catch (error) {
      console.error(`❌ Erro ao sincronizar ${symbol}:`, error.message);
      throw error;
    } finally {
      syncingPromises.delete(symbol);
    }
  })();

  syncingPromises.set(symbol, syncPromise);
  return syncPromise;
}

app.get('/api/candles/:symbol', async (req, res) => {
  const symbol = req.params.symbol.toUpperCase();

  try {
    const check = await db.query(
      'SELECT COUNT(*) FROM candles_mtf_v3 WHERE symbol = $1 AND interval = $2',
      [symbol, '1m'],
    );

    if (toNumber(check.rows?.[0]?.count) < 300) {
      await sincronizarHistorico(symbol);
    }

    const respostaFinal = {};

    for (const tf of TIMEFRAMES) {
      const result = await db.query(
        `
          SELECT time, open, high, low, close, volume, bid_volume, ask_volume
          FROM (
            SELECT time, open, high, low, close, volume, bid_volume, ask_volume
            FROM candles_mtf_v3
            WHERE symbol = $1 AND interval = $2
            ORDER BY time DESC
            LIMIT 300
          ) t
          ORDER BY time ASC
        `,
        [symbol, tf],
      );

      const dados = result.rows || [];
      respostaFinal[tf] = tf === '1m' ? applySMA20(dados) : dados.map(mapRowToCandle);
    }

    res.json(respostaFinal);
  } catch (error) {
    console.error('Erro na rota /api/candles:', error);
    res.status(500).json({ error: 'Falha ao buscar dados' });
  }
});

app.get('/health', (_req, res) => {
  res.json({ ok: true });
});

function broadcast(payload) {
  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(payload);
    }
  });
}

function buildStreamsFromSymbols(symbols) {
  const streams = [];

  for (const rawSymbol of symbols) {
    const symbol = String(rawSymbol).toLowerCase();

    streams.push(`${symbol}@kline_1m`);
    streams.push(`${symbol}@kline_5m`);
    streams.push(`${symbol}@kline_15m`);
    streams.push(`${symbol}@kline_1h`);
    streams.push(`${symbol}@kline_1d`);
    streams.push(`${symbol}@bookTicker`);
  }

  return streams;
}

function safeBinanceSend(payload) {
  if (binanceWS && binanceWS.readyState === WebSocket.OPEN) {
    binanceWS.send(JSON.stringify(payload));
  }
}

function collectDesiredStreams() {
  const desired = new Set();

  wss.clients.forEach((client) => {
    if (client.readyState !== WebSocket.OPEN) return;
    if (!client.subscriptions) return;

    client.subscriptions.forEach((stream) => desired.add(stream));
  });

  return desired;
}

function reconcileBinanceSubscriptions() {
  const desired = collectDesiredStreams();

  const toSubscribe = [...desired].filter((s) => !activeSubscriptions.has(s));
  const toUnsubscribe = [...activeSubscriptions].filter((s) => !desired.has(s));

  if (toSubscribe.length > 0) {
    safeBinanceSend({
      method: 'SUBSCRIBE',
      params: toSubscribe,
      id: Date.now(),
    });

    toSubscribe.forEach((s) => activeSubscriptions.add(s));
  }

  if (toUnsubscribe.length > 0) {
    safeBinanceSend({
      method: 'UNSUBSCRIBE',
      params: toUnsubscribe,
      id: Date.now() + 1,
    });

    toUnsubscribe.forEach((s) => activeSubscriptions.delete(s));
  }
}

function connectBinance() {
  if (shuttingDown) return;

  binanceWS = new WebSocket(BINANCE_WS_URL);

  binanceWS.on('open', () => {
    console.log('✅ Conectado à Binance!');

    if (activeSubscriptions.size > 0) {
      binanceWS.send(
        JSON.stringify({
          method: 'SUBSCRIBE',
          params: [...activeSubscriptions],
          id: Date.now(),
        }),
      );
    }
  });

  binanceWS.on('error', (err) => {
    console.error('❌ Erro no WebSocket Binance:', err.message);
  });

  binanceWS.on('close', () => {
    console.warn('⚠️ WebSocket Binance fechado.');

    if (!shuttingDown) {
      setTimeout(connectBinance, 3000);
    }
  });

  binanceWS.on('message', async (rawData) => {
    try {
      const message = JSON.parse(rawData.toString());

      if (message.result !== undefined) return;

      if (message.u && message.B && message.A) {
        const bookData = {
          bidQty: toNumber(message.B),
          askQty: toNumber(message.A),
          bidPrice: toNumber(message.b),
          askPrice: toNumber(message.a),
        };

        currentBook[message.s] = bookData;

        broadcast(
          JSON.stringify({
            action: 'book',
            symbol: message.s,
            data: bookData,
          }),
        );

        return;
      }

      if (!message.k) return;

      const candle = message.k;
      const sym = message.s;
      const bookSnapshot = currentBook[sym] || {
        bidQty: 1,
        askQty: 1,
        bidPrice: 0,
        askPrice: 0,
      };

      const priceData = {
        action: 'kline',
        symbol: sym,
        interval: candle.i,
        time: toNumber(candle.t),
        open: toNumber(candle.o),
        high: toNumber(candle.h),
        low: toNumber(candle.l),
        close: toNumber(candle.c),
        volume: toNumber(candle.v),
        bid_volume: toNumber(bookSnapshot.bidQty),
        ask_volume: toNumber(bookSnapshot.askQty),
      };

      broadcast(JSON.stringify(priceData));

      if (priceData.interval === '1m') {
        await db.query(
          `
            INSERT INTO candles_mtf_v3
            (symbol, interval, time, open, high, low, close, volume, bid_volume, ask_volume)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
            ON CONFLICT (symbol, interval, time)
            DO UPDATE SET
              high = EXCLUDED.high,
              low = EXCLUDED.low,
              close = EXCLUDED.close,
              volume = EXCLUDED.volume,
              bid_volume = EXCLUDED.bid_volume,
              ask_volume = EXCLUDED.ask_volume
          `,
          [
            priceData.symbol,
            priceData.interval,
            priceData.time,
            priceData.open,
            priceData.high,
            priceData.low,
            priceData.close,
            priceData.volume,
            priceData.bid_volume,
            priceData.ask_volume,
          ],
        );
      }
    } catch (err) {
      console.error('Erro ao processar mensagem da Binance:', err);
    }
  });
}

connectBinance();

wss.on('connection', (ws) => {
  ws.subscriptions = new Set();

  ws.on('message', async (message) => {
    try {
      const request = JSON.parse(message.toString());

      if (request.action !== 'update_subscriptions') return;
      if (!Array.isArray(request.symbols)) return;

      const symbols = [...new Set(request.symbols.map((s) => String(s).toUpperCase()))];

      ws.subscriptions = new Set(buildStreamsFromSymbols(symbols));

      for (const symbol of symbols) {
        sincronizarHistorico(symbol).catch((err) => {
          console.error(`Falha na sincronização de ${symbol}:`, err.message);
        });
      }

      reconcileBinanceSubscriptions();
    } catch (err) {
      console.error('Erro ao processar mensagem do cliente:', err);
    }
  });

  ws.on('close', () => {
    ws.subscriptions = new Set();
    reconcileBinanceSubscriptions();
  });
});

async function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;

  console.log('Encerrando servidores...');

  try {
    wss.close();

    if (binanceWS) {
      binanceWS.close();
    }

    server.close(async () => {
      try {
        await db.end();
      } catch (err) {
        console.error('Erro ao fechar conexão com banco:', err.message);
      }

      console.log('Servidor HTTP encerrado.');
      process.exit(0);
    });
  } catch (err) {
    console.error('Erro no shutdown:', err.message);
    process.exit(1);
  }
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);