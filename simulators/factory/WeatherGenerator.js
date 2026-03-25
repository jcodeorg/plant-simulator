class WeatherGenerator {
    constructor() {
        // 東京の月別平均データ (最低気温, 最高気温, 平均湿度)
        this.tokyoStats = {
            1:  { minT: 1.0,  maxT: 10.0, hum: 45 },
            4:  { minT: 10.5, maxT: 19.5, hum: 60 },
            7:  { minT: 23.0, maxT: 30.5, hum: 75 },
            10: { minT: 15.0, maxT: 22.0, hum: 70 },
            // 他の月も同様に設定可能
        };
    }

    /**
     * generateMonthData(month, opts)
     * opts: { sunrise, sunset, peakLux }
     */
    generateMonthData(month, opts = {}) {
        const stats = this.tokyoStats[month] || this.tokyoStats[4]; // デフォルトは4月
        const data = [];

        // 月ごとの日照ピーク（屋内・よく日光が入る室内想定）
        // 晴天時の窓際を想定（夏: 5000lx、春/秋: 4000lx、冬: 2500lx）
        const peakMap = {
            1:  2500,
            4:  4000,
            7:  5000,
            10: 4000
        };
        const peakLux = opts.peakLux || peakMap[month] || 4000;
        const sunrise = (typeof opts.sunrise === 'number') ? opts.sunrise : 6;
        const sunset  = (typeof opts.sunset === 'number')  ? opts.sunset  : 18;

        for (let day = 1; day <= 45; day++) {
            for (let hour = 0; hour < 24; hour++) {
                // 1. 気温の計算 (14時にピーク、正弦波)
                const timeDiff = Math.sin((hour - 8) * Math.PI / 12); 
                const temp = ((stats.maxT + stats.minT) / 2) + ((stats.maxT - stats.minT) / 2) * timeDiff;

                // 2. 湿度の計算 (気温が高いと低くなる)
                const humid = stats.hum - (timeDiff * 10) + (Math.random() * 5);

                // 3. 明るさ: 太陽光を正弦波で簡易シミュレート
                let lux = 0;
                if (sunrise < sunset && hour >= sunrise && hour <= sunset) {
                    const dayProgress = (hour - sunrise) / (sunset - sunrise); // 0..1
                    const sunFactor = Math.sin(dayProgress * Math.PI); // 峰は正午
                    // 乱雲効果 (0.5 ~ 1.0)
                    const cloud = 0.5 + Math.random() * 0.5;
                    lux = Math.round(peakLux * sunFactor * cloud);
                } else {
                    // 夜間の残光を少しだけ（街灯や室内照明の影響）
                    lux = Math.round(Math.random() * 50);
                }

                data.push({
                    day: day,
                    hour: hour,
                    temp: parseFloat(temp.toFixed(1)),
                    humidity: parseFloat(Math.min(100, humid).toFixed(1)),
                    lux: lux
                });
            }
        }
        return data;
    }
}