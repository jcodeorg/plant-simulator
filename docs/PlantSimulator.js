class PlantSimulator {
    constructor() {
        /**
         * 成長ステージ別パラメータ (リーフレタス向け)
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
            waterLevel: 5.0,    // 5.0cm渴水目標値
            tipburn: 0.0,       // チップバーン度
            storageDLI: 0.0,    // 光合成エネルギー蓄積量 (上限 1.0)
            isDayLightDeficit: false // 当日昼間に光不足があったフラグ (夜の徒長判定に使用)
        };
        // 発芽制御: 条件が連続して満たされた時間 (時間単位) と発芽開始フラグ
        this.state.germinationTimerHours = 0.0;
        this.state.germinationActive = false; // 条件が満たされ、発芽が開始されたか
        // 土の締まり (0.0=緩い/通気良好, 1.0=非常に固い/通気悪い)
        this.state.soilCompaction = 0.2;
        // 発芽パラメータ（リーフレタス用）
        // - moistureMin/Max: 土のしっとりレンジ（過湿はNG）
        // - tempMin/Max: 発芽に適した温度範囲
        // - maxAvoidTemp: 回避すべき高温閾値（安全側の上限）
        // - soilCompactionMax: 通気良好と見なす最大の土の締まり
        // - lightMin: 発芽に必要な最小照度 (lx)
        // - requiredHours: 条件が連続で満たされる必要時間 (時間)
        this.germinationParams = {
            moistureMin: 4.0,
            moistureMax: 6.0,
            tempMin: 15.0,
            tempMax: 20.0,
            maxAvoidTemp: 25.0,
            soilCompactionMax: 0.4,
            lightMin: 1000,
            requiredHours: 1.0
        };
        // 種子由来の初期エネルギー（発芽直後の成長・徒長に使用される）
        this.state.seedEnergy = 0.20; // 内部エネルギースケール（強め）
        // 種子エネルギーの変換パラメータ
        this.seedParams = {
            dayEtiolConversion: 1.4,   // 昼間の種子/貯蔵エネルギー→徒長変換効率（強め）
            nightEtiolConversion: 1.0, // 夜間の変換効率
            maxDayEtiolUse: 0.12,      // 昼間に1hあたり使える最大エネルギー（大幅増加）
            maxNightUse: 0.08          // 夜間に1hあたり使える最大エネルギー（やや増加）
        };
        // 徒長予備プール: 発芽後に持続的に徒長を起こせる余力（単位: 内部エネルギースケール）
        this.etiolationParams = {
            reserveInitial: 6.0,    // 初期リザーブ量（デフォルトでかなり持続）
            reserveEfficiency: 1.0   // リザーブから徒長への変換効率
        };
        this.state.etiolationReserve = this.etiolationParams.reserveInitial;
        this.pendingWater = 0; // 予約された足し水量 (次の update() で適用)
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

        // --- 予約された足し水を適用 ---
        if (this.pendingWater > 0) {
            this.state.waterLevel += this.pendingWater;
            this.pendingWater = 0;
        }

        // --- 発芽条件チェック (リーフレタス) ---
        // 条件が `germinationParams.requiredHours` 連続で満たされると発芽期が開始する
        const gp = this.germinationParams;
        const moistureGood = (this.state.waterLevel >= gp.moistureMin && this.state.waterLevel <= gp.moistureMax);
        const tempGood = (t >= gp.tempMin && t <= gp.tempMax && t < gp.maxAvoidTemp);
        const oxygenGood = (this.state.soilCompaction <= gp.soilCompactionMax);
        const lightGood = (l >= gp.lightMin);
        const germConditionsMet = moistureGood && tempGood && oxygenGood && lightGood;

        // 発芽未開始かつ発芽期未到達ならタイマーを進める/リセット
        if (this.state.growth < 0.10 && !this.state.germinationActive) {
            if (germConditionsMet) {
                this.state.germinationTimerHours += dt;
            } else {
                this.state.germinationTimerHours = 0.0;
            }

            if (this.state.germinationTimerHours >= gp.requiredHours) {
                this.state.germinationActive = true;
                // 発芽開始を明示するために最小成長値を与える（以降通常の発育計算が働く）
                this.state.growth = Math.max(this.state.growth, 0.001);
            }
        }

        const vpd = this.calculateVPD(t, h);
        const sp = this.getStage();

        // --- 1. 水位変動 (蒸発 + 蒸散) ---
        const evap = this.config.ke * vpd;
        const trans = this.config.kt * this.state.growth * (l / (l + sp.kl)) * vpd;
        this.state.waterLevel -= (evap + trans) * dt * 3; // 水位変動をcm単位で表現 (蒸発・蒸散の影響を拡大して見やすくするため)

        // --- 2. 成長因子の計算 ---
        // 昼間フラグをローカル変数で判定
        const isDaytime = l > 50;

        const fL = l / (l + sp.kl);
        const fT = Math.exp(-Math.pow(t - sp.optTemp, 2) / (2 * sp.tempW * sp.tempW));
        
        let fVPD = 1.0; // VPD応答
        if (vpd < 0.8) fVPD = vpd / 0.8;
        else if (vpd > 1.2) fVPD = Math.exp(-(vpd - 1.2));
        
        const iW = Math.exp(-this.config.kw * Math.pow(this.state.waterLevel - 5.0, 2)); // 渴水応答 (5cmからの乖離で成長抸制)

        // --- エネルギー蓄積・変換モデル ---
        // 発芽期 (成長<0.10) の扱い: 発芽条件が満たされ発芽開始(`germinationActive`)するまでは
        // 種子は成長しない（光合成蓄積も行わない）。条件成立後は通常の発育ルートへ入る。
        const isGerminating = this.state.growth < 0.05; // 発芽初期（成長0.05未満）を特に厳しく制限
        const allowGerminationGrowth = this.state.germinationActive || this.state.growth >= 0.10;
        let etiolStep = 0;            // 徒長進行速度 (per hour)
        // 診断用の直近使用量・希望量
        let lastDesiredDay = 0;
        let lastDesiredCost = 0;
        let lastSeedUsed = 0;
        let lastStorageUsed = 0;
        let lastReserveUsed = 0;
        const dayLightThreshold = 2000; // 昼間光不足の判定閾値 (lx) — 低光判定を厳しくして昼間徒長が起きやすくする

        let deltaG = 0;
        if (isDaytime) {
            // 昼間: 光合成でエネルギーを蓄める
            // 発芽未開始の場合は通常の光合成成長は行わないが、
            // 種子エネルギーがある場合は昼間でも徒長エネルギーとして消費可能にする。
            if (isGerminating && !allowGerminationGrowth) {
                // 発芽前でも光が不足している場合、種子エネルギーを使って徒長を起こす
                if (l < dayLightThreshold) {
                    const maxUse = this.seedParams.maxDayEtiolUse * dt;
                    const desired = Math.min(this.state.storageDLI + this.state.seedEnergy, maxUse);
                    // 供給優先度: seedEnergy -> storageDLI -> etiolReserve
                    const seedUsed = Math.min(this.state.seedEnergy, desired);
                    const remainAfterSeed = desired - seedUsed;
                    const storageUsed = Math.min(this.state.storageDLI, remainAfterSeed);
                    const remainAfterStorage = remainAfterSeed - storageUsed;
                    const reserveUsed = Math.min(this.state.etiolationReserve, remainAfterStorage);
                    // 差し引き
                    this.state.seedEnergy = Math.max(0, this.state.seedEnergy - seedUsed);
                    this.state.storageDLI = Math.max(0, this.state.storageDLI - storageUsed);
                    this.state.etiolationReserve = Math.max(0, this.state.etiolationReserve - reserveUsed);
                    const tempMult = t > 20 ? 1.0 + (t - 20) * 0.1 : 1.0;
                    // etiolStep にリザーブの効率も反映
                    etiolStep = (desired / dt) * this.seedParams.dayEtiolConversion * sp.etiolSens * tempMult * this.etiolationParams.reserveEfficiency;
                    deltaG = desired * 0.05; // 種子/リザーブエネルギーによる控えめな成長
                    lastDesiredDay = desired;
                    lastSeedUsed = seedUsed;
                    lastStorageUsed = storageUsed;
                    lastReserveUsed = reserveUsed;
                } else {
                    deltaG = 0;
                }
            } else {
                // /10 で正規化: 良好な照度12hでほぼ満タン(~0.7)になるスケール
                this.state.storageDLI = Math.min(1.0, this.state.storageDLI + fL * fT * dt / 10);

                // 昼間光不足フラグ: 低照度なら「徒長予備軍」として記録
                if (allowGerminationGrowth && l < dayLightThreshold) {
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

                // 昼間でも光が不足しているときは、蓄積エネルギー＋種子エネルギーを使って
                // 一部を徒長に回す（夜間のみだった徒長を昼間にも発生させる）
                if (allowGerminationGrowth && l < dayLightThreshold) {
                    const maxDayUse = this.seedParams.maxDayEtiolUse * dt;
                    const desiredDay = Math.min(this.state.storageDLI + this.state.seedEnergy, maxDayUse);
                    if (desiredDay > 0) {
                        const seedUsed = Math.min(this.state.seedEnergy, desiredDay);
                        const remainAfterSeed = desiredDay - seedUsed;
                        const storageUsed = Math.min(this.state.storageDLI, remainAfterSeed);
                        const remainAfterStorage = remainAfterSeed - storageUsed;
                        const reserveUsed = Math.min(this.state.etiolationReserve, remainAfterStorage);
                        this.state.seedEnergy = Math.max(0, this.state.seedEnergy - seedUsed);
                        this.state.storageDLI = Math.max(0, this.state.storageDLI - storageUsed);
                        this.state.etiolationReserve = Math.max(0, this.state.etiolationReserve - reserveUsed);
                        const tempMult = t > 20 ? 1.0 + (t - 20) * 0.1 : 1.0;
                        etiolStep += (desiredDay / dt) * this.seedParams.dayEtiolConversion * sp.etiolSens * tempMult * this.etiolationParams.reserveEfficiency;
                        // 徒長に回すため成長をやや抑える
                        deltaG = Math.max(0, deltaG - desiredDay * 0.2);
                        lastDesiredDay = desiredDay;
                        lastSeedUsed = seedUsed;
                        lastStorageUsed = storageUsed;
                        lastReserveUsed = reserveUsed;
                    }
                }
            }
        } else {
            // 夜間: 蓄積エネルギーを「成長 (Growth)」または「徒長 (Etiolation)」に分配
            const conversionRate = 0.1 * fT; // 夜間温度が良いほど変換効率アップ
            // 夜間は貯蔵エネルギー＋種子エネルギーを使用可能にする
            const maxNight = this.seedParams.maxNightUse * dt;
            const desiredCost = Math.min(this.state.storageDLI + this.state.seedEnergy, maxNight);
            const storageUsed = Math.min(this.state.storageDLI, desiredCost);
            const remainAfterStorage = desiredCost - storageUsed;
            const seedUsed = Math.min(this.state.seedEnergy, remainAfterStorage);
            const remainAfterSeed = remainAfterStorage - seedUsed;
            const reserveUsed = Math.min(this.state.etiolationReserve, remainAfterSeed);
            this.state.storageDLI = Math.max(0, this.state.storageDLI - storageUsed);
            this.state.seedEnergy = Math.max(0, this.state.seedEnergy - seedUsed);
            this.state.etiolationReserve = Math.max(0, this.state.etiolationReserve - reserveUsed);
            const cost = desiredCost;
            lastDesiredCost = desiredCost;
            lastSeedUsed = seedUsed;
            lastStorageUsed = storageUsed;
            lastReserveUsed = reserveUsed;

            // 発芽未開始ならエネルギー変換もしない
            if (isGerminating && !allowGerminationGrowth) {
                etiolStep = 0;
                deltaG = 0;
            } else if (allowGerminationGrowth && this.state.isDayLightDeficit) {
                // 【徒長ルート】昼間に光不足 → 「光のある高さまで伸びろ」という命令
                // 夜温が高いほど細胞伸長が加速（代謝過剰による軟弱化）
                const nightTempMult = t > 20 ? 1.0 + (t - 20) * 0.15 : 1.0;
                etiolStep = (cost / dt) * conversionRate * sp.etiolSens * nightTempMult;
                deltaG    = cost * conversionRate * 0.2; // 成長は抑制（エネルギーを徒長に奪われる）
            } else {
                // 【正常ルート】エネルギーを均一な成長に変換
                deltaG = cost * conversionRate;
                // 夜温過剰による軟弱化（光は足りているが高温で細胞が過剰伸長する）
                if (allowGerminationGrowth && t > 22) {
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
        // 渴水ストレス (5cmからの乖離でダメージ増加、下回りすぎは致命的)
        const dev = this.state.waterLevel - 5.0;
        const sW = dev < -3.0 ? 0.3 : Math.abs(dev) * 0.03;
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

        const stageName = (this.state.growth < 0.10 && !this.state.germinationActive) ? '未発芽' : sp.name;

        return {
            ...this.state,
            // etiolRate: etiolStep,  // 現時点の徒長ダメージ発生率 (SVG描画・ブレークダウン表示用)
            stageName: stageName,
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
            ,
            debug: {
                etiolStep: etiolStep,
                lastDesiredDay: lastDesiredDay,
                lastDesiredCost: lastDesiredCost,
                lastSeedUsed: lastSeedUsed,
                lastStorageUsed: lastStorageUsed,
                lastReserveUsed: lastReserveUsed,
                etiolReserve: this.state.etiolationReserve
            }
        };
    }

    addWater(amount) {
        this.pendingWater += amount; // 足し水を予約（update() 内で適用される）
    }

    setSoilCompaction(value) {
        // 値は 0.0 (緩い) 〜 1.0 (非常に固い) の範囲を想定
        this.state.soilCompaction = Math.max(0, Math.min(1, value));
    }

    setGerminationParams(params) {
        // 部分的に上書き可能
        this.germinationParams = Object.assign({}, this.germinationParams, params);
    }
}

// Node.js での利用を想定したエクスポート（ブラウザ側では無視される）
if (typeof module !== 'undefined' && module.exports) {
    module.exports = PlantSimulator;
}