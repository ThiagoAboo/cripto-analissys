from flask import Flask, jsonify, request
from flask_cors import CORS
import pandas as pd
import requests
from xgboost import XGBClassifier
from sklearn.model_selection import train_test_split
from sklearn.metrics import accuracy_score
import ta
from functools import lru_cache
import time
import threading
import pickle

app = Flask(__name__)
CORS(app)

# Cache em memória para modelos (simples)
model_cache = {}
cache_lock = threading.Lock()

def get_model_key(symbol, depth, agressivity, use_ema):
    return f"{symbol}_{depth}_{agressivity}_{use_ema}"

def train_model(symbol, depth, agressivity, use_ema):
    """Treina um modelo e retorna (modelo, precisao, X_presente)"""
    try:
        resposta = requests.get(f'http://localhost:4000/api/candles/{symbol}')
        dados_completos = resposta.json()

        if '1m' not in dados_completos or len(dados_completos['1m']) < 50:
            return None, None, None, {"error": "Dados de 1m insuficientes."}

        df_1m = processar_tempo_grafico(dados_completos['1m'], '1m')
        df_5m = processar_tempo_grafico(dados_completos['5m'], '5m')
        df_15m = processar_tempo_grafico(dados_completos['15m'], '15m')

        if df_1m.empty or df_5m.empty or df_15m.empty:
            return None, None, None, {"error": "Aguardando volume MTF..."}

        df_1m, df_5m, df_15m = df_1m.sort_index(), df_5m.sort_index(), df_15m.sort_index()
        df_final = pd.merge_asof(df_1m, df_5m, left_index=True, right_index=True, direction='backward')
        df_final = pd.merge_asof(df_final, df_15m, left_index=True, right_index=True, direction='backward')
        df_final = df_final.dropna()

        if len(df_final) < 50:
            return None, None, None, {"error": "Dados insuficientes pós-fusão."}

        df_final['Distancia_Macro_EMA200'] = df_final['1m_close'] - df_final['15m_EMA_200']

        taxa_corretagem = 0.001
        preco_futuro_5m = df_final['1m_close'].shift(-5)
        preco_alvo = df_final['1m_close'] * (1 + taxa_corretagem)
        df_final['Target'] = (preco_futuro_5m > preco_alvo).astype(int)

        df_estudo = df_final.drop(columns=['1m_close', '5m_close', '15m_close', '15m_EMA_200'])

        df_treino = df_estudo.iloc[:-5]
        linha_atual = df_estudo.iloc[[-1]]

        X = df_treino.drop('Target', axis=1)
        y = df_treino['Target']
        X_train, X_test, y_train, y_test = train_test_split(X, y, test_size=0.2, random_state=42, shuffle=False)

        modelo = XGBClassifier(
            n_estimators=100,
            learning_rate=0.05,
            max_depth=depth,
            scale_pos_weight=agressivity,
            random_state=42,
            eval_metric='logloss'
        )
        modelo.fit(X_train, y_train)
        precisao = accuracy_score(y_test, modelo.predict(X_test))

        X_presente = linha_atual.drop('Target', axis=1)

        return modelo, precisao, X_presente, None

    except Exception as e:
        import traceback
        print(traceback.format_exc())
        return None, None, None, {"error": f"Erro interno: {str(e)}"}

def processar_tempo_grafico(dados_json, prefixo):
    df = pd.DataFrame(dados_json)
    if df.empty:
        return df

    df['time'] = pd.to_datetime(df['time'], unit='s')
    df.set_index('time', inplace=True)

    for col in ['open', 'high', 'low', 'close', 'volume', 'bid_volume', 'ask_volume']:
        if col in df.columns:
            df[col] = df[col].astype(float)

    df['SMA_20'] = df['close'].rolling(window=20).mean()
    df['Distancia_SMA'] = df['close'] - df['SMA_20']
    df['Forca_Vela'] = df['close'] - df['open']
    df['RSI'] = ta.momentum.RSIIndicator(close=df['close'], window=14).rsi()

    macd = ta.trend.MACD(close=df['close'])
    df['MACD'] = macd.macd()
    df['MACD_Signal'] = macd.macd_signal()

    bollinger = ta.volatility.BollingerBands(close=df['close'], window=20, window_dev=2)
    df['BB_High_Indicator'] = bollinger.bollinger_hband_indicator()
    df['BB_Low_Indicator'] = bollinger.bollinger_lband_indicator()

    df['Volume_SMA_20'] = df['volume'].rolling(window=20).mean()
    df['Volume_Forca'] = df['volume'] / (df['Volume_SMA_20'] + 1e-9)

    if 'bid_volume' in df.columns and 'ask_volume' in df.columns:
        df['Order_Imbalance'] = df['bid_volume'] / (df['bid_volume'] + df['ask_volume'] + 1e-9)
    else:
        df['Order_Imbalance'] = 0.5

    colunas_estudo = ['close', 'Forca_Vela', 'Distancia_SMA', 'RSI', 'MACD', 'MACD_Signal',
                      'BB_High_Indicator', 'BB_Low_Indicator', 'Volume_Forca', 'Order_Imbalance']

    if prefixo == '15m':
        df['EMA_200'] = ta.trend.EMAIndicator(close=df['close'], window=200).ema_indicator()
        colunas_estudo.append('EMA_200')

    df = df.dropna()
    df = df[colunas_estudo]
    df.columns = [f"{prefixo}_{col}" for col in df.columns]
    return df

@app.route('/api/predict/<symbol>', methods=['GET'])
def predict(symbol):
    ai_depth = int(request.args.get('depth', 5))
    ai_agressivity = float(request.args.get('agressivity', 2.0))
    use_ema = request.args.get('ema', 'true') == 'true'

    key = get_model_key(symbol.upper(), ai_depth, ai_agressivity, use_ema)

    # Verificar cache com lock para evitar race conditions
    with cache_lock:
        cached = model_cache.get(key)
        if cached and (time.time() - cached['timestamp']) < 300:  # cache por 5 minutos
            modelo, precisao, X_presente, error = cached['model'], cached['precisao'], cached['X_presente'], None
        else:
            modelo, precisao, X_presente, error = train_model(symbol.upper(), ai_depth, ai_agressivity, use_ema)
            if modelo:
                model_cache[key] = {
                    'model': modelo,
                    'precisao': precisao,
                    'X_presente': X_presente,
                    'timestamp': time.time()
                }

    if error:
        return jsonify(error)

    # Fazer previsão
    previsao = int(modelo.predict(X_presente)[0])

    importances = modelo.feature_importances_
    feature_importance = sorted(zip(X_presente.columns, importances), key=lambda x: x[1], reverse=True)
    top_reasons = [f"{feat.replace('_', ' ')} ({round(imp * 100, 1)}%)" for feat, imp in feature_importance[:2]]

    distancia_ema = X_presente['Distancia_Macro_EMA200'].values[0] if 'Distancia_Macro_EMA200' in X_presente.columns else 0

    if use_ema and previsao == 1 and distancia_ema < 0:
        previsao = 0
        top_reasons = ["⚠️ BLOQUEADO: Preço abaixo da EMA 200"] + top_reasons

    return jsonify({
        "symbol": symbol.upper(),
        "accuracy": round(precisao * 100, 2),
        "prediction": "COMPRAR" if previsao == 1 else "VENDER",
        "reasons": top_reasons
    })

if __name__ == '__main__':
    print("🚀 Cérebro HFT com Parâmetros Dinâmicos rodando na 5000...")
    app.run(port=5000, debug=False)  # debug=False para produção