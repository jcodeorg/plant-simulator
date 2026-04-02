// sim-state.js
// シミュレーション全体で共有するグローバル状態・定数を定義する
// PlantSimulator.js / WeatherGenerator.js より後にロードすること

// --- シミュレータインスタンス ---
const lettuce = new PlantSimulator();
const weather = new WeatherGenerator();

// --- ランタイム変数 ---
let weatherData  = [];  // generateMonthData() の結果 (45日×24時間)
let weatherIndex = 0;   // 現在の時間インデックス
let simAccum     = 0;   // 蓄積経過（シミュレーション時間・時間単位）
let simSpeed     = 6;   // 速度: 単位は時間/実秒 (1,3,6,12,24)
const SIM_SPEEDS = [1, 3, 6, 12, 24];
let simPaused    = true; // true=停止中 / false=実行中

// --- 中心状態オブジェクト ---
let state = {
    temp: 22.0,
    ec: 1.2,
    light: 0,
    sunLux: 0,
    growth: 0,
    humid: 55.0,
    damage: 0,
    waterLevel: 5,
    ledActive: false,
    ledLux: 8000,           // 現在設定中のLED光量 (lx) 1000〜15000
    etiolation: 0,          // 徒長度 0.0(正常)〜1.0(重度徒長)
    stageName: '発芽期',    // 現在の成長ステージ名
    stressBreakdown: { env: 0, water: 0, etiol: 0, tipburn: 0, recovery: 0.001, net: 0 },
    simFinished: false,     // シミュレーション終了フラグ
    lastTick: Date.now(),
    day: 1,                 // 経過日数
};

// --- 統計・ログ ---
let simStats = { maxGrowth: 0, ledOnHours: 0, totalHours: 0, ledCostAcc: 0 };
let csvLog   = []; // 時間ごとの観測記録 + マニュアルイベント

// ストレス要因の累積値 (各要因 /h を毎時間加算)
let stressCumul = { env: 0, water: 0, etiol: 0, tipburn: 0, recovery: 0 };

// タイムラインスナップショット
let snapshots  = [];  // 時間ごとの完全スナップショット
let scrubIndex = -1;  // -1=ライブ, >=0=スクラブ中のインデックス

// --- ステージ別パラメータ (PlantSimulatorと同期) ---
const STAGE_MIN_LIGHT = [300, 1500, 3000, 2000];  // 徒長開始照度 (lx)
const STAGE_OPT_TEMP  = [22,  20,   20,   18  ];  // 最適温度 (°C)
const STAGE_NAMES     = ['発芽期', '幼苗期', '生育期', '成熟期'];

// --- 環境プリセット（changeMonth・起動時・sunSettings初期化で共有） ---
const MONTH_DEFAULTS = {
    'outdoor_1':  { month: 1,  sunrise: 7, sunset: 17, peakLux: 20000, minT:  1.0, maxT: 10.0, hum: 45 }, // 屋外・冬
    'outdoor_4':  { month: 4,  sunrise: 6, sunset: 18, peakLux: 50000, minT: 10.5, maxT: 19.5, hum: 60 }, // 屋外・春
    'outdoor_7':  { month: 7,  sunrise: 5, sunset: 19, peakLux: 80000, minT: 23.0, maxT: 30.5, hum: 75 }, // 屋外・夏
    'outdoor_10': { month: 10, sunrise: 6, sunset: 17, peakLux: 35000, minT: 15.0, maxT: 22.0, hum: 70 }, // 屋外・秋
    'indoor_1':   { month: 1,  sunrise: 8, sunset: 17, peakLux: 2000,  minT: 18.0, maxT: 23.0, hum: 50 }, // 屋内・冬
    'indoor_4':   { month: 4,  sunrise: 7, sunset: 18, peakLux: 2000,  minT: 10.5, maxT: 19.5, hum: 60 }, // 屋内・春
    'indoor_7':   { month: 7,  sunrise: 6, sunset: 19, peakLux: 2000,  minT: 22.0, maxT: 27.0, hum: 60 }, // 屋内・夏 (冷房想定)
    'indoor_10':  { month: 10, sunrise: 7, sunset: 17, peakLux: 2000,  minT: 18.0, maxT: 24.0, hum: 55 }, // 屋内・秋
};

// 太陽設定（UIで変更可）— 初期値は屋外4月のデフォルトから生成
let sunSettings = { ...MONTH_DEFAULTS['outdoor_4'] };

// --- ロギング（スタブ） ---
function addLog(msg, type = 'info') { /* ログパネル廃止 */ }
function setStatusBadge(running) {}
