// JavaScript simulation logic for Espresso Extraction
document.addEventListener("DOMContentLoaded", () => {
    // UI Elements
    const sliderPressure = document.getElementById("param-pressure");
    const valPressure = document.getElementById("val-pressure");
    const sliderTemp = document.getElementById("param-temp");
    const valTemp = document.getElementById("val-temp");
    const selectGrind = document.getElementById("param-grind");
    const sliderTamping = document.getElementById("param-tamping");
    const valTamping = document.getElementById("val-tamping");

    const btnStart = document.getElementById("btn-start");
    const btnReset = document.getElementById("btn-reset");

    const statTime = document.getElementById("stat-time");
    const statFlow = document.getElementById("stat-flow");
    const statVolume = document.getElementById("stat-volume");
    const statYield1 = document.getElementById("stat-yield1");
    const statYield2 = document.getElementById("stat-yield2");
    const statTaste = document.getElementById("stat-taste");
    const statTds = document.getElementById("stat-tds");
    const statRatio = document.getElementById("stat-ratio");

    const viewButtons = document.querySelectorAll(".view-btn");
    const puckCanvas = document.getElementById("puck-canvas");
    const plotCanvas = document.getElementById("plot-canvas");
    const debugConsole = document.getElementById("debug-console");

    const cupLiquid = document.getElementById("cup-liquid");
    const cupCrema = document.getElementById("cup-crema");

    const scaleMax = document.getElementById("scale-max");
    const scaleMin = document.getElementById("scale-min");

    // Theory Panel UI Elements
    const sliderEa1 = document.getElementById("param-ea1");
    const valEa1 = document.getElementById("val-ea1");
    const sliderEa2 = document.getElementById("param-ea2");
    const valEa2 = document.getElementById("val-ea2");
    const sliderK0 = document.getElementById("param-k0");
    const valK0 = document.getElementById("val-k0");
    const sliderMaxTime = document.getElementById("param-maxtime");
    const valMaxTime = document.getElementById("val-maxtime");

    const arrheniusCanvas = document.getElementById("arrhenius-canvas");
    const permeabilityCanvas = document.getElementById("permeability-canvas");

    // Grid and constants
    const L = 0.02; // puck length (m)
    const Nx = 40;  // grid points
    const dx = L / (Nx - 1);
    const dt = 0.004; // time step for stability (CFL condition)
    const R = 8.314;  // gas constant

    // Properties
    const rho_s = 1200.0;
    const rho_f = 1000.0;
    const Cp_f = 4184.0;
    const Cp_s = 1500.0;
    const k_eff = 0.5;
    const D_eff = 1e-9;

    // Species 1: Caffeine (Fast)
    const S1_0 = 0.012;
    let Ea1 = 30000.0;
    const k1_0 = 3500.0;
    const C_sat1 = 60.0;

    // Species 2: Bitter Compounds (Slow)
    const S2_0 = 0.060;
    let Ea2 = 55000.0;
    const k2_0 = 2.5e6;

    // Simulation State
    let isRunning = false;
    let animId = null;
    let t = 0.0;
    let maxTime = 30.0;
    let timeStepsRun = 0;
    let activeField = "temp"; // temp, caffeine, bitter, depletion

    // Field arrays
    let T = new Float32Array(Nx);
    let S1 = new Float32Array(Nx);
    let S2 = new Float32Array(Nx);
    let C1 = new Float32Array(Nx);
    let C2 = new Float32Array(Nx);

    let massCaffeineExtracted = 0.0;
    let massBitterExtracted = 0.0;
    let totalWaterVolume = 0.0; // mL
    let yieldHistory = []; // {t, y1, y2}

    // Initialize values
    resetSimulation();

    // Event Listeners
    sliderPressure.addEventListener("input", (e) => {
        valPressure.textContent = parseFloat(e.target.value).toFixed(1) + " bar";
    });
    sliderTemp.addEventListener("input", (e) => {
        valTemp.textContent = e.target.value + " °C";
        drawArrheniusCurve();
    });
    sliderTamping.addEventListener("input", (e) => {
        valTamping.textContent = e.target.value + " kg";
        drawPermeabilityCurve();
    });

    // Theory Sliders Listeners
    sliderEa1.addEventListener("input", (e) => {
        Ea1 = parseFloat(e.target.value) * 1000.0;
        valEa1.textContent = parseFloat(e.target.value).toFixed(1) + " kJ/mol";
        drawArrheniusCurve();
    });
    sliderEa2.addEventListener("input", (e) => {
        Ea2 = parseFloat(e.target.value) * 1000.0;
        valEa2.textContent = parseFloat(e.target.value).toFixed(1) + " kJ/mol";
        drawArrheniusCurve();
    });
    sliderK0.addEventListener("input", (e) => {
        valK0.innerHTML = parseFloat(e.target.value).toFixed(1) + " &times; 10<sup>-15</sup> m<sup>2</sup>";
        drawPermeabilityCurve();
    });
    sliderMaxTime.addEventListener("input", (e) => {
        maxTime = parseFloat(e.target.value);
        valMaxTime.textContent = e.target.value + " s";
        drawPlot();
    });

    btnStart.addEventListener("click", () => {
        if (!isRunning) {
            startSimulation();
        } else {
            pauseSimulation();
        }
    });

    btnReset.addEventListener("click", resetSimulation);

    viewButtons.forEach(btn => {
        btn.addEventListener("click", (e) => {
            viewButtons.forEach(b => b.classList.remove("active"));
            e.target.classList.add("active");
            activeField = e.target.getAttribute("data-field");
            logDebug(`Switched visualization to: ${activeField}`);
            updateScaleLabels();
            drawPuck();
        });
    });

    // Logging helper
    function logDebug(msg) {
        const d = new Date();
        const timeStr = d.toTimeString().split(" ")[0];
        debugConsole.innerHTML += `\n[${timeStr}] ${msg}`;
        debugConsole.scrollTop = debugConsole.scrollHeight;
    }

    function updateScaleLabels() {
        if (activeField === "temp") {
            scaleMax.textContent = `${sliderTemp.value}°C`;
            scaleMin.textContent = "20°C";
        } else if (activeField === "caffeine") {
            scaleMax.textContent = "High";
            scaleMin.textContent = "0";
        } else if (activeField === "bitter") {
            scaleMax.textContent = "High";
            scaleMin.textContent = "0";
        } else if (activeField === "depletion") {
            scaleMax.textContent = "100%";
            scaleMin.textContent = "0%";
        }
    }

    // Viscosity helper (Celsius)
    function getViscosity(tempC) {
        const T = Math.max(5.0, Math.min(100.0, tempC));
        return 0.00179 / (1.0 + 0.03368 * T + 0.000221 * T * T);
    }

    // Solubility helper (Celsius)
    function getSolubility2(tempC) {
        const T_k = tempC + 273.15;
        return 50.0 * Math.exp(-3000.0 / T_k) / Math.exp(-3000.0 / 363.15);
    }

    function resetSimulation() {
        isRunning = false;
        if (animId) cancelAnimationFrame(animId);
        btnStart.textContent = "▶ Start Brew";
        btnStart.classList.remove("btn-danger");
        
        t = 0.0;
        timeStepsRun = 0;
        massCaffeineExtracted = 0.0;
        massBitterExtracted = 0.0;
        totalWaterVolume = 0.0;
        yieldHistory = [];

        // Update theory parameters from sliders
        Ea1 = parseFloat(sliderEa1.value) * 1000.0;
        Ea2 = parseFloat(sliderEa2.value) * 1000.0;
        maxTime = parseFloat(sliderMaxTime.value);

        // Reset fields
        for (let i = 0; i < Nx; i++) {
            T[i] = 20.0; // dry puck starts at 20C
            S1[i] = S1_0;
            S2[i] = S2_0;
            C1[i] = 0.0;
            C2[i] = 0.0;
        }
        T[0] = parseFloat(sliderTemp.value); // Water entering temperature

        updateUIElements();
        updateScaleLabels();
        drawPuck();
        drawPlot();
        drawArrheniusCurve();
        drawPermeabilityCurve();
        
        // Reset cup
        cupLiquid.style.height = "0%";
        cupCrema.style.opacity = "0";

        logDebug("Simulation reset. Ready.");
    }

    function startSimulation() {
        isRunning = true;
        btnStart.textContent = "⏸ Pause Brew";
        btnStart.classList.add("btn-danger");
        logDebug(`Brew started: Pressure=${sliderPressure.value} bar, Temp=${sliderTemp.value}°C, Tamping=${sliderTamping.value} kg`);
        animate();
    }

    function pauseSimulation() {
        isRunning = false;
        btnStart.textContent = "▶ Start Brew";
        btnStart.classList.remove("btn-danger");
        logDebug("Simulation paused.");
    }

    // Mathematical solver step
    function simulationStep() {
        // 1. Calculate porosity epsilon based on tamping pressure (5 to 30 kg)
        const tamp = parseFloat(sliderTamping.value);
        const epsilon = 0.48 - 0.005 * tamp;
        const rho_b = (1.0 - epsilon) * rho_s;
        const rho_Cp_eff = (1.0 - epsilon) * rho_s * Cp_s + epsilon * rho_f * Cp_f;

        // 2. Permeability model based on grind selection and Kozeny-Carman porosity scaling
        let k0_val = parseFloat(sliderK0.value) * 1e-15;
        let k0 = k0_val; // default medium
        const grind = selectGrind.value;
        if (grind === "coarse") k0 = k0_val * 4.0;
        if (grind === "fine") k0 = k0_val / 4.0;
        
        // Scale with porosity: (eps^3)/(1-eps)^2 normalized to default porosity eps=0.4
        const eps_ref = 0.4;
        const kc_ref = Math.pow(eps_ref, 3) / Math.pow(1 - eps_ref, 2);
        const kc_cur = Math.pow(epsilon, 3) / Math.pow(1 - epsilon, 2);
        const permeability = k0 * (kc_cur / kc_ref);

        // 3. Fluid dynamics
        const T_avg = Array.from(T).reduce((a,b)=>a+b, 0) / Nx;
        const viscosity = getViscosity(T_avg);
        const dP = parseFloat(sliderPressure.value) * 1e5;
        const u = (permeability / viscosity) * (dP / L);

        // Flow rate (mL/s) for A = 20 cm2
        const A = 2e-3;
        const Q = u * A * 1e6;

        // 4. Update fields using explicit upwind discretization
        let T_new = new Float32Array(T);
        let S1_new = new Float32Array(S1);
        let S2_new = new Float32Array(S2);
        let C1_new = new Float32Array(C1);
        let C2_new = new Float32Array(C2);

        // Temperature (Inlet boundary T[0] = T_in)
        T_new[0] = parseFloat(sliderTemp.value);
        for (let i = 1; i < Nx - 1; i++) {
            const conv = u * rho_f * Cp_f * (T[i] - T[i-1]) / dx;
            const cond = k_eff * (T[i+1] - 2 * T[i] + T[i-1]) / (dx * dx);
            T_new[i] = T[i] + dt * (cond - conv) / rho_Cp_eff;
        }
        T_new[Nx-1] = T_new[Nx-2]; // convective outlet

        // Species extraction and transport
        for (let i = 0; i < Nx; i++) {
            const T_k = T[i] + 273.15;
            
            // Temperature-dependent rates
            const k1 = k1_0 * Math.exp(-Ea1 / (R * T_k));
            const k2 = k2_0 * Math.exp(-Ea2 / (R * T_k));
            const sat2 = getSolubility2(T[i]);

            // Reaction rates (extraction rate)
            const rate1 = Math.max(0.0, k1 * S1[i] * (1.0 - C1[i] / C_sat1));
            const rate2 = Math.max(0.0, k2 * S2[i] * (1.0 - C2[i] / sat2));

            // Solid depletion
            S1_new[i] = Math.max(0.0, S1[i] - dt * rate1);
            S2_new[i] = Math.max(0.0, S2[i] - dt * rate2);

            // Liquid transport (only interior points solve PDE)
            if (i > 0 && i < Nx - 1) {
                const conv1 = u * (C1[i] - C1[i-1]) / dx;
                const diff1 = D_eff * (C1[i+1] - 2 * C1[i] + C1[i-1]) / (dx*dx);
                const source1 = rho_b * rate1;
                C1_new[i] = Math.max(0.0, C1[i] + dt * (diff1 - conv1 + source1) / epsilon);

                const conv2 = u * (C2[i] - C2[i-1]) / dx;
                const diff2 = D_eff * (C2[i+1] - 2 * C2[i] + C2[i-1]) / (dx*dx);
                const source2 = rho_b * rate2;
                C2_new[i] = Math.max(0.0, C2[i] + dt * (diff2 - conv2 + source2) / epsilon);
            }
        }
        // Boundaries
        C1_new[0] = 0.0;
        C2_new[0] = 0.0;
        C1_new[Nx-1] = C1_new[Nx-2];
        C2_new[Nx-1] = C2_new[Nx-2];

        // Mass extracted at outlet
        massCaffeineExtracted += (u * A * C1[Nx-1]) * dt;
        massBitterExtracted += (u * A * C2[Nx-1]) * dt;
        totalWaterVolume += Q * dt;

        // Apply new values
        T = T_new;
        S1 = S1_new;
        S2 = S2_new;
        C1 = C1_new;
        C2 = C2_new;

        t += dt;
        timeStepsRun++;

        return Q;
    }

    // Animation frame handler
    function animate() {
        if (!isRunning) return;

        // Run multiple time steps per visual frame to speed up and match real time
        // 1 frame = 1/60s = 16.7ms. With dt = 4ms, we run 4 steps per frame.
        let flowRate = 0.0;
        for (let step = 0; step < 4; step++) {
            flowRate = simulationStep();
        }

        // Calculate yields
        const tamp = parseFloat(sliderTamping.value);
        const epsilon = 0.48 - 0.005 * tamp;
        const rho_b = (1.0 - epsilon) * rho_s;
        const total_dry_coffee_mass = rho_b * (L * 2e-3);
        const initial_caffeine = S1_0 * total_dry_coffee_mass;
        const initial_bitter = S2_0 * total_dry_coffee_mass;

        const yieldCaffeine = (massCaffeineExtracted / initial_caffeine) * 100.0;
        const yieldBitter = (massBitterExtracted / initial_bitter) * 100.0;

        yieldHistory.push({
            t: t,
            y1: yieldCaffeine,
            y2: yieldBitter
        });

        // Update UI
        statTime.textContent = t.toFixed(1) + " s";
        statFlow.textContent = flowRate.toFixed(2) + " mL/s";
        statVolume.textContent = totalWaterVolume.toFixed(1) + " mL";
        statYield1.textContent = yieldCaffeine.toFixed(1) + " %";
        statYield2.textContent = yieldBitter.toFixed(1) + " %";
        
        // Taste Profile & TDS calculations
        const caffeineG = massCaffeineExtracted * 1000; // mg
        const bitterG = massBitterExtracted * 1000;     // mg
        const tds = ((massCaffeineExtracted + massBitterExtracted) / (totalWaterVolume * 1e-3 + 1e-9)) * 100;
        statTds.textContent = tds.toFixed(2) + " %";
        
        const ratioVal = yieldCaffeine / (yieldBitter + 1e-6);
        statRatio.textContent = ratioVal.toFixed(2);

        // Taste classification
        let taste = "Dry";
        let tasteClass = "taste-dry";
        
        if (t < 5.0) {
            taste = "Sour / Under-extracted";
            tasteClass = "taste-sour";
        } else if (yieldCaffeine > 70.0 && yieldBitter < 25.0) {
            taste = "Bright & Sweet";
            tasteClass = "taste-sweet";
        } else if (yieldCaffeine > 85.0 && yieldBitter >= 25.0 && yieldBitter <= 40.0) {
            taste = "Sweet & Balanced";
            tasteClass = "taste-sweet";
        } else if (yieldBitter > 40.0 && yieldBitter < 55.0) {
            taste = "Bitter & Heavy";
            tasteClass = "taste-bitter";
        } else if (yieldBitter >= 55.0) {
            taste = "Over-extracted / Harsh";
            tasteClass = "taste-bitter";
        }
        
        statTaste.textContent = taste;
        statTaste.className = `taste-badge ${tasteClass}`;

        // Animate Cup
        // Max volume is 60mL. Set height accordingly.
        const cupPercentage = Math.min(85, (totalWaterVolume / 60.0) * 85);
        cupLiquid.style.height = `${cupPercentage}%`;
        
        // Fade in crema layer as coffee pours
        if (totalWaterVolume > 2.0) {
            cupCrema.style.opacity = Math.min(0.9, (totalWaterVolume - 2.0) / 10.0);
        }

        // Draw visuals
        drawPuck();
        drawPlot();

        // End brew if dry or maxTime elapsed
        if (t >= maxTime || totalWaterVolume >= 60.0) {
            isRunning = false;
            btnStart.textContent = "▶ Brew Finished";
            btnStart.classList.remove("btn-danger");
            logDebug(`Simulation complete. Final Volume: ${totalWaterVolume.toFixed(1)} mL, Caffeine Yield: ${yieldCaffeine.toFixed(1)}%, Bitter Yield: ${yieldBitter.toFixed(1)}%`);
        } else {
            animId = requestAnimationFrame(animate);
        }
    }

    function updateUIElements() {
        statTime.textContent = t.toFixed(1) + " s";
        statFlow.textContent = "0.00 mL/s";
        statVolume.textContent = "0.0 mL";
        statYield1.textContent = "0.0 %";
        statYield2.textContent = "0.0 %";
        statTaste.textContent = "Dry";
        statTaste.className = "taste-badge taste-dry";
        statTds.textContent = "0.00 %";
        statRatio.textContent = "0.00";
    }

    // Color conversion helper
    function getTemperatureColor(temp) {
        // Map 20C (blue) to 100C (red)
        const t_min = 20.0;
        const t_max = parseFloat(sliderTemp.value);
        const f = Math.max(0.0, Math.min(1.0, (temp - t_min) / (t_max - t_min + 1e-6)));
        
        // RGB gradients
        const r = Math.round(255 * f);
        const g = Math.round(100 * f * (1-f) + 150 * f * f);
        const b = Math.round(255 * (1 - f));
        return `rgb(${r}, ${g}, ${b})`;
    }

    function getConcentrationColor(conc, maxVal, colorType) {
        const f = Math.max(0.0, Math.min(1.0, conc / maxVal));
        if (colorType === "caffeine") {
            // Glow blue
            return `rgba(0, 162, 255, ${f})`;
        } else {
            // Amber/brown
            return `rgba(212, 163, 115, ${f})`;
        }
    }

    function getDepletionColor(solidFrac) {
        // solidFrac is 0.0 to 1.0 (relative to S_0)
        // Green (rich) to dark grey (depleted)
        const g = Math.round(30 + 180 * solidFrac);
        const r = Math.round(20 + 80 * (1 - solidFrac));
        const b = Math.round(30 + 50 * solidFrac);
        return `rgb(${r}, ${g}, ${b})`;
    }

    // Draw fields in the puck canvas
    function drawPuck() {
        const ctx = puckCanvas.getContext("2d");
        const w = puckCanvas.width;
        const h = puckCanvas.height;

        ctx.clearRect(0, 0, w, h);

        // Drawing parameters
        const bandH = h / Nx;

        for (let i = 0; i < Nx; i++) {
            let fillColor = "#000";

            if (activeField === "temp") {
                fillColor = getTemperatureColor(T[i]);
            } else if (activeField === "caffeine") {
                // Caffeine saturation limit is 60 kg/m3. We scale color up to 15 kg/m3 for visual depth.
                fillColor = getConcentrationColor(C1[i], 12.0, "caffeine");
            } else if (activeField === "bitter") {
                // Scale bitterness concentration color to 20 kg/m3
                fillColor = getConcentrationColor(C2[i], 25.0, "bitter");
            } else if (activeField === "depletion") {
                // Average solid depletion of both species
                const solidFrac = 0.5 * (S1[i]/S1_0 + S2[i]/S2_0);
                fillColor = getDepletionColor(solidFrac);
            }

            ctx.fillStyle = fillColor;
            ctx.fillRect(0, i * bandH, w, bandH);

            // Optional: Draw a grid lines or texture
            if (i % 5 === 0) {
                ctx.fillStyle = "rgba(255, 255, 255, 0.02)";
                ctx.fillRect(0, i * bandH, w, 1);
            }
        }

        // Draw side walls of basket
        ctx.strokeStyle = "rgba(255, 255, 255, 0.15)";
        ctx.lineWidth = 4;
        ctx.strokeRect(0, 0, w, h);
    }

    // Draw yield curves
    function drawPlot() {
        const ctx = plotCanvas.getContext("2d");
        const w = plotCanvas.width;
        const h = plotCanvas.height;

        ctx.clearRect(0, 0, w, h);
        
        // Back grid
        ctx.strokeStyle = "rgba(255, 255, 255, 0.05)";
        ctx.lineWidth = 1;
        const padX = 40;
        const padY = 30;
        const graphW = w - padX - 15;
        const graphH = h - padY - 15;

        // Draw grid lines
        for (let grid = 0; grid <= 4; grid++) {
            // Y-axis grid (Yield %)
            const y = padY + graphH * (1 - grid / 4);
            ctx.beginPath();
            ctx.moveTo(padX, y);
            ctx.lineTo(w - 15, y);
            ctx.stroke();

            ctx.fillStyle = "rgba(255, 255, 255, 0.4)";
            ctx.font = "10px Outfit";
            ctx.fillText((grid * 25) + "%", 10, y + 3);

            // X-axis grid (Time s)
            const x = padX + graphW * (grid / 4);
            ctx.beginPath();
            ctx.moveTo(x, padY);
            ctx.lineTo(x, h - padY);
            ctx.stroke();

            ctx.fillText((grid * maxTime / 4).toFixed(0) + "s", x - 10, h - 10);
        }

        // Axis lines
        ctx.strokeStyle = "rgba(255, 255, 255, 0.2)";
        ctx.beginPath();
        ctx.moveTo(padX, padY);
        ctx.lineTo(padX, h - padY);
        ctx.lineTo(w - 15, h - padY);
        ctx.stroke();

        // Titles
        ctx.fillStyle = "#fff";
        ctx.font = "12px Outfit";
        ctx.fillText("Yield Curves (Caffeine vs Bitterness)", padX + 10, padY - 10);

        if (yieldHistory.length === 0) return;

        // Draw Caffeine Yield curve (Blue)
        ctx.lineWidth = 2.5;
        ctx.strokeStyle = "#00a2ff";
        ctx.beginPath();
        for (let idx = 0; idx < yieldHistory.length; idx++) {
            const pt = yieldHistory[idx];
            const x = padX + (pt.t / maxTime) * graphW;
            const y = padY + graphH * (1 - pt.y1 / 100.0);
            if (idx === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
        }
        ctx.stroke();

        // Draw Bitter Yield curve (Amber)
        ctx.strokeStyle = "#d4a373";
        ctx.beginPath();
        for (let idx = 0; idx < yieldHistory.length; idx++) {
            const pt = yieldHistory[idx];
            const x = padX + (pt.t / maxTime) * graphW;
            const y = padY + graphH * (1 - pt.y2 / 100.0);
            if (idx === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
        }
        ctx.stroke();
    }

    // Theory Plot 1: Arrhenius Rate Constant vs. Temperature
    function drawArrheniusCurve() {
        const ctx = arrheniusCanvas.getContext("2d");
        const w = arrheniusCanvas.width;
        const h = arrheniusCanvas.height;
        ctx.clearRect(0, 0, w, h);

        const padX = 35;
        const padY = 20;
        const graphW = w - padX - 15;
        const graphH = h - padY - 10;

        // X-axis: Temperature 20°C to 100°C
        // Y-axis: k (1/s)
        
        // Calculations for scale
        const getK1 = (tempC) => k1_0 * Math.exp(-Ea1 / (R * (tempC + 273.15)));
        const getK2 = (tempC) => k2_0 * Math.exp(-Ea2 / (R * (tempC + 273.15)));

        // Find max value to scale Y
        const maxK = Math.max(getK1(100), getK2(100), 0.05);

        // Draw grid
        ctx.strokeStyle = "rgba(255, 255, 255, 0.05)";
        ctx.lineWidth = 1;
        ctx.fillStyle = "rgba(255, 255, 255, 0.4)";
        ctx.font = "9px Outfit";

        for (let g = 0; g <= 3; g++) {
            // Y-lines
            const y = padY + graphH * (1 - g / 3);
            ctx.beginPath();
            ctx.moveTo(padX, y);
            ctx.lineTo(w - 15, y);
            ctx.stroke();
            ctx.fillText((maxK * (g / 3)).toFixed(2), 5, y + 3);

            // X-lines
            const tempVal = 20 + g * (80 / 3);
            const x = padX + (g / 3) * graphW;
            ctx.beginPath();
            ctx.moveTo(x, padY);
            ctx.lineTo(x, h - padY);
            ctx.stroke();
            ctx.fillText(Math.round(tempVal) + "°", x - 6, h - 8);
        }

        // Axis
        ctx.strokeStyle = "rgba(255, 255, 255, 0.2)";
        ctx.beginPath();
        ctx.moveTo(padX, padY);
        ctx.lineTo(padX, h - padY);
        ctx.lineTo(w - 15, h - padY);
        ctx.stroke();

        // Title
        ctx.fillStyle = "#fff";
        ctx.fillText("k(T) vs. Temp (Kinetics)", padX + 5, padY - 8);

        // Plot Caffeine (Blue)
        ctx.strokeStyle = "#00a2ff";
        ctx.lineWidth = 2;
        ctx.beginPath();
        for (let i = 0; i <= 30; i++) {
            const tc = 20 + i * (80 / 30);
            const k = getK1(tc);
            const x = padX + (i / 30) * graphW;
            const y = padY + graphH * (1 - k / maxK);
            if (i === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
        }
        ctx.stroke();

        // Plot Bitter (Amber)
        ctx.strokeStyle = "#d4a373";
        ctx.beginPath();
        for (let i = 0; i <= 30; i++) {
            const tc = 20 + i * (80 / 30);
            const k = getK2(tc);
            const x = padX + (i / 30) * graphW;
            const y = padY + graphH * (1 - k / maxK);
            if (i === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
        }
        ctx.stroke();

        // Draw current operating temperature indicator
        const curTemp = parseFloat(sliderTemp.value);
        const x_cur = padX + ((curTemp - 20) / 80) * graphW;
        ctx.strokeStyle = "rgba(255, 255, 255, 0.3)";
        ctx.lineWidth = 1;
        ctx.setLineDash([3, 3]);
        ctx.beginPath();
        ctx.moveTo(x_cur, padY);
        ctx.lineTo(x_cur, h - padY);
        ctx.stroke();
        ctx.setLineDash([]); // reset

        // Draw current operating point dots
        const curK1 = getK1(curTemp);
        const curK2 = getK2(curTemp);
        
        ctx.fillStyle = "#00a2ff";
        ctx.beginPath();
        ctx.arc(x_cur, padY + graphH * (1 - curK1 / maxK), 4, 0, 2 * Math.PI);
        ctx.fill();

        ctx.fillStyle = "#d4a373";
        ctx.beginPath();
        ctx.arc(x_cur, padY + graphH * (1 - curK2 / maxK), 4, 0, 2 * Math.PI);
        ctx.fill();
    }

    // Theory Plot 2: Kozeny-Carman Permeability vs. Porosity
    function drawPermeabilityCurve() {
        const ctx = permeabilityCanvas.getContext("2d");
        const w = permeabilityCanvas.width;
        const h = permeabilityCanvas.height;
        ctx.clearRect(0, 0, w, h);

        const padX = 35;
        const padY = 20;
        const graphW = w - padX - 15;
        const graphH = h - padY - 10;

        // Porosity range: 0.3 to 0.5
        // Y-axis: Permeability (scaled relative to k0_val in 10^-15 m2)
        const k0_val = parseFloat(sliderK0.value); // e.g. 6.0

        // Permeability KC scaling factor: eps^3 / (1-eps)^2
        const getPerm = (eps) => {
            return k0_val * (Math.pow(eps, 3) / Math.pow(1 - eps, 2)) / (Math.pow(0.4, 3) / Math.pow(0.6, 2));
        };

        const maxPerm = getPerm(0.5);

        // Draw grid
        ctx.strokeStyle = "rgba(255, 255, 255, 0.05)";
        ctx.lineWidth = 1;
        ctx.fillStyle = "rgba(255, 255, 255, 0.4)";
        ctx.font = "9px Outfit";

        for (let g = 0; g <= 3; g++) {
            // Y-lines
            const y = padY + graphH * (1 - g / 3);
            ctx.beginPath();
            ctx.moveTo(padX, y);
            ctx.lineTo(w - 15, y);
            ctx.stroke();
            ctx.fillText((maxPerm * (g / 3)).toFixed(1), 5, y + 3);

            // X-lines (0.3 to 0.5)
            const epsVal = 0.3 + g * (0.2 / 3);
            const x = padX + (g / 3) * graphW;
            ctx.beginPath();
            ctx.moveTo(x, padY);
            ctx.lineTo(x, h - padY);
            ctx.stroke();
            ctx.fillText(epsVal.toFixed(2), x - 8, h - 8);
        }

        // Axis
        ctx.strokeStyle = "rgba(255, 255, 255, 0.2)";
        ctx.beginPath();
        ctx.moveTo(padX, padY);
        ctx.lineTo(padX, h - padY);
        ctx.lineTo(w - 15, h - padY);
        ctx.stroke();

        // Title
        ctx.fillStyle = "#fff";
        ctx.fillText("κ(ε) vs. Porosity (Flow)", padX + 5, padY - 8);

        // Plot Kozeny-Carman curve (Green)
        ctx.strokeStyle = "#39d353";
        ctx.lineWidth = 2;
        ctx.beginPath();
        for (let i = 0; i <= 20; i++) {
            const eps = 0.3 + i * (0.2 / 20);
            const perm = getPerm(eps);
            const x = padX + (i / 20) * graphW;
            const y = padY + graphH * (1 - perm / maxPerm);
            if (i === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
        }
        ctx.stroke();

        // Draw current operating point dot
        const tamp = parseFloat(sliderTamping.value);
        const curEps = 0.48 - 0.005 * tamp;
        const curPerm = getPerm(curEps);

        const x_cur = padX + ((curEps - 0.3) / 0.2) * graphW;
        const y_cur = padY + graphH * (1 - curPerm / maxPerm);

        // Dotted indicator
        ctx.strokeStyle = "rgba(255, 255, 255, 0.3)";
        ctx.lineWidth = 1;
        ctx.setLineDash([3, 3]);
        ctx.beginPath();
        ctx.moveTo(x_cur, padY);
        ctx.lineTo(x_cur, h - padY);
        ctx.stroke();
        ctx.setLineDash([]); // reset

        // Draw active dot
        ctx.fillStyle = "#39d353";
        ctx.beginPath();
        ctx.arc(x_cur, y_cur, 5, 0, 2 * Math.PI);
        ctx.fill();
    }
});
