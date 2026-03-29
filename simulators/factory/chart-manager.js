// chart-manager.js
// Chart.js によるグラフデータ管理・描画
// sim-state.js / Chart.js より後にロードすること

// --- データストア ---
const CHART_MAX = 1080; // 45日 × 24時間
const chartData = {
    temp:   [],
    humid:  [],
    light:  [],
    growth: [],
    damage: []
};

let mainChart = null;

// --- データ追加 ---
function pushChart(key, val) {
    chartData[key].push(val);
    if (chartData[key].length > CHART_MAX) chartData[key].shift();
}

// 1シミュレーション時間ごとにデータを追記（coreLoop内で呼ぶ）
function pushChartData() {
    pushChart('temp',   state.temp);
    pushChart('humid',  state.humid);
    pushChart('light',  state.light);
    pushChart('growth', state.growth);
    pushChart('damage', state.damage * 100);
}

function clearCharts() {
    Object.keys(chartData).forEach(k => chartData[k] = []);
    if (mainChart) {
        mainChart.data.labels = [];
        mainChart.data.datasets.forEach(ds => ds.data = []);
        mainChart.update('none');
    }
}

// --- Chart.js 統合チャート初期化 ---
function initMainChart() {
    const ctx = document.getElementById('main-chart');
    if (!ctx) return;
    if (mainChart) { mainChart.destroy(); mainChart = null; }

    Chart.defaults.font.family = "'Inter','Helvetica Neue',sans-serif";
    Chart.defaults.font.size   = 10;

    mainChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: [],
            datasets: [
                {
                    label: '気温 (°C)',
                    data: [],
                    borderColor: '#3b82f6',
                    backgroundColor: 'rgba(59,130,246,0.08)',
                    fill: false,
                    tension: 0.3,
                    pointRadius: 0,
                    borderWidth: 1.5,
                    yAxisID: 'yTemp',
                },
                {
                    label: '湿度 (%)',
                    data: [],
                    borderColor: '#06b6d4',
                    backgroundColor: 'rgba(6,182,212,0.08)',
                    fill: false,
                    tension: 0.3,
                    pointRadius: 0,
                    borderWidth: 1.5,
                    yAxisID: 'yPct',
                },
                {
                    label: '光量 (klx)',
                    data: [],
                    borderColor: '#f59e0b',
                    backgroundColor: 'rgba(245,158,11,0.08)',
                    fill: false,
                    tension: 0.3,
                    pointRadius: 0,
                    borderWidth: 1.5,
                    yAxisID: 'yLight',
                },
                {
                    label: '成長率 (%)',
                    data: [],
                    borderColor: '#22c55e',
                    backgroundColor: 'rgba(34,197,94,0.10)',
                    fill: true,
                    tension: 0.3,
                    pointRadius: 0,
                    borderWidth: 2,
                    yAxisID: 'yPct',
                },
                {
                    label: 'ダメージ (%)',
                    data: [],
                    borderColor: '#f43f5e',
                    backgroundColor: 'rgba(244,63,94,0.08)',
                    fill: false,
                    tension: 0.3,
                    pointRadius: 0,
                    borderWidth: 1.5,
                    borderDash: [4, 3],
                    yAxisID: 'yPct',
                },
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            animation: false,
            interaction: { mode: 'index', intersect: false },
            plugins: {
                legend: {
                    display: true,
                    position: 'top',
                    labels: { boxWidth: 12, padding: 8, font: { size: 10 } }
                },
                tooltip: {
                    callbacks: {
                        label: ctx => {
                            const v = ctx.parsed.y;
                            const u = ['°C', '%', 'klx', '%', '%'][ctx.datasetIndex];
                            return ` ${ctx.dataset.label}: ${v.toFixed(1)}${u}`;
                        }
                    }
                }
            },
            scales: {
                x: {
                    ticks: {
                        maxTicksLimit: 10,
                        color: '#94a3b8',
                        font: { size: 9 },
                        callback: (_, i) => {
                            const d = Math.floor(i / 24) + 1;
                            return i % 24 === 0 ? `Day${d}` : '';
                        }
                    },
                    grid: { color: 'rgba(148,163,184,0.15)' }
                },
                yTemp: {
                    type: 'linear',
                    position: 'left',
                    min: 0, max: 40,
                    title: { display: true, text: '°C', color: '#3b82f6', font: { size: 9 } },
                    ticks: { color: '#3b82f6', font: { size: 9 }, stepSize: 10 },
                    grid: { color: 'rgba(148,163,184,0.12)' }
                },
                yPct: {
                    type: 'linear',
                    position: 'right',
                    min: 0, max: 100,
                    title: { display: true, text: '%', color: '#64748b', font: { size: 9 } },
                    ticks: { color: '#64748b', font: { size: 9 }, stepSize: 25 },
                    grid: { drawOnChartArea: false }
                },
                yLight: {
                    type: 'linear',
                    display: false,
                    min: 0,
                }
            }
        }
    });
}

// --- 描画（毎フレーム呼ぶ） ---
function drawCharts() {
    if (!mainChart) { initMainChart(); if (!mainChart) return; }
    // scrubIndex >= 0 の場合はその時点までのデータのみ表示
    const n = scrubIndex >= 0 ? scrubIndex + 1 : chartData.temp.length;
    if (n === 0) return;

    mainChart.data.labels = Array.from({ length: n }, (_, i) => i);
    mainChart.data.datasets[0].data = chartData.temp.slice(0, n);
    mainChart.data.datasets[1].data = chartData.humid.slice(0, n);
    mainChart.data.datasets[2].data = chartData.light.slice(0, n).map(v => v / 1000); // lx → klx
    mainChart.data.datasets[3].data = chartData.growth.slice(0, n);
    mainChart.data.datasets[4].data = chartData.damage.slice(0, n);
    // 光量軸の max を動的に更新
    mainChart.options.scales.yLight.max = (sunSettings.peakLux + 15000) / 1000;
    mainChart.update('none');
}
