// JavaScript for Smartphone Thermal Simulator (Class 6)

// Grid layout W x H
const W = 60;
const H = 40;
let T = new Float32Array(W * H);
let T_prev = new Float32Array(W * H);
let mat_type = new Uint8Array(W * H); // Material mask
let cond = new Float32Array(W * H);   // Local thermal conductivity parameter

// Material type identifiers
const MAT_AIR = 0;
const MAT_CPU = 1;
const MAT_BATTERY = 2;
const MAT_PASTE = 3;
const MAT_CASE = 4;

// UI Variables
let cpuLoad = 80.0;
let pasteStatus = 'good';
let caseMaterial = 'aluminum';
let gripLocation = 'none';
let simSpeed = 1.0;
let isPaused = true;
let simTime = 0.0;

// Component Temperatures for HUD
let avgCpuTemp = 25.0;
let throttlingPercent = 100.0;

// Canvas & Animation
let animationFrameId = null;
const canvasField = document.getElementById('canvas-field');
const ctxField = canvasField.getContext('2d');
const canvasChart = document.getElementById('canvas-chart');
const ctxChart = canvasChart.getContext('2d');

// Chart data
let chartHistory = [];
let maxChartTime = 60.0; // s
const dt = 0.05; // Time step per iteration

// Initialize grid layout
function initGrid() {
    simTime = 0.0;
    chartHistory = [];
    
    // Ambient start at 25C
    for (let idx = 0; idx < W*H; idx++) {
        T[idx] = 25.0;
        T_prev[idx] = 25.0;
    }

    rebuildMaterials();
    updateHUD();
    drawField();
    drawChart();
}

// Rebuild material map when paste or case changes
function rebuildMaterials() {
    // 1. Define geometry zones
    for (let i = 0; i < H; i++) {
        for (let j = 0; j < W; j++) {
            let idx = i * W + j;
            
            // Casing is the outermost ring
            if (i === 0 || i === H - 1 || j === 0 || j === W - 1) {
                mat_type[idx] = MAT_CASE;
            }
            // CPU is top-left
            else if (i >= 8 && i <= 18 && j >= 10 && j <= 22) {
                mat_type[idx] = MAT_CPU;
            }
            // Thermal Paste wraps CPU on boundaries to shield/case
            else if (((i === 7 || i === 19) && j >= 9 && j <= 23) ||
                     ((j === 9 || j === 23) && i >= 7 && i <= 19)) {
                mat_type[idx] = MAT_PASTE;
            }
            // Battery is a large block on the right
            else if (i >= 6 && i <= 33 && j >= 30 && j <= 52) {
                mat_type[idx] = MAT_BATTERY;
            }
            // Air gaps everywhere else
            else {
                mat_type[idx] = MAT_AIR;
            }
        }
    }

    // 2. Set localized thermal conductivity parameters (scaled for stability)
    // Stability requires D_T <= 0.25
    let condCase = (caseMaterial === 'aluminum') ? 4.4 : 0.1;
    let condPaste = (pasteStatus === 'good') ? 2.4 : 0.02; // bottleneck if bad!

    for (let idx = 0; idx < W*H; idx++) {
        let mat = mat_type[idx];
        if (mat === MAT_CASE) cond[idx] = condCase;
        else if (mat === MAT_CPU) cond[idx] = 3.0;
        else if (mat === MAT_PASTE) cond[idx] = condPaste;
        else if (mat === MAT_BATTERY) cond[idx] = 0.8;
        else cond[idx] = 0.02; // Air gap
    }
}

// Solve one explicit finite difference step
function stepSimulation(stepDt) {
    // 1. Calculate active CPU temp and throttling feedback
    let cpuSum = 0.0;
    let cpuCount = 0;
    for (let idx = 0; idx < W*H; idx++) {
        if (mat_type[idx] === MAT_CPU) {
            cpuSum += T[idx];
            cpuCount++;
        }
    }
    avgCpuTemp = cpuSum / cpuCount;

    // Throttling curves: starts at 80C, heavy throttling (10%) at 95C
    if (avgCpuTemp < 80.0) {
        throttlingPercent = 100.0;
    } else {
        let factor = 1.0 - (avgCpuTemp - 80.0) / (95.0 - 80.0);
        throttlingPercent = Math.max(10.0, factor * 100.0);
    }

    // 2. Calculate CPU heat generation
    // load is 0 to 100
    let Q_cpu = (cpuLoad / 100.0) * (throttlingPercent / 100.0) * 8.5; // Power scale

    // 3. Transient Conduction Step
    for (let i = 1; i < H - 1; i++) {
        for (let j = 1; j < W - 1; j++) {
            let idx = i * W + j;

            // Neighbor indices
            let ip = (i + 1) * W + j;
            let im = (i - 1) * W + j;
            let jp = i * W + (j + 1);
            let jm = i * W + (j - 1);

            // Conductivities at boundaries (arithmetic average)
            let k_x_plus = 0.5 * (cond[idx] + cond[jp]);
            let k_x_minus = 0.5 * (cond[idx] + cond[jm]);
            let k_y_plus = 0.5 * (cond[idx] + cond[ip]);
            let k_y_minus = 0.5 * (cond[idx] + cond[im]);

            // Heat sources: CPU heat generation
            let Q_src = (mat_type[idx] === MAT_CPU) ? Q_cpu : 0.0;

            // Battery gets a small charge/degrade heat source if gaming
            if (mat_type[idx] === MAT_BATTERY && cpuLoad > 50) {
                Q_src = 0.05; // tiny battery draw heat
            }

            // Explicit conduction equation (scaled by stepDt)
            T_prev[idx] = T[idx] + (
                k_x_plus * (T[jp] - T[idx]) + 
                k_x_minus * (T[jm] - T[idx]) + 
                k_y_plus * (T[ip] - T[idx]) + 
                k_y_minus * (T[im] - T[idx])
            ) * stepDt + Q_src * stepDt;
        }
    }

    // 4. Boundary Convection Heat Loss
    // Convection loss: q = h * (T - T_ambient)
    let T_ambient = 25.0;

    for (let i = 0; i < H; i++) {
        for (let j = 0; j < W; j++) {
            let idx = i * W + j;
            if (mat_type[idx] !== MAT_CASE) continue;

            // Check if covered by hand grip
            let h_coeff = 0.8; // standard convection coefficient (scaled up by 20)
            
            if (gripLocation === 'cpu') {
                // Hand blocks top-left edges
                if ((j < 25 && i === 0) || (j === 0 && i < 20)) {
                    h_coeff = 0.04; // convection blocked by hand
                }
            } else if (gripLocation === 'bottom') {
                // Hand blocks bottom-right edges
                if ((j > 25 && i === H - 1) || (j === W - 1 && i > 20)) {
                    h_coeff = 0.04; // convection blocked by hand
                }
            }

            // Neighbor grid points inside the phone to diffuse to casing
            let ip = (i < H - 1) ? (i + 1) * W + j : idx;
            let im = (i > 0) ? (i - 1) * W + j : idx;
            let jp = (j < W - 1) ? i * W + (j + 1) : idx;
            let jm = (j > 0) ? i * W + (j - 1) : idx;

            // Simple boundary conduction to interior
            let interior_idx = idx;
            if (i === 0) interior_idx = W + j;
            else if (i === H - 1) interior_idx = (H - 2) * W + j;
            else if (j === 0) interior_idx = i * W + 1;
            else if (j === W - 1) interior_idx = i * W + W - 2;

            let k_casing = cond[idx];
            T_prev[idx] = T[idx] + (k_casing * (T[interior_idx] - T[idx]) - h_coeff * (T[idx] - T_ambient)) * stepDt;
        }
    }

    // Swap buffers
    let temp = T;
    T = T_prev;
    T_prev = temp;
}

// Color scale for temperature mapping (25C to 100C)
function getTempColor(temp) {
    let t = (temp - 25.0) / 75.0; // Normalized
    t = Math.max(0.0, Math.min(1.0, t));
    let r, g, b;

    if (t < 0.25) {
        // Dark blue (#0d1b2a) to Purple (#7b2cbf)
        let f = t / 0.25;
        r = Math.round(13 * (1-f) + 123 * f);
        g = Math.round(27 * (1-f) + 44 * f);
        b = Math.round(42 * (1-f) + 191 * f);
    } else if (t < 0.50) {
        // Purple (#7b2cbf) to red (#e63946)
        let f = (t - 0.25) / 0.25;
        r = Math.round(123 * (1-f) + 230 * f);
        g = Math.round(44 * (1-f) + 57 * f);
        b = Math.round(191 * (1-f) + 70 * f);
    } else if (t < 0.75) {
        // Red (#e63946) to orange (#ff9f43)
        let f = (t - 0.50) / 0.25;
        r = Math.round(230 * (1-f) + 255 * f);
        g = Math.round(57 * (1-f) + 159 * f);
        b = Math.round(70 * (1-f) + 67 * f);
    } else {
        // Orange (#ff9f43) to yellow-white (#ffffff)
        let f = (t - 0.75) / 0.25;
        r = Math.round(255 * (1-f) + 255 * f);
        g = Math.round(159 * (1-f) + 245 * f);
        b = Math.round(67 * (1-f) + 220 * f);
    }
    return `rgb(${r}, ${g}, ${b})`;
}

// Draw the temperature grid and overlays
function drawField() {
    ctxField.clearRect(0, 0, canvasField.width, canvasField.height);
    
    const cw = canvasField.width;
    const ch = canvasField.height;
    const cellW = cw / W;
    const cellH = ch / H;

    // 1. Draw temperature cells
    for (let i = 0; i < H; i++) {
        for (let j = 0; j < W; j++) {
            let idx = i * W + j;
            ctxField.fillStyle = getTempColor(T[idx]);
            ctxField.fillRect(j * cellW - 0.5, i * cellH - 0.5, cellW + 1.0, cellH + 1.0);
        }
    }

    // 2. Draw component outlines overlay
    ctxField.strokeStyle = 'rgba(255, 255, 255, 0.15)';
    ctxField.lineWidth = 1;

    // CPU Outline
    ctxField.strokeStyle = 'rgba(0, 210, 255, 0.4)'; // blue outline
    ctxField.strokeRect(10 * cellW, 8 * cellH, 12 * cellW, 10 * cellH);
    ctxField.fillStyle = 'rgba(0, 210, 255, 0.1)';
    ctxField.fillRect(10 * cellW, 8 * cellH, 12 * cellW, 10 * cellH);

    // Battery Outline
    ctxField.strokeStyle = 'rgba(57, 211, 83, 0.4)'; // green outline
    ctxField.strokeRect(30 * cellW, 6 * cellH, 22 * cellW, 28 * cellH);
    ctxField.fillStyle = 'rgba(57, 211, 83, 0.05)';
    ctxField.fillRect(30 * cellW, 6 * cellH, 22 * cellW, 28 * cellH);

    // Thermal Paste layer
    ctxField.strokeStyle = 'rgba(255, 255, 255, 0.2)';
    ctxField.strokeRect(9 * cellW, 7 * cellH, 14 * cellW, 12 * cellH);

    // Write Component Labels inside phone
    ctxField.fillStyle = 'rgba(255, 255, 255, 0.7)';
    ctxField.font = '10px Outfit, sans-serif';
    ctxField.fillText('CPU', 15 * cellW - 5, 13 * cellH);
    ctxField.fillText('BATTERY', 38 * cellW, 20 * cellH);

    // Draw hand grip blocking icon
    if (gripLocation === 'cpu') {
        ctxField.fillStyle = 'rgba(255, 77, 77, 0.25)'; // red blocking highlight
        ctxField.fillRect(0, 0, 25 * cellW, 3 * cellH);
        ctxField.fillRect(0, 0, 3 * cellW, 20 * cellH);

        ctxField.fillStyle = '#ff4d4d';
        ctxField.font = 'bold 9px Outfit, sans-serif';
        ctxField.fillText('HAND GRIP (BLOCKED)', 5, 12);
    } else if (gripLocation === 'bottom') {
        ctxField.fillStyle = 'rgba(255, 77, 77, 0.25)';
        ctxField.fillRect(25 * cellW, (H-3) * cellH, 35 * cellW, 3 * cellH);
        ctxField.fillRect((W-3) * cellW, 20 * cellH, 3 * cellW, 20 * cellH);

        ctxField.fillStyle = '#ff4d4d';
        ctxField.font = 'bold 9px Outfit, sans-serif';
        ctxField.fillText('HAND GRIP (BLOCKED)', (W-20)*cellW, (H-1)*cellH - 4);
    }

    // Outer case border
    ctxField.strokeStyle = 'rgba(255, 255, 255, 0.3)';
    ctxField.lineWidth = 3;
    ctxField.strokeRect(0, 0, cw, ch);
}

// Draw chart for Temperature and Throttling Performance
function drawChart() {
    ctxChart.clearRect(0, 0, canvasChart.width, canvasChart.height);
    const w = canvasChart.width;
    const h = canvasChart.height;

    // Layout
    const padding = { left: 40, right: 40, top: 15, bottom: 30 };
    const chartW = w - padding.left - padding.right;
    const chartH = h - padding.top - padding.bottom;

    // Draw axes
    ctxChart.strokeStyle = 'rgba(255, 255, 255, 0.15)';
    ctxChart.lineWidth = 1;
    ctxChart.beginPath();
    ctxChart.moveTo(padding.left, padding.top);
    ctxChart.lineTo(padding.left, h - padding.bottom);
    ctxChart.lineTo(w - padding.right, h - padding.bottom);
    ctxChart.moveTo(w - padding.right, padding.top);
    ctxChart.lineTo(w - padding.right, h - padding.bottom);
    ctxChart.stroke();

    // Axis Labels
    ctxChart.fillStyle = '#8b949e';
    ctxChart.font = '10px Outfit, sans-serif';
    ctxChart.textAlign = 'center';
    ctxChart.fillText('Simulation Time (s)', padding.left + chartW / 2, h - 8);

    // Left Y label (Temp)
    ctxChart.save();
    ctxChart.translate(12, padding.top + chartH / 2);
    ctxChart.rotate(-Math.PI / 2);
    ctxChart.fillText('CPU Temp (°C)', 0, 0);
    ctxChart.restore();

    // Right Y label (Performance)
    ctxChart.save();
    ctxChart.translate(w - 12, padding.top + chartH / 2);
    ctxChart.rotate(Math.PI / 2);
    ctxChart.fillText('CPU Speed (%)', 0, 0);
    ctxChart.restore();

    // Scale mappings
    const getX = (t) => padding.left + (t / maxChartTime) * chartW;
    const getYTemp = (temp) => h - padding.bottom - ((temp - 25.0) / 75.0) * chartH; // 25 to 100C
    const getYPerf = (perf) => h - padding.bottom - (perf / 100.0) * chartH; // 0 to 100%

    // Draw Gridlines & tick labels
    ctxChart.strokeStyle = 'rgba(255, 255, 255, 0.05)';
    ctxChart.font = '9px Outfit, sans-serif';
    ctxChart.textAlign = 'center';

    // Temp ticks left
    for (let temp = 40; temp <= 100; temp += 20) {
        let yPos = getYTemp(temp);
        ctxChart.beginPath();
        ctxChart.moveTo(padding.left, yPos);
        ctxChart.lineTo(w - padding.right, yPos);
        ctxChart.stroke();

        ctxChart.fillStyle = '#ff4d4d'; // red for temp
        ctxChart.fillText(temp + '°', padding.left - 15, yPos + 3);
    }

    // Performance ticks right
    for (let perf = 20; perf <= 100; perf += 20) {
        let yPos = getYPerf(perf);
        ctxChart.fillStyle = '#00d2ff'; // blue for speed
        ctxChart.fillText(perf + '%', w - padding.right + 15, yPos + 3);
    }

    // Draw Curves
    if (chartHistory.length > 0) {
        // CPU Temp curve (Vibrant Red)
        ctxChart.strokeStyle = '#ff4d4d';
        ctxChart.lineWidth = 2.5;
        ctxChart.beginPath();
        for (let i = 0; i < chartHistory.length; i++) {
            let pt = chartHistory[i];
            let px = getX(pt.time);
            let py = getYTemp(pt.temp);
            if (i === 0) ctxChart.moveTo(px, py);
            else ctxChart.lineTo(px, py);
        }
        ctxChart.stroke();

        // CPU Speed Throttling curve (Vibrant Blue)
        ctxChart.strokeStyle = '#00d2ff';
        ctxChart.lineWidth = 2;
        ctxChart.setLineDash([2, 2]);
        ctxChart.beginPath();
        for (let i = 0; i < chartHistory.length; i++) {
            let pt = chartHistory[i];
            let px = getX(pt.time);
            let py = getYPerf(pt.perf);
            if (i === 0) ctxChart.moveTo(px, py);
            else ctxChart.lineTo(px, py);
        }
        ctxChart.stroke();
        ctxChart.setLineDash([]); // Reset
    }
}

// Update HUD texts
function updateHUD() {
    document.getElementById('hud-cpu-temp').innerText = avgCpuTemp.toFixed(1) + ' °C';
    document.getElementById('hud-throttling').innerText = throttlingPercent.toFixed(1) + '%';
    
    // Change HUD color if throttling is active
    let valueEl = document.getElementById('hud-throttling');
    if (throttlingPercent < 100.0) {
        valueEl.style.color = '#ff9f43'; // orange warning
    } else {
        valueEl.style.color = '#39d353'; // green ideal
    }
}

// Main loop step
function loop() {
    if (isPaused) return;

    // Simulate multiple physics steps per frame
    let subSteps = Math.round(simSpeed * 2.0); // Conduction speed multiplier
    for (let step = 0; step < subSteps; step++) {
        stepSimulation(dt);
        simTime += dt;

        // Record history
        if (simTime <= maxChartTime) {
            chartHistory.push({ time: simTime, temp: avgCpuTemp, perf: throttlingPercent });
        }
    }

    updateHUD();
    drawField();
    drawChart();

    animationFrameId = requestAnimationFrame(loop);
}

// Bind UI controls
function setupEventListeners() {
    const sliderLoad = document.getElementById('param-load');
    const valLoad = document.getElementById('val-load');
    sliderLoad.addEventListener('input', (e) => {
        cpuLoad = parseFloat(e.target.value);
        valLoad.innerText = cpuLoad + ' %';
    });

    const selectPaste = document.getElementById('param-paste');
    selectPaste.addEventListener('change', (e) => {
        pasteStatus = e.target.value;
        rebuildMaterials();
        drawField();
    });

    const selectCasing = document.getElementById('param-casing');
    selectCasing.addEventListener('change', (e) => {
        caseMaterial = e.target.value;
        rebuildMaterials();
        drawField();
    });

    const selectGrip = document.getElementById('param-grip');
    selectGrip.addEventListener('change', (e) => {
        gripLocation = e.target.value;
        drawField();
    });

    const sliderSimSpeed = document.getElementById('param-simspeed');
    const valSimSpeed = document.getElementById('val-simspeed');
    sliderSimSpeed.addEventListener('input', (e) => {
        simSpeed = parseFloat(e.target.value);
        valSimSpeed.innerText = simSpeed.toFixed(1) + 'x';
    });

    // Buttons
    const btnPause = document.getElementById('btn-pause');
    btnPause.addEventListener('click', () => {
        if (isPaused) {
            isPaused = false;
            btnPause.innerText = 'Pause Sim';
            btnPause.style.background = '#00d2ff'; // color change
            btnPause.style.color = '#0b0d10';
            loop();
        } else {
            isPaused = true;
            btnPause.innerText = 'Start Sim';
            btnPause.style.background = '#ff4d4d';
            btnPause.style.color = '#fff';
            if (animationFrameId) cancelAnimationFrame(animationFrameId);
        }
    });

    const btnReset = document.getElementById('btn-reset');
    btnReset.addEventListener('click', () => {
        isPaused = true;
        btnPause.innerText = 'Start Sim';
        btnPause.style.background = '#ff4d4d';
        btnPause.style.color = '#fff';
        if (animationFrameId) cancelAnimationFrame(animationFrameId);
        initGrid();
    });
}

// Initialise everything
setupEventListeners();
initGrid();
