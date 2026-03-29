// block-engine.js
// ビジュアルブロックの実行エンジン・Python書き出し・D&D処理
// sim-state.js より後にロードすること

// --- D&D ---
let draggedElement = null;

document.addEventListener('dragstart', (e) => {
    if (e.target.classList.contains('block')) draggedElement = e.target;
    e.dataTransfer.setData('text/plain', '');
});

document.addEventListener('dragover', (e) => {
    const slot = e.target.closest('.slot') || e.target.closest('#workspace');
    if (slot) { e.preventDefault(); slot.classList.add('slot-highlight'); }
});

document.addEventListener('dragleave', (e) => {
    const slot = e.target.closest('.slot') || e.target.closest('#workspace');
    if (slot) slot.classList.remove('slot-highlight');
});

document.addEventListener('drop', (e) => {
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

            const btn = blockToDrop.querySelector('.delete-btn');
            if (btn) {
                btn.onclick = (ev) => {
                    ev.stopPropagation();
                    blockToDrop.remove();
                    updateElseBars();
                };
            }
        } else {
            blockToDrop = draggedElement;
        }
        target.appendChild(blockToDrop);
        updateElseBars();
    }
    draggedElement = null;
});

// --- ブロックUI ---
function updateLogicRow(sel) {
    const row = sel.closest('.logic-row');
    const active = sel.value !== 'none';
    row.style.opacity = active ? '1' : '0.4';
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
    if (sensorType === 'light') return state.sunLux;
    if (sensorType === 'temp')  return state.temp;
    if (sensorType === 'water') return state.waterLevel;
    if (sensorType === 'hour')  return state.hour;
    if (sensorType === 'day')   return state.day;
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
            const lx = sel ? Math.max(1000, Math.min(15000, parseInt(sel.value) || 8000)) : 8000;
            state.ledActive = true;
            state.ledLux = lx;
        } else {
            applyAction(type);
        }
    }
}

function applyAction(type) {
    switch (type) {
        case 'led_off':    state.ledActive = false; break;
        case 'add_water':  lettuce.addWater(1.0); state.waterLevel = lettuce.state.waterLevel; break;
    }
}

// --- Python書き出し ---
const OP_PY  = { lt: '<', gt: '>', eq: '==' };
const ACT_PY = {
    led_set:   (b) => `led.set(${b.querySelector('.led-lux-select')?.value || 8000})`,
    led_off:   ()  => 'led.off()',
    add_water: ()  => 'add_water(1)',
};

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

function generatePython() {
    const header = [
        '# PlantSimulator 制御ロジック (自動生成)',
        '# アクション: led.set(lux), led.off(), add_water(cm)',
        '',
        'while True:',
        '    # センサー値の取得',
        '    light = sensors.get("light")',
        '    temp  = sensors.get("temp")',
        '    water = sensors.get("water")',
        '    hour  = sensors.get("hour")',
        '    day   = sensors.get("day")',
        '    # 制御ロジック',
    ];
    const ws = document.getElementById('workspace');
    const bodyLines = genPyBlocks(ws.children, 1);
    const body = bodyLines.length ? bodyLines : ['    pass'];
    return [...header, ...body].join('\n');
}

function showPythonCode() {
    document.getElementById('python-output').textContent = generatePython();
    document.getElementById('python-modal').classList.remove('hidden');
}

function copyPythonCode() {
    const code = document.getElementById('python-output').textContent;
    navigator.clipboard.writeText(code).then(() => {
        const btn = event.target;
        btn.textContent = '✅ コピーしました';
        setTimeout(() => btn.textContent = '📋 コピー', 1500);
    });
}
