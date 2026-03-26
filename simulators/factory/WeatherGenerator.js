class WeatherGenerator {
    /**
     * generateMonthData(month, opts)
     * opts: { sunrise, sunset, peakLux, minT, maxT, hum }
     * 気温・湿度データは呼び出し元 (MONTH_DEFAULTS) から渡す
     */
    generateMonthData(month, opts = {}) {
        const minT    = (opts.minT   != null) ? opts.minT   : 10.5;
        const maxT    = (opts.maxT   != null) ? opts.maxT   : 19.5;
        const hum     = (opts.hum    != null) ? opts.hum    : 60;
        const data = [];

        const peakLux = (opts.peakLux != null) ? opts.peakLux : 4000;
        const sunrise = (typeof opts.sunrise === 'number') ? opts.sunrise : 6;
        const sunset  = (typeof opts.sunset === 'number')  ? opts.sunset  : 18;

        for (let day = 1; day <= 45; day++) {
            for (let hour = 0; hour < 24; hour++) {
                // 1. 気温の計算 (14時にピーク、正弦波)
                const timeDiff = Math.sin((hour - 8) * Math.PI / 12); 
                const temp = ((maxT + minT) / 2) + ((maxT - minT) / 2) * timeDiff;

                // 2. 湿度の計算 (気温が高いと低くなる)
                const humid = hum - (timeDiff * 10) + (Math.random() * 5);

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