// JavaScript for Thermos Mug Designer (Class 7)

// 1D Radial Grid W
const N = 15;
let T = new Float32Array(N);
let T_prev = new Float32Array(N);
let mat_type = new Uint8Array(N);

// Material identifiers
const MAT_STEEL = 0;
const MAT_CERAMIC = 1;
const MAT_PLASTIC = 2;
const MAT_VACUUM = 3;
const MAT_FOAM = 4;
const MAT_AIR = 5;

// Physics Parameters
let coffeeTemp = 90.0;
let ambientTemp = 25.0;
let lidClosed = true;

// Material selections
let innerWallMat = 'steel';
let insulationMat = 'vacuum';
let outerWallMat = 'steel';

// Simulation state
let simSpeed = 1.0;
let isPaused = true;
let simTime = 0.0; // minutes

// UI References
const canvasField = document.getElementById('canvas-field');
const ctxField = canvasField.getContext('2d');
const canvasChart = document.getElementById('canvas-chart');
const ctxChart = canvasChart.getContext('2d');

// Chart history
let chartHistory = [];
let baselineHistory = []; // baseline for single-walled ceramic mug
let maxChartTime = 120.0; // minutes
const dt = 0.1; // physics timestep

// Material properties: conductivity k, heat capacity C
const props = {
    steel: { k: 3.5, C: 2.0 },
    ceramic: { k: 0.4, C: 2.5 },
    plastic: { k: 0.05, C: 1.5 },
    vacuum: { k: 0.0001, C: 2.0 },
    foam: { k: 0.007, C: 0.8 },
    air: { k: 0.006, C: 0.8 }
};

// Initialize Grid
function initGrid() {
    simTime = 0.0;
    coffeeTemp = 90.0;
    chartHistory = [];
    
    // Initialize wall temperatures to ambient 25C
    for (let i = 0; i < N; i++) {
        T[i] = 25.0;
        T_prev[i] = 25.0;
    }

    rebuildMaterials();
    generateBaselineMugData();
    updateHUD();
    drawField();
    drawChart();
}

// Map material types to grid cells
function rebuildMaterials() {
    // 0 to 2: Inner Wall
    // 3 to 8: Insulation
    // 9 to 14: Outer Wall
    for (let i = 0; i < N; i++) {
        if (i >= 0 && i <= 2) {
            mat_type[i] = getMatEnum(innerWallMat);
        } else if (i >= 3 && i <= 8) {
            mat_type[i] = getMatEnum(insulationMat);
        } else {
            mat_type[i] = getMatEnum(outerWallMat);
        }
    }
}

function getMatEnum(name) {
    if (name === 'steel') return MAT_STEEL;
    if (name === 'ceramic') return MAT_CERAMIC;
    if (name === 'plastic') return MAT_PLASTIC;
    if (name === 'vacuum') return MAT_VACUUM;
    if (name === 'foam') return MAT_FOAM;
    return MAT_AIR;
}

// Get conductivity k and capacity C for cell i
function getCellProps(i) {
    let type = mat_type[i];
    if (type === MAT_STEEL) return props.steel;
    if (type === MAT_CERAMIC) return props.ceramic;
    if (type === MAT_PLASTIC) return props.plastic;
    if (type === MAT_VACUUM) return props.vacuum;
    if (type === MAT_FOAM) return props.foam;
    return props.air;
}

// Generate comparison baseline: Single-walled Ceramic Mug
function generateBaselineMugData() {
    baselineHistory = [];
    let temp = 90.0;
    let baselineDt = 0.5;
    
    // An analytical cooling curve: single-walled ceramic has high heat loss
    // Cools down to 40C in 30 minutes
    for (let t = 0; t <= maxChartTime; t += baselineDt) {
        baselineHistory.push({ time: t, val: temp });
        // Exponential cooling towards ambient
        let rate = lidClosed ? 0.05 : 0.12; // cooling rate constant
        temp = ambientTemp + (90.0 - ambientTemp) * Math.exp(-rate * t);
    }
}

// Solve 1D Radial Heat Equations
function stepSimulation(stepDt) {
    // Grid radial positions
    const r_inner = 0.04;
    const r_outer = 0.052;
    const dr = (r_outer - r_inner) / (N - 1);

    // Coffee parameters
    const C_coffee = 85.0; // scaled heat capacity of coffee volume
    const A_inner = 2.0 * Math.PI * r_inner * 0.15; // Inner area
    const A_outer = 2.0 * Math.PI * r_outer * 0.15; // Outer area
    const A_lid = Math.PI * r_inner * r_inner;     // Lid area

    // 1. Heat loss through lid (convection + evaporation)
    let h_lid = lidClosed ? 0.005 : 0.18; // Massive difference!
    let q_lid = h_lid * A_lid * (coffeeTemp - ambientTemp);

    // 2. Heat flow into inner wall
    // contact heat transfer coefficient
    let h_contact = 8.0;
    let q_wall = h_contact * A_inner * (coffeeTemp - T[0]);

    // 3. Update Coffee Temperature
    coffeeTemp = coffeeTemp - (stepDt / C_coffee) * (q_wall + q_lid);
    coffeeTemp = Math.max(ambientTemp, coffeeTemp);

    // 4. Update wall interior cells (concentric cylinders)
    for (let i = 1; i < N - 1; i++) {
        let r = r_inner + i * dr;
        let r_plus = r + 0.5 * dr;
        let r_minus = r - 0.5 * dr;

        let p = getCellProps(i);
        let p_plus = getCellProps(i + 1);
        let p_minus = getCellProps(i - 1);

        let k_plus = 0.5 * (p.k + p_plus.k);
        let k_minus = 0.5 * (p.k + p_minus.k);

        // Discretized radial heat diffusion: 
        // dT/dt = (1 / (C * r * dr^2)) * [ r_plus * k_plus * (T[i+1] - T[i]) - r_minus * k_minus * (T[i] - T[i-1]) ]
        let conduction = (1.0 / (p.C * r * dr * dr)) * (
            r_plus * k_plus * (T[i+1] - T[i]) - 
            r_minus * k_minus * (T[i] - T[i-1])
        );

        T_prev[i] = T[i] + stepDt * conduction;
    }

    // 5. Boundary cells
    // Inner boundary i = 0
    let p0 = getCellProps(0);
    let r0 = r_inner;
    let r0_plus = r_inner + 0.5 * dr;
    let k0_plus = 0.5 * (p0.k + getCellProps(1).k);
    T_prev[0] = T[0] + (stepDt / (p0.C * r0 * dr)) * (
        q_wall / (2.0 * Math.PI * 0.15) + (r0_plus * k0_plus * (T[1] - T[0])) / dr
    );

    // Outer boundary i = N - 1 (ambient convection)
    let pN = getCellProps(N - 1);
    let rN = r_outer;
    let rN_minus = r_outer - 0.5 * dr;
    let kN_minus = 0.5 * (pN.k + getCellProps(N - 2).k);

    let h_amb = 0.08; // convection coefficient to ambient air
    let q_amb = h_amb * A_outer * (T[N-1] - ambientTemp);

    T_prev[N-1] = T[N-1] + (stepDt / (pN.C * rN * dr)) * (
        (rN_minus * kN_minus * (T[N-2] - T[N-1])) / dr - q_amb / (2.0 * Math.PI * 0.15)
    );

    // Swap buffers
    let temp = T;
    T = T_prev;
    T_prev = temp;

    // Clamp wall temperatures to prevent numerical noise
    for (let i = 0; i < N; i++) {
        T[i] = Math.max(ambientTemp, Math.min(coffeeTemp, T[i]));
    }
}

// Color scale for temperature mapping (25C to 90C)
function getTempColor(temp) {
    let t = (temp - ambientTemp) / (90.0 - ambientTemp);
    t = Math.max(0.0, Math.min(1.0, t));
    let r, g, b;

    if (t < 0.3) {
        // Cold Dark Blue (#0b0d10) to light cyan (#00d2ff)
        let f = t / 0.3;
        r = Math.round(11 * (1 - f) + 0 * f);
        g = Math.round(13 * (1 - f) + 210 * f);
        b = Math.round(16 * (1 - f) + 255 * f);
    } else if (t < 0.6) {
        // Cyan (#00d2ff) to caramel brown (#e68a00)
        let f = (t - 0.3) / 0.3;
        r = Math.round(0 * (1 - f) + 230 * f);
        g = Math.round(210 * (1 - f) + 138 * f);
        b = Math.round(255 * (1 - f) + 0 * f);
    } else {
        // Caramel (#e68a00) to red-hot orange (#ff4d4d)
        let f = (t - 0.6) / 0.4;
        r = Math.round(230 * (1 - f) + 255 * f);
        g = Math.round(138 * (1 - f) + 77 * f);
        b = Math.round(0 * (1 - f) + 77 * f);
    }
    return `rgb(${r}, ${g}, ${b})`;
}

// Draw the concentric circular temperature profile
function drawField() {
    ctxField.clearRect(0, 0, canvasField.width, canvasField.height);
    
    const cw = canvasField.width;
    const ch = canvasField.height;
    const centerX = cw / 2;
    const centerY = ch / 2;

    // Draw grid rings from inside out
    // Grid: i=0 (inner) to i=14 (outer)
    // Ring radii map from 80 pixels (coffee core) to 170 pixels (outer casing)
    const R_core = 75;
    const R_outer = 175;
    const RingW = (R_outer - R_core) / (N - 1);

    // 1. Draw Coffee core circle
    ctxField.fillStyle = getTempColor(coffeeTemp);
    ctxField.beginPath();
    ctxField.arc(centerX, centerY, R_core, 0, 2 * Math.PI);
    ctxField.fill();

    // Draw grid rings
    for (let i = 0; i < N - 1; i++) {
        let rInnerRing = R_core + i * RingW;
        let rOuterRing = R_core + (i + 1) * RingW;

        // Draw ring segment filled with average temperature color of cells i and i+1
        ctxField.strokeStyle = getTempColor(0.5 * (T[i] + T[i+1]));
        ctxField.lineWidth = RingW + 1.5;
        ctxField.beginPath();
        ctxField.arc(centerX, centerY, 0.5 * (rInnerRing + rOuterRing), 0, 2 * Math.PI);
        ctxField.stroke();
    }

    // 2. Draw interface boundaries and texts
    ctxField.strokeStyle = 'rgba(255, 255, 255, 0.15)';
    ctxField.lineWidth = 1;

    // Inner interface
    ctxField.beginPath();
    ctxField.arc(centerX, centerY, R_core, 0, 2 * Math.PI);
    ctxField.stroke();

    // Outer interface
    ctxField.beginPath();
    ctxField.arc(centerX, centerY, R_outer, 0, 2 * Math.PI);
    ctxField.stroke();

    // Labels
    ctxField.fillStyle = '#ffffff';
    ctxField.font = 'bold 11px Outfit, sans-serif';
    ctxField.textAlign = 'center';
    ctxField.fillText('COFFEE CORE', centerX, centerY - 10);
    ctxField.fillStyle = 'rgba(255, 255, 255, 0.7)';
    ctxField.font = '10px Outfit, sans-serif';
    ctxField.fillText(coffeeTemp.toFixed(1) + ' °C', centerX, centerY + 10);

    // Draw layer boundary indicators
    // inner wall: index 0 to 2 (corresponds to R_core to R_core + 3 * RingW)
    let R_insul_start = R_core + 3 * RingW;
    let R_insul_end = R_core + 9 * RingW;

    ctxField.strokeStyle = 'rgba(255, 255, 255, 0.4)';
    ctxField.lineWidth = 1.5;
    ctxField.setLineDash([3, 3]);

    ctxField.beginPath();
    ctxField.arc(centerX, centerY, R_insul_start, 0, 2*Math.PI);
    ctxField.stroke();

    ctxField.beginPath();
    ctxField.arc(centerX, centerY, R_insul_end, 0, 2*Math.PI);
    ctxField.stroke();
    ctxField.setLineDash([]);

    // Draw labels of layers
    ctxField.fillStyle = '#8b949e';
    ctxField.font = '9px JetBrains Mono, monospace';
    ctxField.textAlign = 'center';
    
    // Draw text radially
    ctxField.fillText('INNER WALL', centerX, centerY - R_core - 6);
    ctxField.fillStyle = '#00d2ff';
    ctxField.fillText(insulationMat.toUpperCase(), centerX, centerY - R_insul_start - 12);
    ctxField.fillStyle = '#8b949e';
    ctxField.fillText('OUTER WALL', centerX, centerY - R_insul_end - 6);

    // Warning overlay if outer wall is too hot to hold comfortably (>50C)
    if (T[N-1] > 50.0) {
        ctxField.fillStyle = 'rgba(255, 77, 77, 0.15)';
        ctxField.beginPath();
        ctxField.arc(centerX, centerY, R_outer, 0, 2 * Math.PI);
        ctxField.fill();

        ctxField.fillStyle = '#ff4d4d';
        ctxField.font = 'bold 11px Outfit, sans-serif';
        ctxField.fillText('⚠️ CASING HOT (>50°C)', centerX, centerY + R_outer + 18);
    }
}

// Draw chart for cooling history compared side-by-side with baseline
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
    ctxChart.fillText('Lecture Duration (min)', padding.left + chartW / 2, h - 8);

    ctxChart.save();
    ctxChart.translate(12, padding.top + chartH / 2);
    ctxChart.rotate(-Math.PI / 2);
    ctxChart.fillText('Coffee Temp (°C)', 0, 0);
    ctxChart.restore();

    // Scale mappings
    const getX = (t) => padding.left + (t / maxChartTime) * chartW;
    const getY = (temp) => h - padding.bottom - ((temp - 25.0) / 75.0) * chartH; // 25 to 100C

    // Draw Gridlines & tick labels
    ctxChart.strokeStyle = 'rgba(255, 255, 255, 0.05)';
    ctxChart.textAlign = 'center';

    for (let temp = 40; temp <= 100; temp += 20) {
        let yPos = getY(temp);
        ctxChart.beginPath();
        ctxChart.moveTo(padding.left, yPos);
        ctxChart.lineTo(w - padding.right, yPos);
        ctxChart.stroke();
        ctxChart.fillStyle = '#8b949e';
        ctxChart.fillText(temp + '°', padding.left - 15, yPos + 3);
    }

    // Draw 60C "Ideal drinking threshold" line (Green dotted)
    ctxChart.strokeStyle = 'rgba(57, 211, 83, 0.4)';
    ctxChart.lineWidth = 1.5;
    ctxChart.setLineDash([4, 4]);
    ctxChart.beginPath();
    ctxChart.moveTo(padding.left, getY(60));
    ctxChart.lineTo(w - padding.right, getY(60));
    ctxChart.stroke();
    
    ctxChart.fillStyle = '#39d353';
    ctxChart.fillText('Ideal Drink Limit (60°C)', w - padding.right - 60, getY(60) - 6);
    ctxChart.setLineDash([]); // Reset

    // 1. Draw Baseline Mug Curve (Dotted Orange - Ceramic Single Wall)
    ctxChart.strokeStyle = '#ff9f43';
    ctxChart.lineWidth = 1.8;
    ctxChart.setLineDash([2, 3]);
    ctxChart.beginPath();
    for (let i = 0; i < baselineHistory.length; i++) {
        let pt = baselineHistory[i];
        let px = getX(pt.time);
        let py = getY(pt.val);
        if (i === 0) ctxChart.moveTo(px, py);
        else ctxChart.lineTo(px, py);
    }
    ctxChart.stroke();
    ctxChart.setLineDash([]); // Reset

    // Label for Baseline
    ctxChart.fillStyle = '#ff9f43';
    ctxChart.font = '9px Outfit, sans-serif';
    ctxChart.textAlign = 'left';
    ctxChart.fillText('Standard Ceramic Mug', getX(15), getY(40));

    // 2. Draw Active Design Curve (Solid Blue)
    if (chartHistory.length > 0) {
        ctxChart.strokeStyle = '#00d2ff';
        ctxChart.lineWidth = 3;
        ctxChart.beginPath();
        for (let i = 0; i < chartHistory.length; i++) {
            let pt = chartHistory[i];
            let px = getX(pt.time);
            let py = getY(pt.temp);
            if (i === 0) ctxChart.moveTo(px, py);
            else ctxChart.lineTo(px, py);
        }
        ctxChart.stroke();
    }
}

// Update HUD texts
function updateHUD() {
    document.getElementById('hud-coffee-temp').innerText = coffeeTemp.toFixed(1) + ' °C';
    document.getElementById('hud-outer-temp').innerText = T[N-1].toFixed(1) + ' °C';
}

// Main loop step
function loop() {
    if (isPaused) return;

    // Simulate multiple physics steps per frame
    // We scale time: 1 frame step equals 0.2 minutes (12 seconds) in simulation
    // This allows 120 minutes of simulation to run in 600 frames (~10 seconds!)
    let subSteps = Math.round(simSpeed * 15);
    for (let step = 0; step < subSteps; step++) {
        stepSimulation(dt);
        simTime += dt * 0.15; // simulation time increment in minutes

        // Record history
        if (simTime <= maxChartTime) {
            chartHistory.push({ time: simTime, temp: coffeeTemp });
        }
    }

    updateHUD();
    drawField();
    drawChart();

    animationFrameId = requestAnimationFrame(loop);
}

// Bind UI controls
function setupEventListeners() {
    const selectInner = document.getElementById('param-inner');
    selectInner.addEventListener('change', (e) => {
        innerWallMat = e.target.value;
        rebuildMaterials();
        initGrid();
    });

    const selectInsulation = document.getElementById('param-insulation');
    selectInsulation.addEventListener('change', (e) => {
        insulationMat = e.target.value;
        rebuildMaterials();
        initGrid();
    });

    const selectOuter = document.getElementById('param-outer');
    selectOuter.addEventListener('change', (e) => {
        outerWallMat = e.target.value;
        rebuildMaterials();
        initGrid();
    });

    const checkLid = document.getElementById('param-lid');
    checkLid.addEventListener('change', (e) => {
        lidClosed = e.target.checked;
        generateBaselineMugData();
        drawChart();
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
            btnPause.style.background = '#ff4d4d'; // color change
            btnPause.style.color = '#fff';
            loop();
        } else {
            isPaused = true;
            btnPause.innerText = 'Start Sim';
            btnPause.style.background = '#00d2ff';
            btnPause.style.color = '#0b0d10';
            if (animationFrameId) cancelAnimationFrame(animationFrameId);
        }
    });

    const btnReset = document.getElementById('btn-reset');
    btnReset.addEventListener('click', () => {
        isPaused = true;
        btnPause.innerText = 'Start Sim';
        btnPause.style.background = '#00d2ff';
        btnPause.style.color = '#0b0d10';
        if (animationFrameId) cancelAnimationFrame(animationFrameId);
        initGrid();
    });
}

// Initialise everything
setupEventListeners();
initGrid();
