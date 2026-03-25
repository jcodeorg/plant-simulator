class PlantSimulator {
    constructor() {
        /**
         * 成長ステージ別パラメータ (サニーレタス向け)
         *
         * 徒長 (etiolation) は minLight を下回る光量が続くと蓄積する。
         * 幼苗期が最も徒長感度が高い。
         *
         * growth 範囲:
         *   0.00-0.10: [0] 発芽期
         *   0.10-0.30: [1] 幼苗期  ← 徒長リスク最高
         *   0.30-0.70: [2] 生育期
         *   0.70-1.00: [3] 成熟期
         */
        this.stageParams = [
            // [0] 発芽期 — 光よりも温度・水分が支配的。徒長感度は低め
            {
                name:              '発芽期',
                kl:                2000,   // 光飽和定数 (Lx) — 低光量で飽和
                baseGrowthSpeed:   0.002,  // 緩やか
                optimalTemp:       22,     // 最適温度 (°C)
                tempWidth:         7,      // 温度応答幅 (σ相当)
                minLight:          300,    // 徒長が始まる最低光量 (Lx)
                etiolSensitivity:  0.4     // 徒長感度
            },
            // [1] 幼苗期 — 光が最も重要。光不足で急速に徒長する
            {
                name:              '幼苗期',
                kl:                6000,
                baseGrowthSpeed:   0.005,
                optimalTemp:       20,
                tempWidth:         8,
                minLight:          1500,   // この光量を下回ると徒長が進む
                etiolSensitivity:  1.5     // 徒長感度: 最大
            },
            // [2] 生育期 — 旺盛な光合成が必要。徒長感度は中程度
            {
                name:              '生育期',
                kl:                15000,
                baseGrowthSpeed:   0.005,
                optimalTemp:       20,
                tempWidth:         10,
                minLight:          3000,
                etiolSensitivity:  0.7
            },
            // [3] 成熟期 — 低温・適度な光で品質向上。徒長感度は低い
            {
                name:              '成熟期',
                kl:                12000,
                baseGrowthSpeed:   0.003,
                optimalTemp:       18,     // 低温が苦味を抑え品質を向上
                tempWidth:         7,
                minLight:          2000,
                etiolSensitivity:  0.3
            }
        ];

        // 共通パラメータ
        this.config = {
            ke:            0.002,  // 自然蒸発係数
            kt:            0.005,  // 蒸散係数
            kw:            0.05,   // 水位ストレス係数
            recoveryRate:  0.001,  // 自然回復量 (毎ステップ)
            damageCoeff:   0.01    // ストレス→ダメージ変換係数
        };

        // 動的な状態変数
        this.state = {
            growth:     0.0,  // 0.0 (種) 〜 1.0 (収穫)
            damage:     0.0,  // 0.0 (健康) 〜 1.0 (枯死)
            waterLevel: 0.0,  // 基準値からの水位差 (cm)
            etiolation: 0.0   // 徒長度 0.0 (正常) 〜 1.0 (重度徒長)
        };
    }

    /** 現在の成長量からステージインデックスを返す */
    getStageIndex(growth) {
        if (growth < 0.10) return 0;
        if (growth < 0.30) return 1;
        if (growth < 0.70) return 2;
        return 3;
    }

    /** VPD (飽差 kPa) を計算する — テテンの式 */
    calculateVPD(temp, humidity) {
        const esat = 0.61078 * Math.exp((17.27 * temp) / (temp + 237.3));
        const eair = esat * (humidity / 100);
        return esat - eair;
    }

    /**
     * 1ステップ（1時間）時間を進める
     * @param {number} t  温度 (°C)
     * @param {number} h  湿度 (%)
     * @param {number} l  光量 (Lx)
     * @param {number} dt 経過時間ステップ (1.0 = 1時間)
     * @returns {{ growth, damage, waterLevel, etiolation, stageName, stageIndex, vpd }}
     */
    update(t, h, l, dt = 1.0) {
        const vpd = this.calculateVPD(t, h);
        const si  = this.getStageIndex(this.state.growth);
        const sp  = this.stageParams[si];

        // --- 1. 水位変動 (蒸発 + 蒸散) ---
        const evap  = this.config.ke * vpd;
        const trans = this.config.kt * this.state.growth * (l / (l + sp.kl)) * vpd;
        this.state.waterLevel -= (evap + trans) * dt;

        // --- 2. 成長因子 ---
        // 光応答: ミカエリス・メンテン型 (ステージごとに kl が異なる)
        const fL = l / (l + sp.kl);
        // 温度応答: ガウス型ベルカーブ (ステージごとに最適温度が異なる)
        const fT = Math.exp(-Math.pow(t - sp.optimalTemp, 2) / (2 * sp.tempWidth * sp.tempWidth));
        // VPD応答: 0.8〜1.2 kPa を最適域とする
        let fVPD = 1.0;
        if      (vpd < 0.8) fVPD = vpd / 0.8;
        else if (vpd > 1.2) fVPD = Math.exp(-(vpd - 1.2));
        // 水位応答: 過水・水切れ共に成長阻害
        const iW = Math.exp(-this.config.kw * Math.pow(this.state.waterLevel, 2));

        // --- 3. 成長量 ---
        const deltaG = sp.baseGrowthSpeed * fL * fT * fVPD * iW * dt;
        this.state.growth = Math.min(1.0, this.state.growth + Math.max(0, deltaG));

        // --- 4. 徒長 (etiolation) ---
        // 徒長は「ステージの最低必要光量 minLight」を下回ると蓄積する。
        // 幼苗期は感度が高く、光なし24〜48 hで明確に徒長する。
        // 回復は構造的変化のため非常に遅い。
        const lightDeficit   = Math.max(0, (sp.minLight - l) / sp.minLight);
        const etiolRate      = lightDeficit * sp.etiolSensitivity * 0.005 * dt;
        // minLight の 2倍以上の光があれば微回復
        const etiolRecovery  = Math.max(0, l / sp.minLight - 1.0) * 0.0005 * dt;
        this.state.etiolation = Math.max(0, Math.min(1.0,
            this.state.etiolation + etiolRate - etiolRecovery));

        // --- 5. ダメージ計算 ---
        // 高温 / 湿度ストレス
        const sE     = Math.max(0, t - 25) * 0.1 + (Math.abs(h - 60) > 20 ? 0.05 : 0);
        // 水位ストレス
        const sW     = this.state.waterLevel < -3.0 ? 0.2 : Math.abs(this.state.waterLevel) * 0.02;
        // 徒長ストレス: 茎が軟弱化し病害・物理的ダメージを受けやすくなる
        const sEtiol = this.state.etiolation * 0.5;

        const totalStress = (sE + sW + sEtiol) * this.config.damageCoeff;
        const netDamage   = totalStress - this.config.recoveryRate;
        this.state.damage = Math.max(0, Math.min(1.0, this.state.damage + netDamage * dt));

        return {
            growth:     this.state.growth,
            damage:     this.state.damage,
            waterLevel: this.state.waterLevel,
            etiolation: this.state.etiolation,
            stageName:  sp.name,
            stageIndex: si,
            vpd
        };
    }

    /** 足し水を行う */
    addWater(amount) {
        this.state.waterLevel += amount;
    }
}