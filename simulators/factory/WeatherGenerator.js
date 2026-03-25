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

    generateMonthData(month) {
        const stats = this.tokyoStats[month] || this.tokyoStats[4]; // デフォルトは4月
        const data = [];

        for (let day = 1; day <= 45; day++) {
            for (let hour = 0; hour < 24; hour++) {
                // 1. 気温の計算 (14時にピーク、正弦波)
                const timeDiff = Math.sin((hour - 8) * Math.PI / 12); 
                const temp = ((stats.maxT + stats.minT) / 2) + ((stats.maxT - stats.minT) / 2) * timeDiff;

                // 2. 湿度の計算 (気温が高いと低くなる)
                const humid = stats.hum - (timeDiff * 10) + (Math.random() * 5);

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