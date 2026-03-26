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
        };

        this.state = {
            growth: 0.0,
            damage: 0.0,
            waterLevel: 0.0,    // 0.0cm基準
            tipburn: 0.0,       // チップバーン度
            storageDLI: 0.0,    // 光合成エネルギー蓄積量 (上限 1.0)
            isDayLightDeficit: false // 当日昼間に光不足があったフラグ (夜の徒長判定に使用)
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
            this.state.isDayLightDeficit = false; // 昼間光不足フラグを朝にリセット
        }

        const vpd = this.calculateVPD(t, h);
        const sp = this.getStage();

        // --- 1. 水位変動 (蒸発 + 蒸散) ---
        const evap = this.config.ke * vpd;
        const trans = this.config.kt * this.state.growth * (l / (l + sp.kl)) * vpd;
        this.state.waterLevel -= (evap + trans) * dt;

        // --- 2. 成長因子の計算 ---
        // 昼間フラグをローカル変数で判定
        const isDaytime = l > 50;

        const fL = l / (l + sp.kl);
        const fT = Math.exp(-Math.pow(t - sp.optTemp, 2) / (2 * sp.tempW * sp.tempW));
        
        let fVPD = 1.0; // VPD応答
        if (vpd < 0.8) fVPD = vpd / 0.8;
        else if (vpd > 1.2) fVPD = Math.exp(-(vpd - 1.2));
        
        const iW = Math.exp(-this.config.kw * Math.pow(this.state.waterLevel, 2)); // 水位応答

        // --- エネルギー蓄積・変換モデル ---
        // 発芽期は暗所発芽が基本のため徒長しない
        const isGerminating = this.state.growth < 0.10;
        let etiolStep = 0;            // 徒長進行速度 (per hour)
        const dayLightThreshold = 5000; // 昼間光不足の判定閾値 (lx)

        let deltaG = 0;
        if (isDaytime) {
            // 昼間: 光合成でエネルギーを蓄める
            // /10 で正規化: 良好な照度12hでほぼ満タン(~0.7)になるスケール
            this.state.storageDLI = Math.min(1.0, this.state.storageDLI + fL * fT * dt / 10);

            // 昼間光不足フラグ: 5000lx未満なら「徒長予備軍」として記録
            if (!isGerminating && l < dayLightThreshold) {
                this.state.isDayLightDeficit = true;
            }

            // デンプン飽和チェック: 0.7超で光合成抑制・わずかにチップバーンリスク上昇
            let satDebuff = 1.0;
            if (this.state.storageDLI > 0.7) {
                satDebuff = 0.8;  // 抑制は軽め
                // 飽和によるチップバーンリスク（非常にゆっくり）
                this.state.tipburn = Math.min(1.0, this.state.tipburn + 0.002 * dt);
            }
            deltaG = sp.baseSpeed * fL * fT * fVPD * iW * satDebuff * dt;
        } else {
            // 夜間: 蓄積エネルギーを「成長 (Growth)」または「徒長 (Etiolation)」に分配
            const conversionRate = 0.1 * fT; // 夜間温度が良いほど変換効率アップ
            const cost = Math.min(this.state.storageDLI, 0.05 * dt);
            this.state.storageDLI = Math.max(0, this.state.storageDLI - cost);

            if (!isGerminating && this.state.isDayLightDeficit) {
                // 【徒長ルート】昼間に光不足 → 「光のある高さまで伸びろ」という命令
                // 夜温が高いほど細胞伸長が加速（代謝過剰による軟弱化）
                const nightTempMult = t > 20 ? 1.0 + (t - 20) * 0.15 : 1.0;
                etiolStep = (cost / dt) * conversionRate * sp.etiolSens * nightTempMult;
                deltaG    = cost * conversionRate * 0.2; // 成長は抑制（エネルギーを徒長に奪われる）
            } else {
                // 【正常ルート】エネルギーを均一な成長に変換
                deltaG = cost * conversionRate;
                // 夜温過剰による軟弱化（光は足りているが高温で細胞が過剰伸長する）
                if (!isGerminating && t > 22) {
                    etiolStep = (t - 22) * 0.004 * sp.etiolSens;
                }
            }
        }

        this.state.growth = Math.min(1.0, this.state.growth + Math.max(0, deltaG));

        // --- 3. チップバーン (Tipburn) ---
        // ※etiolStep はエネルギーモデルで算出済み → 以下のダメージ計算(sEtiol)に直接使用
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
        const sW = this.state.waterLevel < -3.0 ? 0.3 : 0 // Math.abs(this.state.waterLevel) * 0.03;
        // 徒長・軟弱化ストレスとチップバーンによる品質低下
        const sTipburn = this.state.tipburn * 0.3;
        // etiolStep を累積せず /h 直接換算 — 他のストレス要因(sE, sW)と同様に扱う
        const sEtiol   = etiolStep * 10;  // 光不足・夜温過剰による組織劣化 (max ≈ 0.15〜0.2)

        const dmgE = sE * this.config.damageCoeff;
        const dmgW = sW * this.config.damageCoeff;
        const dmgT = sTipburn * this.config.damageCoeff;
        const dmgEt = sEtiol * this.config.damageCoeff;
        const recov = this.config.recoveryRate;

        const netDamage = Math.max(0, dmgE + dmgW + dmgT - recov) + dmgEt; // 徒長ストレスは回復で相殺されない（自然回復は主に環境ストレスの回復を表すため）
        this.state.damage = Math.max(0, Math.min(1.0, this.state.damage + netDamage * dt));

        return {
            ...this.state,
            // etiolRate: etiolStep,  // 現時点の徒長ダメージ発生率 (SVG描画・ブレークダウン表示用)
            stageName: sp.name,
            vpd: vpd,
            isDead: this.state.damage >= 1.0,
            isHarvestable: this.state.growth >= 1.0 && this.state.damage < 0.5,
            stressBreakdown: {
                env:      dmgE    * dt,  // 現時点の環境ストレス/h
                water:    dmgW    * dt,  // 水分ストレス/h
                etiol:    dmgEt   * dt,  // 徒長・軟弱化ストレス/h
                tipburn:  dmgT    * dt,  // チップバーンストレス/h
                recovery: recov   * dt,  // 自然回復/h
                net:      netDamage * dt  // 正味ダメージ変化/h
            }
        };
    }

    addWater(amount) {
        this.state.waterLevel += amount;
    }
}