// block-engine.js
// ビジュアルブロックの実行エンジン・Python書き出し・D&D処理
// sim-state.js より後にロードすること

// --- D&D ---
let draggedElement = null;

function isFromWorkspace(el) {
    return !!el.closest('#workspace');
}

document.addEventListener('dragstart', (e) => {
    if (e.target?.classList?.contains('block')) {
        draggedElement = e.target;
        // ワークスペース内ブロックのドラッグ中のみゴミ箱を表示
        if (isFromWorkspace(draggedElement)) {
            const overlay = document.getElementById('trash-overlay');
            if (overlay) overlay.classList.add('active');
        }
    }
    e.dataTransfer.setData('text/plain', '');
});

document.addEventListener('dragend', () => {
    const overlay = document.getElementById('trash-overlay');
    if (overlay) overlay.classList.remove('active');
    draggedElement = null;
});

document.addEventListener('dragover', (e) => {
    const slot = e.target.closest('.slot') || e.target.closest('#workspace');
    if (slot) { e.preventDefault(); slot.classList.add('slot-highlight'); }
    // ゴミ箱オーバーレイへのdragoverを許可
    const overlay = e.target.closest('#trash-overlay');
    if (overlay && draggedElement && isFromWorkspace(draggedElement)) e.preventDefault();
});

document.addEventListener('dragleave', (e) => {
    const slot = e.target.closest('.slot') || e.target.closest('#workspace');
    if (slot) slot.classList.remove('slot-highlight');
});

document.addEventListener('drop', (e) => {
    // ゴミ箱への drop → 削除
    const overlay = e.target.closest('#trash-overlay');
    if (overlay && draggedElement && isFromWorkspace(draggedElement)) {
        e.preventDefault();
        draggedElement.remove();
        overlay.classList.remove('active');
        updateElseBars();
        saveWorkspace();
        draggedElement = null;
        return;
    }
    const target = e.target.closest('.slot') || e.target.closest('#workspace');
    if (target && draggedElement) {
        e.preventDefault();
        target.classList.remove('slot-highlight');
        let blockToDrop;
        if (draggedElement.closest('.block-container')) {
            blockToDrop = draggedElement.cloneNode(true);

            const selects = draggedElement.querySelectorAll('select');
            const cloneSelects = blockToDrop.querySelectorAll('select');
            selects.forEach((s, i) => cloneSelects[i].value = s.value);
            const inputs = draggedElement.querySelectorAll('input');
            const cloneInputs = blockToDrop.querySelectorAll('input');
            inputs.forEach((inpt, i) => cloneInputs[i].value = inpt.value);
            const logicSel = blockToDrop.querySelector('.logic-select');
            if (logicSel) updateLogicRow(logicSel);
        } else {
            blockToDrop = draggedElement;
        }
        target.appendChild(blockToDrop);
        applyBlockLang(blockToDrop);
        updateElseBars();
        saveWorkspace();
    }
    // dragend で draggedElement はリセットされるが drop 後も念のため
    draggedElement = null;
});

// --- ブロックUI ---
function updateLogicRow(sel) {
    const row = sel.closest('.logic-row');
    const active = sel.value !== 'none';
    row.querySelectorAll('.logic-dim').forEach(el => el.style.opacity = active ? '1' : '0.4');
}

function updateElseBars() {
    document.querySelectorAll('[data-role="else"]').forEach(slot => {
        const bar = slot.previousElementSibling;
        if (bar && bar.classList.contains('else-bar')) {
            bar.style.opacity = slot.children.length === 0 ? '0.35' : '1';
        }
    });
}

// --- センサー読み取り ---
function getSensorValue(sensorType) {
    if (sensorType === 'sun_lx')      return state.sunLux;
    if (sensorType === 'temp')        return state.temp;
    if (sensorType === 'water_cm') return state.waterLevel;
    if (sensorType === 'hour')        return state.hour;
    if (sensorType === 'day')         return state.day;
    return 0;
}

function evalOneCondition(sensorType, operator, targetValue) {
    const cv = getSensorValue(sensorType);
    if (operator === 'lt') return cv < targetValue;
    if (operator === 'gt') return cv > targetValue;
    if (operator === 'eq') return Math.abs(cv - targetValue) < 1;
    return false;
}

// querySelector の代わりに直接の子孫のみを対象にするヘルパー
// (入れ子ifブロックで内側の要素を誤って拾わないようにするため)
function qsOwn(block, selector) {
    for (const child of block.children) {
        if (child.matches(selector)) return child;
        if (!child.dataset?.role) {
            const found = qsOwn(child, selector);
            if (found) return found;
        }
    }
    return null;
}

// --- ブロック実行 ---
function executeBlockList(elementList) {
    for (let block of elementList) {
        const type = block.dataset.type;
        if (type === 'custom_if_else') {
            let condition = evalOneCondition(
                qsOwn(block, '.sensor-select').value,
                qsOwn(block, '.operator-select').value,
                parseFloat(qsOwn(block, '.value-input').value)
            );
            const logic = qsOwn(block, '.logic-select')?.value || 'none';
            if (logic !== 'none') {
                const cond2 = evalOneCondition(
                    qsOwn(block, '.sensor-select2').value,
                    qsOwn(block, '.operator-select2').value,
                    parseFloat(qsOwn(block, '.value-input2').value)
                );
                if (logic === 'and') condition = condition && cond2;
                if (logic === 'or')  condition = condition || cond2;
            }
            const thenSlot = [...block.children].find(c => c.dataset?.role === 'then');
            const elseSlot = [...block.children].find(c => c.dataset?.role === 'else');
            executeBlockList(condition ? thenSlot.children : elseSlot.children);
        } else if (type === 'led_set') {
            const sel = block.querySelector('.led-lux-select');
            const lx = sel ? Math.max(0, Math.min(20000, parseInt(sel.value) || 0)) : 0;
            if (lx === 0) {
                state.ledActive = false;
            } else {
                state.ledActive = true;
                state.ledLux = lx;
            }
        } else {
            applyAction(type);
        }
    }
}

function applyAction(type) {
    switch (type) {
        case 'water_add': lettuce.addWater(1.0); break; // 水位更新は update() 内で行われる
    }
}

// --- Python書き出し ---
const OP_PY  = { lt: '<', gt: '>', eq: '==' };
const ACT_PY = {
    led_set:   (b) => {
        const lx = parseInt(b.querySelector('.led-lux-select')?.value) || 0;
        return lx === 0 ? 'led_set(0)  # LED OFF' : `led_set(${lx})`;
    },
    water_add: ()  => 'water_add(1)',
};

// --- きたらっち書き出し ---
const OP_KT  = { lt: 'が', gt: 'が', eq: 'が' };
const OP_KT_LABEL = { lt: '<', gt: '>', eq: '==' };
const ACT_KT = {
    led_set:   (b) => {
        const lx = parseInt(b.querySelector('.led-lux-select')?.value) || 0;
        return lx === 0 ? '「LEDを消す」' : `「LEDを ${lx} ルクスにする」`;
    },
    water_add: ()  => '「水を 1cm 追加する」',
};
const SENSOR_KT = {
    'sun_lx':  '太陽光',
    'temp':    '気温',
    'water_cm':'水位',
    'hour':    '時',
    'day':     '日',
};
const LOGIC_KT = { and: 'かつ', or: 'または' };

// --- ブロック表示言語切り替え ---
let blockLang = 'python';

const SENSOR_DISPLAY = {
    python:     { 'sun_lx': 'sun_lx', 'temp': 'temp', 'water_cm': 'water_cm', 'hour': 'hour', 'day': 'day' },
    kitaratchi: { 'sun_lx': '太陽光', 'temp': '気温', 'water_cm': '水位', 'hour': '時', 'day': '日' },
};
const OP_DISPLAY = {
    python:     { lt: '<', gt: '>', eq: '==' },
    kitaratchi: { lt: '<', gt: '>', eq: '==' },
};
const LOGIC_DISPLAY = {
    python:     { none: '--', and: 'and', or: 'or' },
    kitaratchi: { none: '--', and: 'かつ', or: 'または' },
};

function applyBlockLang(root) {
    root.querySelectorAll('[data-py][data-kt]').forEach(el => {
        el.textContent = blockLang === 'kitaratchi' ? el.dataset.kt : el.dataset.py;
    });
    const sensorMap = SENSOR_DISPLAY[blockLang] || SENSOR_DISPLAY.python;
    root.querySelectorAll('.sensor-select, .sensor-select2').forEach(sel => {
        [...sel.options].forEach(opt => { if (sensorMap[opt.value] !== undefined) opt.text = sensorMap[opt.value]; });
    });
    const opMap = OP_DISPLAY[blockLang] || OP_DISPLAY.python;
    root.querySelectorAll('.operator-select, .operator-select2').forEach(sel => {
        [...sel.options].forEach(opt => { if (opMap[opt.value] !== undefined) opt.text = opMap[opt.value]; });
    });
    const logicMap = LOGIC_DISPLAY[blockLang] || LOGIC_DISPLAY.python;
    root.querySelectorAll('.logic-select').forEach(sel => {
        [...sel.options].forEach(opt => { if (logicMap[opt.value] !== undefined) opt.text = logicMap[opt.value]; });
    });
}

function setBlockLang(lang) {
    blockLang = lang;
    ['python', 'kitaratchi'].forEach(l => {
        const btn = document.getElementById(l === 'python' ? 'btn-lang-py' : 'btn-lang-kt');
        if (!btn) return;
        if (l === lang) {
            btn.classList.add('bg-indigo-500', 'text-white');
            btn.classList.remove('bg-white', 'text-slate-500');
        } else {
            btn.classList.remove('bg-indigo-500', 'text-white');
            btn.classList.add('bg-white', 'text-slate-500');
        }
    });
    const palette = document.querySelector('.block-container');
    if (palette) applyBlockLang(palette);
    const ws = document.getElementById('workspace');
    if (ws) applyBlockLang(ws);
    saveWorkspace();
}

function genPyBlocks(elementList, indent) {
    const pad = '    '.repeat(indent);
    let lines = [];
    for (const block of elementList) {
        const type = block.dataset?.type;
        if (!type) continue;
        if (type === 'custom_if_else') {
            const s1    = qsOwn(block, '.sensor-select').value;
            const op1   = OP_PY[qsOwn(block, '.operator-select').value];
            const v1    = qsOwn(block, '.value-input').value;
            const logic = qsOwn(block, '.logic-select')?.value || 'none';
            let cond = `${s1} ${op1} ${v1}`;
            if (logic !== 'none') {
                const s2  = qsOwn(block, '.sensor-select2').value;
                const op2 = OP_PY[qsOwn(block, '.operator-select2').value];
                const v2  = qsOwn(block, '.value-input2').value;
                cond += ` ${logic} ${s2} ${op2} ${v2}`;
            }
            lines.push(`${pad}if ${cond}:`);
            const thenSlot  = [...block.children].find(c => c.dataset?.role === 'then');
            const thenLines = genPyBlocks(thenSlot ? thenSlot.children : [], indent + 1);
            lines.push(...(thenLines.length ? thenLines : [`${'    '.repeat(indent + 1)}pass`]));
            const elseSlot  = [...block.children].find(c => c.dataset?.role === 'else');
            const elseLines = genPyBlocks(elseSlot ? elseSlot.children : [], indent + 1);
            if (elseLines.length) {
                lines.push(`${pad}else:`);
                lines.push(...elseLines);
            }
        } else if (ACT_PY[type]) {
            lines.push(`${pad}${ACT_PY[type](block)}`);
        }
    }
    return lines;
}

function genKtBlocks(elementList, indent) {
    const pad = '　'.repeat(indent * 2);
    let lines = [];
    for (const block of elementList) {
        const type = block.dataset?.type;
        if (!type) continue;
        if (type === 'custom_if_else') {
            const s1    = SENSOR_KT[qsOwn(block, '.sensor-select').value] || qsOwn(block, '.sensor-select').value;
            const opKey = qsOwn(block, '.operator-select').value;
            const v1    = qsOwn(block, '.value-input').value;
            const logic = qsOwn(block, '.logic-select')?.value || 'none';
            let cond = `${s1} が ${OP_KT_LABEL[opKey]} ${v1}`;
            if (logic !== 'none') {
                const s2  = SENSOR_KT[qsOwn(block, '.sensor-select2').value] || qsOwn(block, '.sensor-select2').value;
                const op2Key = qsOwn(block, '.operator-select2').value;
                const v2  = qsOwn(block, '.value-input2').value;
                cond += ` ${LOGIC_KT[logic]} ${s2} が ${OP_KT_LABEL[op2Key]} ${v2}`;
            }
            lines.push(`${pad}もし ${cond} なら`);
            const thenSlot  = [...block.children].find(c => c.dataset?.role === 'then');
            const thenLines = genKtBlocks(thenSlot ? thenSlot.children : [], indent + 1);
            lines.push(...(thenLines.length ? thenLines : [`${'　'.repeat((indent+1)*2)}（何もしない）`]));
            const elseSlot  = [...block.children].find(c => c.dataset?.role === 'else');
            const elseLines = genKtBlocks(elseSlot ? elseSlot.children : [], indent + 1);
            if (elseLines.length) {
                lines.push(`${pad}でなければ`);
                lines.push(...elseLines);
            }
            lines.push(`${pad}おわり`);
        } else if (ACT_KT[type]) {
            lines.push(`${pad}${ACT_KT[type](block)}`);
        }
    }
    return lines;
}

function generatePython() {
    const header = [
        '# PlantSimulator 制御ロジック (自動生成)',
        '# センサー: sun_lx, temp, water_cm',
        '# 経過時間: hour, day',
        '# アクション: led.set(lux 0=OFF), water.add(cm)',
        '',
        'import time',
        '',
        'class MockSensors:',
        '    def get(self, sensor_name):',
        '       return 0',
        '',
        'def water_add(n):',
        '    pass',
        '',
        'def led_set(n):',
        '    pass',
        '',
        'sensors = MockSensors()',
        'system_time_counter = 23 # システム時間カウンターを初期化',
        '',
        'while True:',
        '    time.sleep(1) # デモンストレーション用に短縮。実際は3600秒 (1時間)',
        '    system_time_counter += 1 # カウンターを1増やす',
        '    hour = system_time_counter % 24  # 0-23時',
        '    day  = system_time_counter // 24 # 1日目から',
        '',
        '    sun_lx        = sensors.get("sun_lx")',
        '    temp          = sensors.get("temp")',
        '    water_cm      = sensors.get("water_cm")',
        '',
        '    # 制御ロジック部分（ブロックから生成）',
    ];
    const ws = document.getElementById('workspace');
    const bodyLines = genPyBlocks(ws.children, 1);
    const body = bodyLines.length ? bodyLines : ['    pass'];
    return [...header, ...body].join('\n');
}

function generateKitaratchi() {
    const header = [
        '# きたらっち 制御ロジック (自動生成)',
        '# センサー: 太陽光、気温、水位、時刻、経過日数',
        '',
        '【毎時間くりかえす】',
    ];
    const ws = document.getElementById('workspace');
    const bodyLines = genKtBlocks(ws.children, 1);
    const body = bodyLines.length ? bodyLines : ['　（何もしない）'];
    return [...header, ...body].join('\n');
}

function showPythonCode() {
    document.getElementById('python-modal-title').textContent = '🐍 Python書き出し';
    document.getElementById('python-output').textContent = generatePython();
    document.getElementById('python-modal').classList.remove('hidden');
}

function copyPythonCode(btn) {
    const code = document.getElementById('python-output').textContent;
    navigator.clipboard.writeText(code).then(() => {
        btn.textContent = '✅ コピーしました';
        setTimeout(() => btn.textContent = '📋 コピー', 1500);
    });
}

// --- ローカルストレージ 保存・復元 ---
const LS_KEY = 'plant-sim-blocks';

function serializeBlocks(container) {
    const result = [];
    for (const block of container.children) {
        const type = block.dataset?.type;
        if (!type) continue;
        const obj = { type };
        if (type === 'custom_if_else') {
            obj.sensor  = qsOwn(block, '.sensor-select')?.value;
            obj.op      = qsOwn(block, '.operator-select')?.value;
            obj.val     = qsOwn(block, '.value-input')?.value;
            obj.logic   = qsOwn(block, '.logic-select')?.value || 'none';
            obj.sensor2 = qsOwn(block, '.sensor-select2')?.value;
            obj.op2     = qsOwn(block, '.operator-select2')?.value;
            obj.val2    = qsOwn(block, '.value-input2')?.value;
            const thenSlot = [...block.children].find(c => c.dataset?.role === 'then');
            const elseSlot = [...block.children].find(c => c.dataset?.role === 'else');
            obj.then = thenSlot ? serializeBlocks(thenSlot) : [];
            obj.else = elseSlot ? serializeBlocks(elseSlot) : [];
        } else if (type === 'led_set') {
            obj.lux = block.querySelector('.led-lux-select')?.value;
        }
        result.push(obj);
    }
    return result;
}

function deserializeBlocks(container, blockList) {
    for (const obj of blockList) {
        const tmpl = document.querySelector(`.block-container [data-type="${obj.type}"]`);
        if (!tmpl) continue;
        const block = tmpl.cloneNode(true);
        if (obj.type === 'custom_if_else') {
            const ss = qsOwn(block, '.sensor-select');
            const os = qsOwn(block, '.operator-select');
            const vi = qsOwn(block, '.value-input');
            const ls = qsOwn(block, '.logic-select');
            const ss2 = qsOwn(block, '.sensor-select2');
            const os2 = qsOwn(block, '.operator-select2');
            const vi2 = qsOwn(block, '.value-input2');
            if (ss)  ss.value  = obj.sensor  || 'sun_lx';
            if (os)  os.value  = obj.op      || 'lt';
            if (vi)  vi.value  = obj.val     || '5000';
            if (ls)  { ls.value = obj.logic || 'none'; updateLogicRow(ls); }
            if (ss2) ss2.value = obj.sensor2 || 'temp';
            if (os2) os2.value = obj.op2     || 'lt';
            if (vi2) vi2.value = obj.val2    || '20';
            const thenSlot = [...block.children].find(c => c.dataset?.role === 'then');
            const elseSlot = [...block.children].find(c => c.dataset?.role === 'else');
            if (obj.then?.length && thenSlot) deserializeBlocks(thenSlot, obj.then);
            if (obj.else?.length && elseSlot) deserializeBlocks(elseSlot, obj.else);
        } else if (obj.type === 'led_set') {
            const sel = block.querySelector('.led-lux-select');
            if (sel && obj.lux !== undefined) sel.value = obj.lux;
        }
        container.appendChild(block);
        applyBlockLang(block);
    }
}

function saveWorkspace() {
    const ws = document.getElementById('workspace');
    if (!ws) return;
    const data = { lang: blockLang, blocks: serializeBlocks(ws) };
    localStorage.setItem(LS_KEY, JSON.stringify(data));
}

function loadWorkspace() {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return;
    try {
        const data = JSON.parse(raw);
        if (data.lang) setBlockLang(data.lang);
        const ws = document.getElementById('workspace');
        if (ws && data.blocks?.length) deserializeBlocks(ws, data.blocks);
        updateElseBars();
    } catch (e) { /* 破損データは無視 */ }
}

document.addEventListener('DOMContentLoaded', loadWorkspace);
