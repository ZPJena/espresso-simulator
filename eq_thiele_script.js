// Controller script for eq_thiele.html
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
// Thiele state (Monte Carlo reactant and product particles)
let thieleReactants = [];
let thieleProducts = [];

// Configuration Object for this specific equation
const eqConfig = {
            title: "Thiele Modulus & Pore Effectiveness (Intraparticle Catalysis)",
            badge: "L6 Heterogeneous Catalysis / L7 Reactors",
            formula: "\\[ \\Phi = R_0 \\cdot \\sqrt{\\frac{k_v}{D_{eff}}} \\quad \\text{und} \\quad \\eta_P = \\frac{3}{\\Phi} \\left( \\frac{1}{\\tanh(\\Phi)} - \\frac{1}{\\Phi} \\right) \\]",
            desc: "The Thiele modulus Φ evaluates the ratio of intrinsic reaction rate to intraparticle diffusion rate inside a porous catalyst pellet. At high Thiele modulus (Φ > 3), the reactant is consumed rapidly in the outer shell of the pellet, before it can diffuse into the core. The inner core of the catalyst remains unused (diffusion bottleneck), causing the pore effectiveness factor η_P to drop significantly. The 2D Monte Carlo particle simulation on the left visualizes reactant molecules (orange) diffusing inward from the surface ($r = R_0$) and reacting to form products (purple).",
            isAnimated: true,
            sliders: [
                { id: "k", label: "Reaction Rate Constant (k_v)", min: 0.1, max: 20.0, step: 0.5, val: 4.0 },
                { id: "deff", label: "Effective Diffusivity (D_eff in 10⁻⁶ m²/s)", min: 0.2, max: 4.0, step: 0.1, val: 1.0 },
                { id: "R0", label: "Pellet Radius (R₀ in mm)", min: 1.0, max: 5.0, step: 0.2, val: 2.5 },
                { id: "simSpeed", label: "Simulation Speed", min: 0.2, max: 4.0, step: 0.2, val: 1.0 }
            ],
            init: () => {
                thieleReactants = [];
                thieleProducts = [];
                
                const w = canvas.width || 550;
                const h_canvas = canvas.height || 420;
                const leftMargin = 55;
                const gap = 35;
                const panelW = (w - leftMargin - 40 - gap) / 2;
                const cx = leftMargin + panelW / 2;
                const cy = 40 + (h_canvas - 110) / 2;
                const Rp = 80; // pellet radius in pixels

                // Initialize 120 reactant particles inside the pellet representing the starting state
                for (let i = 0; i < 120; i++) {
                    const r = Math.sqrt(Math.random()) * Rp;
                    const angle = Math.random() * 2 * Math.PI;
                    thieleReactants.push({
                        x: cx + r * Math.cos(angle),
                        y: cy + r * Math.sin(angle)
                    });
                }
            },
            reset: () => {
                eqConfig.init();
            },
            solve: () => {
                const k = parameters["k"];
                const D_eff_val = parameters["deff"];
                const D_eff = D_eff_val * 1e-6;
                const R0 = parameters["R0"] * 1e-3; // mm to m

                // Thiele Modulus for spherical particle: R0 * sqrt(k / Deff)
                const Phi = R0 * Math.sqrt(k / D_eff);

                // Pore efficiency eta_p
                let eta_p = 1.0;
                if (Phi > 0.01) {
                    eta_p = (3.0 / Phi) * (1.0 / Math.tanh(Phi) - 1.0 / Phi);
                }

                parameters["_Phi"] = Phi;
                parameters["_eta_p"] = eta_p;

                if (isRunning) {
                    const w = canvas.width || 550;
                    const h_canvas = canvas.height || 420;
                    const leftMargin = 55;
                    const gap = 35;
                    const panelW = (w - leftMargin - 40 - gap) / 2;
                    const cx = leftMargin + panelW / 2;
                    const cy = 40 + (h_canvas - 110) / 2;
                    const Rp = 80; // pellet radius in pixels

                    const diffSpeed = Math.sqrt(D_eff_val) * 5.0;

                    // Calculate reaction probability based on Thiele Modulus for perfect visual match
                    const scaleFactor = 0.0003;
                    const P_rx = Math.min(1.0, scaleFactor * diffSpeed * diffSpeed * Phi * Phi);

                    // 1. Update reactant particles (diffusion + reaction)
                    thieleReactants.forEach(p => {
                        // Isotropic random walk
                        p.x += (Math.random() - 0.5) * diffSpeed;
                        p.y += (Math.random() - 0.5) * diffSpeed;

                        const r = Math.hypot(p.x - cx, p.y - cy);
                        
                        if (r < Rp) {
                            if (Math.random() < P_rx) {
                                // React! Turn into product particle
                                thieleProducts.push({
                                    x: p.x,
                                    y: p.y,
                                    alpha: 1.0,
                                    vx: (p.x - cx) / r * 0.8, // drifts outwards along pore radius
                                    vy: (p.y - cy) / r * 0.8
                                });
                                p.remove = true;
                            }
                        } else {
                            // If it wanders outside the boundary, remove it (re-evaluated at boundary)
                            p.remove = true;
                        }
                    });

                    // Filter out reacted/escaped reactants
                    thieleReactants = thieleReactants.filter(p => !p.remove);

                    // 2. Update product particles (fade and diffuse outwards)
                    thieleProducts.forEach(p => {
                        p.x += p.vx + (Math.random() - 0.5) * diffSpeed * 0.4;
                        p.y += p.vy + (Math.random() - 0.5) * diffSpeed * 0.4;
                        p.alpha -= 0.025; // fade rate
                    });
                    thieleProducts = thieleProducts.filter(p => p.alpha > 0.01);

                    // 3. Maintain constant surface concentration at the outer boundary (r = Rp)
                    while (thieleReactants.length < 150) {
                        const angle = Math.random() * 2 * Math.PI;
                        thieleReactants.push({
                            x: cx + Rp * Math.cos(angle),
                            y: cy + Rp * Math.sin(angle)
                        });
                    }
                }
            },
            draw: () => {
                ctx.fillStyle = "#040507";
                ctx.fillRect(0, 0, canvas.width, canvas.height);

                const Phi = parameters["_Phi"] || 0;
                const eta_p = parameters["_eta_p"] || 1.0;

                const w = canvas.width || 550;
                const h_canvas = canvas.height || 420;
                const leftMargin = 55;
                const gap = 35;
                const panelW = (w - leftMargin - 40 - gap) / 2;
                const panelH = h_canvas - 110;
                const cx = leftMargin + panelW / 2;
                const cy = 40 + panelH / 2;
                const Rp = 80; // pellet radius in pixels
                const rx = leftMargin + panelW + gap;
                const plotH = 105;

                // Left Panel: Microscopic circular catalyst pellet
                ctx.strokeStyle = "rgba(255,255,255,0.06)";
                ctx.strokeRect(leftMargin, 40, panelW, panelH);

                // Shaded porous solid phase (soft gray/glassmorphic fill)
                ctx.fillStyle = "rgba(255, 255, 255, 0.025)";
                ctx.beginPath();
                ctx.arc(cx, cy, Rp, 0, 2 * Math.PI);
                ctx.fill();

                // Circular boundary line
                ctx.strokeStyle = "rgba(255, 255, 255, 0.2)";
                ctx.lineWidth = 2.0;
                ctx.stroke();

                // Draw active shell (visual penetration depth)
                const penetrationDepth = Rp / Math.max(1.0, Phi);
                ctx.strokeStyle = "rgba(0, 210, 255, 0.15)";
                ctx.lineWidth = Math.min(Rp, penetrationDepth);
                ctx.beginPath();
                ctx.arc(cx, cy, Rp - ctx.lineWidth / 2, 0, 2 * Math.PI);
                ctx.stroke();
                ctx.lineWidth = 1.0; // reset

                // Draw reactant particles (orange dots)
                thieleReactants.forEach(p => {
                    ctx.fillStyle = "#ff9f43";
                    ctx.beginPath();
                    ctx.arc(p.x, p.y, 3.0, 0, 2 * Math.PI);
                    ctx.fill();
                });

                // Draw product particles (purple fading dots)
                thieleProducts.forEach(p => {
                    ctx.fillStyle = `rgba(168, 85, 247, ${p.alpha})`;
                    ctx.beginPath();
                    ctx.arc(p.x, p.y, 3.0, 0, 2 * Math.PI);
                    ctx.fill();
                });

                // Title and Labels on left panel
                ctx.fillStyle = "#fff";
                ctx.font = "bold 9px Outfit";
                ctx.textAlign = "left";
                ctx.fillText("Microscopic Pore Diffusion (Monte Carlo)", leftMargin, 32);

                ctx.fillStyle = "rgba(255, 255, 255, 0.4)";
                ctx.font = "8px Outfit";
                ctx.textAlign = "center";
                ctx.fillText("Catalyst Pellet (R₀)", cx, cy + Rp + 14);

                // Right Panel: Plots and profiles
                const getXCoordTop = (r_pct) => rx + r_pct * panelW; // r_pct in [0, 1.0]
                const getYCoordTop = (c_pct) => 45 + plotH - (c_pct / 100) * plotH; // c_pct in [0, 100]

                const getXCoordBottom = (pVal) => rx + (pVal / 10.0) * panelW; // Phi in [0, 10.0]
                const getYCoordBottom = (eVal) => 210 + plotH - eVal * plotH; // eta_p in [0, 1.0]

                // Draw Top Plot card border
                ctx.strokeStyle = "rgba(255,255,255,0.06)";
                ctx.strokeRect(rx, 45, panelW, plotH);

                // Draw Top Grid
                ctx.strokeStyle = "rgba(255,255,255,0.04)";
                ctx.lineWidth = 1;
                for (let i = 1; i < 5; i++) {
                    const r_pct = i / 5;
                    ctx.beginPath();
                    ctx.moveTo(getXCoordTop(r_pct), 45);
                    ctx.lineTo(getXCoordTop(r_pct), 45 + plotH);
                    ctx.stroke();

                    const c_pct = i * 20;
                    ctx.beginPath();
                    ctx.moveTo(rx, getYCoordTop(c_pct));
                    ctx.lineTo(rx + panelW, getYCoordTop(c_pct));
                    ctx.stroke();
                }

                // Draw analytical curve of c(r)
                ctx.strokeStyle = "#ff9f43";
                ctx.lineWidth = 3.0;
                ctx.beginPath();
                const sinh = (x) => 0.5 * (Math.exp(x) - Math.exp(-x));
                for (let i = 0; i <= 50; i++) {
                    const r_pct = i / 50;
                    let c_pct;
                    if (Phi > 50.0) {
                        c_pct = r_pct < 0.002 ? 0.0 : 100.0 * (1.0 / r_pct) * Math.exp(Phi * (r_pct - 1.0));
                    } else {
                        if (r_pct < 0.002) {
                            c_pct = Phi < 0.01 ? 100.0 : 100.0 * Phi / sinh(Phi);
                        } else {
                            c_pct = Phi < 0.01 ? 100.0 : 100.0 * (1.0 / r_pct) * sinh(Phi * r_pct) / sinh(Phi);
                        }
                    }
                    c_pct = Math.max(0.0, Math.min(100.0, c_pct));
                    if (i === 0) ctx.moveTo(getXCoordTop(r_pct), getYCoordTop(c_pct));
                    else ctx.lineTo(getXCoordTop(r_pct), getYCoordTop(c_pct));
                }
                ctx.stroke();

                // Top Axes
                ctx.strokeStyle = "rgba(255,255,255,0.2)";
                ctx.beginPath();
                ctx.moveTo(rx, 45); ctx.lineTo(rx, 45 + plotH); ctx.lineTo(rx + panelW, 45 + plotH);
                ctx.stroke();

                // Top Axis Ticks & Labels
                ctx.fillStyle = "rgba(255,255,255,0.4)";
                ctx.font = "8px 'JetBrains Mono', monospace";
                ctx.textAlign = "right";
                ctx.fillText("1.0", rx - 6, 48);
                ctx.fillText("0.5", rx - 6, 45 + plotH / 2 + 3);
                ctx.fillText("0", rx - 6, 45 + plotH);

                ctx.textAlign = "center";
                ctx.fillText("0", getXCoordTop(0.0), 45 + plotH + 11);
                ctx.fillText("0.5", getXCoordTop(0.5), 45 + plotH + 11);
                ctx.fillText("1.0", getXCoordTop(1.0), 45 + plotH + 11);

                ctx.fillStyle = "#fff";
                ctx.font = "bold 9px Outfit";
                ctx.textAlign = "left";
                ctx.fillText("Concentration Profile c(r)/c₀", rx, 36);

                ctx.fillStyle = "rgba(255,255,255,0.5)";
                ctx.font = "8px Outfit";
                ctx.fillText("Radius r/R₀ [-]", rx + panelW / 2 - 25, 45 + plotH + 20);

                // Draw Bottom Plot card border
                ctx.strokeStyle = "rgba(255,255,255,0.06)";
                ctx.strokeRect(rx, 210, panelW, plotH);

                // Draw Bottom Grid
                ctx.strokeStyle = "rgba(255,255,255,0.04)";
                for (let i = 1; i < 5; i++) {
                    const pVal = i * 2.0;
                    ctx.beginPath();
                    ctx.moveTo(getXCoordBottom(pVal), 210);
                    ctx.lineTo(getXCoordBottom(pVal), 210 + plotH);
                    ctx.stroke();

                    const eVal = i / 5;
                    ctx.beginPath();
                    ctx.moveTo(rx, getYCoordBottom(eVal));
                    ctx.lineTo(rx + panelW, getYCoordBottom(eVal));
                    ctx.stroke();
                }

                // Draw eta_p vs Phi curve (blue line)
                ctx.strokeStyle = "#00d2ff";
                ctx.lineWidth = 2.0;
                ctx.beginPath();
                for (let pVal = 0.05; pVal <= 10.0; pVal += 0.2) {
                    const ep = (3.0 / pVal) * (1.0 / Math.tanh(pVal) - 1.0 / pVal);
                    if (pVal === 0.05) ctx.moveTo(getXCoordBottom(pVal), getYCoordBottom(ep));
                    else ctx.lineTo(getXCoordBottom(pVal), getYCoordBottom(ep));
                }
                ctx.stroke();

                // Draw active operating point dot on curve (red)
                const dotPhi = Math.min(10.0, Phi);
                const dotEta = (3.0 / dotPhi) * (1.0 / Math.tanh(dotPhi) - 1.0 / dotPhi);
                ctx.fillStyle = "#ff4d4d";
                ctx.beginPath();
                ctx.arc(getXCoordBottom(dotPhi), getYCoordBottom(dotEta), 5, 0, 2*Math.PI);
                ctx.fill();

                // Bottom Axes
                ctx.strokeStyle = "rgba(255,255,255,0.2)";
                ctx.beginPath();
                ctx.moveTo(rx, 210); ctx.lineTo(rx, 210 + plotH); ctx.lineTo(rx + panelW, 210 + plotH);
                ctx.stroke();

                // Bottom Axis Ticks & Labels
                ctx.fillStyle = "rgba(255,255,255,0.4)";
                ctx.font = "8px 'JetBrains Mono', monospace";
                ctx.textAlign = "right";
                ctx.fillText("100%", rx - 6, 213);
                ctx.fillText("50%", rx - 6, 210 + plotH / 2 + 3);
                ctx.fillText("0%", rx - 6, 210 + plotH);

                ctx.textAlign = "center";
                ctx.fillText("0", getXCoordBottom(0.0), 210 + plotH + 11);
                ctx.fillText("5.0", getXCoordBottom(5.0), 210 + plotH + 11);
                ctx.fillText("10.0", getXCoordBottom(10.0), 210 + plotH + 11);

                ctx.fillStyle = "#fff";
                ctx.font = "bold 9px Outfit";
                ctx.textAlign = "left";
                ctx.fillText("Effectiveness η_P vs. Thiele Modulus Φ", rx, 201);

                ctx.fillStyle = "rgba(255,255,255,0.5)";
                ctx.font = "8px Outfit";
                ctx.fillText("Thiele Modulus Φ [-]", rx + panelW / 2 - 40, 210 + plotH + 20);

                // Draw legends (in the upper-left inside the left panel)
                drawLegend([
                    { color: "#ff9f43", label: "Reactant (A)" },
                    { color: "rgb(168, 85, 247)", label: "Product (P)" },
                    { color: "rgba(0, 210, 255, 0.4)", label: "Active Catalytic Shell" }
                ], leftMargin + 10, 52);

                // Output calculations
                outputsList.innerHTML = `
                    <div class="stat-row"><span>Thiele Modulus (Φ):</span><span class="mono text-orange" style="font-weight:bold; font-size:1.05rem;">${Phi.toFixed(3)}</span></div>
                    <div class="stat-row"><span>Pore Effectiveness (η_P):</span><span class="mono text-blue" style="font-weight:bold; font-size:1.05rem;">${(eta_p * 100).toFixed(1)} %</span></div>
                    <div class="stat-row"><span>Rate Limitation:</span><span class="mono" style="color: ${Phi > 3.0 ? '#ff4d4d' : '#39d353'};">
                        ${Phi > 3.0 ? 'Intraparticle Diffusion Control' : 'Kinetic Control (Ideal)'}
                    </span></div>
                `;
            }
        };

const activeEqKey = "thiele";
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
