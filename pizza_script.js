// JavaScript simulation logic for Pizza Cooking & Preheating Optimization (Class 4)
document.addEventListener("DOMContentLoaded", () => {
    // UI Elements - Sliders & Inputs
    const sliderT0 = document.getElementById("param-t0");
    const valT0 = document.getElementById("val-t0");
    const sliderTTarget = document.getElementById("param-ttarget");
    const valTTarget = document.getElementById("val-ttarget");
    const sliderRecipeTime = document.getElementById("param-recipetime");
    const valRecipeTime = document.getElementById("val-recipetime");
    const sliderTau = document.getElementById("param-tau");
    const valTau = document.getElementById("val-tau");
    const sliderThickness = document.getElementById("param-thickness");
    const valThickness = document.getElementById("val-thickness");
    const sliderK = document.getElementById("param-k");
    const valK = document.getElementById("val-k");
    const sliderEa = document.getElementById("param-ea");
    const valEa = document.getElementById("val-ea");
    const sliderHConv = document.getElementById("param-hconv");
    const valHConv = document.getElementById("val-hconv");

    // Action Buttons
    const btnStart = document.getElementById("btn-start");
    const btnReset = document.getElementById("btn-reset");
    const sliderSpeed = document.getElementById("param-speed");
    const valSpeed = document.getElementById("val-speed");

    // Real-time Outputs / Stats
    const statTime = document.getElementById("stat-time");
    const statOvenTemp = document.getElementById("stat-oventemp");
    const statCenterTemp = document.getElementById("stat-centertemp");
    const statCenterDone = document.getElementById("stat-centerdone");
    const statMode = document.getElementById("stat-mode");

    // Results Dashboard Metrics
    const metricACook = document.getElementById("metric-a-cook");
    const metricAPreheat = document.getElementById("metric-a-preheat");
    const metricATotal = document.getElementById("metric-a-total");
    const metricBCook = document.getElementById("metric-b-cook");
    const metricBTotal = document.getElementById("metric-b-total");
    const metricSaved = document.getElementById("metric-saved");
    const metricPercent = document.getElementById("metric-percent");
    const metricAStress = document.getElementById("metric-a-stress");
    const metricBStress = document.getElementById("metric-b-stress");

    // Visualizer tabs & Canvas elements
    const viewButtons = document.querySelectorAll(".view-btn");
    const pizzaCanvas = document.getElementById("pizza-canvas");
    const tempCanvas = document.getElementById("temp-canvas");
    const doneCanvas = document.getElementById("done-canvas");
    const debugConsole = document.getElementById("debug-console");

    // Scale label elements
    const scaleMax = document.getElementById("scale-max");
    const scaleMin = document.getElementById("scale-min");
    const scaleBar = document.querySelector(".scale-bar");

    // Debug Logger
    function logDebug(message, source = "SYSTEM") {
        const timeStamp = new Date().toLocaleTimeString();
        debugConsole.innerHTML += `\n[${timeStamp}] [${source}] ${message}`;
        debugConsole.scrollTop = debugConsole.scrollHeight;
    }

    // Grid and Physics Constants
    const Nx = 20; // 1D grid points (half-thickness)
    const dt = 0.05; // Time step (seconds) for stability
    const Rg = 8.314; // Gas constant J/(mol*K)

    // Material properties
    const rho = 800.0; // Pizza density (kg/m3)
    const Cp_base = 2500.0; // Dry pizza specific heat capacity (J/(kg*K))
    const waterFraction = 0.40; // 40% water content
    const L_fusion = 334000.0; // Latent heat of fusion for water (J/kg)
    const L_fusion_eff = L_fusion * waterFraction; // Effective latent heat of pizza (J/kg)
    const T_melting = 273.15; // Melting temperature (0 C in Kelvin)
    const sigma_melting = 1.5; // Smoothing range for melting transition (K)

    // Simulation State Variables
    let isRunning = false;
    let animId = null;
    let simTime = 0.0;
    let activeField = "temp"; // temp, done
    let calibratedA0 = 1.0e5; // Calibrated pre-exponential factor (1/s)
    const Ea_burn = 80.0;     // Activation energy for burning/browning (kJ/mol)
    let calibratedA0_burn = 1.0e6; // Calibrated pre-exponential factor for burning (1/s)

    // Simulation Data Stores
    let dataA = []; // Array of time steps: {t, T_oven, T_center, T_surface, c_center, c_avg, T_profile, c_profile}
    let dataB = []; // Array of time steps: same structure
    let results = {
        preheatTimeA: 600, // 3 * tau (seconds)
        cookTimeA: 720,    // recipe time (seconds)
        totalTimeA: 1320,
        cookTimeB: 870,    // time to reach c = 0.99 in Cold-Start
        totalTimeB: 870,
        timeSaved: 450,
        percentSaved: 34.1,
        stressA: 0,
        stressB: 0
    };

    // Initialize UI values
    function updateUIValues() {
        valT0.textContent = sliderT0.value + " °C";
        valTTarget.textContent = sliderTTarget.value + " °C";
        valRecipeTime.textContent = sliderRecipeTime.value + " min";
        valTau.textContent = sliderTau.value + " s (" + (parseFloat(sliderTau.value)/60).toFixed(1) + " min)";
        valThickness.textContent = parseFloat(sliderThickness.value).toFixed(1) + " cm";
        valK.textContent = parseFloat(sliderK.value).toFixed(2) + " W/(m·K)";
        valEa.textContent = sliderEa.value + " kJ/mol";
        valHConv.textContent = sliderHConv.value + " W/(m²·K)";
        valSpeed.textContent = parseFloat(sliderSpeed.value).toFixed(1) + "x";
    }

    // Set up slider event listeners
    [sliderT0, sliderTTarget, sliderRecipeTime, sliderTau, sliderThickness, sliderK, sliderEa, sliderHConv, sliderSpeed].forEach(slider => {
        slider.addEventListener("input", () => {
            updateUIValues();
            if (!isRunning) {
                runModelPipeline();
            }
        });
    });

    // Toggle between fields
    viewButtons.forEach(btn => {
        btn.addEventListener("click", (e) => {
            viewButtons.forEach(b => b.classList.remove("active"));
            e.target.classList.add("active");
            activeField = e.target.getAttribute("data-field");
            
            let fieldName = "Temperature Profile";
            if (activeField === "done") fieldName = "Cooking Doneness";
            if (activeField === "burn") fieldName = "Crust Browning & Burn";
            logDebug(`Switched visualizer to: ${fieldName}`);
            
            // Adjust scale labels
            if (activeField === "temp") {
                scaleBar.className = "scale-bar scale-temp";
                scaleMax.textContent = sliderTTarget.value + "°C";
                scaleMin.textContent = sliderT0.value + "°C";
            } else if (activeField === "done") {
                scaleBar.className = "scale-bar scale-done";
                scaleMax.textContent = "Cooked (1.0)";
                scaleMin.textContent = "Raw (0.0)";
            } else {
                // Burn field scale
                scaleBar.className = "scale-bar scale-done";
                scaleMax.textContent = "Charred (100%)";
                scaleMin.textContent = "Raw (0%)";
            }
            drawPizzaCrossSection();
        });
    });

    // Tab buttons for mobile compatibility
    const mobileNavButtons = document.querySelectorAll(".mobile-nav-btn");
    const workspaceTabs = ["left-column", "center-column", "cup-plot-panel"];
    
    mobileNavButtons.forEach((btn, index) => {
        btn.addEventListener("click", () => {
            mobileNavButtons.forEach(b => b.classList.remove("active"));
            btn.classList.add("active");
            const tab = btn.getAttribute("data-tab");
            
            // Show corresponding column, hide others
            if (tab === "brew") {
                document.querySelector(".left-column").style.display = "flex";
                document.querySelector(".center-column").style.display = "none";
                document.querySelector(".cup-plot-panel").style.display = "none";
            } else if (tab === "fields" || tab === "theory") {
                document.querySelector(".left-column").style.display = "none";
                document.querySelector(".center-column").style.display = "flex";
                document.querySelector(".cup-plot-panel").style.display = "none";
            } else if (tab === "charts") {
                document.querySelector(".left-column").style.display = "none";
                document.querySelector(".center-column").style.display = "none";
                document.querySelector(".cup-plot-panel").style.display = "flex";
            }
        });
    });

    // 1D Finite Difference Solver for Heat Transfer & Reaction
    // Scenario A: constant T_oven = T_target
    // Scenario B: T_oven = T_room + (T_target - T_room)*(1 - exp(-t/tau))
    function runSimulationScenario(isColdStart, T_initial, T_target, tau, A0, Ea, A0_burn, Ea_burn, thickness, k, h_conv) {
        const H = (thickness / 100.0) / 2.0; // half-thickness (meters)
        const dx = H / (Nx - 1);
        const T0_K = T_initial + 273.15;
        const T_target_K = T_target + 273.15;
        const T_room_K = 20.0 + 273.15; // Room temperature 20C
        const Ea_J = Ea * 1000.0;
        const Ea_burn_J = Ea_burn * 1000.0;

        // Initialize fields
        let T = new Float32Array(Nx);
        let c = new Float32Array(Nx);
        let b = new Float32Array(Nx);
        for (let i = 0; i < Nx; i++) {
            T[i] = T0_K;
            c[i] = 0.0;
            b[i] = 0.0;
        }

        let history = [];
        let t_sec = 0.0;
        const totalSteps = 1500 / dt; // 1500 seconds (25 minutes)
        const recordInterval = Math.round(1.0 / dt); // Record history every 1 second

        for (let step = 0; step <= totalSteps; step++) {
            // 1. Compute Oven Temperature
            let T_oven;
            if (!isColdStart) {
                T_oven = T_target_K; // Preheated
            } else {
                T_oven = T_room_K + (T_target_K - T_room_K) * (1.0 - Math.exp(-t_sec / tau)); // Cold-start
            }

            // 2. Solve Heat Conduction explicitly
            let T_new = new Float32Array(Nx);
            
            // Loop through points
            for (let i = 0; i < Nx; i++) {
                // Compute local Cp with phase-change peak (latent heat of melting ice)
                // A Gaussian peak centered at 0 °C (273.15 K)
                const dT_melting = T[i] - T_melting;
                const Cp_phase = (L_fusion_eff / (sigma_melting * Math.sqrt(2 * Math.PI))) * 
                                 Math.exp(-(dT_melting * dT_melting) / (2 * sigma_melting * sigma_melting));
                const Cp = Cp_base + Cp_phase;
                const alpha_unclamped = k / (rho * Cp);
                
                // Explicit 1D diffusion Fourier stability limit: alpha * dt / dx^2 <= 0.5
                // We use a safe buffer of 0.48 to prevent numerical oscillations.
                const alpha_max = (0.48 * dx * dx) / dt;
                const alpha = Math.min(alpha_unclamped, alpha_max);

                if (i === 0) {
                    // Center Symmetry Boundary (dT/dx = 0)
                    // Discretization: T_new = T + dt * alpha * 2 * (T[1] - T[0]) / dx^2
                    T_new[0] = T[0] + dt * alpha * 2.0 * (T[1] - T[0]) / (dx * dx);
                } else if (i === Nx - 1) {
                    // Convective Outer Surface Boundary (k * dT/dx = h * (T_oven - T))
                    // Discretization based on boundary control volume (half-width dx/2)
                    // rho * Cp * (dx/2) * (dT/dt) = -k * (T[N-1] - T[N-2])/dx + h * (T_oven - T[N-1])
                    const heatFluxIn = h_conv * (T_oven - T[Nx - 1]);
                    const heatFluxOut = -k * (T[Nx - 1] - T[Nx - 2]) / dx;
                    const dT_boundary_raw = dt * (2.0 / (rho * Cp * dx)) * (heatFluxIn + heatFluxOut);
                    
                    // Clamp boundary update to prevent numerical oscillations/overshoots
                    const max_dT = 0.5 * Math.abs(T_oven - T[Nx - 1]);
                    const dT_boundary = Math.max(-max_dT, Math.min(max_dT, dT_boundary_raw));
                    T_new[Nx - 1] = T[Nx - 1] + dT_boundary;
                } else {
                    // Internal points
                    T_new[i] = T[i] + dt * alpha * (T[i + 1] - 2.0 * T[i] + T[i - 1]) / (dx * dx);
                }
            }

            // 3. Solve Doneness Kinetics
            let c_new = new Float32Array(Nx);
            for (let i = 0; i < Nx; i++) {
                const reactionRate = A0 * Math.exp(-Ea_J / (Rg * T[i])) * (1.0 - c[i]);
                c_new[i] = Math.min(1.0, c[i] + dt * reactionRate);
            }

            // 4. Solve Burn/Browning Kinetics
            let b_new = new Float32Array(Nx);
            for (let i = 0; i < Nx; i++) {
                const burnRate = A0_burn * Math.exp(-Ea_burn_J / (Rg * T[i])) * (1.0 - b[i]);
                b_new[i] = Math.min(1.0, b[i] + dt * burnRate);
            }

            // Update fields
            T.set(T_new);
            c.set(c_new);
            b.set(b_new);

            // Record step at intervals
            if (step % recordInterval === 0) {
                const centerT = T[0] - 273.15;
                const surfaceT = T[Nx - 1] - 273.15;
                const centerC = c[0];
                let c_sum = 0.0;
                for (let i = 0; i < Nx; i++) c_sum += c[i];
                const avgC = c_sum / Nx;

                // Clone profile arrays for visualization
                let T_prof = new Float32Array(Nx);
                let c_prof = new Float32Array(Nx);
                let b_prof = new Float32Array(Nx);
                for (let i = 0; i < Nx; i++) {
                    T_prof[i] = T[i] - 273.15;
                    c_prof[i] = c[i];
                    b_prof[i] = b[i];
                }

                history.push({
                    t: t_sec,
                    T_oven: T_oven - 273.15,
                    T_center: centerT,
                    T_surface: surfaceT,
                    c_center: centerC,
                    c_avg: avgC,
                    b_center: b[0],
                    b_surface: b[Nx - 1],
                    T_profile: T_prof,
                    c_profile: c_prof,
                    b_profile: b_prof
                });
            }

            t_sec += dt;
        }

        return history;
    }

    // Run the whole calibration, solve, and comparison pipeline
    function runModelPipeline() {
        const T0 = parseFloat(sliderT0.value);
        const TTarget = parseFloat(sliderTTarget.value);
        const recipeTimeMin = parseFloat(sliderRecipeTime.value);
        const recipeTimeSec = recipeTimeMin * 60.0;
        const tau = parseFloat(sliderTau.value);
        const thickness = parseFloat(sliderThickness.value);
        const k = parseFloat(sliderK.value);
        const Ea = parseFloat(sliderEa.value);
        const h_conv = parseFloat(sliderHConv.value);

        logDebug(`Initiating cooking simulation pipeline...`);
        logDebug(`Inputs: T_initial = ${T0}°C, T_target = ${TTarget}°C, Recipe = ${recipeTimeMin} min, Oven constant tau = ${tau} s.`);

        // --- STEP 1: CALIBRATION ---
        // Run trial simulation with A0 = 1.0, A0_burn = 1.0 to get temperature histories
        logDebug("Running heat transfer calibration study (Scenario A)...", "CALIBRATOR");
        const trialHistoryA = runSimulationScenario(false, T0, TTarget, tau, 1.0, Ea, 1.0, Ea_burn, thickness, k, h_conv);

        // Find the temperature history at the center and surface
        let integral = 0.0;
        let integral_burn = 0.0;
        const recipeStepIndexEnd = Math.round(recipeTimeSec);
        
        for (let i = 0; i < recipeStepIndexEnd; i++) {
            const T_center_K = trialHistoryA[i].T_center + 273.15;
            integral += Math.exp(-(Ea * 1000.0) / (Rg * T_center_K)) * 1.0; // 1.0 s interval

            const T_surface_K = trialHistoryA[i].T_surface + 273.15;
            integral_burn += Math.exp(-(Ea_burn * 1000.0) / (Rg * T_surface_K)) * 1.0;
        }

        // Calibrate A0 so that c_center reaches exactly 0.99 (99% cooked) at recipeTimeSec
        calibratedA0 = 4.60517018599 / integral;
        logDebug(`Calibrated pre-exponential factor A₀ = ${calibratedA0.toExponential(4)} s⁻¹`, "CALIBRATOR");

        // Calibrate A0_burn so that b_surface reaches exactly 0.15 (15% browned) at recipeTimeSec
        calibratedA0_burn = -Math.log(1.0 - 0.15) / integral_burn;
        logDebug(`Calibrated pre-exponential factor A₀_burn = ${calibratedA0_burn.toExponential(4)} s⁻¹`, "CALIBRATOR");

        // --- STEP 2: RUN SCENARIOS WITH CALIBRATED KINETICS ---
        logDebug("Simulating Scenario A (Preheated Oven)...", "SOLVER");
        dataA = runSimulationScenario(false, T0, TTarget, tau, calibratedA0, Ea, calibratedA0_burn, Ea_burn, thickness, k, h_conv);

        logDebug("Simulating Scenario B (Cold-Start Oven)...", "SOLVER");
        dataB = runSimulationScenario(true, T0, TTarget, tau, calibratedA0, Ea, calibratedA0_burn, Ea_burn, thickness, k, h_conv);

        // --- STEP 3: POST-PROCESS AND COMPARE ---
        results.preheatTimeA = Math.round(3.0 * tau); // 3*tau is preheat time to 95%
        results.cookTimeA = recipeTimeSec;
        results.totalTimeA = results.preheatTimeA + results.cookTimeA;

        // Find cook time in Scenario B (Cold start): when c_center crosses 0.99
        let cookTimeB = 1500;
        for (let i = 0; i < dataB.length; i++) {
            if (dataB[i].c_center >= 0.99) {
                cookTimeB = dataB[i].t;
                break;
            }
        }
        results.cookTimeB = cookTimeB;
        results.totalTimeB = cookTimeB; // placed in cold oven from t=0

        results.timeSaved = results.totalTimeA - results.totalTimeB;
        results.percentSaved = (results.timeSaved / results.totalTimeA) * 100.0;

        // Browning percentages at completion (StressA is Scenario A final surface, StressB is Scenario B final surface)
        const finalIdxA = Math.min(dataA.length - 1, recipeStepIndexEnd - 1);
        const finalIdxB = Math.min(dataB.length - 1, Math.round(cookTimeB));
        
        results.stressA = (dataA[finalIdxA].b_surface * 100.0).toFixed(1);
        results.stressB = (dataB[finalIdxB].b_surface * 100.0).toFixed(1);

        logDebug(`Simulation complete. Oven Runtime: Scenario A = ${(results.totalTimeA/60).toFixed(1)} min, Scenario B = ${(results.totalTimeB/60).toFixed(1)} min.`);
        logDebug(`Savings: ${results.percentSaved.toFixed(1)}% of total oven operation time saved!`);

        // Update static results display
        updateResultsDisplay();
        
        // Redraw static charts
        drawCharts();
        drawPizzaCrossSection();
    }

    // Update the dashboard results
    function updateResultsDisplay() {
        metricACook.textContent = (results.cookTimeA / 60.0).toFixed(1) + " min";
        metricAPreheat.textContent = (results.preheatTimeA / 60.0).toFixed(1) + " min";
        metricATotal.textContent = (results.totalTimeA / 60.0).toFixed(1) + " min";

        metricBCook.textContent = (results.cookTimeB / 60.0).toFixed(1) + " min";
        metricBTotal.textContent = (results.totalTimeB / 60.0).toFixed(1) + " min";

        metricSaved.textContent = (results.timeSaved / 60.0).toFixed(1) + " min";
        metricPercent.textContent = results.percentSaved.toFixed(1) + "%";

        metricAStress.textContent = results.stressA + "%";
        metricBStress.textContent = results.stressB + "%";

        // Highlight bad/good stress
        if (parseFloat(results.stressB) < parseFloat(results.stressA)) {
            metricBStress.className = "metric-value text-green";
            metricAStress.className = "metric-value text-orange";
        } else {
            metricBStress.className = "metric-value text-orange";
            metricAStress.className = "metric-value text-green";
        }
    }

    // Animation & Real-Time Loop
    let lastRenderTime = 0;
    function simulationLoop(timestamp) {
        if (!isRunning) return;

        // Advance simulation time based on speed slider
        const simSpeed = parseFloat(sliderSpeed.value); 
        simTime += simSpeed;

        const maxSimTime = 1500;
        if (simTime >= maxSimTime) {
            pauseSimulation();
            simTime = maxSimTime;
        }

        // Find data points matching current simulation time
        const idx = Math.min(dataA.length - 1, Math.floor(simTime));
        
        // Update stats readout
        statTime.textContent = (simTime / 60.0).toFixed(1) + " min (" + Math.round(simTime) + " s)";
        
        // Display Scenario B (Cold start) real-time state as primary visible run
        if (dataB[idx]) {
            statOvenTemp.textContent = dataB[idx].T_oven.toFixed(1) + " °C";
            statCenterTemp.textContent = dataB[idx].T_center.toFixed(1) + " °C";
            statCenterDone.textContent = (dataB[idx].c_center * 100.0).toFixed(1) + " %";

            if (dataB[idx].c_center < 0.05) {
                statMode.textContent = "Thawing (Frozen Core)";
                statMode.style.color = "var(--accent-blue)";
            } else if (dataB[idx].c_center < 0.99) {
                statMode.textContent = "Cooking In Progress";
                statMode.style.color = "var(--accent-orange)";
            } else {
                statMode.textContent = "Cooked & Ready! 🍕";
                statMode.style.color = "var(--accent-green)";
            }
        }

        // Draw live charts and pizza cross-section
        drawCharts(simTime);
        drawPizzaCrossSection(idx);

        animId = requestAnimationFrame(simulationLoop);
    }

    function startSimulation() {
        isRunning = true;
        btnStart.innerHTML = "⏸ Pause Sim";
        btnStart.className = "btn btn-primary";
        logDebug("Simulation animation started.", "UI");
        animId = requestAnimationFrame(simulationLoop);
    }

    function pauseSimulation() {
        isRunning = false;
        btnStart.innerHTML = "▶ Resume Sim";
        btnStart.className = "btn btn-primary";
        if (animId) {
            cancelAnimationFrame(animId);
        }
        logDebug("Simulation animation paused.", "UI");
    }

    function resetSimulation() {
        pauseSimulation();
        simTime = 0.0;
        btnStart.innerHTML = "▶ Start Sim";
        btnStart.className = "btn btn-primary";
        
        // Reset readout
        statTime.textContent = "0.0 min";
        statOvenTemp.textContent = "20.0 °C";
        statCenterTemp.textContent = sliderT0.value + " °C";
        statCenterDone.textContent = "0.0 %";
        statMode.textContent = "Idle";
        statMode.style.color = "var(--text-secondary)";

        // Recalculate and redraw static
        runModelPipeline();
        logDebug("Simulation state reset.", "UI");
    }

    btnStart.addEventListener("click", () => {
        if (!isRunning) {
            // If we are at the end, reset first
            if (simTime >= 1500) simTime = 0.0;
            startSimulation();
        } else {
            pauseSimulation();
        }
    });

    btnReset.addEventListener("click", resetSimulation);

    // --- CANVAS GRAPHICS DRAWING FUNCTIONS ---

    // Draw Pizza Slab Cross-Section
    function drawPizzaCrossSection(dataIndex = -1) {
        const ctx = pizzaCanvas.getContext("2d");
        const w = pizzaCanvas.width;
        const h = pizzaCanvas.height;

        ctx.clearRect(0, 0, w, h);

        // Retrieve current profiles
        let T_profile, c_profile, b_profile;
        if (dataIndex === -1) {
            // Draw initial or final based on time
            const idx = dataB.length - 1;
            T_profile = dataB[idx].T_profile;
            c_profile = dataB[idx].c_profile;
            b_profile = dataB[idx].b_profile;
        } else {
            T_profile = dataB[dataIndex].T_profile;
            c_profile = dataB[dataIndex].c_profile;
            b_profile = dataB[dataIndex].b_profile;
        }

        // Draw background
        ctx.fillStyle = "#161b22";
        ctx.fillRect(0, 0, w, h);

        // Center line (symmetry boundary)
        ctx.strokeStyle = "rgba(255,255,255,0.08)";
        ctx.setLineDash([5, 5]);
        ctx.beginPath();
        ctx.moveTo(w / 2, 0);
        ctx.moveTo(w / 2, h);
        ctx.stroke();
        ctx.setLineDash([]);

        // The Pizza Slab: drawn horizontally from center (left) to surface (right)
        // Since it's symmetric, we draw the full thickness by mirroring: 
        // left side: x from H to 0, right side: x from 0 to H
        const slabYStart = h * 0.15;
        const slabHeight = h * 0.7;
        const slabWidthHalf = w * 0.38;
        const centerX = w / 2;

        // Draw the pizza layers:
        // We divide the half-width into 4 structural regions:
        // Core/Dough (0.0 to 0.7 H)
        // Sauce (0.7 H to 0.85 H)
        // Cheese (0.85 H to 1.0 H)
        // (For simplicity, we draw the background structural colors first, then overlay the field values with opacity)
        
        // Draw structurally mirrored pizza layers
        function drawBaseLayer(xStartFrac, xEndFrac, fillStyle) {
            ctx.fillStyle = fillStyle;
            // Left mirror
            const xL_start = centerX - xEndFrac * slabWidthHalf;
            const xL_width = (xEndFrac - xStartFrac) * slabWidthHalf;
            ctx.fillRect(xL_start, slabYStart, xL_width, slabHeight);
            // Right mirror
            const xR_start = centerX + xStartFrac * slabWidthHalf;
            const xR_width = (xEndFrac - xStartFrac) * slabWidthHalf;
            ctx.fillRect(xR_start, slabYStart, xR_width, slabHeight);
        }

        // Structural base layers
        drawBaseLayer(0.0, 0.75, "#eae1d4"); // Crumb/Dough
        drawBaseLayer(0.75, 0.88, "#c92a2a"); // Tomato Sauce
        drawBaseLayer(0.88, 1.0, "#f9c631");  // Mozzarella Cheese
        
        // Draw bottom and top crust edges (outer edges)
        ctx.fillStyle = "#a06a30"; // Baked crust color
        ctx.fillRect(centerX - slabWidthHalf - 5, slabYStart - 4, 5, slabHeight + 8); // Top outer crust
        ctx.fillRect(centerX + slabWidthHalf, slabYStart - 4, 5, slabHeight + 8); // Bottom outer crust

        // Overlay the physical field (Temperature, Doneness, or Burn)
        // We draw small vertical strips matching the Nx grid points, mirrored
        const stepWidth = slabWidthHalf / (Nx - 1);
        const T0 = parseFloat(sliderT0.value);
        const TTarget = parseFloat(sliderTTarget.value);

        for (let i = 0; i < Nx - 1; i++) {
            const xStart = i * stepWidth;
            const xEnd = (i + 1) * stepWidth;
            
            // Average field values in this element
            const T_avg = (T_profile[i] + T_profile[i + 1]) / 2.0;
            const c_avg = (c_profile[i] + c_profile[i + 1]) / 2.0;
            const b_avg = (b_profile[i] + b_profile[i + 1]) / 2.0;

            let overlayColor;
            if (activeField === "temp") {
                // Temperature scale: blue (cold) -> purple -> red (hot)
                // Normalize T_avg between T0 and TTarget
                const normT = Math.min(1.0, Math.max(0.0, (T_avg - T0) / (TTarget - T0)));
                
                // Color mapping: 
                // Cold (normT = 0): rgba(0, 210, 255, 0.7) (Blue)
                // Mid (normT = 0.5): rgba(138, 43, 226, 0.7) (Purple)
                // Hot (normT = 1.0): rgba(255, 77, 77, 0.7) (Red)
                let r, g, b;
                if (normT < 0.5) {
                    const f = normT / 0.5;
                    r = Math.round(0 + f * 138);
                    g = Math.round(210 * (1 - f) + 43 * f);
                    b = Math.round(255 * (1 - f) + 226 * f);
                } else {
                    const f = (normT - 0.5) / 0.5;
                    r = Math.round(138 + f * (255 - 138));
                    g = Math.round(43 * (1 - f) + 77 * f);
                    b = Math.round(226 * (1 - f) + 77 * f);
                }
                overlayColor = `rgba(${r}, ${g}, ${b}, 0.65)`;
            } else if (activeField === "done") {
                // Doneness scale: translucent dark grey (raw) -> vibrant green (fully cooked)
                // c = 0: rgba(15, 23, 42, 0.75)
                // c = 1: rgba(57, 211, 83, 0.6)
                const r = Math.round(15 * (1 - c_avg) + 57 * c_avg);
                const g = Math.round(23 * (1 - c_avg) + 211 * c_avg);
                const b = Math.round(42 * (1 - c_avg) + 83 * c_avg);
                const alpha = 0.75 * (1 - c_avg) + 0.3 * c_avg;
                overlayColor = `rgba(${r}, ${g}, ${b}, ${alpha})`;
            } else {
                // Burn/Browning scale: transparent -> golden -> deep brown -> charred black
                if (b_avg < 0.15) {
                    const f = b_avg / 0.15;
                    overlayColor = `rgba(230, 126, 34, ${f * 0.45})`; // light gold browning
                } else if (b_avg < 0.40) {
                    const f = (b_avg - 0.15) / 0.25;
                    const r = Math.round(230 * (1 - f) + 93 * f);
                    const g = Math.round(126 * (1 - f) + 38 * f);
                    const b = Math.round(34 * (1 - f) + 19 * f);
                    const a = 0.45 + f * 0.35;
                    overlayColor = `rgba(${r}, ${g}, ${b}, ${a})`;
                } else {
                    const f = Math.min(1.0, (b_avg - 0.4) / 0.6);
                    const r = Math.round(93 * (1 - f) + 0 * f);
                    const g = Math.round(38 * (1 - f) + 0 * f);
                    const b = Math.round(19 * (1 - f) + 0 * f);
                    const a = 0.8 + f * 0.15;
                    overlayColor = `rgba(${r}, ${g}, ${b}, ${a})`;
                }
            }

            ctx.fillStyle = overlayColor;
            
            // Draw left mirror strip
            const xL_pos = centerX - xEnd;
            ctx.fillRect(xL_pos, slabYStart, stepWidth + 0.5, slabHeight);
            
            // Draw right mirror strip
            const xR_pos = centerX + xStart;
            ctx.fillRect(xR_pos, slabYStart, stepWidth + 0.5, slabHeight);
        }

        // Draw labels on pizza parts
        ctx.fillStyle = "#fff";
        ctx.font = "bold 10px 'Outfit', sans-serif";
        ctx.textAlign = "center";

        // Draw boundaries indicators
        ctx.fillStyle = "rgba(255,255,255,0.4)";
        ctx.fillText("CENTER LINE", centerX, slabYStart - 10);
        ctx.fillText("(SYMMETRY)", centerX, slabYStart - 22);

        ctx.fillStyle = "#ff9f43"; // accent-orange
        ctx.fillText("HEAT INFLOW", centerX - slabWidthHalf - 40, slabYStart + slabHeight/2);
        ctx.fillText("HEAT INFLOW", centerX + slabWidthHalf + 40, slabYStart + slabHeight/2);

        // Draw small horizontal arrows indicating heat conduction
        ctx.strokeStyle = "#ff9f43"; // accent-orange
        ctx.lineWidth = 2;
        
        function drawArrow(x, y, dx) {
            ctx.beginPath();
            ctx.moveTo(x, y);
            ctx.lineTo(x + dx, y);
            ctx.lineTo(x + dx - Math.sign(dx)*4, y - 4);
            ctx.moveTo(x + dx, y);
            ctx.lineTo(x + dx - Math.sign(dx)*4, y + 4);
            ctx.stroke();
        }

        drawArrow(centerX - slabWidthHalf - 15, slabYStart + slabHeight/2 + 15, 10);
        drawArrow(centerX + slabWidthHalf + 15, slabYStart + slabHeight/2 + 15, -10);

        ctx.lineWidth = 1;
    }

    // Draw Line Charts (Temperature and Doneness) on Canvas
    function drawCharts(currentSimTime = -1) {
        drawTemperatureChart(currentSimTime);
        drawDonenessChart(currentSimTime);
    }

    function drawTemperatureChart(currentSimTime) {
        const ctx = tempCanvas.getContext("2d");
        const w = tempCanvas.width;
        const h = tempCanvas.height;

        ctx.clearRect(0, 0, w, h);

        // Background
        ctx.fillStyle = "#111418";
        ctx.fillRect(0, 0, w, h);

        // Chart area bounds
        const padL = 40;
        const padR = 15;
        const padT = 20;
        const padB = 30;
        const cw = w - padL - padR;
        const ch = h - padT - padB;

        // Grid lines & Axes
        ctx.strokeStyle = "rgba(255,255,255,0.05)";
        ctx.lineWidth = 1;
        ctx.beginPath();
        // Horizontals (T-axis, 0 to 220C)
        const temps = [0, 50, 100, 150, 200];
        temps.forEach(temp => {
            const y = padT + ch * (1.0 - (temp - (-20)) / 240.0);
            ctx.moveTo(padL, y);
            ctx.lineTo(w - padR, y);
            ctx.fillStyle = "rgba(255,255,255,0.4)";
            ctx.font = "9px 'JetBrains Mono', monospace";
            ctx.textAlign = "right";
            ctx.fillText(temp + "°", padL - 6, y + 3);
        });
        // Verticals (t-axis, 0 to 25 min)
        const timesMin = [0, 5, 10, 15, 20, 25];
        timesMin.forEach(tMin => {
            const x = padL + cw * (tMin / 25.0);
            ctx.moveTo(x, padT);
            ctx.lineTo(x, h - padB);
            ctx.fillStyle = "rgba(255,255,255,0.4)";
            ctx.font = "9px 'JetBrains Mono', monospace";
            ctx.textAlign = "center";
            ctx.fillText(tMin + "m", x, h - padB + 13);
        });
        ctx.stroke();

        // Axis lines
        ctx.strokeStyle = "rgba(255,255,255,0.15)";
        ctx.beginPath();
        ctx.moveTo(padL, padT);
        ctx.lineTo(padL, h - padB);
        ctx.lineTo(w - padR, h - padB);
        ctx.stroke();

        // Chart Title
        ctx.fillStyle = "#fff";
        ctx.font = "bold 10px 'Outfit', sans-serif";
        ctx.textAlign = "left";
        ctx.fillText("TEMPERATURE PROFILE OVER TIME", padL, padT - 8);

        // Helper to convert time (s) and Temp (C) to chart coords
        function getCoords(t_sec, temp_C) {
            const x = padL + cw * ((t_sec / 60.0) / 25.0);
            const y = padT + ch * (1.0 - (temp_C - (-20.0)) / 240.0);
            return { x, y };
        }

        // Draw curves
        // Scenario A (Preheated) - Center Temperature (dashed or thin)
        // In Scenario A, baking starts after preheating (offset by results.preheatTimeA)
        ctx.strokeStyle = "rgba(255, 159, 67, 0.4)";
        ctx.lineWidth = 1.5;
        ctx.setLineDash([4, 4]);
        ctx.beginPath();
        dataA.forEach((step, idx) => {
            const t_total = results.preheatTimeA + step.t;
            if (t_total <= 1500) {
                const pt = getCoords(t_total, step.T_center);
                if (idx === 0) ctx.moveTo(pt.x, pt.y);
                else ctx.lineTo(pt.x, pt.y);
            }
        });
        ctx.stroke();
        ctx.setLineDash([]);

        // Scenario B (Cold Start) - Center Temperature (thick solid red)
        ctx.strokeStyle = "#ff4d4d"; // accent-red
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        const activeStepsCount = currentSimTime === -1 ? dataB.length : Math.min(dataB.length, Math.floor(currentSimTime));
        for (let i = 0; i < activeStepsCount; i++) {
            const step = dataB[i];
            const pt = getCoords(step.t, step.T_center);
            if (i === 0) ctx.moveTo(pt.x, pt.y);
            else ctx.lineTo(pt.x, pt.y);
        }
        ctx.stroke();

        // Scenario B (Cold Start) - Oven Temperature (solid blue)
        ctx.strokeStyle = "#00d2ff"; // accent-blue
        ctx.lineWidth = 2;
        ctx.beginPath();
        for (let i = 0; i < activeStepsCount; i++) {
            const step = dataB[i];
            const pt = getCoords(step.t, step.T_oven);
            if (i === 0) ctx.moveTo(pt.x, pt.y);
            else ctx.lineTo(pt.x, pt.y);
        }
        ctx.stroke();

        // Draw preheat vertical threshold for Scenario A
        const preheatPt = getCoords(results.preheatTimeA, 20);
        ctx.strokeStyle = "rgba(255, 255, 255, 0.15)";
        ctx.lineWidth = 1;
        ctx.setLineDash([2, 2]);
        ctx.beginPath();
        ctx.moveTo(preheatPt.x, padT);
        ctx.lineTo(preheatPt.x, h - padB);
        ctx.stroke();
        ctx.setLineDash([]);
        
        ctx.fillStyle = "rgba(255, 255, 255, 0.3)";
        ctx.font = "8px 'Outfit', sans-serif";
        ctx.textAlign = "center";
        ctx.fillText("Preheat Ends", preheatPt.x, padT + 12);

        // Legend
        ctx.textAlign = "right";
        ctx.font = "8px 'Outfit', sans-serif";
        
        ctx.fillStyle = "#00d2ff"; // accent-blue
        ctx.fillText("● Oven Temp (Cold)", w - padR - 5, padT + 5);
        
        ctx.fillStyle = "#ff4d4d"; // accent-red
        ctx.fillText("● Pizza Center (Cold)", w - padR - 5, padT + 15);
        
        ctx.fillStyle = "rgba(255, 159, 67, 0.7)";
        ctx.fillText("- - Pizza Center (Preheated)", w - padR - 5, padT + 25);
    }

    function drawDonenessChart(currentSimTime) {
        const ctx = doneCanvas.getContext("2d");
        const w = doneCanvas.width;
        const h = doneCanvas.height;

        ctx.clearRect(0, 0, w, h);

        // Background
        ctx.fillStyle = "#111418";
        ctx.fillRect(0, 0, w, h);

        // Chart area bounds
        const padL = 40;
        const padR = 15;
        const padT = 20;
        const padB = 30;
        const cw = w - padL - padR;
        const ch = h - padT - padB;

        // Grid lines & Axes
        ctx.strokeStyle = "rgba(255,255,255,0.05)";
        ctx.lineWidth = 1;
        ctx.beginPath();
        // Horizontals (c-axis, 0 to 100%)
        const yields = [0, 25, 50, 75, 100];
        yields.forEach(yld => {
            const y = padT + ch * (1.0 - yld / 100.0);
            ctx.moveTo(padL, y);
            ctx.lineTo(w - padR, y);
            ctx.fillStyle = "rgba(255,255,255,0.4)";
            ctx.font = "9px 'JetBrains Mono', monospace";
            ctx.textAlign = "right";
            ctx.fillText(yld + "%", padL - 6, y + 3);
        });
        // Verticals (t-axis, 0 to 25 min)
        const timesMin = [0, 5, 10, 15, 20, 25];
        timesMin.forEach(tMin => {
            const x = padL + cw * (tMin / 25.0);
            ctx.moveTo(x, padT);
            ctx.lineTo(x, h - padB);
            ctx.fillStyle = "rgba(255,255,255,0.4)";
            ctx.font = "9px 'JetBrains Mono', monospace";
            ctx.textAlign = "center";
            ctx.fillText(tMin + "m", x, h - padB + 13);
        });
        ctx.stroke();

        // Axis lines
        ctx.strokeStyle = "rgba(255,255,255,0.15)";
        ctx.beginPath();
        ctx.moveTo(padL, padT);
        ctx.lineTo(padL, h - padB);
        ctx.lineTo(w - padR, h - padB);
        ctx.stroke();

        // Chart Title
        ctx.fillStyle = "#fff";
        ctx.font = "bold 10px 'Outfit', sans-serif";
        ctx.textAlign = "left";
        ctx.fillText("CENTER COOKING DONENESS", padL, padT - 8);

        // Helper to convert time (s) and doneness (0-1) to chart coords
        function getCoords(t_sec, done_val) {
            const x = padL + cw * ((t_sec / 60.0) / 25.0);
            const y = padT + ch * (1.0 - done_val);
            return { x, y };
        }

        const activeStepsCount = currentSimTime === -1 ? dataB.length : Math.min(dataB.length, Math.floor(currentSimTime));

        // Draw curves
        // Scenario A (Preheated) - Center Doneness (dashed orange)
        ctx.strokeStyle = "rgba(255, 159, 67, 0.6)";
        ctx.lineWidth = 2;
        ctx.setLineDash([4, 4]);
        ctx.beginPath();
        
        // Find how much of Scenario A is currently active
        // Scenario A is offset by results.preheatTimeA
        const activeSimTimeA = currentSimTime === -1 ? 1500 : currentSimTime;
        dataA.forEach((step, idx) => {
            const t_total = results.preheatTimeA + step.t;
            if (t_total <= activeSimTimeA && t_total <= 1500) {
                const pt = getCoords(t_total, step.c_center);
                if (idx === 0) ctx.moveTo(pt.x, pt.y);
                else ctx.lineTo(pt.x, pt.y);
            }
        });
        ctx.stroke();
        ctx.setLineDash([]);

        // Scenario B (Cold Start) - Center Doneness (solid green)
        ctx.strokeStyle = "#39d353"; // accent-green
        ctx.lineWidth = 3;
        ctx.beginPath();
        for (let i = 0; i < activeStepsCount; i++) {
            const step = dataB[i];
            const pt = getCoords(step.t, step.c_center);
            if (i === 0) ctx.moveTo(pt.x, pt.y);
            else ctx.lineTo(pt.x, pt.y);
        }
        ctx.stroke();

        // Scenario A (Preheated) - Surface Browning (dotted orange)
        ctx.strokeStyle = "rgba(255, 159, 67, 0.7)";
        ctx.lineWidth = 1.5;
        ctx.setLineDash([1, 2]);
        ctx.beginPath();
        dataA.forEach((step, idx) => {
            const t_total = results.preheatTimeA + step.t;
            if (t_total <= activeSimTimeA && t_total <= 1500) {
                const pt = getCoords(t_total, step.b_surface);
                if (idx === 0) ctx.moveTo(pt.x, pt.y);
                else ctx.lineTo(pt.x, pt.y);
            }
        });
        ctx.stroke();
        ctx.setLineDash([]);

        // Scenario B (Cold Start) - Surface Browning (dotted green)
        ctx.strokeStyle = "rgba(57, 211, 83, 0.7)";
        ctx.lineWidth = 1.5;
        ctx.setLineDash([1, 2]);
        ctx.beginPath();
        for (let i = 0; i < activeStepsCount; i++) {
            const step = dataB[i];
            const pt = getCoords(step.t, step.b_surface);
            if (i === 0) ctx.moveTo(pt.x, pt.y);
            else ctx.lineTo(pt.x, pt.y);
        }
        ctx.stroke();
        ctx.setLineDash([]);

        // 99% Cooked Line indicator
        const targetY = getCoords(0, 0.99).y;
        ctx.strokeStyle = "rgba(57, 211, 83, 0.3)";
        ctx.lineWidth = 1;
        ctx.setLineDash([3, 3]);
        ctx.beginPath();
        ctx.moveTo(padL, targetY);
        ctx.lineTo(w - padR, targetY);
        ctx.stroke();
        ctx.setLineDash([]);

        // Legend
        ctx.textAlign = "right";
        ctx.font = "8px 'Outfit', sans-serif";
        
        ctx.fillStyle = "#39d353"; // accent-green
        ctx.fillText("● B Center Cooked", w - padR - 5, padT + 5);
        
        ctx.fillStyle = "rgba(255, 159, 67, 0.8)";
        ctx.fillText("- - A Center Cooked", w - padR - 5, padT + 15);

        ctx.fillStyle = "rgba(57, 211, 83, 0.8)";
        ctx.fillText("··· B Surface Browning", w - padR - 5, padT + 25);

        ctx.fillStyle = "rgba(255, 159, 67, 0.8)";
        ctx.fillText("··· A Surface Browning", w - padR - 5, padT + 35);
    }

    // Run initial compilation
    updateUIValues();
    runModelPipeline();
});
