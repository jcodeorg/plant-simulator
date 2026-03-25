class PlantSimulator {
    constructor() {
        /**
         * 成長ステージ別パラメータ (サニーレタス向け)
         */
        this.stageParams = [
            { name: '発芽期', kl: 2000,  baseSpeed: 0.002, optTemp: 22, tempW: 7,  etiolSens: 0.4 },
            { name: '幼苗期', kl: 6000,  baseSpeed: 0.005, optTemp: 20, tempW: 8,  etiolSens: 1.5 }, // 徒長リスク最大
            { name: '生育期', kl: 15000, baseSpeed: 0.005, optTemp: 20, tempW: 10, etiolSens: 0.7 },
            { name: '成熟期', kl: 12000, baseSpeed: 0.003, optTemp: 18, tempW: 7,  etiolSens: 0.3 }
        ];

        this.config = {
            ke: 0.002,           // 自然蒸発係数
            kt: 0.005,           // 蒸散係数
            kw: 0.05,            // 水位ストレス係数
            recoveryRate: 0.001, // 自然回復量
            damageCoeff: 0.01,   // 全体ダメージ係数
            dliThreshold: 8000*10 //150000 // 理想積算光量 (Lx・h)
        };

        this.state = {
            growth: 0.0,
            damage: 0.0,
            waterLevel: 0.0,    // 0.0cm基準
            etiolation: 0.0,    // 徒長度
            tipburn: 0.0,       // チップバーン度
            dailyLightSum: 0,   // 当日の積算光量
            isLightDeficit: false, // 前日の光不足フラグ
            isDay: false,       // 昼間フラグ (l>50で立ち、l<50で倒れる。0時にリセット)
            storageDLI: 0.0     // 光合成エネルギー蓄積量 (昇淯上限 1.0)
        };
    }

    /** 成長ステージの判定 */
    getStage() {
        const g = this.state.growth;
        if (g < 0.10) return this.stageParams[0];
        if (g < 0.30) return this.stageParams[1];
        if (g < 0.70) return this.stageParams[2];
        return this.stageParams[3];
    }

    /** 飽差 (VPD) の計算 */
    calculateVPD(t, h) {
        const esat = 0.61078 * Math.exp((17.27 * t) / (t + 237.3));
        const eair = esat * (h / 100);
        return esat - eair;
    }

    /**
     * ステップ更新 (1時間ごとを想定)
     */
    update(t, h, l, dt = 1.0, hour = 0) {
        // --- 0. 日次リセットと積算光量 ---
        if (hour === 0) {
            this.state.isLightDeficit = (this.state.dailyLightSum < this.config.dliThreshold);
            this.state.dailyLightSum = 0;
            this.state.isDay = false; // 日付が変わったら昼間フラグをリセット
        }
        this.state.dailyLightSum += l * dt;

        const vpd = this.calculateVPD(t, h);
        const sp = this.getStage();

        // --- 1. 水位変動 (蒸発 + 蒸散) ---
        const evap = this.config.ke * vpd;
        const trans = this.config.kt * this.state.growth * (l / (l + sp.kl)) * vpd;
        this.state.waterLevel -= (evap + trans) * dt;

        // --- 2. 成長因子の計算 ---
        // 昼間フラグを先に確定（エネルギーモデルで必要）
        if (l > 50) this.state.isDay = true;
        if (l < 50) this.state.isDay = false;
        const isDaytime = this.state.isDay;

        const fL = l / (l + sp.kl);
        const fT = Math.exp(-Math.pow(t - sp.optTemp, 2) / (2 * sp.tempW * sp.tempW));
        
        let fVPD = 1.0; // VPD応答
        if (vpd < 0.8) fVPD = vpd / 0.8;
        else if (vpd > 1.2) fVPD = Math.exp(-(vpd - 1.2));
        
        const iW = Math.exp(-this.config.kw * Math.pow(this.state.waterLevel, 2)); // 水位応答

        // --- エネルギー蓄積・変換モデル ---
        let deltaG = 0;
        if (isDaytime) {
            // 昼間: 光合成でエネルギーを蓄める
            // /10 で正規化: 良好な照度12hでほぼ満タン(~0.7)になるスケール
            this.state.storageDLI = Math.min(1.0, this.state.storageDLI + fL * fT * dt / 10);

            // デンプン飽和チェック: 0.7超で光合成抑制・わずかにチップバーンリスク上昇
            let satDebuff = 1.0;
            if (this.state.storageDLI > 0.7) {
                satDebuff = 0.8;  // 抑制は軽め
                // 飽和によるチップバーンリスク（非常にゆっくり）
                this.state.tipburn = Math.min(1.0, this.state.tipburn + 0.002 * dt);
            }
            deltaG = sp.baseSpeed * fL * fT * fVPD * iW * satDebuff * dt;
        } else {
            // 夜間: 蓄積エネルギーを成長に変換
            const conversionRate = 0.1 * fT; // 夜間温度が良いほど変換効率アップ
            const cost = Math.min(this.state.storageDLI, 0.05 * dt);
            deltaG = cost * conversionRate;
            this.state.storageDLI = Math.max(0, this.state.storageDLI - cost);
        }

        this.state.growth = Math.min(1.0, this.state.growth + Math.max(0, deltaG));

        // --- 3. 徒長 (Etiolation) ---
        let etiolStep = 0;
        // isDaytime は step 2 先頭で確定済み
        const lightThreshold = 8000;

        // 発芽期は暗所発芽が基本のため徒長しない
        const isGerminating = this.state.growth < 0.10;

        // 「昼間の光不足」または「エネルギー不足の夜」に進行
        if (!isGerminating && ((isDaytime && l < lightThreshold) || (!isDaytime && this.state.isLightDeficit))) {
            // console.log(hour, isDaytime, l < lightThreshold, this.state.isLightDeficit);
            const deficit = isDaytime ? (lightThreshold - l) / lightThreshold : 0.5;
            const tFactor = t > 22 ? (t - 22) * 0.1 + 1 : 1;
            etiolStep = deficit * tFactor * sp.etiolSens * 0.01;
        }
        this.state.etiolation = Math.min(1.0, this.state.etiolation + etiolStep * dt);

        // --- 4. チップバーン (Tipburn) ---
        let tipburnStep = 0;
        if (this.state.growth > 0.3) {
            // 高負荷（強い光＋高温）かつ 蒸散不良（VPD異常）
            const isHighLoad = (l > 15000 && t > 26);
            const vpdBad = (vpd < 0.4 || vpd > 1.8);
            if (isHighLoad && vpdBad) {
                // 急激な成長にカルシウム供給が追いつかない状態を模倣
                tipburnStep = deltaG * 1.5 * dt;
            }
        }
        this.state.tipburn = Math.min(1.0, this.state.tipburn + tipburnStep);

        // --- 5. ダメージ・健康度 ---
        // 環境ストレス (高温・湿度異常)
        const sE = Math.max(0, t - 26) * 0.1 + (Math.abs(h - 60) > 25 ? 0.05 : 0);
        // 水位ストレス (水切れは致命的)
        const sW = this.state.waterLevel < -3.0 ? 0.3 : Math.abs(this.state.waterLevel) * 0.03;
        // 徒長とチップバーンによる品質低下（個別に記録）
        const sEtiol   = this.state.etiolation * 0.2;
        const sTipburn = this.state.tipburn * 0.3;   // 0.8 → 0.3 に緩和
        const sQuality = sEtiol + sTipburn;

        const totalStress = (sE + sW + sQuality) * this.config.damageCoeff;
        const netDamage = totalStress - this.config.recoveryRate;
        this.state.damage = Math.max(0, Math.min(1.0, this.state.damage + netDamage * dt));

        return {
            ...this.state,
            stageName: sp.name,
            vpd: vpd,
            isDead: this.state.damage >= 1.0,
            isHarvestable: this.state.growth >= 1.0 && this.state.damage < 0.5,
            stressBreakdown: {
                env:      sE      * this.config.damageCoeff,  // 現時点の環境ストレス/h
                water:    sW      * this.config.damageCoeff,  // 水分ストレス/h
                etiol:    sEtiol  * this.config.damageCoeff,  // 徒長ストレス/h
                tipburn:  sTipburn* this.config.damageCoeff,  // チップバーンストレス/h
                recovery: this.config.recoveryRate,            // 自然回復/h
                net:      netDamage                            // 正味ダメージ変化/h
            }
        };
    }

    addWater(amount) {
        this.state.waterLevel += amount;
    }
}