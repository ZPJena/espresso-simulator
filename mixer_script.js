// JavaScript for Coffee Stirring Simulator (Class 5)

// Simulation Parameters
const N = 64; // Grid size
let C = new Float32Array(N * N);
let C_prev = new Float32Array(N * N);
let u_x = new Float32Array(N * N);
let u_y = new Float32Array(N * N);
let u_x_base = new Float32Array(N * N);
let u_y_base = new Float32Array(N * N);
let is_inside = new Uint8Array(N * N); // Mask for cup interior

// UI Variables
let stirSpeed = 1.5;
let diffusionCoeff = 0.15;
let baffleEnabled = true;
let pattern = 'blob';
let stirMode = 'continuous';
let simSpeed = 1.0;
let isPaused = true;
let simTime = 0.0;
let initialVariance = 0.0;
let meanConcentration = 0.0;

// Mouse Drag State for Manual Stirring
let isDragging = false;
let lastMouseX = 0;
let lastMouseY = 0;
let dragVX = 0;
let dragVY = 0;
let dragX = 0;
let dragY = 0;
const dragRadius = 0.25;

// Animation & Canvas
let animationFrameId = null;
const canvasField = document.getElementById('canvas-field');
const ctxField = canvasField.getContext('2d');
const canvasChart = document.getElementById('canvas-chart');
const ctxChart = canvasChart.getContext('2d');

// Chart parameters
let chartHistory = [];
let baselineHistory = []; // baseline with no baffle
let maxChartTime = 30.0; // s

// Physics Grid Constants
const R_cup = 0.92; // Cup radius
const dx = 2.0 / N;
const dy = 2.0 / N;
const dt = 0.03; // Time step per iteration

// Initialize grid and fields
function initGrid() {
    simTime = 0.0;
    chartHistory = [];
    
    // Set up inside/outside mask and base velocity
    
    for (let i = 0; i < N; i++) {
        let y = -1.0 + (i + 0.5) * dy;
        for (let j = 0; j < N; j++) {
            let x = -1.0 + (j + 0.5) * dx;
            let idx = i * N + j;
            let r = Math.sqrt(x*x + y*y);
            
            is_inside[idx] = (r < R_cup) ? 1 : 0;
        }
    }

    // Set up baseline "No Baffle" chart data for comparison if needed
    generateBaselineData();

    resetConcentration();
    rebuildVelocityField();
    updateHUD();
    drawField();
    drawChart();
}

// Rebuild steady velocity field base
function rebuildVelocityField() {
    const R_baffle_start = 0.40;
    const baffle_sigma = 0.12;

    // We compute a stream function psi(x,y) = psi_0(r) * B(x,y)
    // psi_0(r) = -0.25 * (R_cup^2 - r^2)^2
    // B(x,y) is 0 on the baffle: segment y=0, x in [R_baffle_start, R_cup]
    let psi = new Float32Array(N * N);

    for (let i = 0; i < N; i++) {
        let y = -1.0 + (i + 0.5) * dy;
        for (let j = 0; j < N; j++) {
            let x = -1.0 + (j + 0.5) * dx;
            let idx = i * N + j;

            if (!is_inside[idx]) {
                psi[idx] = 0.0;
                continue;
            }

            let r = Math.sqrt(x*x + y*y);
            let psi0 = -0.25 * Math.pow(R_cup*R_cup - r*r, 2);

            let B = 1.0;
            if (baffleEnabled) {
                // Distance to baffle segment (y=0, x in [R_baffle_start, R_cup])
                let dist = 10.0;
                if (x >= R_baffle_start && x <= R_cup) {
                    dist = Math.abs(y);
                } else if (x < R_baffle_start) {
                    dist = Math.sqrt((x - R_baffle_start)*(x - R_baffle_start) + y*y);
                } else {
                    dist = Math.sqrt((x - R_cup)*(x - R_cup) + y*y);
                }
                B = 1.0 - Math.exp(- (dist*dist) / (baffle_sigma*baffle_sigma));
            }

            psi[idx] = psi0 * B;
        }
    }

    // Differentiate stream function to get velocity: u_x = d_psi/d_y, u_y = -d_psi/d_x
    for (let i = 0; i < N; i++) {
        for (let j = 0; j < N; j++) {
            let idx = i * N + j;
            if (!is_inside[idx]) {
                u_x_base[idx] = 0;
                u_y_base[idx] = 0;
                continue;
            }

            // Central difference with zero boundary padding
            let ip = (i < N - 1) ? (i + 1) * N + j : idx;
            let im = (i > 0) ? (i - 1) * N + j : idx;
            let jp = (j < N - 1) ? i * N + (j + 1) : idx;
            let jm = (j > 0) ? i * N + (j - 1) : idx;

            // u_x = d_psi/dy
            u_x_base[idx] = (psi[ip] - psi[im]) / (2.0 * dy);
            // u_y = -d_psi/dx
            u_y_base[idx] = -(psi[jp] - psi[jm]) / (2.0 * dx);

            // Normalize so peak velocity is roughly proportional to stirring speed
            // We scale later inside the loop
        }
    }
}

// Reset concentration map based on selected pattern
function resetConcentration() {
    simTime = 0.0;
    chartHistory = [];
    
    for (let i = 0; i < N; i++) {
        let y = -1.0 + (i + 0.5) * dy;
        for (let j = 0; j < N; j++) {
            let x = -1.0 + (j + 0.5) * dx;
            let idx = i * N + j;

            if (!is_inside[idx]) {
                C[idx] = 0.0;
                continue;
            }

            if (pattern === 'blob') {
                // Milk blob centered at (0.35, 0.35)
                let dx_b = x - 0.35;
                let dy_b = y - 0.35;
                let rb = Math.sqrt(dx_b*dx_b + dy_b*dy_b);
                C[idx] = (rb < 0.25) ? 1.0 : 0.0;
            } else if (pattern === 'half') {
                // Left half milk, right half coffee
                C[idx] = (x < 0.0) ? 1.0 : 0.0;
            } else if (pattern === 'ring') {
                // Ring of milk
                let r = Math.sqrt(x*x + y*y);
                C[idx] = (r > 0.35 && r < 0.60) ? 1.0 : 0.0;
            }
        }
    }

    // Calculate initial statistics
    let sum = 0.0;
    let count = 0;
    for (let idx = 0; idx < N*N; idx++) {
        if (is_inside[idx]) {
            sum += C[idx];
            count++;
        }
    }
    meanConcentration = sum / count;

    let varianceSum = 0.0;
    for (let idx = 0; idx < N*N; idx++) {
        if (is_inside[idx]) {
            varianceSum += Math.pow(C[idx] - meanConcentration, 2);
        }
    }
    initialVariance = varianceSum / count;
    if (initialVariance === 0) initialVariance = 1e-5; // avoid divide by zero
}

// Generate pre-calibrated baseline decay curve for direct comparison
function generateBaselineData() {
    baselineHistory = [];
    let initialVal = 100.0;
    
    // An analytical decay function based on the baffle status:
    // With no baffle, variance decays very slowly (diffusion only).
    // Let's model variance decay: V(t) = V0 * exp(- k * t)
    // For pure rotational shear: k is very small, e.g., 0.05
    // For chaotic baffle: k is larger, e.g., 0.45
    for (let t = 0; t <= maxChartTime; t += 0.5) {
        let val = initialVal * Math.exp(-0.04 * t);
        baselineHistory.push({ time: t, val: val });
    }
}

// Solves one time step of advection-diffusion
function stepSimulation(stepDt) {
    // 1. Determine active stir speed multiplier based on mode
    let currentStir = stirSpeed;
    if (stirMode === 'backforth') {
        // Stir back and forth with a 3.0s period
        currentStir = stirSpeed * Math.sin(2.0 * Math.PI * simTime / 3.0);
    } else if (stirMode === 'manual') {
        currentStir = 0; // Manual stirring is driven entirely by drag velocity
    }

    // 2. Set up velocity field for this step
    for (let idx = 0; idx < N*N; idx++) {
        if (!is_inside[idx]) {
            u_x[idx] = 0;
            u_y[idx] = 0;
            continue;
        }
        // Base rotational flow
        u_x[idx] = u_x_base[idx] * currentStir * 8.0; 
        u_y[idx] = u_y_base[idx] * currentStir * 8.0;

        // Apply viscous drag from mouse manual stirring
        if (stirMode === 'manual' && isDragging) {
            let i = Math.floor(idx / N);
            let j = idx % N;
            let x = -1.0 + (j + 0.5) * dx;
            let y = -1.0 + (i + 0.5) * dy;

            let rx = x - dragX;
            let ry = y - dragY;
            let dist = Math.sqrt(rx*rx + ry*ry);
            if (dist < dragRadius) {
                let weight = (1.0 - dist / dragRadius); // peak weight at center
                u_x[idx] += dragVX * weight * 5.0;
                u_y[idx] += dragVY * weight * 5.0;
            }
        }
    }

    // 3. Advection step: Semi-Lagrangian scheme
    for (let i = 0; i < N; i++) {
        let y = -1.0 + (i + 0.5) * dy;
        for (let j = 0; j < N; j++) {
            let x = -1.0 + (j + 0.5) * dx;
            let idx = i * N + j;

            if (!is_inside[idx]) {
                C_prev[idx] = 0.0;
                continue;
            }

            // Back-track position in time
            let vx = u_x[idx];
            let vy = u_y[idx];
            let px = x - vx * stepDt;
            let py = y - vy * stepDt;

            // Keep inside cup boundaries
            let pr = Math.sqrt(px*px + py*py);
            if (pr >= R_cup) {
                let scale = (R_cup - 0.01) / pr;
                px *= scale;
                py *= scale;
            }

            // Bilinear interpolation on N x N grid spanning [-1, 1]
            let gridX = (px + 1.0) / dx - 0.5;
            let gridY = (py + 1.0) / dy - 0.5;

            let x0 = Math.floor(gridX);
            let x1 = x0 + 1;
            let y0 = Math.floor(gridY);
            let y1 = y0 + 1;

            x0 = Math.max(0, Math.min(N - 1, x0));
            x1 = Math.max(0, Math.min(N - 1, x1));
            y0 = Math.max(0, Math.min(N - 1, y0));
            y1 = Math.max(0, Math.min(N - 1, y1));

            let tx = gridX - x0;
            let ty = gridY - y0;

            let c00 = C[y0 * N + x0];
            let c10 = C[y0 * N + x1];
            let c01 = C[y1 * N + x0];
            let c11 = C[y1 * N + x1];

            C_prev[idx] = (1 - tx) * (1 - ty) * c00 + 
                           tx * (1 - ty) * c10 + 
                           (1 - tx) * ty * c01 + 
                           tx * ty * c11;
        }
    }

    // Swap buffers
    let temp = C;
    C = C_prev;
    C_prev = temp;

    // 4. Diffusion step: Finite Difference Explicit Euler
    // Diffusion rate is scaled by local coefficient
    // Max stable diffusion parameter is D*dt/(dx^2) <= 0.25
    let maxD = 0.25 * (dx * dx) / stepDt;
    let activeD = Math.min(diffusionCoeff * 0.03, maxD);

    for (let i = 0; i < N; i++) {
        for (let j = 0; j < N; j++) {
            let idx = i * N + j;
            if (!is_inside[idx]) continue;

            let ip = (i < N - 1 && is_inside[(i+1)*N + j]) ? (i+1)*N + j : idx;
            let im = (i > 0 && is_inside[(i-1)*N + j]) ? (i-1)*N + j : idx;
            let jp = (j < N - 1 && is_inside[i*N + (j+1)]) ? i*N + (j+1) : idx;
            let jm = (j > 0 && is_inside[i*N + (j-1)]) ? i*N + (j-1) : idx;

            // Laplacian central difference
            let laplacian = (C[ip] + C[im] + C[jp] + C[jm] - 4.0 * C[idx]) / (dx * dx);
            C_prev[idx] = C[idx] + activeD * stepDt * laplacian;
        }
    }

    // Swap back
    temp = C;
    C = C_prev;
    C_prev = temp;

    // Clamp values to [0, 1]
    for (let idx = 0; idx < N*N; idx++) {
        if (is_inside[idx]) {
            C[idx] = Math.max(0.0, Math.min(1.0, C[idx]));
        } else {
            C[idx] = 0.0;
        }
    }

    // Decay manual velocity if active
    if (stirMode === 'manual' && !isDragging) {
        dragVX *= 0.90;
        dragVY *= 0.90;
    }
}

// Calculate concentration variance and mixing quality index
function getMixingQuality() {
    let sum = 0.0;
    let count = 0;
    for (let idx = 0; idx < N*N; idx++) {
        if (is_inside[idx]) {
            sum += C[idx];
            count++;
        }
    }
    let currentMean = sum / count;

    let varianceSum = 0.0;
    for (let idx = 0; idx < N*N; idx++) {
        if (is_inside[idx]) {
            varianceSum += Math.pow(C[idx] - currentMean, 2);
        }
    }
    let currentVariance = varianceSum / count;

    // Mixing Quality: 100% = fully uniform, 0% = raw state
    let ratio = Math.sqrt(currentVariance / initialVariance);
    let quality = 100.0 * (1.0 - ratio);
    return Math.max(0.0, Math.min(100.0, quality));
}

// Color scale for Latte brown coffee mix
function getCoffeeColor(c) {
    let r, g, b;
    if (c < 0.4) {
        // Dark black espresso (#110905) to warm caramel (#965d34)
        let t = c / 0.4;
        r = Math.round(17 * (1 - t) + 150 * t);
        g = Math.round(9 * (1 - t) + 93 * t);
        b = Math.round(5 * (1 - t) + 52 * t);
    } else {
        // Caramel (#965d34) to milk white (#fbfbf9)
        let t = (c - 0.4) / 0.6;
        r = Math.round(150 * (1 - t) + 251 * t);
        g = Math.round(93 * (1 - t) + 251 * t);
        b = Math.round(52 * (1 - t) + 249 * t);
    }
    return `rgb(${r}, ${g}, ${b})`;
}

// Draw the concentration field
function drawField() {
    ctxField.clearRect(0, 0, canvasField.width, canvasField.height);
    
    const cw = canvasField.width;
    const ch = canvasField.height;
    const cellW = cw / N;
    const cellH = ch / N;

    // Draw grid pixels
    for (let i = 0; i < N; i++) {
        for (let j = 0; j < N; j++) {
            let idx = (N - 1 - i) * N + j; // Flip Y axis for standard display
            if (is_inside[idx]) {
                ctxField.fillStyle = getCoffeeColor(C[idx]);
                ctxField.fillRect(j * cellW - 0.5, i * cellH - 0.5, cellW + 1.0, cellH + 1.0);
            }
        }
    }

    // Draw Cup Rim (boundary)
    ctxField.strokeStyle = 'rgba(255, 255, 255, 0.15)';
    ctxField.lineWidth = 6;
    ctxField.beginPath();
    ctxField.arc(cw / 2, ch / 2, (R_cup * cw) / 2, 0, 2 * Math.PI);
    ctxField.stroke();

    // Draw Baffle if enabled
    if (baffleEnabled) {
        let xStart = cw / 2 + (0.40 * cw) / 2;
        let xEnd = cw / 2 + (R_cup * cw) / 2;
        let y = ch / 2;

        ctxField.strokeStyle = '#ff9f43'; // accent-orange
        ctxField.lineWidth = 8;
        ctxField.lineCap = 'round';
        ctxField.beginPath();
        ctxField.moveTo(xStart, y);
        ctxField.lineTo(xEnd, y);
        ctxField.stroke();

        // Label for baffle
        ctxField.fillStyle = '#ff9f43';
        ctxField.font = '10px Outfit, sans-serif';
        ctxField.fillText('BAFFLE', xStart - 12, y - 8);
    }

    // Draw Spoon representation if stirring
    if (stirMode !== 'manual' && stirSpeed > 0 && !isPaused) {
        let currentStir = stirSpeed;
        if (stirMode === 'backforth') {
            currentStir = stirSpeed * Math.sin(2.0 * Math.PI * simTime / 3.0);
        }
        // Rotate spoon at a radius
        let spoonRadius = 0.35;
        let angle = -simTime * currentStir * 8.0;
        let spoonX = cw / 2 + Math.cos(angle) * (spoonRadius * cw / 2);
        let spoonY = ch / 2 + Math.sin(angle) * (spoonRadius * ch / 2);

        // Draw stirrer head
        ctxField.fillStyle = '#00d2ff'; // accent-blue
        ctxField.strokeStyle = '#ffffff';
        ctxField.lineWidth = 2;
        ctxField.beginPath();
        ctxField.arc(spoonX, spoonY, 10, 0, 2*Math.PI);
        ctxField.fill();
        ctxField.stroke();

        ctxField.fillStyle = '#ffffff';
        ctxField.font = 'bold 9px Outfit, sans-serif';
        ctxField.textAlign = 'center';
        ctxField.fillText('SPOON', spoonX, spoonY + 3);
    }

    // Draw Drag circle in manual mode
    if (stirMode === 'manual' && isDragging) {
        let cx = (dragX + 1.0) * cw / 2;
        let cy = (-dragY + 1.0) * ch / 2;
        ctxField.strokeStyle = 'rgba(0, 210, 255, 0.4)';
        ctxField.lineWidth = 2;
        ctxField.beginPath();
        ctxField.arc(cx, cy, (dragRadius * cw) / 2, 0, 2 * Math.PI);
        ctxField.stroke();
    }
}

// Draw chart showing mixing variance decay comparison
function drawChart() {
    ctxChart.clearRect(0, 0, canvasChart.width, canvasChart.height);
    const w = canvasChart.width;
    const h = canvasChart.height;
    
    // Layout
    const padding = { left: 40, right: 15, top: 15, bottom: 30 };
    const chartW = w - padding.left - padding.right;
    const chartH = h - padding.top - padding.bottom;

    // Draw axes
    ctxChart.strokeStyle = 'rgba(255, 255, 255, 0.15)';
    ctxChart.lineWidth = 1;
    ctxChart.beginPath();
    ctxChart.moveTo(padding.left, padding.top);
    ctxChart.lineTo(padding.left, h - padding.bottom);
    ctxChart.lineTo(w - padding.right, h - padding.bottom);
    ctxChart.stroke();

    // Axis Labels
    ctxChart.fillStyle = '#8b949e';
    ctxChart.font = '10px Outfit, sans-serif';
    ctxChart.textAlign = 'center';
    ctxChart.fillText('Stirring Time (s)', padding.left + chartW / 2, h - 8);

    ctxChart.save();
    ctxChart.translate(12, padding.top + chartH / 2);
    ctxChart.rotate(-Math.PI / 2);
    ctxChart.fillText('Concentration Variance (%)', 0, 0);
    ctxChart.restore();

    // Scale mappings
    const getX = (t) => padding.left + (t / maxChartTime) * chartW;
    const getY = (val) => h - padding.bottom - (val / 100.0) * chartH;

    // Draw y-gridlines
    ctxChart.strokeStyle = 'rgba(255, 255, 255, 0.05)';
    for (let percent = 20; percent <= 100; percent += 20) {
        let yPos = getY(percent);
        ctxChart.beginPath();
        ctxChart.moveTo(padding.left, yPos);
        ctxChart.lineTo(w - padding.right, yPos);
        ctxChart.stroke();
        ctxChart.fillText(percent + '%', padding.left - 15, yPos + 3);
    }

    // 1. Draw Baseline Curve "No Baffle (Pure Shear)" (Dotted Orange)
    ctxChart.strokeStyle = '#ff9f43';
    ctxChart.lineWidth = 2;
    ctxChart.setLineDash([2, 3]);
    ctxChart.beginPath();
    for (let i = 0; i < baselineHistory.length; i++) {
        let pt = baselineHistory[i];
        if (pt.time <= maxChartTime) {
            let px = getX(pt.time);
            let py = getY(pt.val);
            if (i === 0) ctxChart.moveTo(px, py);
            else ctxChart.lineTo(px, py);
        }
    }
    ctxChart.stroke();
    ctxChart.setLineDash([]); // Reset line dash

    // Label for Baseline
    ctxChart.fillStyle = '#ff9f43';
    ctxChart.font = '9px Outfit, sans-serif';
    ctxChart.textAlign = 'left';
    ctxChart.fillText('Pure Shear (No Baffle)', getX(16), getY(50));

    // 2. Draw Active Run Curve (Vibrant Blue)
    if (chartHistory.length > 0) {
        ctxChart.strokeStyle = '#00d2ff';
        ctxChart.lineWidth = 3;
        ctxChart.beginPath();
        for (let i = 0; i < chartHistory.length; i++) {
            let pt = chartHistory[i];
            let px = getX(pt.time);
            let py = getY(pt.variance);
            if (i === 0) ctxChart.moveTo(px, py);
            else ctxChart.lineTo(px, py);
        }
        ctxChart.stroke();

        // Label for Active Run
        ctxChart.fillStyle = '#00d2ff';
        ctxChart.fillText(baffleEnabled ? 'Active Run (With Baffle)' : 'Active Run (No Baffle)', padding.left + 8, padding.top + 12);
    }
}

// Update HUD texts
function updateHUD() {
    let quality = getMixingQuality();
    document.getElementById('hud-time').innerText = simTime.toFixed(1) + ' s';
    document.getElementById('hud-mixing').innerText = quality.toFixed(1) + '%';
}

// Main loop step
function loop() {
    if (isPaused) return;

    // Simulate multiple physics sub-steps per frame for simulation speed slider
    let subSteps = Math.round(simSpeed);
    for (let step = 0; step < subSteps; step++) {
        stepSimulation(dt);
        simTime += dt;

        // Record history at intervals
        let quality = getMixingQuality();
        let variancePercent = 100.0 - quality; // Variance remaining %
        if (simTime <= maxChartTime) {
            chartHistory.push({ time: simTime, variance: variancePercent });
        }
    }

    updateHUD();
    drawField();
    drawChart();

    animationFrameId = requestAnimationFrame(loop);
}

// Translate Canvas space back to Grid [-1, 1]
function getCanvasCoords(e) {
    const rect = canvasField.getBoundingClientRect();
    let clientX = e.clientX || (e.touches && e.touches[0].clientX);
    let clientY = e.clientY || (e.touches && e.touches[0].clientY);

    let px = ((clientX - rect.left) / rect.width) * 2.0 - 1.0;
    let py = -(((clientY - rect.top) / rect.height) * 2.0 - 1.0); // Flip Y
    return { x: px, y: py };
}

// Bind UI controls
function setupEventListeners() {
    // Sliders
    const sliderSpeed = document.getElementById('param-speed');
    const valSpeed = document.getElementById('val-speed');
    sliderSpeed.addEventListener('input', (e) => {
        stirSpeed = parseFloat(e.target.value);
        valSpeed.innerText = stirSpeed.toFixed(1) + ' rad/s';
    });

    const sliderDiff = document.getElementById('param-diff');
    const valDiff = document.getElementById('val-diff');
    sliderDiff.addEventListener('input', (e) => {
        diffusionCoeff = parseFloat(e.target.value);
        valDiff.innerText = diffusionCoeff.toFixed(2);
    });

    const sliderSimSpeed = document.getElementById('param-simspeed');
    const valSimSpeed = document.getElementById('val-simspeed');
    sliderSimSpeed.addEventListener('input', (e) => {
        simSpeed = parseFloat(e.target.value);
        valSimSpeed.innerText = simSpeed.toFixed(1) + 'x';
    });

    // Checkboxes
    const checkBaffle = document.getElementById('param-baffle');
    checkBaffle.addEventListener('change', (e) => {
        baffleEnabled = e.target.checked;
        rebuildVelocityField();
        drawField();
    });

    // Selectors
    const selectPattern = document.getElementById('param-pattern');
    selectPattern.addEventListener('change', (e) => {
        pattern = e.target.value;
        resetConcentration();
        updateHUD();
        drawField();
        drawChart();
    });

    const selectStirMode = document.getElementById('param-stir-mode');
    selectStirMode.addEventListener('change', (e) => {
        stirMode = e.target.value;
    });

    // Buttons
    const btnPause = document.getElementById('btn-pause');
    btnPause.addEventListener('click', () => {
        if (isPaused) {
            isPaused = false;
            btnPause.innerText = 'Pause Sim';
            btnPause.style.background = '#ff4d4d'; // Accent red
            loop();
        } else {
            isPaused = true;
            btnPause.innerText = 'Start Sim';
            btnPause.style.background = '#00d2ff'; // Accent blue
            if (animationFrameId) cancelAnimationFrame(animationFrameId);
        }
    });

    const btnReset = document.getElementById('btn-reset');
    btnReset.addEventListener('click', () => {
        isPaused = true;
        btnPause.innerText = 'Start Sim';
        btnPause.style.background = '#00d2ff';
        if (animationFrameId) cancelAnimationFrame(animationFrameId);
        initGrid();
    });

    // Mouse Drag events inside Canvas
    canvasField.addEventListener('mousedown', (e) => {
        if (stirMode !== 'manual') return;
        isDragging = true;
        let coords = getCanvasCoords(e);
        lastMouseX = coords.x;
        lastMouseY = coords.y;
        dragX = coords.x;
        dragY = coords.y;
        dragVX = 0;
        dragVY = 0;
    });

    canvasField.addEventListener('mousemove', (e) => {
        if (!isDragging || stirMode !== 'manual') return;
        let coords = getCanvasCoords(e);
        dragX = coords.x;
        dragY = coords.y;
        
        // Calculate instantaneous drag velocity
        dragVX = (dragX - lastMouseX) / dt;
        dragVY = (dragY - lastMouseY) / dt;
        
        lastMouseX = dragX;
        lastMouseY = dragY;

        drawField();
    });

    window.addEventListener('mouseup', () => {
        isDragging = false;
    });

    // Touch support for mobiles/tablets
    canvasField.addEventListener('touchstart', (e) => {
        if (stirMode !== 'manual') return;
        isDragging = true;
        let coords = getCanvasCoords(e);
        lastMouseX = coords.x;
        lastMouseY = coords.y;
        dragX = coords.x;
        dragY = coords.y;
        dragVX = 0;
        dragVY = 0;
    });

    canvasField.addEventListener('touchmove', (e) => {
        if (!isDragging || stirMode !== 'manual') return;
        e.preventDefault();
        let coords = getCanvasCoords(e);
        dragX = coords.x;
        dragY = coords.y;
        dragVX = (dragX - lastMouseX) / dt;
        dragVY = (dragY - lastMouseY) / dt;
        lastMouseX = dragX;
        lastMouseY = dragY;
        drawField();
    });

    canvasField.addEventListener('touchend', () => {
        isDragging = false;
    });
}

// Initialise everything
setupEventListeners();
initGrid();
updateHUD();
drawField();
drawChart();
