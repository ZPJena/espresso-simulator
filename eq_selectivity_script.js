// Controller script for eq_selectivity.html
// Part of the Equation Playground Split Suite

// UI Elements
const slidersBox = document.getElementById("sliders-box");
const playbackBox = document.getElementById("playback-box");
const btnPlay = document.getElementById("btn-play");
const btnReset = document.getElementById("btn-reset");
const outputsList = document.getElementById("outputs-list");
var canvas = document.getElementById("playground-canvas");
var ctx = canvas.getContext("2d");

// Global Sim State
let isRunning = false;
let animId = null;
let t = 0.0;
let dt = 0.05; // s per step
let parameters = {}; // Stores current values of sliders

// Simulation State variables
let cA = 0.0;
let cP = 0.0;
let cU = 0.0;
let reactorTemp = 25.0; // °C

// History for plotting
let historyT = [];
let historyTc = [];
let historycA = [];
let historycP = [];
let historycU = [];
let historyTime = [];

// Monte Carlo Particles
let reactorParticles = [];
const maxParticles = 150;

// Configuration Object for this specific equation
const eqConfig = {
    title: "Selectivity & Thermal Runaway (Competing Kinetics)",
    badge: "L8 Reactor Temperature Optimization",
    formula: "\\[ \\frac{r_P}{r_U} = \\frac{k_{1,0}}{k_{2,0}} \\exp\\left( \\frac{E_2 - E_1}{R T} \\right) \\quad \\text{und} \\quad \\rho C_p \\frac{dT}{dt} = Q_{gen} - Ua(T - T_c) \\]",
    desc: "This interactive simulator models competing parallel reactions A -> P (desired, green) and A -> U (undesired, red) in a jacketed batch reactor. Selectivity is highly dependent on temperature due to differences in activation energy (E_1 vs. E_2). An exothermic heat balance is solved in real-time. If cooling (heat transfer coefficient Ua or coolant temperature Tc) is insufficient, heat generation outpaces cooling, triggering thermal runaway (exponential temperature spike).",
    isAnimated: true,
    sliders: [
        { id: "sysType", label: "Reaction System Type", isSelect: true, options: [
            { val: 0, text: "Type I: High-T Favors Product (E1 > E2)" },
            { val: 1, text: "Type II: Low-T Favors Product (E1 < E2)" }
        ], val: 0 },
        { id: "Tc", label: "Coolant Temperature (T_c in °C)", min: 20, max: 120, step: 2, val: 60 },
        { id: "Ua", label: "Heat Transfer Coefficient (Ua in W/K)", min: 10, max: 200, step: 5, val: 80 },
        { id: "cA0", label: "Initial Reactant Conc (c_A0 in mol/L)", min: 0.5, max: 3.0, step: 0.1, val: 1.5 },
        { id: "simSpeed", label: "Simulation Speed", min: 0.2, max: 4.0, step: 0.2, val: 1.0 }
    ],
    init: () => {
        t = 0.0;
        cA = parameters["cA0"] || 1.5;
        cP = 0.0;
        cU = 0.0;
        reactorTemp = 25.0; // Start at room temperature
        
        // Reset histories
        historyT = [];
        historyTc = [];
        historycA = [];
        historycP = [];
        historycU = [];
        historyTime = [];
        
        // Initialize particles
        reactorParticles = [];
        const w = canvas.width || 550;
        const h_canvas = canvas.height || 420;
        const leftMargin = 55;
        const gap = 35;
        const panelW = (w - leftMargin - 40 - gap) / 2;
        const cx = leftMargin + panelW / 2;
        const cy = 40 + (h_canvas - 110) / 2;
        
        const r_width = 120;
        const r_height = 150;
        const rx_min = cx - r_width / 2 + 10;
        const rx_max = cx + r_width / 2 - 10;
        const ry_min = cy - r_height / 2 + 10;
        const ry_max = cy + r_height / 2 - 10;

        for (let i = 0; i < maxParticles; i++) {
            reactorParticles.push({
                x: rx_min + Math.random() * (rx_max - rx_min),
                y: ry_min + Math.random() * (ry_max - ry_min),
                vx: (Math.random() - 0.5) * 1.5,
                vy: (Math.random() - 0.5) * 1.5,
                type: 'A' // A = reactant (orange), P = product (green), U = waste (red)
            });
        }
    },
    reset: () => {
        eqConfig.init();
    },
    solve: () => {
        const sysType = parameters["sysType"];
        const Tc = parameters["Tc"];
        const Ua = parameters["Ua"];
        const simSpeed = parameters["simSpeed"] || 1.0;
        
        const effectiveDt = dt * simSpeed;
        
        // Kinetic Constants
        const R = 8.314; // J/(mol K)
        const TK = reactorTemp + 273.15; // Kelvin
        
        let E1, E2, k1_0, k2_0;
        if (sysType === 0) {
            // Type I: High Temp Favors P (E1 > E2)
            E1 = 65000; // J/mol
            E2 = 45000; // J/mol
            k1_0 = 1.5e7;
            k2_0 = 1.0e4;
        } else {
            // Type II: Low Temp Favors P (E1 < E2)
            E1 = 45000;
            E2 = 65000;
            k1_0 = 1.0e4;
            k2_0 = 1.5e7;
        }
        
        const k1 = k1_0 * Math.exp(-E1 / (R * TK));
        const k2 = k2_0 * Math.exp(-E2 / (R * TK));
        
        // Exothermic Rates
        const r_P = k1 * cA;
        const r_U = k2 * cA;
        
        // Concentration ODEs
        const dcA = -(r_P + r_U) * effectiveDt;
        cA = Math.max(0.0, cA + dcA);
        cP += r_P * effectiveDt;
        cU += r_U * effectiveDt;
        
        // Heat Balance ODE
        // Heat Generation (scaled for visual effect)
        const Q_gen = (r_P * 65.0 + r_U * 110.0); // Kelvin/s-like generation
        // Heat Removal (cooling jacket)
        const Ua_eff = Ua * 0.00035;
        const Q_rem = Ua_eff * (reactorTemp - Tc);
        
        const dT = (Q_gen - Q_rem) * effectiveDt;
        reactorTemp = Math.max(10.0, Math.min(250.0, reactorTemp + dT));
        
        t += effectiveDt;
        
        // Append history for plotting (downsample if running long)
        if (historyTime.length === 0 || t - historyTime[historyTime.length - 1] >= 0.25) {
            historyTime.push(t);
            historyT.push(reactorTemp);
            historyTc.push(Tc);
            historycA.push(cA);
            historycP.push(cP);
            historycU.push(cU);
            
            // Limit history arrays to 150 points
            if (historyTime.length > 150) {
                historyTime.shift();
                historyT.shift();
                historyTc.shift();
                historycA.shift();
                historycP.shift();
                historycU.shift();
            }
        }
        
        // Update particles (diffusion + reaction conversion)
        const w = canvas.width || 550;
        const h_canvas = canvas.height || 420;
        const leftMargin = 55;
        const gap = 35;
        const panelW = (w - leftMargin - 40 - gap) / 2;
        const cx = leftMargin + panelW / 2;
        const cy = 40 + (h_canvas - 110) / 2;
        
        const r_width = 120;
        const r_height = 150;
        const rx_min = cx - r_width / 2 + 8;
        const rx_max = cx + r_width / 2 - 8;
        const ry_min = cy - r_height / 2 + 8;
        const ry_max = cy + r_height / 2 - 8;
        
        const rx_prob = (k1 + k2) * effectiveDt * 3.0; // Reaction conversion probability
        const select_P = k1 / Math.max(1e-10, k1 + k2); // Selectivity to product P
        
        reactorParticles.forEach(p => {
            // Isotropic random walk inside reactor volume
            p.x += p.vx;
            p.y += p.vy;
            
            // Bounce off reactor walls
            if (p.x < rx_min) { p.x = rx_min; p.vx = -p.vx; }
            if (p.x > rx_max) { p.x = rx_max; p.vx = -p.vx; }
            if (p.y < ry_min) { p.y = ry_min; p.vy = -p.vy; }
            if (p.y > ry_max) { p.y = ry_max; p.vy = -p.vy; }
            
            // Reaction check
            if (p.type === 'A') {
                if (Math.random() < rx_prob) {
                    if (Math.random() < select_P) {
                        p.type = 'P'; // Green
                    } else {
                        p.type = 'U'; // Red
                    }
                }
            }
        });
        
        // Maintain particle counts aligned with macro concentration
        const targetA = Math.round(maxParticles * (cA / (parameters["cA0"] || 1.5)));
        const countA = reactorParticles.filter(p => p.type === 'A').length;
        
        if (countA > targetA) {
            // Convert excess A particles to P/U based on selectivity
            let toConvert = countA - targetA;
            for (let i = 0; i < reactorParticles.length && toConvert > 0; i++) {
                if (reactorParticles[i].type === 'A') {
                    reactorParticles[i].type = (Math.random() < select_P) ? 'P' : 'U';
                    toConvert--;
                }
            }
        }
    },
    draw: () => {
        ctx.fillStyle = "#040507";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        
        const w = canvas.width || 550;
        const h_canvas = canvas.height || 420;
        const leftMargin = 55;
        const gap = 35;
        const panelW = (w - leftMargin - 40 - gap) / 2;
        const panelH = h_canvas - 110;
        const cx = leftMargin + panelW / 2;
        const cy = 40 + panelH / 2;
        const rx = leftMargin + panelW + gap;
        const plotH = 105;
        
        const r_width = 120;
        const r_height = 150;
        
        // Left Panel: Batch Reactor chamber and jacket
        ctx.strokeStyle = "rgba(255,255,255,0.06)";
        ctx.strokeRect(leftMargin, 40, panelW, panelH);
        
        // 1. Draw Jacket (Cooling channel surrounding the reactor core)
        ctx.fillStyle = "rgba(0, 210, 255, 0.08)";
        ctx.strokeStyle = "rgba(0, 210, 255, 0.25)";
        ctx.lineWidth = 3.0;
        ctx.beginPath();
        // Drawing cooling jacket outer box
        ctx.roundRect(cx - r_width / 2 - 12, cy - r_height / 2 - 4, r_width + 24, r_height + 16, 12);
        ctx.fill();
        ctx.stroke();
        ctx.lineWidth = 1.0;
        
        // 2. Draw Reactor Core (Color shifts dynamically based on temperature)
        // Red component increases with temp, blue component decreases
        const heatPct = Math.min(1.0, (reactorTemp - 20.0) / 120.0); // 0 at 20°C, 1 at 140°C
        const red = Math.round(30 + heatPct * 225);
        const green = Math.round(15 - heatPct * 15);
        const blue = Math.round(60 - heatPct * 60);
        ctx.fillStyle = `rgb(${red}, ${green}, ${blue})`;
        
        ctx.beginPath();
        ctx.roundRect(cx - r_width / 2, cy - r_height / 2, r_width, r_height, 8);
        ctx.fill();
        ctx.strokeStyle = "rgba(255, 255, 255, 0.4)";
        ctx.stroke();
        
        // 3. Draw cooling coils/pipes arrows to show cooling flow
        ctx.strokeStyle = "rgba(0, 210, 255, 0.5)";
        ctx.beginPath();
        // inlet left bottom, outlet right top
        ctx.moveTo(cx - r_width / 2 - 20, cy + r_height / 2);
        ctx.lineTo(cx - r_width / 2 - 12, cy + r_height / 2);
        ctx.moveTo(cx + r_width / 2 + 12, cy - r_height / 2);
        ctx.lineTo(cx + r_width / 2 + 20, cy - r_height / 2);
        ctx.stroke();
        
        ctx.fillStyle = "rgba(0, 210, 255, 0.6)";
        ctx.font = "8px Outfit";
        ctx.textAlign = "center";
        ctx.fillText("Coolant In", cx - r_width / 2 - 22, cy + r_height / 2 - 5);
        ctx.fillText("Coolant Out", cx + r_width / 2 + 25, cy - r_height / 2 - 5);
        
        // 4. Draw Stirrer Impeller inside the reactor
        ctx.strokeStyle = "rgba(255, 255, 255, 0.45)";
        ctx.lineWidth = 2.0;
        ctx.beginPath();
        // Shaft
        ctx.moveTo(cx, cy - r_height / 2 - 10);
        ctx.lineTo(cx, cy + 20);
        // Blades
        const angle = isRunning ? t * 6.0 : 0.0;
        const bladeHalfW = 28;
        ctx.moveTo(cx - bladeHalfW * Math.cos(angle), cy + 20 - 5 * Math.sin(angle));
        ctx.lineTo(cx + bladeHalfW * Math.cos(angle), cy + 20 + 5 * Math.sin(angle));
        ctx.stroke();
        ctx.lineWidth = 1.0;
        
        // 5. Draw Particles
        reactorParticles.forEach(p => {
            if (p.type === 'A') ctx.fillStyle = "#ff9f43";      // Reactant A (Orange)
            else if (p.type === 'P') ctx.fillStyle = "#39d353"; // Desired P (Green)
            else ctx.fillStyle = "#ff4d4d";                     // Undesired U (Red)
            
            ctx.beginPath();
            ctx.arc(p.x, p.y, 2.5, 0, 2 * Math.PI);
            ctx.fill();
        });
        
        // 6. Draw Flashing Runaway Warning
        if (reactorTemp > 130.0) {
            const isFlash = Math.floor(t * 5.0) % 2 === 0;
            if (isFlash) {
                ctx.fillStyle = "#ff4d4d";
                ctx.font = "bold 13px Outfit";
                ctx.textAlign = "center";
                ctx.fillText("⚠️ THERMAL RUNAWAY!", cx, cy - r_height / 2 + 25);
            }
        }
        
        // Labels & Titles on left panel
        ctx.fillStyle = "#fff";
        ctx.font = "bold 9px Outfit";
        ctx.textAlign = "left";
        ctx.fillText("Microscopic Particle Conversions", leftMargin + 10, 32);
        
        // Thermometer Visual on left side of reactor
        const thermoX = leftMargin + 12;
        const thermoY = cy - 40;
        const thermoH = 90;
        ctx.strokeStyle = "rgba(255,255,255,0.3)";
        ctx.strokeRect(thermoX, thermoY, 6, thermoH);
        const fillHeight = Math.min(thermoH, thermoH * (reactorTemp / 180.0));
        ctx.fillStyle = reactorTemp > 130.0 ? "#ff4d4d" : "#ffcc00";
        ctx.fillRect(thermoX + 1, thermoY + thermoH - fillHeight, 4, fillHeight);
        
        ctx.fillStyle = "rgba(255, 255, 255, 0.5)";
        ctx.font = "7px Outfit";
        ctx.textAlign = "left";
        ctx.fillText(`${reactorTemp.toFixed(0)}°C`, thermoX - 3, thermoY - 6);
        
        // Right Panel: Plots
        const getXCoord = (timeVal) => {
            const maxTime = Math.max(20.0, t);
            return rx + (timeVal / maxTime) * panelW;
        };
        const getYCoordTop = (concVal) => {
            const maxcA0 = parameters["cA0"] || 1.5;
            return 45 + plotH - (concVal / maxcA0) * plotH;
        };
        const getYCoordBottom = (tempVal) => {
            const maxTemp = 200.0;
            return 210 + plotH - (tempVal / maxTemp) * plotH;
        };
        
        // 1. Top Plot: Concentration Profiles
        ctx.strokeStyle = "rgba(255,255,255,0.06)";
        ctx.strokeRect(rx, 45, panelW, plotH);
        
        ctx.strokeStyle = "rgba(255,255,255,0.04)";
        for (let i = 1; i < 5; i++) {
            const pct = i / 5;
            ctx.beginPath();
            ctx.moveTo(rx + pct * panelW, 45);
            ctx.lineTo(rx + pct * panelW, 45 + plotH);
            ctx.moveTo(rx, 45 + pct * plotH);
            ctx.lineTo(rx + panelW, 45 + pct * plotH);
            ctx.stroke();
        }
        
        // Draw Curve cA (Orange), cP (Green), cU (Red)
        if (historyTime.length > 1) {
            // cA
            ctx.strokeStyle = "#ff9f43";
            ctx.lineWidth = 2.0;
            ctx.beginPath();
            ctx.moveTo(getXCoord(historyTime[0]), getYCoordTop(historycA[0]));
            for (let i = 1; i < historyTime.length; i++) {
                ctx.lineTo(getXCoord(historyTime[i]), getYCoordTop(historycA[i]));
            }
            ctx.stroke();
            
            // cP
            ctx.strokeStyle = "#39d353";
            ctx.beginPath();
            ctx.moveTo(getXCoord(historyTime[0]), getYCoordTop(historycP[0]));
            for (let i = 1; i < historyTime.length; i++) {
                ctx.lineTo(getXCoord(historyTime[i]), getYCoordTop(historycP[i]));
            }
            ctx.stroke();
            
            // cU
            ctx.strokeStyle = "#ff4d4d";
            ctx.beginPath();
            ctx.moveTo(getXCoord(historyTime[0]), getYCoordTop(historycU[0]));
            for (let i = 1; i < historyTime.length; i++) {
                ctx.lineTo(getXCoord(historyTime[i]), getYCoordTop(historycU[i]));
            }
            ctx.stroke();
            ctx.lineWidth = 1.0;
        }
        
        // Axes and Ticks Top
        ctx.strokeStyle = "rgba(255,255,255,0.2)";
        ctx.beginPath();
        ctx.moveTo(rx, 45); ctx.lineTo(rx, 45 + plotH); ctx.lineTo(rx + panelW, 45 + plotH);
        ctx.stroke();
        
        ctx.fillStyle = "rgba(255,255,255,0.4)";
        ctx.font = "8px 'JetBrains Mono', monospace";
        ctx.textAlign = "right";
        const maxcA0Val = parameters["cA0"] || 1.5;
        ctx.fillText(maxcA0Val.toFixed(1), rx - 6, 48);
        ctx.fillText((maxcA0Val / 2).toFixed(1), rx - 6, 45 + plotH / 2 + 3);
        ctx.fillText("0", rx - 6, 45 + plotH);
        
        ctx.textAlign = "center";
        const totalDuration = Math.max(20.0, t);
        ctx.fillText("0s", getXCoord(0.0), 45 + plotH + 11);
        ctx.fillText((totalDuration / 2).toFixed(0) + "s", getXCoord(totalDuration / 2), 45 + plotH + 11);
        ctx.fillText(totalDuration.toFixed(0) + "s", getXCoord(totalDuration), 45 + plotH + 11);
        
        ctx.fillStyle = "#fff";
        ctx.font = "bold 9px Outfit";
        ctx.textAlign = "left";
        ctx.fillText("Concentration Profiles [mol/L]", rx, 36);
        
        // 2. Bottom Plot: Temperature Profile
        ctx.strokeStyle = "rgba(255,255,255,0.06)";
        ctx.strokeRect(rx, 210, panelW, plotH);
        
        ctx.strokeStyle = "rgba(255,255,255,0.04)";
        for (let i = 1; i < 5; i++) {
            const pct = i / 5;
            ctx.beginPath();
            ctx.moveTo(rx + pct * panelW, 210);
            ctx.lineTo(rx + pct * panelW, 210 + plotH);
            ctx.moveTo(rx, 210 + pct * plotH);
            ctx.lineTo(rx + panelW, 210 + pct * plotH);
            ctx.stroke();
        }
        
        // Draw Runaway limit line at 130°C
        ctx.strokeStyle = "rgba(255, 77, 77, 0.4)";
        ctx.lineWidth = 1.0;
        ctx.setLineDash([3, 3]);
        ctx.beginPath();
        ctx.moveTo(rx, getYCoordBottom(130.0));
        ctx.lineTo(rx + panelW, getYCoordBottom(130.0));
        ctx.stroke();
        ctx.setLineDash([]);
        
        ctx.fillStyle = "rgba(255, 77, 77, 0.7)";
        ctx.font = "7px Outfit";
        ctx.textAlign = "right";
        ctx.fillText("Runaway (130°C)", rx + panelW - 5, getYCoordBottom(130.0) - 3);
        
        // Draw T (Yellow/Red) and Tc (Blue dashed)
        if (historyTime.length > 1) {
            // Tc Coolant
            ctx.strokeStyle = "#4dabf7";
            ctx.setLineDash([2, 2]);
            ctx.beginPath();
            ctx.moveTo(getXCoord(historyTime[0]), getYCoordBottom(historyTc[0]));
            for (let i = 1; i < historyTime.length; i++) {
                ctx.lineTo(getXCoord(historyTime[i]), getYCoordBottom(historyTc[i]));
            }
            ctx.stroke();
            ctx.setLineDash([]);
            
            // T Reactor
            ctx.strokeStyle = reactorTemp > 130.0 ? "#ff4d4d" : "#ffcc00";
            ctx.lineWidth = 2.0;
            ctx.beginPath();
            ctx.moveTo(getXCoord(historyTime[0]), getYCoordBottom(historyT[0]));
            for (let i = 1; i < historyTime.length; i++) {
                ctx.lineTo(getXCoord(historyTime[i]), getYCoordBottom(historyT[i]));
            }
            ctx.stroke();
            ctx.lineWidth = 1.0;
        }
        
        // Axes and Ticks Bottom
        ctx.strokeStyle = "rgba(255,255,255,0.2)";
        ctx.beginPath();
        ctx.moveTo(rx, 210); ctx.lineTo(rx, 210 + plotH); ctx.lineTo(rx + panelW, 210 + plotH);
        ctx.stroke();
        
        ctx.fillStyle = "rgba(255,255,255,0.4)";
        ctx.font = "8px 'JetBrains Mono', monospace";
        ctx.textAlign = "right";
        ctx.fillText("200°C", rx - 6, 213);
        ctx.fillText("100°C", rx - 6, 210 + plotH / 2 + 3);
        ctx.fillText("0°C", rx - 6, 210 + plotH);
        
        ctx.textAlign = "center";
        ctx.fillText("0s", getXCoord(0.0), 210 + plotH + 11);
        ctx.fillText((totalDuration / 2).toFixed(0) + "s", getXCoord(totalDuration / 2), 210 + plotH + 11);
        ctx.fillText(totalDuration.toFixed(0) + "s", getXCoord(totalDuration), 210 + plotH + 11);
        
        ctx.fillStyle = "#fff";
        ctx.font = "bold 9px Outfit";
        ctx.textAlign = "left";
        ctx.fillText("Temperature Profiles [°C]", rx, 201);
        
        // Legends on panels
        drawLegend([
            { color: "#ff9f43", label: "Reactant A" },
            { color: "#39d353", label: "Desired P" },
            { color: "#ff4d4d", label: "Undesired U" }
        ], leftMargin + 6, 52);
        
        // Output calculations
        const selectivity = cP / Math.max(1e-10, cP + cU);
        const conversion = ( ( (parameters["cA0"] || 1.5) - cA ) / (parameters["cA0"] || 1.5) ) * 100;
        
        let runawayText = `<span class="mono" style="color: #39d353; font-weight:bold;">Safe</span>`;
        if (reactorTemp > 130.0) {
            runawayText = `<span class="mono" style="color: #ff4d4d; font-weight:bold; animation: blink 1s infinite;">🔥 RUNAWAY DETECTED</span>`;
        } else if (reactorTemp > 90.0) {
            runawayText = `<span class="mono" style="color: #ff9f43; font-weight:bold;">Warning (High Temp)</span>`;
        }
        
        outputsList.innerHTML = `
            <div class="stat-row"><span>Reactor Temperature:</span><span class="mono" style="font-weight:bold; color:${reactorTemp > 130 ? '#ff4d4d' : '#ffcc00'};">${reactorTemp.toFixed(1)} °C</span></div>
            <div class="stat-row"><span>Conversion (X):</span><span class="mono">${conversion.toFixed(1)} %</span></div>
            <div class="stat-row"><span>Product Selectivity (S_P):</span><span class="mono" style="font-weight:bold; color:#39d353;">${(selectivity * 100).toFixed(1)} %</span></div>
            <div class="stat-row"><span>Reactor State:</span>${runawayText}</div>
        `;
    }
};

const activeEqKey = "selectivity";
const isAnimated = true;

// Generate Sliders dynamically
function initSliders(sliders) {
    slidersBox.innerHTML = "";
    parameters = {};
    sliders.forEach(s => {
        parameters[s.id] = s.val;
        const group = document.createElement("div");
        group.className = "control-group";
        if (s.isSelect) {
            group.innerHTML = `
                <div class="slider-header">
                    <label for="param-${s.id}">${s.label}</label>
                </div>
                <select id="param-${s.id}">
                    ${s.options.map(o => `<option value="${o.val}" ${o.val === s.val ? 'selected' : ''}>${o.text}</option>`).join('')}
                </select>
            `;
            slidersBox.appendChild(group);
            const selectEl = document.getElementById(`param-${s.id}`);
            selectEl.addEventListener("change", (e) => {
                parameters[s.id] = parseFloat(e.target.value);
                if (!isAnimated || !isRunning) {
                    eqConfig.solve();
                    eqConfig.draw();
                }
            });
        } else {
            group.innerHTML = `
                <div class="slider-header">
                    <label for="param-${s.id}">${s.label}</label>
                    <span class="slider-value" id="val-${s.id}">${s.val}</span>
                </div>
                <input type="range" id="param-${s.id}" min="${s.min}" max="${s.max}" step="${s.step}" value="${s.val}">
            `;
            slidersBox.appendChild(group);
            const inputEl = document.getElementById(`param-${s.id}`);
            const valueEl = document.getElementById(`val-${s.id}`);
            inputEl.addEventListener("input", (e) => {
                const val = parseFloat(e.target.value);
                parameters[s.id] = val;
                valueEl.textContent = val;
                if (!isAnimated || !isRunning) {
                    eqConfig.solve();
                    eqConfig.draw();
                }
            });
        }
    });
}

// Playback control event listeners
if (btnPlay) {
    btnPlay.addEventListener("click", () => {
        if (!isRunning) {
            isRunning = true;
            btnPlay.textContent = "⏸ Pause";
            btnPlay.classList.add("btn-danger");
            animate();
        } else {
            isRunning = false;
            btnPlay.textContent = "▶ Start";
            btnPlay.classList.remove("btn-danger");
            if (animId) cancelAnimationFrame(animId);
        }
    });
}

if (btnReset) {
    btnReset.addEventListener("click", () => {
        isRunning = false;
        if (btnPlay) {
            btnPlay.textContent = "▶ Start";
            btnPlay.classList.remove("btn-danger");
        }
        if (animId) cancelAnimationFrame(animId);
        eqConfig.init();
        eqConfig.solve();
        eqConfig.draw();
    });
}

window.addEventListener("resize", () => {
    resizeCanvas();
    drawActive();
});

function resizeCanvas() {
    const wrapper = canvas.parentElement;
    let w = wrapper.clientWidth;
    if (!w || w < 100) {
        w = 550;
    }
    canvas.width = w;
    canvas.height = Math.round(w * 0.76);
}

function drawActive() {
    eqConfig.solve();
    eqConfig.draw();
}

// Animation Loop
let speedAccumulator = 0.0;
function animate() {
    if (!isRunning) return;
    try {
        const simSpeed = parameters["simSpeed"] || 1.0;
        speedAccumulator += simSpeed;
        while (speedAccumulator >= 1.0) {
            eqConfig.solve();
            speedAccumulator -= 1.0;
        }
        eqConfig.draw();
        animId = requestAnimationFrame(animate);
    } catch (err) {
        console.error("Animation Loop Crash:", err);
        if (outputsList) {
            outputsList.innerHTML = `<div class="error-msg" style="color: #ff4d4d; font-weight: bold; padding: 10px; background: rgba(255, 77, 77, 0.1); border-radius: 4px; border: 1px solid rgba(255, 77, 77, 0.3); font-family: monospace; font-size: 10px;">Animation Error: ${err.message}<br>${err.stack}</div>`;
        }
        isRunning = false;
    }
}

// Initialize on load
document.addEventListener("DOMContentLoaded", () => {
    if (isAnimated) {
        playbackBox.style.display = "flex";
        btnPlay.textContent = isRunning ? "⏸ Pause" : "▶ Start";
    } else {
        playbackBox.style.display = "none";
    }

    initSliders(eqConfig.sliders);
    eqConfig.init();
    resizeCanvas();
    eqConfig.solve();
    eqConfig.draw();
});
