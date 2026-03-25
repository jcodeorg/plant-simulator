class PlantSimulator {
    constructor() {
        // 植物の固定パラメータ (サニーレタス向け)
        this.config = {
            baseGrowthSpeed: 0.005,  // 1ステップあたりの基本成長速度
            kl: 15000,               // 光飽和定数 (Lx)
            ke: 0.002,               // 自然蒸発係数
            kt: 0.005,               // 植物の蒸散係数
            kw: 0.05,                // 水位異常による成長阻害係数
            recoveryRate: 0.001,     // 自然回復量
            damageCoeff: 0.01        // ストレス感度
        };

        // 動的な状態変数
        this.state = {
            growth: 0.0,    // 0.0 (種) 〜 1.0 (収穫)
            damage: 0.0,    // 0.0 (健康) 〜 1.0 (枯死)
            waterLevel: 0.0 // 基準値からの差 (cm)。初期値0
        };
    }

    /**
     * VPD (飽差) を計算する内部メソッド
     */
    calculateVPD(temp, humidity) {
        // テテンの式による飽和水蒸気圧 (kPa)
        const esat = 0.61078 * Math.exp((17.27 * temp) / (temp + 237.3));
        // 現在の水蒸気圧
        const eair = esat * (humidity / 100);
        return esat - eair;
    }

    /**
     * 1ステップ（例えば1時間）時間を進める
     * @param {number} t 温度 (°C)
     * @param {number} h 湿度 (%)
     * @param {number} l 光量 (Lx)
     * @param {number} dt 経過時間ステップ (1.0 = 1単位時間)
     */
    update(t, h, l, dt = 1.0) {
        const vpd = this.calculateVPD(t, h);

        // --- 1. 水位の変動 (蒸発 + 蒸散) ---
        const evap = this.config.ke * vpd;
        const trans = this.config.kt * this.state.growth * (l / (l + this.config.kl)) * vpd;
        const waterLoss = (evap + trans) * dt;
        this.state.waterLevel -= waterLoss;

        // --- 2. 成長率の計算 ---
        // 光応答
        const fL = l / (l + this.config.kl);
        // 温度応答 (20度最適のベルカーブ)
        const fT = Math.exp(-Math.pow(t - 20, 2) / 50);
        // VPD応答 (0.8~1.2kPaを最適とする)
        let fVPD = 1.0;
        if (vpd < 0.8) fVPD = vpd / 0.8;
        else if (vpd > 1.2) fVPD = Math.exp(-(vpd - 1.2));
        
        // 水位による成長阻害 (水位が-2cm以下、または+2cm以上で低下)
        const iW = Math.exp(-this.config.kw * Math.pow(this.state.waterLevel, 2));

        const deltaG = this.config.baseGrowthSpeed * fL * fT * fVPD * iW * dt;
        this.state.growth = Math.min(1.0, this.state.growth + deltaG);

        // --- 3. ダメージの計算 ---
        // 環境ストレス (温度25度以上、または湿度80%以上/40%以下)
        const sE = (Math.max(0, t - 25) * 0.1) + (Math.abs(h - 60) > 20 ? 0.05 : 0);
        // 水位ストレス (特に水切れに厳しい設定)
        const sW = this.state.waterLevel < -3.0 ? 0.2 : (Math.abs(this.state.waterLevel) * 0.02);

        const totalStress = (sE + sW) * this.config.damageCoeff;
        const netDamage = totalStress - this.config.recoveryRate;
        
        this.state.damage = Math.max(0.0, Math.min(1.0, this.state.damage + netDamage * dt));

        return { ...this.state, vpd };
    }

    /**
     * 足し水を行うメソッド
     */
    addWater(amount) {
        this.state.waterLevel += amount;
    }
}