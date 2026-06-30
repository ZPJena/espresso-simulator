// Strawberry Drying Simulator - TC I Lecture 5
// Discretization and Solver
const Nr = 15;
let dr = 0.01 / Nr; // starts at R=10mm

let V = new Float32Array(Nr);
let A = new Float32Array(Nr + 1);

function updateGeometry(R) {
    dr = R / Nr;
    const r_bound = new Float32Array(Nr + 1);
    for (let i = 0; i <= Nr; i++) {
        r_bound[i] = i * dr;
    }
    for (let i = 0; i < Nr; i++) {
        V[i] = (4.0 / 3.0) * Math.PI * (Math.pow(r_bound[i + 1], 3) - Math.pow(r_bound[i], 3));
    }
    for (let i = 0; i <= Nr; i++) {
        A[i] = 4.0 * Math.PI * Math.pow(r_bound[i], 2);
    }
}

// Solver
function runSimulationRun(T_air, RH_air, Kevap, Dbulk, R, maxTime, mode) {
    updateGeometry(R);

    const w = new Float32Array(Nr);
    const w0 = 0.90; // fresh water content
    for (let i = 0; i < Nr; i++) w[i] = w0;

    let T = 20.0; // initial temperature
    const rho_wet = 1000.0;
    const Cp = 4180.0;
    const H_evap = 2.26e6; // latent heat of water
    const rho_solid = 100.0; // 10% solid mass fraction

    const h_coeff = 5.0 + 1500.0 * Kevap;
    const w_eq = 0.05 + 0.35 * RH_air;

    const totalTime = maxTime * 3600; // seconds
    const Nt = 200;
    const dt_plot = totalTime / Nt;

    const history = {
        t: new Float32Array(Nt + 1),
        w_avg: new Float32Array(Nt + 1),
        w_profile: [],
        T: new Float32Array(Nt + 1),
        mass: new Float32Array(Nt + 1),
        rate: new Float32Array(Nt + 1),
        flux_bulk: [],
        N_evap: new Float32Array(Nt + 1),
        diffusivity: []
    };

    function getDiff(w_val) {
        if (mode === "constant") {
            return Dbulk;
        } else {
            const D_min = 1e-12;
            return Math.max(D_min, Dbulk * Math.pow(w_val / w0, 2));
        }
    }

    history.t[0] = 0;
    history.w_avg[0] = w0;
    history.w_profile.push(new Float32Array(w));
    history.T[0] = T;
    
    // Fresh mass in grams
    const fresh_mass = rho_wet * ((4.0 / 3.0) * Math.PI * Math.pow(R, 3)) * 1000;
    const solid_mass = fresh_mass * (1.0 - w0);
    history.mass[0] = fresh_mass;
    history.rate[0] = 0;

    const initial_diff = new Float32Array(Nr);
    for (let i = 0; i < Nr; i++) initial_diff[i] = getDiff(w[i]);
    history.diffusivity.push(initial_diff);

    const initial_flux = new Float32Array(Nr - 1);
    history.flux_bulk.push(initial_flux);
    history.N_evap[0] = 0;

    for (let step = 1; step <= Nt; step++) {
        let max_D = 0;
        const current_diffs = new Float32Array(Nr);
        for (let i = 0; i < Nr; i++) {
            current_diffs[i] = getDiff(w[i]);
            if (current_diffs[i] > max_D) max_D = current_diffs[i];
        }

        const dt_stable = 0.3 * (dr * dr) / (max_D + Kevap * dr);
        const n_sub = Math.ceil(dt_plot / dt_stable);
        const dt_sub = dt_plot / n_sub;

        for (let s = 0; s < n_sub; s++) {
            const D_half = new Float32Array(Nr - 1);
            for (let i = 0; i < Nr - 1; i++) {
                D_half[i] = (current_diffs[i] + current_diffs[i + 1]) / 2.0;
            }

            const J = new Float32Array(Nr - 1);
            for (let i = 0; i < Nr - 1; i++) {
                J[i] = D_half[i] * (w[i] - w[i + 1]) / dr;
            }

            const D_surf = getDiff(w[Nr - 1]);
            const Bi_half = (Kevap * dr) / (2.0 * D_surf);
            const N_evap = Math.max(0.0, (Kevap * rho_solid * (w[Nr - 1] - w_eq)) / (1.0 + Bi_half));

            const w_new = new Float32Array(w);
            w_new[0] = w[0] - dt_sub * A[1] * J[0] / V[0];
            for (let i = 1; i < Nr - 1; i++) {
                w_new[i] = w[i] - dt_sub * (A[i + 1] * J[i] - A[i] * J[i - 1]) / V[i];
            }
            w_new[Nr - 1] = w[Nr - 1] - dt_sub * (A[Nr] * N_evap / rho_solid - A[Nr - 1] * J[Nr - 2]) / V[Nr - 1];

            for (let i = 0; i < Nr; i++) {
                w[i] = Math.max(w_eq, Math.min(w0, w_new[i]));
            }

            const T_rate = (3.0 / (rho_wet * Cp * R)) * (h_coeff * (T_air - T) - H_evap * N_evap);
            T = T + dt_sub * T_rate;
            T = Math.max(20.0, Math.min(T_air, T));
        }

        history.t[step] = (step * dt_plot) / 3600;

        let sum_wV = 0;
        let sum_V = 0;
        for (let i = 0; i < Nr; i++) {
            sum_wV += w[i] * V[i];
            sum_V += V[i];
        }
        const w_avg = sum_wV / sum_V;
        history.w_avg[step] = w_avg;
        history.w_profile.push(new Float32Array(w));
        history.T[step] = T;

        const current_mass = solid_mass / (1.0 - w_avg);
        history.mass[step] = current_mass;

        const mass_loss_rate = (history.mass[step - 1] - current_mass) / (dt_plot / 3600);
        history.rate[step] = Math.max(0.0, mass_loss_rate);

        const current_diffs_recorded = new Float32Array(Nr);
        for (let i = 0; i < Nr; i++) current_diffs_recorded[i] = getDiff(w[i]);
        history.diffusivity.push(current_diffs_recorded);

        const final_D_half = new Float32Array(Nr - 1);
        for (let i = 0; i < Nr - 1; i++) {
            final_D_half[i] = (current_diffs_recorded[i] + current_diffs_recorded[i + 1]) / 2.0;
        }
        const final_J = new Float32Array(Nr - 1);
        for (let i = 0; i < Nr - 1; i++) {
            final_J[i] = final_D_half[i] * (w[i] - w[i + 1]) / dr;
        }
        history.flux_bulk.push(final_J);

        const final_D_surf = getDiff(w[Nr - 1]);
        const final_Bi_half = (Kevap * dr) / (2.0 * final_D_surf);
        const final_N_evap = Math.max(0.0, (Kevap * rho_solid * (w[Nr - 1] - w_eq)) / (1.0 + final_Bi_half));
        history.N_evap[step] = final_N_evap;
    }

    // smooth rate curves step 0
    history.rate[0] = history.rate[1];
    return history;
}

// DOM Setup & UI Bindings (Protected for QJSEngine environment)
let sliderTair, sliderRhair, sliderKevap, sliderDbulk, sliderRadius, sliderTime, selectMode;
let valTair, valRhair, valKevap, valDbulk, valRadius, valTime;
let btnStart, btnReset, selectTask, taskDesc, btnShowExperiment, btnRevealHidden;
let statTime, statMoisture, statMass, statRate, statStatus;
let lockedOverlay, visControls, viewButtons, strawberryCanvas, ctxStrawberry, playbackTime, valPlayback, btnPlay;
let canvasMoisture, ctxMoisture, canvasRate, ctxRate;
let reflectionCard, reflectionBefore, reflectionAfter, btnSaveReflection, reflectionFeedback;
let debugConsole;

// Prediction & Stats Overlay DOM elements
let predictionModeView, reflectionModeView, predictionText, btnSubmitPrediction;
let displayUserGuess, displayUserReasoning, btnShowStats, btnEditPrediction;
let statsModal, statsYourGuess, statsChart, statsTakeaway, btnCloseStats, btnCloseStatsOk;
let btnClearWorkbook;
let workbookSummaryTable, btnExportWorkbook, btnCopyWorkbook;

let currentHistory = null;
let currentPlaybackStep = 0;
let isPlaying = false;
let playAnimId = null;
let activeField = "moisture";
let activeChallenge = "task0";
let comparativeData = null;

const taskData = {
    task0: {
        desc: "Task 0 — Reference case: Run the reference case once. Record mass loss, drying rate, and final moisture. Then inspect all hidden fields. The mass-loss curve gives the observable result; hidden fields explain how it was produced.",
        setup: () => {
            sliderTair.value = 60;
            sliderRhair.value = 0.20;
            sliderKevap.value = -3.7; // 2e-4
            sliderDbulk.value = -9.7; // 2e-10
            sliderRadius.value = 10;
            sliderTime.value = 3;
            selectMode.value = "constant";
            unlockSliders();
        }
    },
    task1: {
        desc: "Task 1 — Drying Case A: D_bulk = 1e-8 m²/s, K_evap = 5e-8 m/s. Without hidden fields, what would you change? Run the simulation, reveal hidden fields, and identify where the physical transport bottleneck lies.",
        setup: () => {
            sliderTair.value = 60;
            sliderRhair.value = 0.20;
            sliderKevap.value = -7.3; // 5e-8, very low
            sliderDbulk.value = -8.0; // 1e-8, high
            sliderRadius.value = 10;
            sliderTime.value = 3;
            selectMode.value = "constant";
            
            unlockSliders();
        }
    },
    task2: {
        desc: "Task 2 — Drying Case B: D_bulk = 2e-11 m²/s, K_evap = 2e-3 m/s. Should we blow harder air to speed up drying? Run simulation, inspect hidden fields, and identify where the physical transport bottleneck lies.",
        setup: () => {
            sliderTair.value = 60;
            sliderRhair.value = 0.20;
            sliderKevap.value = -2.7; // 2e-3 (high)
            sliderDbulk.value = -10.7; // 2e-11 (low)
            sliderRadius.value = 10;
            sliderTime.value = 3;
            selectMode.value = "constant";
            
            unlockSliders();
        }
    },
    task3: {
        desc: "Task 3 — Drying Case C (Air Speed Study): D_bulk is locked to 2e-11 m²/s. We compare K_evap of 2e-4, 2e-3, and 2e-2 m/s. The charts plot all three cases. Observe whether blowing harder air helps speed up drying in the long run and identify the bottleneck.",
        setup: () => {
            sliderTair.value = 60;
            sliderRhair.value = 0.20;
            sliderKevap.value = -3.7; 
            sliderDbulk.value = -10.7; // 2e-11 (low)
            sliderRadius.value = 10;
            sliderTime.value = 3;
            selectMode.value = "constant";
            
            unlockSliders();
        }
    },
    task4: {
        desc: "Task 4 — Drying Case D (Size Study): Compare R = 15mm, 10mm, and 5mm under the case D_bulk = 2e-11 m²/s, K_evap = 2e-3 m/s. The charts plot all three cases. Observe how diffusion distance shapes the curves and identify the bottleneck.",
        setup: () => {
            sliderTair.value = 60;
            sliderRhair.value = 0.20;
            sliderKevap.value = -2.7; // 2e-3
            sliderDbulk.value = -10.7; // 2e-11
            sliderRadius.value = 10;
            sliderTime.value = 3;
            selectMode.value = "constant";
            
            unlockSliders();
        }
    },
    task5: {
        desc: "Task 5 — Drying Case E (Diffusivity Mode Study): Compare Constant diffusivity vs. Moisture-dependent diffusivity. The charts plot both cases. Notice how a dry surface shapes the drying rate, and identify the resulting transport limit.",
        setup: () => {
            sliderTair.value = 60;
            sliderRhair.value = 0.20;
            sliderKevap.value = -3.7; // 2e-4
            sliderDbulk.value = -9.7; // 2e-10
            sliderRadius.value = 10;
            sliderTime.value = 3;
            selectMode.value = "dependent";
            
            unlockSliders();
        }
    }
};

function lockSlider(element) {
    if (element) {
        element.disabled = true;
        element.closest(".control-group")?.classList.add("locked");
    }
}

function unlockSliders() {
    const list = [sliderTair, sliderRhair, sliderKevap, sliderDbulk, sliderRadius, sliderTime, selectMode];
    list.forEach(el => {
        if (el) {
            el.disabled = false;
            el.closest(".control-group")?.classList.remove("locked");
        }
    });
}

function initializeSimulator() {
    // Bind DOM
    sliderTair = document.getElementById("param-tair");
    sliderRhair = document.getElementById("param-rhair");
    sliderKevap = document.getElementById("param-kevap");
    sliderDbulk = document.getElementById("param-dbulk");
    sliderRadius = document.getElementById("param-radius");
    sliderTime = document.getElementById("param-time");
    selectMode = document.getElementById("param-mode");
    
    valTair = document.getElementById("val-tair");
    valRhair = document.getElementById("val-rhair");
    valKevap = document.getElementById("val-kevap");
    valDbulk = document.getElementById("val-dbulk");
    valRadius = document.getElementById("val-radius");
    valTime = document.getElementById("val-time");

    btnStart = document.getElementById("btn-start");
    btnReset = document.getElementById("btn-reset");
    selectTask = document.getElementById("select-task");
    taskDesc = document.getElementById("task-desc");
    btnShowExperiment = document.getElementById("btn-show-experiment");
    btnRevealHidden = document.getElementById("btn-reveal-hidden");

    statTime = document.getElementById("stat-time");
    statMoisture = document.getElementById("stat-moisture");
    statMass = document.getElementById("stat-mass");
    statRate = document.getElementById("stat-rate");
    statStatus = document.getElementById("stat-status");

    lockedOverlay = document.getElementById("locked-overlay");
    visControls = document.getElementById("vis-controls");
    viewButtons = document.querySelectorAll(".view-btn");
    strawberryCanvas = document.getElementById("strawberry-canvas");
    if (strawberryCanvas) ctxStrawberry = strawberryCanvas.getContext("2d");
    playbackTime = document.getElementById("playback-time");
    valPlayback = document.getElementById("val-playback");
    btnPlay = document.getElementById("btn-play");

    canvasMoisture = document.getElementById("canvas-chart-moisture");
    if (canvasMoisture) ctxMoisture = canvasMoisture.getContext("2d");
    canvasRate = document.getElementById("canvas-chart-rate");
    if (canvasRate) ctxRate = canvasRate.getContext("2d");

    reflectionCard = document.getElementById("reflection-card");
    reflectionBefore = document.getElementById("reflection-before");
    reflectionAfter = document.getElementById("reflection-after");
    btnSaveReflection = document.getElementById("btn-save-reflection");
    reflectionFeedback = document.getElementById("reflection-feedback");
    
    debugConsole = document.getElementById("debug-console");

    // Bind Prediction & Stats Overlay DOM elements
    predictionModeView = document.getElementById("prediction-mode-view");
    reflectionModeView = document.getElementById("reflection-mode-view");
    predictionText = document.getElementById("prediction-text");
    btnSubmitPrediction = document.getElementById("btn-submit-prediction");
    
    displayUserGuess = document.getElementById("display-user-guess");
    displayUserReasoning = document.getElementById("display-user-reasoning");
    btnShowStats = document.getElementById("btn-show-stats");
    btnEditPrediction = document.getElementById("btn-edit-prediction");
    
    statsModal = document.getElementById("stats-modal");
    statsYourGuess = document.getElementById("stats-your-guess");
    statsChart = document.getElementById("stats-chart");
    statsTakeaway = document.getElementById("stats-takeaway");
    btnCloseStats = document.getElementById("btn-close-stats");
    btnCloseStatsOk = document.getElementById("btn-close-stats-ok");
    btnClearWorkbook = document.getElementById("btn-clear-workbook");
    workbookSummaryTable = document.getElementById("workbook-summary-table");
    btnExportWorkbook = document.getElementById("btn-export-workbook");
    btnCopyWorkbook = document.getElementById("btn-copy-workbook");

    // Sliders Event Handlers
    const addSliderListener = (slider, valElement, unit, scaleFn = (x) => x) => {
        if (!slider) return;
        slider.addEventListener("input", () => {
            const rawVal = parseFloat(slider.value);
            const displayVal = scaleFn(rawVal);
            if (valElement) {
                if (typeof displayVal === "number" && displayVal < 1e-3) {
                    valElement.textContent = displayVal.toExponential(1) + " " + unit;
                } else {
                    valElement.textContent = displayVal.toFixed(displayVal < 0.1 ? 2 : 1) + " " + unit;
                }
            }
            // Auto re-run simulation on drag for instant updates
            calculateAndRefresh();
        });
    };

    addSliderListener(sliderTair, valTair, "°C");
    addSliderListener(sliderRhair, valRhair, "");
    addSliderListener(sliderKevap, valKevap, "m/s", (x) => Math.pow(10, x));
    addSliderListener(sliderDbulk, valDbulk, "m²/s", (x) => Math.pow(10, x));
    addSliderListener(sliderRadius, valRadius, "mm");
    addSliderListener(sliderTime, valTime, "h");

    if (selectMode) {
        selectMode.addEventListener("change", () => {
            calculateAndRefresh();
        });
    }

    // Task Selection Event
    if (selectTask) {
        selectTask.addEventListener("change", () => {
            activeChallenge = selectTask.value;
            const task = taskData[activeChallenge];
            if (task) {
                task.setup();
                taskDesc.textContent = task.desc;
                
                // Reset hidden fields to locked mode only if prediction has not been submitted
                const isSubmitted = checkTaskPredictionSubmitted();
                setHiddenFieldsLock(!isSubmitted);
                
                // Trigger sliders update to sync display values
                const list = [sliderTair, sliderRhair, sliderKevap, sliderDbulk, sliderRadius, sliderTime];
                list.forEach(el => el && el.dispatchEvent(new Event("input")));
                
                loadReflection();
                logDebug(`Loaded task: ${selectTask.options[selectTask.selectedIndex].text}`);
            }
        });
    }

    // Toggle Hidden/Experiment Views
    if (btnShowExperiment) {
        btnShowExperiment.addEventListener("click", () => {
            setHiddenFieldsLock(true);
        });
    }
    if (btnRevealHidden) {
        btnRevealHidden.addEventListener("click", () => {
            if (!checkTaskPredictionSubmitted()) {
                alert("Please make a bottleneck prediction and submit it in the Reflection Log first to unlock the hidden fields!");
                if (reflectionCard) {
                    reflectionCard.style.transform = "scale(1.03)";
                    setTimeout(() => reflectionCard.style.transform = "none", 300);
                }
                return;
            }
            setHiddenFieldsLock(false);
        });
    }

    // View Selectors
    viewButtons.forEach(btn => {
        btn.addEventListener("click", () => {
            viewButtons.forEach(b => b.classList.remove("active"));
            btn.classList.add("active");
            activeField = btn.getAttribute("data-field");
            updateScaleLegend(activeField);
            renderPlaybackState();
        });
    });

    // Playback Timeline
    if (playbackTime) {
        playbackTime.addEventListener("input", () => {
            currentPlaybackStep = parseInt(playbackTime.value);
            renderPlaybackState();
        });
    }

    // Play/Pause button
    if (btnPlay) {
        btnPlay.addEventListener("click", () => {
            if (isPlaying) {
                pausePlayback();
            } else {
                startPlayback();
            }
        });
    }

    // Run Sim manually
    if (btnStart) {
        btnStart.addEventListener("click", () => {
            calculateAndRefresh();
            pausePlayback();
            currentPlaybackStep = 0;
            startPlayback();
            logDebug("Simulation run started with live playback animation.");
        });
    }

    // Reset Sim
    if (btnReset) {
        btnReset.addEventListener("click", () => {
            const task = taskData[activeChallenge];
            if (task) {
                task.setup();
            }
            const list = [sliderTair, sliderRhair, sliderKevap, sliderDbulk, sliderRadius, sliderTime];
            list.forEach(el => el && el.dispatchEvent(new Event("input")));
            setHiddenFieldsLock(true);
            logDebug("Reset parameters to default values.");
        });
    }

    // Edit guess / prediction
    if (btnEditPrediction) {
        btnEditPrediction.addEventListener("click", () => {
            const rawPrediction = localStorage.getItem(`tc1_drying_prediction_${activeChallenge}`);
            if (rawPrediction) {
                try {
                    const data = JSON.parse(rawPrediction);
                    data.submitted = false;
                    localStorage.setItem(`tc1_drying_prediction_${activeChallenge}`, JSON.stringify(data));
                } catch(e){}
            }
            loadReflection();
            setHiddenFieldsLock(true);
            updateWorkbookSummary();
        });
    }

    // Submit prediction
    if (btnSubmitPrediction) {
        btnSubmitPrediction.addEventListener("click", () => {
            submitPrediction();
        });
    }

    // Show stats modal
    if (btnShowStats) {
        btnShowStats.addEventListener("click", () => {
            showStats();
        });
    }

    // Close stats modal
    if (btnCloseStats) {
        btnCloseStats.addEventListener("click", () => {
            hideStats();
        });
    }
    if (btnCloseStatsOk) {
        btnCloseStatsOk.addEventListener("click", () => {
            hideStats();
        });
    }

    // Close modal on clicking backdrop
    if (statsModal) {
        statsModal.addEventListener("click", (e) => {
            if (e.target === statsModal) hideStats();
        });
    }

    // Reset workbook progress button
    if (btnClearWorkbook) {
        btnClearWorkbook.addEventListener("click", () => {
            if (confirm("Are you sure you want to clear all your saved predictions, reflections, and progress for all tasks? This cannot be undone.")) {
                // Clear localStorage entries for drying simulator
                const keysToRemove = [];
                for (let i = 0; i < localStorage.length; i++) {
                    const key = localStorage.key(i);
                    if (key && (key.startsWith("tc1_drying_prediction_") || key.startsWith("tc1_drying_reflection_") || key.startsWith("tc1_drying_workbook_"))) {
                        keysToRemove.push(key);
                    }
                }
                keysToRemove.forEach(key => localStorage.removeItem(key));
                
                // Reset active challenge to task0
                activeChallenge = "task0";
                if (selectTask) selectTask.value = "task0";
                
                const task = taskData["task0"];
                if (task) {
                    task.setup();
                    taskDesc.textContent = task.desc;
                }
                
                // Sync sliders display
                const list = [sliderTair, sliderRhair, sliderKevap, sliderDbulk, sliderRadius, sliderTime];
                list.forEach(el => el && el.dispatchEvent(new Event("input")));
                
                loadReflection();
                setHiddenFieldsLock(!checkTaskPredictionSubmitted());
                calculateAndRefresh();
                updateWorkbookSummary();
                
                logDebug("Workbook cleared. All student progress has been reset.");
                alert("Workbook cleared. All progress has been reset!");
            }
        });
    }

    // Export workbook markdown button
    if (btnExportWorkbook) {
        btnExportWorkbook.addEventListener("click", () => {
            exportWorkbookMarkdown();
        });
    }

    // Copy workbook markdown button
    if (btnCopyWorkbook) {
        btnCopyWorkbook.addEventListener("click", () => {
            copyWorkbookMarkdown();
        });
    }

    // Initial setup
    if (taskData.task0) {
        taskData.task0.setup();
        if (sliderTair) {
            const list = [sliderTair, sliderRhair, sliderKevap, sliderDbulk, sliderRadius, sliderTime];
            list.forEach(el => el && el.dispatchEvent(new Event("input")));
        }
    }
    
    // Set lock depending on whether prediction is submitted
    setHiddenFieldsLock(!checkTaskPredictionSubmitted());
    loadReflection();
    updateWorkbookSummary();
    calculateAndRefresh();
}

function setHiddenFieldsLock(locked) {
    if (locked) {
        if (lockedOverlay) lockedOverlay.style.display = "flex";
        if (btnShowExperiment) btnShowExperiment.classList.add("active");
        if (btnRevealHidden) btnRevealHidden.classList.remove("active");
    } else {
        if (lockedOverlay) lockedOverlay.style.display = "none";
        if (btnShowExperiment) btnShowExperiment.classList.remove("active");
        if (btnRevealHidden) btnRevealHidden.classList.add("active");
    }
}

function logDebug(msg) {
    if (debugConsole) {
        debugConsole.textContent = `[SYSTEM] ${msg}\n` + debugConsole.textContent.split('\n').slice(0, 5).join('\n');
    }
}

function getMoistureColor(w_val) {
    const f = (w_val - 0.05) / (0.90 - 0.05); // extend range to equilibrium w_eq ~ 0.05
    const t = Math.max(0, Math.min(1, f));
    // Dry: pale dry seed beige (r=200, g=170, b=120)
    // Wet: deep fresh water blue (r=0, g=150, b=255)
    const r = Math.round(200 * (1 - t) + 0 * t);
    const g = Math.round(170 * (1 - t) + 150 * t);
    const b = Math.round(120 * (1 - t) + 255 * t);
    return `rgb(${r}, ${g}, ${b})`;
}

function getTempColor(T_val) {
    const f = (T_val - 20) / (90 - 20);
    const t = Math.max(0, Math.min(1, f));
    // 20°C: cool grey-blue (r=50, g=65, b=90)
    // 90°C: hot crimson red (r=255, g=50, b=50)
    const r = Math.round(50 * (1 - t) + 255 * t);
    const g = Math.round(65 * (1 - t) + 50 * t);
    const b = Math.round(90 * (1 - t) + 50 * t);
    return `rgb(${r}, ${g}, ${b})`;
}

function getDiffusivityColor(D_val) {
    const logD = Math.log10(D_val);
    const f = (logD - (-12)) / (-8 - (-12));
    const t = Math.max(0, Math.min(1, f));
    // Slow (10^-12): dark purple-grey (r=55, g=45, b=65)
    // Fast (10^-8): neon lime green (r=57, g=211, b=83)
    const r = Math.round(55 * (1 - t) + 57 * t);
    const g = Math.round(45 * (1 - t) + 211 * t);
    const b = Math.round(65 * (1 - t) + 83 * t);
    return `rgb(${r}, ${g}, ${b})`;
}

function updateScaleLegend(fieldType) {
    const scaleMax = document.getElementById("scale-max");
    const scaleMin = document.getElementById("scale-min");
    const scaleGradient = document.getElementById("scale-gradient");
    if (!scaleMax || !scaleMin || !scaleGradient) return;

    if (fieldType === "moisture") {
        scaleMax.textContent = "90%";
        scaleMin.textContent = "15%";
        scaleGradient.style.background = "linear-gradient(to top, rgb(200, 170, 120), rgb(100, 160, 187), rgb(0, 150, 255))";
    } else if (fieldType === "temp") {
        scaleMax.textContent = "90°C";
        scaleMin.textContent = "20°C";
        scaleGradient.style.background = "linear-gradient(to top, rgb(50, 65, 90), rgb(152, 57, 70), rgb(255, 50, 50))";
    } else if (fieldType === "diffusivity") {
        scaleMax.textContent = "10⁻⁸";
        scaleMin.textContent = "10⁻¹²";
        scaleGradient.style.background = "linear-gradient(to top, rgb(55, 45, 65), rgb(56, 128, 74), rgb(57, 211, 83))";
    } else {
        // fluxes are overlaid on moisture
        scaleMax.textContent = "90%";
        scaleMin.textContent = "15%";
        scaleGradient.style.background = "linear-gradient(to top, rgb(200, 170, 120), rgb(100, 160, 187), rgb(0, 150, 255))";
    }
}

function calculateAndRefresh() {
    if (!sliderTair) return; // check binding

    const T_air = parseFloat(sliderTair.value);
    const RH_air = parseFloat(sliderRhair.value);
    const Kevap = Math.pow(10, parseFloat(sliderKevap.value));
    const Dbulk = Math.pow(10, parseFloat(sliderDbulk.value));
    const R = parseFloat(sliderRadius.value) / 1000.0;
    const maxTime = parseFloat(sliderTime.value);
    const mode = selectMode.value;

    // Run active simulation
    currentHistory = runSimulationRun(T_air, RH_air, Kevap, Dbulk, R, maxTime, mode);

    // Calculate comparative dataset if under tasks 3, 4, 5
    comparativeData = null;
    if (activeChallenge === "task3") {
        // compare K_evap: 2e-4, 2e-3, 2e-2
        const c1 = runSimulationRun(T_air, RH_air, 2e-4, Dbulk, R, maxTime, mode);
        const c2 = runSimulationRun(T_air, RH_air, 2e-3, Dbulk, R, maxTime, mode);
        const c3 = runSimulationRun(T_air, RH_air, 2e-2, Dbulk, R, maxTime, mode);
        comparativeData = {
            moisture: {
                curves: [
                    { x: c1.t, y: c1.w_avg, color: "rgba(139, 148, 158, 0.4)", dashed: true, label: "K_evap = 2e-4" },
                    { x: c2.t, y: c2.w_avg, color: "rgba(255, 159, 67, 0.5)", dashed: true, label: "2e-3" },
                    { x: c3.t, y: c3.w_avg, color: "rgba(57, 211, 83, 0.5)", dashed: true, label: "2e-2" }
                ]
            },
            rate: {
                curves: [
                    { x: c1.t, y: c1.rate, color: "rgba(139, 148, 158, 0.4)", dashed: true, label: "2e-4" },
                    { x: c2.t, y: c2.rate, color: "rgba(255, 159, 67, 0.5)", dashed: true, label: "2e-3" },
                    { x: c3.t, y: c3.rate, color: "rgba(57, 211, 83, 0.5)", dashed: true, label: "2e-2" }
                ]
            }
        };
    } else if (activeChallenge === "task4") {
        // Compare R: 15mm, 10mm, 5mm
        const c1 = runSimulationRun(T_air, RH_air, Kevap, Dbulk, 0.015, maxTime, mode);
        const c2 = runSimulationRun(T_air, RH_air, Kevap, Dbulk, 0.010, maxTime, mode);
        const c3 = runSimulationRun(T_air, RH_air, Kevap, Dbulk, 0.005, maxTime, mode);
        comparativeData = {
            moisture: {
                curves: [
                    { x: c1.t, y: c1.w_avg, color: "rgba(255, 77, 77, 0.5)", dashed: true, label: "R = 15 mm" },
                    { x: c2.t, y: c2.w_avg, color: "rgba(255, 159, 67, 0.5)", dashed: true, label: "10 mm" },
                    { x: c3.t, y: c3.w_avg, color: "rgba(57, 211, 83, 0.5)", dashed: true, label: "5 mm" }
                ]
            },
            rate: {
                curves: [
                    { x: c1.t, y: c1.rate, color: "rgba(255, 77, 77, 0.5)", dashed: true, label: "15 mm" },
                    { x: c2.t, y: c2.rate, color: "rgba(255, 159, 67, 0.5)", dashed: true, label: "10 mm" },
                    { x: c3.t, y: c3.rate, color: "rgba(57, 211, 83, 0.5)", dashed: true, label: "5 mm" }
                ]
            }
        };
    } else if (activeChallenge === "task5") {
        // compare Constant vs Moisture-dependent (Crust)
        const c1 = runSimulationRun(T_air, RH_air, Kevap, Dbulk, R, maxTime, "constant");
        const c2 = runSimulationRun(T_air, RH_air, Kevap, Dbulk, R, maxTime, "dependent");
        comparativeData = {
            moisture: {
                curves: [
                    { x: c1.t, y: c1.w_avg, color: "rgba(0, 210, 255, 0.5)", dashed: true, label: "Constant" },
                    { x: c2.t, y: c2.w_avg, color: "rgba(255, 159, 67, 0.5)", dashed: true, label: "Crust (Dep.)" }
                ]
            },
            rate: {
                curves: [
                    { x: c1.t, y: c1.rate, color: "rgba(0, 210, 255, 0.5)", dashed: true, label: "Constant" },
                    { x: c2.t, y: c2.rate, color: "rgba(255, 159, 67, 0.5)", dashed: true, label: "Crust" }
                ]
            }
        };
    }

    // Set timeline max to 200 (since we have 200 intervals)
    if (playbackTime) {
        playbackTime.max = 200;
        // Keep scrubber at current position or reset to end
        if (currentPlaybackStep > 200) currentPlaybackStep = 200;
    }

    renderPlaybackState();
}

function renderPlaybackState() {
    if (!currentHistory) return;
    
    const idx = currentPlaybackStep;
    const timeHr = currentHistory.t[idx];
    const wAvg = currentHistory.w_avg[idx];
    const massG = currentHistory.mass[idx];
    const rateG = currentHistory.rate[idx];
    const wProfile = currentHistory.w_profile[idx];
    const TProfile = currentHistory.T[idx];
    const diffProfile = currentHistory.diffusivity[idx];
    const JProfile = currentHistory.flux_bulk[idx];
    const N_evap_val = currentHistory.N_evap[idx];

    // Update Readouts
    if (statTime) statTime.textContent = timeHr.toFixed(1) + " h";
    if (statMoisture) statMoisture.textContent = (wAvg * 100).toFixed(1) + " %";
    if (statMass) statMass.textContent = massG.toFixed(2) + " g";
    if (statRate) statRate.textContent = rateG.toFixed(2) + " g/h";

    if (valPlayback) valPlayback.textContent = timeHr.toFixed(1) + " h";
    if (playbackTime) playbackTime.value = idx;

    // Update Status Badge
    // surface cell index is Nr-1
    const surfMoisture = wProfile[Nr - 1];
    const centerMoisture = wProfile[0];

    if (surfMoisture >= 0.70) {
        statStatus.textContent = "Surface Wet";
        statStatus.className = "status-badge state-wet";
    } else if (centerMoisture >= 0.50) {
        statStatus.textContent = "Dry Shell, Wet Core";
        statStatus.className = "status-badge state-crust";
    } else {
        statStatus.textContent = "Mostly Dry";
        statStatus.className = "status-badge state-dry";
    }

    // Draw fields on Canvas
    if (ctxStrawberry) {
        drawStrawberry(wProfile, TProfile, diffProfile, JProfile, N_evap_val, activeField);
    }

    // Draw Charts
    if (ctxMoisture && ctxRate) {
        drawCharts(currentHistory, timeHr, comparativeData);
    }
}

function drawStrawberry(w_profile, T_profile, diff_profile, J_profile, N_evap_val, fieldType) {
    const cx = strawberryCanvas.width / 2;
    const cy = strawberryCanvas.height / 2 - 10;
    const R_px = 85;

    ctxStrawberry.clearRect(0, 0, strawberryCanvas.width, strawberryCanvas.height);

    // Draw Concentric Shells from outside-in
    for (let i = Nr - 1; i >= 0; i--) {
        const r_frac = (i + 1) / Nr;
        const r_shell = R_px * r_frac;

        ctxStrawberry.beginPath();
        for (let theta = 0; theta <= 2 * Math.PI + 0.05; theta += 0.05) {
            const shape_factor = 1.0 - 0.12 * Math.sin(theta);
            const px = cx + r_shell * shape_factor * Math.cos(theta);
            const py = cy + r_shell * shape_factor * Math.sin(theta) * 1.1; // strawberry profile taper
            if (theta === 0) ctxStrawberry.moveTo(px, py);
            else ctxStrawberry.lineTo(px, py);
        }
        ctxStrawberry.closePath();

        let color = "#000";
        if (fieldType === "moisture") {
            color = getMoistureColor(w_profile[i]);
        } else if (fieldType === "temp") {
            const local_T = T_profile - (parseFloat(sliderTair?.value || 60) - T_profile) * 0.1 * (1.0 - Math.pow(r_frac, 2));
            color = getTempColor(local_T);
        } else if (fieldType === "diffusivity") {
            color = getDiffusivityColor(diff_profile[i]);
        } else {
            // For flux overlays, draw moisture field in background
            color = getMoistureColor(w_profile[i]);
        }

        ctxStrawberry.fillStyle = color;
        ctxStrawberry.fill();
        ctxStrawberry.strokeStyle = "rgba(255, 255, 255, 0.015)";
        ctxStrawberry.lineWidth = 1;
        ctxStrawberry.stroke();
    }

    // Draw little strawberry seeds on top for rich visual details!
    ctxStrawberry.fillStyle = "rgba(255, 255, 255, 0.3)";
    const seed_shells = [Math.floor(Nr * 0.4), Math.floor(Nr * 0.7), Math.floor(Nr * 0.9)];
    seed_shells.forEach(shell_idx => {
        const r_frac = shell_idx / Nr;
        const num_seeds = Math.round(shell_idx * 1.8);
        for (let j = 0; j < num_seeds; j++) {
            const theta = (j / num_seeds) * 2 * Math.PI + shell_idx * 0.5;
            const shape_factor = 1.0 - 0.12 * Math.sin(theta);
            const r_seed = R_px * r_frac * shape_factor;
            const px = cx + r_seed * Math.cos(theta);
            const py = cy + r_seed * Math.sin(theta) * 1.1;
            
            ctxStrawberry.beginPath();
            ctxStrawberry.arc(px, py, 1.2, 0, 2*Math.PI);
            ctxStrawberry.fill();
        }
    });

    // Draw overlays
    if (fieldType === "bulkflux") {
        drawFluxVectors(J_profile);
    } else if (fieldType === "evapflux") {
        drawEvaporationFlux(N_evap_val);
    }
}

function drawArrow(x1, y1, x2, y2, size = 5) {
    ctxStrawberry.beginPath();
    ctxStrawberry.moveTo(x1, y1);
    ctxStrawberry.lineTo(x2, y2);
    ctxStrawberry.stroke();

    const angle = Math.atan2(y2 - y1, x2 - x1);
    ctxStrawberry.beginPath();
    ctxStrawberry.moveTo(x2, y2);
    ctxStrawberry.lineTo(x2 - size * Math.cos(angle - Math.PI / 6), y2 - size * Math.sin(angle - Math.PI / 6));
    ctxStrawberry.lineTo(x2 - size * Math.cos(angle + Math.PI / 6), y2 - size * Math.sin(angle + Math.PI / 6));
    ctxStrawberry.closePath();
    ctxStrawberry.fillStyle = ctxStrawberry.strokeStyle;
    ctxStrawberry.fill();
}

function drawFluxVectors(J_profile) {
    ctxStrawberry.strokeStyle = "rgba(0, 210, 255, 0.9)";
    ctxStrawberry.lineWidth = 1.8;

    const cx = strawberryCanvas.width / 2;
    const cy = strawberryCanvas.height / 2 - 10;
    const R_px = 85;

    const angles = [0, Math.PI / 4, Math.PI / 2, 3 * Math.PI / 4, Math.PI, 5 * Math.PI / 4, 3 * Math.PI / 2, 7 * Math.PI / 4];
    const shells = [Math.floor(Nr * 0.25), Math.floor(Nr * 0.5), Math.floor(Nr * 0.75)];

    shells.forEach(shell_idx => {
        const r_frac = (shell_idx + 0.5) / Nr;
        const flux = J_profile[shell_idx] || 0.0;
        
        // Scale vector size: J max around 1e-6 to 1e-4
        const arrow_len = Math.min(16, flux * 1e11 * 14.0);
        if (arrow_len < 1.5) return;

        angles.forEach(theta => {
            const shape_factor = 1.0 - 0.12 * Math.sin(theta);
            const r_start = R_px * r_frac * shape_factor;
            const x1 = cx + r_start * Math.cos(theta);
            const y1 = cy + r_start * Math.sin(theta) * 1.1;

            const x2 = cx + (r_start + arrow_len) * Math.cos(theta);
            const y2 = cy + (r_start + arrow_len) * Math.sin(theta) * 1.1;

            drawArrow(x1, y1, x2, y2, arrow_len * 0.4);
        });
    });
}

function drawEvaporationFlux(N_evap_val) {
    ctxStrawberry.strokeStyle = "rgba(255, 107, 129, 0.9)";
    ctxStrawberry.lineWidth = 2.2;

    const cx = strawberryCanvas.width / 2;
    const cy = strawberryCanvas.height / 2 - 10;
    const R_px = 85;

    const num_arrows = 12;
    // N_evap typically range 1e-4 to 1e-2
    const arrow_len = Math.min(22, N_evap_val * 1e3 * 0.6);
    if (arrow_len < 1.0) return;

    for (let i = 0; i < num_arrows; i++) {
        const theta = (i / num_arrows) * 2 * Math.PI;
        const shape_factor = 1.0 - 0.12 * Math.sin(theta);
        const r_start = R_px * shape_factor;

        const x1 = cx + r_start * Math.cos(theta);
        const y1 = cy + r_start * Math.sin(theta) * 1.1;

        const x2 = cx + (r_start + arrow_len) * Math.cos(theta);
        const y2 = cy + (r_start + arrow_len) * Math.sin(theta) * 1.1;

        drawArrow(x1, y1, x2, y2, arrow_len * 0.35);
    }
}

function drawCharts(history, currentTime, compData) {
    // Slice arrays up to current playback step for live progressive curves
    const slice_len = currentPlaybackStep + 1;
    const t_sliced = history.t.subarray ? history.t.subarray(0, slice_len) : history.t.slice(0, slice_len);
    const w_sliced = history.w_avg.subarray ? history.w_avg.subarray(0, slice_len) : history.w_avg.slice(0, slice_len);
    const rate_sliced = history.rate.subarray ? history.rate.subarray(0, slice_len) : history.rate.slice(0, slice_len);

    drawChartInstance(canvasMoisture, ctxMoisture, t_sliced, w_sliced, currentTime, "%", 0.0, 1.0, "Moisture", "#00d2ff", compData ? compData.moisture : null);
    
    const maxRate = Math.max(...history.rate, 0.1); // Keep max rate fixed based on full history to avoid jittering
    drawChartInstance(canvasRate, ctxRate, t_sliced, rate_sliced, currentTime, "g/h", 0.0, maxRate * 1.1, "Rate", "#ff9f43", compData ? compData.rate : null);
}

function drawChartInstance(canvas, ctx, xData, yData, currentTime, yUnit, yMin, yMax, title, mainColor, compData) {
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const w = canvas.width;
    const h = canvas.height;
    const padding = { top: 15, right: 15, bottom: 25, left: 42 };
    const chartW = w - padding.left - padding.right;
    const chartH = h - padding.top - padding.bottom;

    // axes
    ctx.strokeStyle = "rgba(255, 255, 255, 0.15)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(padding.left, padding.top);
    ctx.lineTo(padding.left, h - padding.bottom);
    ctx.lineTo(w - padding.right, h - padding.bottom);
    ctx.stroke();

    const xMax = currentHistory ? currentHistory.t[currentHistory.t.length - 1] : 6.0;
    function getX(x) {
        return padding.left + (x / xMax) * chartW;
    }
    function getY(y) {
        const val = (y - yMin) / (yMax - yMin);
        return h - padding.bottom - val * chartH;
    }

    // Playback timeline indicator line
    const curX = getX(currentTime);
    if (curX >= padding.left && curX <= w - padding.right) {
        ctx.strokeStyle = "rgba(255, 107, 129, 0.4)";
        ctx.lineWidth = 1.5;
        ctx.setLineDash([4, 4]);
        ctx.beginPath();
        ctx.moveTo(curX, padding.top);
        ctx.lineTo(curX, h - padding.bottom);
        ctx.stroke();
        ctx.setLineDash([]);
    }

    // Grid lines
    ctx.strokeStyle = "rgba(255, 255, 255, 0.03)";
    ctx.lineWidth = 1;
    const numYticks = 4;
    for (let i = 0; i <= numYticks; i++) {
        const yVal = yMin + (i / numYticks) * (yMax - yMin);
        const yPos = getY(yVal);
        ctx.beginPath();
        ctx.moveTo(padding.left, yPos);
        ctx.lineTo(w - padding.right, yPos);
        ctx.stroke();

        ctx.fillStyle = "#8b949e";
        ctx.font = "8px monospace";
        ctx.textAlign = "right";
        const displayVal = (yUnit === "%") ? Math.round(yVal * 100) : yVal.toFixed(2);
        ctx.fillText(displayVal + " " + yUnit, padding.left - 4, yPos + 3);
    }

    const numXticks = 4;
    for (let i = 0; i <= numXticks; i++) {
        const xVal = (i / numXticks) * xMax;
        const xPos = getX(xVal);
        ctx.fillStyle = "#8b949e";
        ctx.font = "8px monospace";
        ctx.textAlign = "center";
        ctx.fillText(xVal.toFixed(1) + "h", xPos, h - padding.bottom + 12);
    }

    // Comparative Curves
    if (compData && compData.curves) {
        compData.curves.forEach(curve => {
            ctx.strokeStyle = curve.color;
            ctx.lineWidth = 1.5;
            ctx.setLineDash(curve.dashed ? [3, 3] : []);
            ctx.beginPath();
            for (let i = 0; i < curve.x.length; i++) {
                const px = getX(curve.x[i]);
                const py = getY(curve.y[i]);
                if (i === 0) ctx.moveTo(px, py);
                else ctx.lineTo(px, py);
            }
            ctx.stroke();
            ctx.setLineDash([]);

            if (curve.label && curve.x.length > 0) {
                ctx.fillStyle = curve.color;
                ctx.font = "7px Outfit, sans-serif";
                ctx.textAlign = "left";
                const lastIdx = curve.x.length - 1;
                ctx.fillText(curve.label, getX(curve.x[lastIdx]) - 55, getY(curve.y[lastIdx]) - 4);
            }
        });
    }

    // Main active curve
    ctx.strokeStyle = mainColor;
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    for (let i = 0; i < xData.length; i++) {
        const px = getX(xData[i]);
        const py = getY(yData[i]);
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
    }
    ctx.stroke();

    // Fill below active curve
    ctx.fillStyle = mainColor + "1a";
    ctx.beginPath();
    ctx.moveTo(padding.left, h - padding.bottom);
    for (let i = 0; i < xData.length; i++) {
        ctx.lineTo(getX(xData[i]), getY(yData[i]));
    }
    ctx.lineTo(getX(xData[xData.length - 1]), h - padding.bottom);
    ctx.closePath();
    ctx.fill();
}

// Playback Animation Loop
function startPlayback() {
    isPlaying = true;
    if (btnPlay) {
        btnPlay.textContent = "⏸ Pause";
        btnPlay.classList.add("playing");
    }
    
    // If we are at the end, wrap to start
    if (currentPlaybackStep >= 200) currentPlaybackStep = 0;
    
    animatePlay();
}

function pausePlayback() {
    isPlaying = false;
    if (btnPlay) {
        btnPlay.textContent = "▶ Play";
        btnPlay.classList.remove("playing");
    }
    if (playAnimId) {
        cancelAnimationFrame(playAnimId);
        playAnimId = null;
    }
}

function animatePlay() {
    if (!isPlaying) return;
    
    currentPlaybackStep += 1;
    if (currentPlaybackStep > 200) {
        currentPlaybackStep = 200;
        pausePlayback();
    }
    
    renderPlaybackState();
    
    if (isPlaying) {
        playAnimId = requestAnimationFrame(animatePlay);
    }
}

// Stats data representing past semesters class statistics for FSU Jena Technical Chemistry students
const statsData = {
    task0: {
        distribution: { surface: 25, bulk: 45, both: 20, unclear: 10 },
        takeaway: "In the reference case (Task 0), the mass transfer Biot number is in the transition regime ($Bi_m \\approx 1.0$), meaning both boundary evaporation resistance and internal diffusion resistance are of similar magnitude."
    },
    task1: {
        distribution: { surface: 18, bulk: 72, both: 6, unclear: 4 },
        takeaway: "<strong>Pedagogical Insight:</strong> Over 70% of students naively guess that drying is 'bulk-diffusion limited' because the mass loss is slow. However, the simulation's moisture profiles are completely flat, showing that diffusion inside is fast. The bottleneck is the air-side boundary layer ($Bi_m = 0.05$). Blowing air harder (increasing $K_{\\text{evap}}$) is the only way to accelerate drying!"
    },
    task2: {
        distribution: { surface: 78, bulk: 12, both: 7, unclear: 3 },
        takeaway: "<strong>Pedagogical Insight:</strong> Nearly 80% of students guess that drying is surface-limited and suggest blowing harder air. But the hidden fields show that a dry crust forms immediately at the boundary ($Bi_m = 10^6$), sealing the core. Pumping more air does not help; we must cut the strawberry smaller (reduce $R$) or heat the bulk (increase $D_{\\text{bulk}}$)."
    },
    task3: {
        distribution: { surface: 65, bulk: 22, both: 10, unclear: 3 },
        takeaway: "<strong>Pedagogical Insight:</strong> Most students suggest increasing fan speed, but the statistics show that the drying rate curve is locked in the long run. In bulk-limited drying, blowing harder yields diminishing returns because internal transport is the physical bottleneck."
    },
    task4: {
        distribution: { surface: 45, bulk: 40, both: 10, unclear: 5 },
        takeaway: "<strong>Pedagogical Insight:</strong> Dividing the characteristic length $R$ reduces diffusion time by $R^2$ (quadratically). Cutting the radius in half speeds up drying by 4x, making this the most effective engineering solution for bulk-limited scenarios."
    },
    task5: {
        distribution: { surface: 55, bulk: 25, both: 15, unclear: 5 },
        takeaway: "<strong>Pedagogical Insight:</strong> Moisture-dependent diffusion creates a crust that seals the strawberry, trapping moisture in the core. Stepwise temperature control or gentle initial drying prevents this shell formation."
    }
};

function checkTaskPredictionSubmitted() {
    if (activeChallenge === "task0") return true; // Task 0 is always open
    const raw = localStorage.getItem(`tc1_drying_prediction_${activeChallenge}`);
    if (raw) {
        try {
            const data = JSON.parse(raw);
            return !!data.submitted;
        } catch (e) {
            return false;
        }
    }
    return false;
}

function submitPrediction() {
    const selectedRadio = document.querySelector('input[name="guess-bottleneck"]:checked');
    if (!selectedRadio) {
        alert("Please select a bottleneck guess first!");
        return;
    }
    
    const guess = selectedRadio.value;
    const reasoning = predictionText?.value || "";
    
    const data = {
        guess: guess,
        reasoning: reasoning,
        submitted: true
    };
    
    localStorage.setItem(`tc1_drying_prediction_${activeChallenge}`, JSON.stringify(data));
    logDebug(`Prediction submitted for task ${activeChallenge}: ${guess}`);
    
    // Smooth transition
    loadReflection();
    
    // Unlock hidden fields controls
    setHiddenFieldsLock(false);
    
    // Refresh the summary checklist
    updateWorkbookSummary();
}

// Persisted Reflections workbook storage
function saveReflection() {
    const val = reflectionAfter?.value || "";
    localStorage.setItem(`tc1_drying_reflection_${activeChallenge}`, val);
    
    if (reflectionFeedback) {
        reflectionFeedback.style.display = "block";
        setTimeout(() => {
            reflectionFeedback.style.display = "none";
        }, 2000);
    }
    logDebug(`Saved final reflection for task: ${activeChallenge}.`);
    
    // Refresh the summary checklist
    updateWorkbookSummary();
}

function loadReflection() {
    const isSubmitted = checkTaskPredictionSubmitted();
    
    // If it's Task 0, prediction mode is hidden and reflection mode is open by default
    if (activeChallenge === "task0") {
        if (predictionModeView) predictionModeView.style.display = "none";
        if (reflectionModeView) reflectionModeView.style.display = "block";
        
        // Hide user prediction display for Task 0 as there is no prediction required
        const displayBox = document.querySelector(".user-prediction-display");
        if (displayBox) displayBox.style.display = "none";
        
        // Load the saved reflection
        const rawReflection = localStorage.getItem(`tc1_drying_reflection_${activeChallenge}`);
        if (reflectionAfter) reflectionAfter.value = rawReflection || "";
        return;
    }
    
    if (isSubmitted) {
        // Show reflection mode
        if (predictionModeView) predictionModeView.style.display = "none";
        if (reflectionModeView) reflectionModeView.style.display = "block";
        
        // Show user prediction display
        const displayBox = document.querySelector(".user-prediction-display");
        if (displayBox) displayBox.style.display = "block";
        
        // Load prediction data
        const rawPrediction = localStorage.getItem(`tc1_drying_prediction_${activeChallenge}`);
        let guess = "";
        let reasoning = "";
        if (rawPrediction) {
            try {
                const data = JSON.parse(rawPrediction);
                guess = data.guess;
                reasoning = data.reasoning;
            } catch (e) {}
        }
        
        const labelMap = {
            surface: "Surface (air-side)",
            bulk: "Bulk (internal diffusion)",
            both: "Both",
            unclear: "Unclear"
        };
        
        if (displayUserGuess) displayUserGuess.textContent = labelMap[guess] || guess;
        if (displayUserReasoning) displayUserReasoning.textContent = reasoning || "None provided";
        
        // Load the saved reflection
        const rawReflection = localStorage.getItem(`tc1_drying_reflection_${activeChallenge}`);
        if (reflectionAfter) reflectionAfter.value = rawReflection || "";
    } else {
        // Show prediction mode
        if (predictionModeView) predictionModeView.style.display = "block";
        if (reflectionModeView) reflectionModeView.style.display = "none";
        
        // Reset prediction inputs
        if (predictionText) predictionText.value = "";
        const radios = document.getElementsByName("guess-bottleneck");
        radios.forEach(r => r.checked = false);
    }
}

function showStats() {
    if (statsModal) {
        statsModal.style.display = "flex";
        
        // Get student's guess
        const rawPrediction = localStorage.getItem(`tc1_drying_prediction_${activeChallenge}`);
        let guessStr = "Not predicted";
        if (rawPrediction) {
            try {
                const data = JSON.parse(rawPrediction);
                const labelMap = {
                    surface: "Surface (air-side)",
                    bulk: "Bulk (internal diffusion)",
                    both: "Both",
                    unclear: "Unclear"
                };
                guessStr = labelMap[data.guess] || data.guess;
            } catch (e) {}
        }
        
        if (statsYourGuess) statsYourGuess.textContent = guessStr;
        renderStatsChart(activeChallenge);
        
        // Re-trigger MathJax to format equations in the takeaway text
        if (window.MathJax && window.MathJax.typeset) {
            window.MathJax.typeset();
        }
    }
}

function hideStats() {
    if (statsModal) {
        statsModal.style.display = "none";
    }
}

function renderStatsChart(taskName) {
    const data = statsData[taskName];
    if (!data || !statsChart) return;
    
    const labelMap = {
        surface: "Surface (air-side)",
        bulk: "Bulk (internal diffusion)",
        both: "Both",
        unclear: "Unclear"
    };
    
    let html = "";
    Object.keys(data.distribution).forEach(key => {
        const percent = data.distribution[key];
        const label = labelMap[key];
        html += `
            <div class="stats-bar-row">
                <div class="stats-bar-header">
                    <span>${label}</span>
                    <span>${percent}%</span>
                </div>
                <div class="stats-bar-outer">
                    <div class="stats-bar-inner ${key}" style="width: ${percent}%;"></div>
                </div>
            </div>
        `;
    });
    statsChart.innerHTML = html;
    
    if (statsTakeaway) {
        statsTakeaway.innerHTML = data.takeaway;
    }
}

// DOM load entry point
if (typeof document !== "undefined") {
    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", initializeSimulator);
    } else {
        initializeSimulator();
    }
}

// Setup Mobile Drawer Menu and Responsive Layout Optimization
function setupMobileMenu() {
    // 1. Inject Menu Toggle Button and Backdrop
    const header = typeof document !== "undefined" && document.querySelectorAll ? document.querySelectorAll(".app-header")[0] : null;
    const sidebar = typeof document !== "undefined" && document.querySelectorAll ? document.querySelectorAll(".sidebar")[0] : null;
    
    if (header && sidebar && document.createElement) {
        // Create mobile toggle button
        const toggleBtn = document.createElement("button");
        toggleBtn.className = "mobile-nav-toggle glass-card";
        toggleBtn.innerHTML = '<span class="toggle-icon">🔬</span> Simulators';
        
        // Find logo area to place toggle button
        const logoArea = header.querySelector ? header.querySelector(".logo-area") : null;
        if (logoArea && logoArea.appendChild) {
            logoArea.appendChild(toggleBtn);
        } else if (header.appendChild) {
            header.appendChild(toggleBtn);
        }
        
        // Create backdrop overlay
        const backdrop = document.createElement("div");
        backdrop.className = "nav-backdrop";
        if (document.body && document.body.appendChild) {
            document.body.appendChild(backdrop);
        }
        
        // Toggle action
        toggleBtn.addEventListener("click", (e) => {
            if (e.stopPropagation) e.stopPropagation();
            if (document.body && document.body.classList) {
                document.body.classList.toggle("nav-open");
            }
        });
        
        // Close on click outside (backdrop)
        backdrop.addEventListener("click", () => {
            if (document.body && document.body.classList) {
                document.body.classList.remove("nav-open");
            }
        });
        
        // Close drawer when a navigation button is clicked
        const navBtns = sidebar.querySelectorAll ? sidebar.querySelectorAll("a, button") : [];
        navBtns.forEach(btn => {
            btn.addEventListener("click", () => {
                if (document.body && document.body.classList) {
                    document.body.classList.remove("nav-open");
                }
            });
        });
    }
    
    // 2. Inject Responsive Stylesheet
    if (typeof document !== "undefined" && document.createElement) {
        const style = document.createElement("style");
        style.innerHTML = `
            /* Mobile Toggle Button */
            .mobile-nav-toggle {
                display: none;
                align-items: center;
                gap: 0.5rem;
                background: rgba(255, 255, 255, 0.04) !important;
                border: 1px solid rgba(255, 255, 255, 0.08) !important;
                color: #fff !important;
                padding: 0.4rem 0.8rem !important;
                border-radius: 8px !important;
                font-size: 0.8rem !important;
                font-weight: 600 !important;
                cursor: pointer !important;
                transition: all 0.2s ease !important;
                margin-left: 1rem;
                box-shadow: 0 4px 12px rgba(0, 0, 0, 0.2) !important;
            }
            .mobile-nav-toggle:hover {
                background: rgba(255, 255, 255, 0.1) !important;
                border-color: rgba(255, 255, 255, 0.2) !important;
            }

            @media (max-width: 1200px) {
                .mobile-nav-toggle {
                    display: flex;
                }
                .logo-area {
                    display: flex;
                    align-items: center;
                    flex-wrap: wrap;
                }
                
                /* Sidebar Drawer Style */
                .sidebar {
                    display: block !important;
                    position: fixed !important;
                    top: 0 !important;
                    left: 0 !important;
                    width: 280px !important;
                    height: 100vh !important;
                    z-index: 99999 !important;
                    background: #0b0d10 !important;
                    border-right: 1px solid rgba(255, 255, 255, 0.08) !important;
                    border-radius: 0 !important;
                    padding: 2rem 1.5rem !important;
                    overflow-y: auto !important;
                    transform: translateX(-100%) !important;
                    transition: transform 0.3s cubic-bezier(0.16, 1, 0.3, 1) !important;
                    box-shadow: 8px 0 32px rgba(0, 0, 0, 0.5) !important;
                }
                body.nav-open .sidebar {
                    transform: translateX(0) !important;
                }
                
                /* Backdrop Overlay */
                .nav-backdrop {
                    position: fixed !important;
                    top: 0 !important;
                    left: 0 !important;
                    width: 100vw !important;
                    height: 100vh !important;
                    background: rgba(0, 0, 0, 0.6) !important;
                    backdrop-filter: blur(4px) !important;
                    -webkit-backdrop-filter: blur(4px) !important;
                    z-index: 99998 !important;
                    opacity: 0 !important;
                    visibility: hidden !important;
                    transition: opacity 0.3s ease, visibility 0.3s ease !important;
                }
                body.nav-open .nav-backdrop {
                    opacity: 1 !important;
                    visibility: visible !important;
                }
            }
            
            /* Tablet Landscape/Portrait Optimization (Pads) */
            @media (min-width: 768px) and (max-width: 1199px) {
                .app-workspace {
                    display: grid !important;
                    grid-template-columns: 320px 1fr !important;
                    gap: 1.25rem !important;
                }
                .left-column {
                    grid-column: 1 !important;
                }
                .right-column, .cup-plot-panel {
                    grid-column: 1 !important;
                }
                .middle-column, .center-column {
                    grid-column: 2 !important;
                    grid-row: 1 / span 2 !important;
                    position: sticky !important;
                    top: 1.25rem !important;
                    height: fit-content !important;
                    display: flex !important;
                    flex-direction: column !important;
                    gap: 1.25rem !important;
                }
                .framing-quote {
                    max-width: 250px !important;
                    font-size: 0.8rem !important;
                }
            }
            
            /* Mobile Portrait Optimization (Handies) */
            @media (max-width: 767px) {
                .app-workspace {
                    display: flex !important;
                    flex-direction: column !important;
                    gap: 1.25rem !important;
                }
                .middle-column, .center-column {
                    order: 1 !important;
                }
                .left-column {
                    order: 2 !important;
                }
                .right-column, .cup-plot-panel {
                    order: 3 !important;
                }
                body {
                    padding: 1rem !important;
                }
                .logo-area h1 {
                    font-size: 1.6rem !important;
                }
                .framing-quote {
                    display: none !important;
                }
                canvas {
                    max-width: 100% !important;
                    height: auto !important;
                }
                .workspace-grid {
                    display: flex !important;
                    flex-direction: column !important;
                }
                .visualizer-column {
                    order: 1 !important;
                }
                .controls-column {
                    order: 2 !important;
                }
            }
        `;
        const head = document.head || (document.getElementsByTagName ? document.getElementsByTagName("head")[0] : null);
        if (head && head.appendChild) {
            head.appendChild(style);
        }
    }
}

if (typeof document !== "undefined") {
    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", setupMobileMenu);
    } else {
        setupMobileMenu();
    }
}

// Student Workbook Summary checklist renderer
function updateWorkbookSummary() {
    if (!workbookSummaryTable) return;
    
    const tasks = [
        { id: "task1", label: "Task 1: Drying Case A" },
        { id: "task2", label: "Task 2: Drying Case B" },
        { id: "task3", label: "Task 3: Drying Case C" },
        { id: "task4", label: "Task 4: Drying Case D" },
        { id: "task5", label: "Task 5: Drying Case E" }
    ];
    
    let html = "";
    tasks.forEach(t => {
        const rawPred = localStorage.getItem(`tc1_drying_prediction_${t.id}`);
        
        let hasPred = false;
        let guess = "";
        if (rawPred) {
            try {
                const data = JSON.parse(rawPred);
                hasPred = !!data.submitted;
                guess = data.guess;
            } catch(e){}
        }
        
        let statusText = "";
        let statusColor = "";
        
        if (hasPred) {
            statusText = "🟢 Completed";
            statusColor = "var(--accent-green)";
        } else {
            statusText = "🔴 Not Started";
            statusColor = "var(--accent-red)";
        }
        
        const labelMap = {
            surface: "Surface",
            bulk: "Bulk",
            both: "Both",
            unclear: "Unclear"
        };
        const displayGuess = guess ? `(${labelMap[guess] || guess})` : "";
        
        html += `
            <div style="display: flex; justify-content: space-between; align-items: center; background: rgba(255,255,255,0.01); border: 1px solid rgba(255,255,255,0.04); padding: 0.5rem 0.75rem; border-radius: 8px; font-size: 0.8rem;">
                <span style="font-weight: 500;">${t.label} <span style="font-size: 0.75rem; color: var(--text-secondary);">${displayGuess}</span></span>
                <span style="color: ${statusColor}; font-weight: 600; font-size: 0.75rem;">${statusText}</span>
            </div>
        `;
    });
    
    workbookSummaryTable.innerHTML = html;
}

// Download student workbook report as Markdown file
function exportWorkbookMarkdown() {
    let md = `# FSU Jena - Technische Chemie I: Strawberry Drying Simulator Report\n`;
    md += `**Date:** ${new Date().toLocaleDateString()}  \n`;
    md += `**Student Progress Log**\n\n`;
    md += `---\n\n`;
    
    const tasks = [
        { id: "task1", title: "Task 1: Drying Case A" },
        { id: "task2", title: "Task 2: Drying Case B" },
        { id: "task3", title: "Task 3: Drying Case C (Air Speed Study)" },
        { id: "task4", title: "Task 4: Drying Case D (Size Study)" },
        { id: "task5", title: "Task 5: Drying Case E (Diffusivity Mode Study)" }
    ];
    
    tasks.forEach(t => {
        md += `## ${t.title}\n\n`;
        
        const rawPred = localStorage.getItem(`tc1_drying_prediction_${t.id}`);
        
        let guess = "No prediction submitted.";
        let reasoning = "No reasoning submitted.";
        if (rawPred) {
            try {
                const data = JSON.parse(rawPred);
                const labelMap = {
                    surface: "Surface-limited (air-side bottleneck)",
                    bulk: "Bulk-diffusion-limited (internal transport bottleneck)",
                    both: "Both limitations present",
                    unclear: "Unclear bottleneck"
                };
                guess = labelMap[data.guess] || data.guess;
                reasoning = data.reasoning || "None.";
            } catch(e){}
        }
        
        md += `*   **Bottleneck Guess:** ${guess}\n`;
        md += `*   **Decision & Reasoning:** ${reasoning}\n\n`;
        md += `---\n\n`;
    });
    
    const blob = new Blob([md], { type: "text/markdown;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.setAttribute("download", "TC1_Strawberry_Drying_Workbook_Report.md");
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    
    logDebug("Workbook exported as Markdown file.");
}

// Copy student workbook report text to clipboard
function copyWorkbookMarkdown() {
    let text = `FSU Jena - Technische Chemie I: Strawberry Drying Simulator Report\n`;
    text += `==================================================================\n\n`;
    
    const tasks = [
        { id: "task1", title: "Task 1: Drying Case A" },
        { id: "task2", title: "Task 2: Drying Case B" },
        { id: "task3", title: "Task 3: Drying Case C (Air Speed Study)" },
        { id: "task4", title: "Task 4: Drying Case D (Size Study)" },
        { id: "task5", title: "Task 5: Drying Case E (Diffusivity Mode Study)" }
    ];
    
    tasks.forEach(t => {
        text += `## ${t.title}\n`;
        
        const rawPred = localStorage.getItem(`tc1_drying_prediction_${t.id}`);
        
        let guess = "No prediction submitted.";
        let reasoning = "No reasoning submitted.";
        if (rawPred) {
            try {
                const data = JSON.parse(rawPred);
                const labelMap = {
                    surface: "Surface-limited (air-side bottleneck)",
                    bulk: "Bulk-diffusion-limited (internal transport bottleneck)",
                    both: "Both limitations present",
                    unclear: "Unclear bottleneck"
                };
                guess = labelMap[data.guess] || data.guess;
                reasoning = data.reasoning || "None.";
            } catch(e){}
        }
        
        text += `* Initial Guess: ${guess}\n`;
        text += `* Reasoning: ${reasoning}\n\n`;
    });
    
    navigator.clipboard.writeText(text).then(() => {
        const feedback = document.getElementById("export-feedback");
        if (feedback) {
            feedback.style.display = "block";
            setTimeout(() => {
                feedback.style.display = "none";
            }, 2000);
        }
        logDebug("Workbook report copied to clipboard.");
    }).catch(err => {
        console.error("Clipboard copy failed.", err);
    });
}
