// Controller script for eq_butler.html
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
let dt = 0.05;
let parameters = {}; // Stores current values of sliders

// Navier-Stokes state (Flow particles)
let flowParticles = [];
const numParticles = 80;

// Stokes state (falling particles)
let stokesParticles = [];

// Two-Film state (diffusion tracer particles)
let diffusionParticles = [];

// McCabe-Thiele state (vapor and liquid flow particles)
let mccabeVaporParticles = [];
let mccabeLiquidParticles = [];

// Adsorption state (1D finite difference grid)
const Nz = 60;
let adsC = new Float32Array(Nz);
let adsX = new Float32Array(Nz);

// GCMC Adsorption state
let gcmcHeights = new Int32Array(15);
let gcmcGasParticles = [];
let gcmcEvent = null;
let gcmcTotalSteps = 0;
let gcmcAcceptedSteps = 0;
let gcmcAccumulatedLoading = [];
let gcmcRunningAvgLoading = 0.0;

// Butler-Volmer electrochemical state
let butlerParticles = [];
let butlerElectrons = [];

// Hatta mass transfer with reaction state
let hattaParticlesA = [];
let hattaParticlesB = [];
let hattaProducts = [];

// Configuration Object for this specific equation
const eqConfig = {
            title: "Butler-Volmer Equation (Electrode Kinetics)",
            badge: "L3 Basics of Electrochemistry",
            formula: "\\[ j = j_0 \\left[ \\exp\\left( \\frac{\\alpha_a F \\eta}{R T} \\right) - \\exp\\left( -\\frac{\\alpha_c F \\eta}{R T} \\right) \\] \\]",
            desc: "The Butler-Volmer equation describes the relationship between the electrical current density j at an electrode and the overpotential η. It represents the foundation of kinetics in batteries, fuel cells, and electrolyzers. The visualizer plots the cathodic reduction branch, the anodic oxidation branch, and the net current density. Adjusting the transfer coefficients α_a and α_c demonstrates symmetry breaking.",
            isAnimated: true,
            sliders: [
                { id: "eta", label: "Applied Overpotential (\u03b7 in V)", min: -0.2, max: 0.2, step: 0.01, val: 0.0 },
                { id: "j0", label: "Exchange Current Density (j\u2080 in A/m\u00b2)", min: 0.1, max: 2.0, step: 0.1, val: 1.0 },
                { id: "alpha_a", label: "Anodic Transfer Coefficient (\u03b1_a)", min: 0.2, max: 0.8, step: 0.05, val: 0.5 },
                { id: "alpha_c", label: "Cathodic Transfer Coefficient (\u03b1_c)", min: 0.2, max: 0.8, step: 0.05, val: 0.5 },
                { id: "temp", label: "Electrolyte Temperature (T in \u00b0C)", min: 10, max: 90, step: 5, val: 25 }
            ],
            init: () => {
                t = 0.0;
                butlerParticles = [];
                butlerElectrons = [];
                const w = canvas.width || 550;
                const h_canvas = canvas.height || 420;
                const leftMargin = 55;
                const rightMargin = 40;
                const gap = 35;
                const panelW = (w - leftMargin - rightMargin - gap) / 2;
                const rx = leftMargin + panelW + gap;
                const panelH = h_canvas - 110;
                const y_bottom = 40 + panelH - 12;

                // Initialize 40 particles: 20 Red (orange), 20 Ox (blue)
                for (let i = 0; i < 40; i++) {
                    const type = i < 20 ? 'Red' : 'Ox';
                    butlerParticles.push({
                        x: rx + 8 + Math.random() * (panelW - 32),
                        y: 50 + Math.random() * (y_bottom - 70),
                        vx: (Math.random() - 0.5) * 1.5,
                        vy: (Math.random() - 0.5) * 1.5,
                        type: type
                    });
                }
            },
            reset: () => {
                equationsConfig.butler.init();
            },
            solve: () => {
                const j0 = parameters["j0"];
                const alpha_a = parameters["alpha_a"];
                const alpha_c = parameters["alpha_c"];
                const T_k = parameters["temp"] + 273.15;
                const eta = parameters["eta"] !== undefined ? parameters["eta"] : 0.0;
                const F = 96485.0; // Faraday constant
                const R = 8.314; // gas constant
                const F_RT = F / (R * T_k);
                parameters["_F_RT"] = F_RT;

                if (isRunning) {
                    const w = canvas.width || 550;
                    const h_canvas = canvas.height || 420;
                    const leftMargin = 55;
                    const rightMargin = 40;
                    const gap = 35;
                    const panelW = (w - leftMargin - rightMargin - gap) / 2;
                    const rx = leftMargin + panelW + gap;
                    const panelH = h_canvas - 110;
                    const y_bottom = 40 + panelH - 12;

                    // Update electrons
                    butlerElectrons.forEach(el => {
                        el.progress += el.speed;
                    });
                    butlerElectrons = butlerElectrons.filter(el => el.progress < 1.0);

                    // Update particles
                    butlerParticles.forEach(p => {
                        p.x += p.vx;
                        p.y += p.vy;

                        // Wall collisions
                        if (p.x < rx + 8) { p.x = rx + 8; p.vx = Math.abs(p.vx); }
                        // Right boundary is the electrode interface (rx + panelW - 20)
                        const electX = rx + panelW - 20;
                        if (p.x > electX) {
                            p.x = electX;
                            p.vx = -Math.abs(p.vx);

                            // Electrochemical reaction check at electrode interface!
                            if (p.type === 'Red') {
                                // Oxidation: Red -> Ox + e- (releases electron into electrode)
                                // Probability proportional to anodic current density branch
                                const P_ox = Math.min(0.85, 0.18 * j0 * Math.exp(alpha_a * F_RT * eta));
                                if (Math.random() < P_ox) {
                                    p.type = 'Ox';
                                    // Spawn electron flowing from interface into metal electrode
                                    butlerElectrons.push({
                                        startX: electX,
                                        startY: p.y,
                                        targetX: rx + panelW - 2,
                                        targetY: p.y,
                                        progress: 0.0,
                                        speed: 0.08,
                                        direction: 'in'
                                    });
                                }
                            } else {
                                // Reduction: Ox + e- -> Red (absorbs electron from electrode)
                                // Probability proportional to cathodic current density branch
                                const P_red = Math.min(0.85, 0.18 * j0 * Math.exp(-alpha_c * F_RT * eta));
                                if (Math.random() < P_red) {
                                    p.type = 'Red';
                                    // Spawn electron flowing from metal electrode to interface
                                    butlerElectrons.push({
                                        startX: rx + panelW - 2,
                                        startY: p.y,
                                        targetX: electX,
                                        targetY: p.y,
                                        progress: 0.0,
                                        speed: 0.08,
                                        direction: 'out'
                                    });
                                }
                            }
                        }

                        if (p.y < 45) { p.y = 45; p.vy = Math.abs(p.vy); }
                        if (p.y > y_bottom - 5) { p.y = y_bottom - 5; p.vy = -Math.abs(p.vy); }

                        // Brownian diffusion / random walk jitter
                        p.vx += (Math.random() - 0.5) * 0.25;
                        p.vy += (Math.random() - 0.5) * 0.25;

                        // Clamp velocities to prevent flying too fast
                        p.vx = Math.max(-1.5, Math.min(1.5, p.vx));
                        p.vy = Math.max(-1.5, Math.min(1.5, p.vy));
                    });
                }
            },
            draw: () => {
                ctx.fillStyle = "#040507";
                ctx.fillRect(0, 0, canvas.width, canvas.height);

                const j0 = parameters["j0"];
                const alpha_a = parameters["alpha_a"];
                const alpha_c = parameters["alpha_c"];
                const eta = parameters["eta"] !== undefined ? parameters["eta"] : 0.0;
                const F_RT = parameters["_F_RT"] || 38.92;

                const leftMargin = 55;
                const rightMargin = 40;
                const gap = 35;
                const panelW = (canvas.width - leftMargin - rightMargin - gap) / 2;
                const panelH = canvas.height - 110;
                const rx = leftMargin + panelW + gap;

                const getXCoord = (eVal) => leftMargin + ((eVal + 0.2) / 0.4) * panelW;
                const getYCoord = (jVal) => {
                    const normalized = Math.max(0, Math.min(1, (jVal + 80.0) / 160.0));
                    return 40 + panelH - normalized * panelH;
                };

                // Draw Graph Boundary Box
                ctx.strokeStyle = "rgba(255,255,255,0.06)";
                ctx.strokeRect(leftMargin, 40, panelW, panelH);

                // Draw Grid
                ctx.strokeStyle = "rgba(255,255,255,0.04)";
                ctx.lineWidth = 1;
                for (let g = 0; g <= 8; g++) {
                    const eVal = -0.2 + g * 0.05;
                    ctx.beginPath();
                    ctx.moveTo(getXCoord(eVal), 40);
                    ctx.lineTo(getXCoord(eVal), 40 + panelH);
                    ctx.stroke();
                }
                for (let g = 0; g <= 8; g++) {
                    const jVal = -80 + g * 20;
                    ctx.beginPath();
                    ctx.moveTo(leftMargin, getYCoord(jVal));
                    ctx.lineTo(leftMargin + panelW, getYCoord(jVal));
                    ctx.stroke();
                }

                // Draw X-axis (zero line of current)
                ctx.strokeStyle = "rgba(255,255,255,0.15)";
                ctx.lineWidth = 1.2;
                ctx.beginPath();
                ctx.moveTo(leftMargin, getYCoord(0));
                ctx.lineTo(leftMargin + panelW, getYCoord(0));
                ctx.stroke();

                // Draw Y-axis (zero line of overpotential)
                ctx.beginPath();
                ctx.moveTo(getXCoord(0), 40);
                ctx.lineTo(getXCoord(0), 40 + panelH);
                ctx.stroke();

                // Draw curves
                ctx.lineWidth = 2.0;

                // Anodic Oxidation Branch (dashed green)
                ctx.strokeStyle = "rgba(57, 211, 83, 0.55)";
                ctx.setLineDash([3, 3]);
                ctx.beginPath();
                for (let i = 0; i <= 50; i++) {
                    const eVal = -0.2 + i * 0.008;
                    const j_a = j0 * Math.exp(alpha_a * F_RT * eVal);
                    if (i === 0) ctx.moveTo(getXCoord(eVal), getYCoord(j_a));
                    else ctx.lineTo(getXCoord(eVal), getYCoord(j_a));
                }
                ctx.stroke();

                // Cathodic Reduction Branch (dashed red)
                ctx.strokeStyle = "rgba(255, 77, 77, 0.55)";
                ctx.beginPath();
                for (let i = 0; i <= 50; i++) {
                    const eVal = -0.2 + i * 0.008;
                    const j_c = -j0 * Math.exp(-alpha_c * F_RT * eVal);
                    if (i === 0) ctx.moveTo(getXCoord(eVal), getYCoord(j_c));
                    else ctx.lineTo(getXCoord(eVal), getYCoord(j_c));
                }
                ctx.stroke();
                ctx.setLineDash([]);

                // Net current density (solid blue)
                ctx.strokeStyle = "#00d2ff";
                ctx.lineWidth = 2.8;
                ctx.beginPath();
                for (let i = 0; i <= 50; i++) {
                    const eVal = -0.2 + i * 0.008;
                    const j_a = j0 * Math.exp(alpha_a * F_RT * eVal);
                    const j_c = -j0 * Math.exp(-alpha_c * F_RT * eVal);
                    const j_net = j_a + j_c;
                    if (i === 0) ctx.moveTo(getXCoord(eVal), getYCoord(j_net));
                    else ctx.lineTo(getXCoord(eVal), getYCoord(j_net));
                }
                ctx.stroke();

                // Draw Current Operating Point on the graph
                const j_a_curr = j0 * Math.exp(alpha_a * F_RT * eta);
                const j_c_curr = -j0 * Math.exp(-alpha_c * F_RT * eta);
                const j_net_curr = j_a_curr + j_c_curr;

                const blink = 0.5 + 0.5 * Math.sin(Date.now() / 150);
                ctx.fillStyle = `rgba(255, 210, 0, ${0.5 + 0.5 * blink})`;
                ctx.beginPath();
                ctx.arc(getXCoord(eta), getYCoord(j_net_curr), 6.5, 0, 2 * Math.PI);
                ctx.fill();
                ctx.strokeStyle = "#ffd200";
                ctx.lineWidth = 1.5;
                ctx.stroke();

                // Graph Ticks and Labels
                ctx.fillStyle = "rgba(255, 255, 255, 0.4)";
                ctx.font = "9px 'JetBrains Mono', monospace";
                
                // Y-axis ticks
                ctx.textAlign = "right";
                const yTicks = [-80, -40, 0, 40, 80];
                yTicks.forEach(tick => {
                    const py = getYCoord(tick);
                    ctx.fillText(tick.toString(), leftMargin - 8, py + 3);
                    ctx.beginPath();
                    ctx.moveTo(leftMargin - 4, py);
                    ctx.lineTo(leftMargin, py);
                    ctx.stroke();
                });

                // X-axis ticks
                ctx.textAlign = "center";
                const xTicks = [-0.2, -0.1, 0, 0.1, 0.2];
                xTicks.forEach(tick => {
                    const px = getXCoord(tick);
                    ctx.fillText(tick.toFixed(2), px, 40 + panelH + 12);
                    ctx.beginPath();
                    ctx.moveTo(px, 40 + panelH);
                    ctx.lineTo(px, 40 + panelH + 4);
                    ctx.stroke();
                });

                // Graph Title and Axes Titles
                ctx.fillStyle = "#fff";
                ctx.font = "bold 9px Outfit";
                ctx.textAlign = "left";
                ctx.fillText("Kinetic Tafel Plot", leftMargin, 32);

                ctx.save();
                ctx.translate(leftMargin - 32, 40 + panelH / 2);
                ctx.rotate(-Math.PI / 2);
                ctx.textAlign = "center";
                ctx.fillStyle = "rgba(255,255,255,0.6)";
                ctx.fillText("Current Density j [A/m²]", 0, 0);
                ctx.restore();

                ctx.textAlign = "center";
                ctx.fillText("Overpotential η [V]", leftMargin + panelW / 2, 40 + panelH + 24);

                // --- Draw Right Panel: Electrode-Electrolyte Interface Simulation ---
                const y_bottom = 40 + panelH - 12;

                ctx.strokeStyle = "rgba(255,255,255,0.06)";
                ctx.strokeRect(rx, 40, panelW, panelH);

                ctx.fillStyle = "#fff";
                ctx.font = "bold 9px Outfit";
                ctx.textAlign = "left";
                ctx.fillText("Electrode-Electrolyte Interface (2D slit)", rx, 32);

                // 1. Draw Liquid Electrolyte Area (left part of slit-pore)
                ctx.fillStyle = "rgba(0, 210, 255, 0.025)";
                ctx.fillRect(rx, 40, panelW - 20, panelH);

                // 2. Draw Solid Electrode Bar (right 20px)
                const electW = 20;
                const electX = rx + panelW - electW;
                const metalGrad = ctx.createLinearGradient(electX, 40, rx + panelW, 40);
                metalGrad.addColorStop(0, "#2c3e50");
                metalGrad.addColorStop(0.3, "#7f8c8d");
                metalGrad.addColorStop(0.7, "#95a5a6");
                metalGrad.addColorStop(1, "#2c3e50");
                ctx.fillStyle = metalGrad;
                ctx.fillRect(electX, 40, electW, panelH);
                ctx.strokeStyle = "rgba(255,255,255,0.15)";
                ctx.strokeRect(electX, 40, electW, panelH);

                // Write "ELECTRODE" vertically
                ctx.save();
                ctx.translate(electX + 13, 40 + panelH / 2);
                ctx.rotate(-Math.PI / 2);
                ctx.textAlign = "center";
                ctx.font = "bold 8px 'JetBrains Mono', monospace";
                ctx.fillStyle = "rgba(255,255,255,0.45)";
                ctx.fillText("ELECTRODE", 0, 0);
                ctx.restore();

                // Draw Electroactive particles
                butlerParticles.forEach(p => {
                    if (p.type === 'Red') {
                        ctx.fillStyle = "#ff9f43"; // Reductive species (orange)
                        ctx.shadowColor = "#ff9f43";
                        ctx.shadowBlur = 3;
                    } else {
                        ctx.fillStyle = "rgba(0, 210, 255, 0.85)"; // Oxidative species (blue)
                        ctx.shadowBlur = 0;
                    }
                    ctx.beginPath();
                    ctx.arc(p.x, p.y, 4.5, 0, 2 * Math.PI);
                    ctx.fill();
                    ctx.shadowBlur = 0;

                    // Draw inner highlight
                    ctx.fillStyle = "rgba(255,255,255,0.25)";
                    ctx.beginPath();
                    ctx.arc(p.x - 1.2, p.y - 1.2, 1.2, 0, 2 * Math.PI);
                    ctx.fill();
                });

                // Draw flowing electrons
                butlerElectrons.forEach(el => {
                    const cx_el = (1.0 - el.progress) * el.startX + el.progress * el.targetX;
                    const cy_el = el.startY;

                    ctx.fillStyle = "#ffd200"; // Electron (yellow)
                    ctx.shadowColor = "#ffd200";
                    ctx.shadowBlur = 4;
                    ctx.beginPath();
                    ctx.arc(cx_el, cy_el, 2.0, 0, 2 * Math.PI);
                    ctx.fill();
                    ctx.shadowBlur = 0;
                });

                // Right Panel Labels
                ctx.fillStyle = "rgba(255,255,255,0.3)";
                ctx.font = "8px Outfit";
                ctx.textAlign = "left";
                ctx.fillText("Liquid Electrolyte", rx + 10, 52);
                ctx.fillText("Anode/Cathode Interface", electX - 110, y_bottom + 12);

                // Interface line indicator
                ctx.strokeStyle = "rgba(255,255,255,0.2)";
                ctx.lineWidth = 1;
                ctx.setLineDash([2, 2]);
                ctx.beginPath();
                ctx.moveTo(electX, 40);
                ctx.lineTo(electX, y_bottom);
                ctx.stroke();
                ctx.setLineDash([]);

                // Draw Legends for both panels (Tafel plot at leftMargin, compact layout)
                drawLegend([
                    { color: "#00d2ff", label: "j_net" },
                    { color: "rgba(57, 211, 83, 0.8)", label: "Oxidation (Anodic)", dashed: true },
                    { color: "rgba(255, 77, 77, 0.8)", label: "Reduction (Cathodic)", dashed: true }
                ], 50, 72);

                // Draw Right panel particle legend below right panel
                const rlx = rx;
                const rly = canvas.height - 45;
                ctx.font = "9px Outfit";
                ctx.textAlign = "left";

                // Red legend
                ctx.fillStyle = "#ff9f43";
                ctx.beginPath(); ctx.arc(rlx + 5, rly - 3, 3.5, 0, 2*Math.PI); ctx.fill();
                ctx.fillStyle = "rgba(255,255,255,0.7)";
                ctx.fillText("Red Species (Oxidizing)", rlx + 13, rly);

                // Ox legend
                ctx.fillStyle = "rgba(0, 210, 255, 0.85)";
                ctx.beginPath(); ctx.arc(rlx + 105, rly - 3, 3.5, 0, 2*Math.PI); ctx.fill();
                ctx.fillStyle = "rgba(255,255,255,0.7)";
                ctx.fillText("Ox Species (Reducing)", rlx + 113, rly);

                // Electron legend
                ctx.fillStyle = "#ffd200";
                ctx.beginPath(); ctx.arc(rlx + 195, rly - 3, 2.0, 0, 2*Math.PI); ctx.fill();
                ctx.fillStyle = "rgba(255,255,255,0.7)";
                ctx.fillText("e⁻ flow", rlx + 201, rly);

                // Output calculations update
                let redCount = 0;
                let oxCount = 0;
                butlerParticles.forEach(p => {
                    if (p.type === 'Red') redCount++;
                    else oxCount++;
                });

                let statusText = "Dynamic Equilibrium";
                let statusColor = "#39d353";
                if (eta > 0.02) {
                    statusText = "Oxidation Dominant (Anodic Current)";
                    statusColor = "#39d353";
                } else if (eta < -0.02) {
                    statusText = "Reduction Dominant (Cathodic Current)";
                    statusColor = "#ff4d4d";
                }

                outputsList.innerHTML = `
                    <div class="stat-row"><span>Faraday Factor F/RT:</span><span class="mono">${F_RT.toFixed(2)} V⁻¹</span></div>
                    <div class="stat-row"><span>Net Current Density j_net:</span><span class="mono text-orange" style="font-weight:bold; font-size:1.05rem;">${j_net_curr.toFixed(3)} A/m²</span></div>
                    <div class="stat-row"><span>Reaction State:</span><span class="mono" style="color: ${statusColor}; font-weight:bold;">${statusText}</span></div>
                    <div class="stat-row"><span>Red/Ox Particle Ratio:</span><span class="mono">${redCount} / ${oxCount}</span></div>
                `;
            }
        };

const activeEqKey = "butler";
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
            btnPlay.textContent = "\u23f8 Pause";
            btnPlay.classList.add("btn-danger");
            animate();
        } else {
            isRunning = false;
            btnPlay.textContent = "\u25b6 Start";
            btnPlay.classList.remove("btn-danger");
            if (animId) cancelAnimationFrame(animId);
        }
    });
}

if (btnReset) {
    btnReset.addEventListener("click", () => {
        isRunning = false;
        if (btnPlay) {
            btnPlay.textContent = "\u25b6 Start";
            btnPlay.classList.remove("btn-danger");
        }
        if (animId) cancelAnimationFrame(animId);
        eqConfig.init();
        if (activeEqKey === "navier") {
            for (let step = 0; step < 12; step++) {
                eqConfig.solve();
            }
        } else {
            eqConfig.solve();
        }
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
function animate() {
    if (!isRunning) return;
    try {
        eqConfig.solve();
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
    // Set up playback box visibility
    if (isAnimated) {
        playbackBox.style.display = "flex";
        btnPlay.textContent = isRunning ? "\u23f8 Pause" : "\u25b6 Start";
    } else {
        playbackBox.style.display = "none";
    }

    // Generate sliders dynamically
    initSliders(eqConfig.sliders);
    
    // Call init and initial sizing/drawing
    eqConfig.init();
    resizeCanvas();
    
    if (activeEqKey === "navier") {
        for (let step = 0; step < 12; step++) {
            eqConfig.solve();
        }
    } else {
        eqConfig.solve();
    }
    eqConfig.draw();
});
