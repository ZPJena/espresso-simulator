// Controller script for eq_twofilm.html
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
            title: "Two-Film Theory (Lewis and Whitman)",
            badge: "L7 Macrokinetics / L12 Extraction",
            formula: "\\[ j = K_L \\left( \\frac{p_{g}}{H} - c_{l} \\right) \\quad \\text{mit} \\quad \\frac{1}{K_L} = \\frac{1}{k_l} + \\frac{R T}{H \\cdot k_g} \\]",
            desc: "The Two-Film theory describes mass transfer across phase boundaries (e.g. gas-liquid absorption or liquid-liquid extraction). Inside the bulk phases, concentrations are uniform due to convection, but near the interface (y=0) stagnant boundary films exist where transfer occurs purely by diffusion. At the interface, thermodynamic equilibrium is established (Henry's distribution law with coefficient H). The simulation calculates the concentration jump at the interface and indicates which film presents the dominant transport resistance.<br><br><strong>Plot View Mode</strong>: Use the dropdown to switch between <strong>Concentration View</strong> (where solubility differences create a sharp concentration jump at the interface) and <strong>Activity View</strong>. Notice that thermodynamic activity ($a$) is **completely continuous** across the phase interface because chemical potential is continuous at equilibrium. In Activity View, the solute tracer molecules also flow continuously without a density step change at the interface, visually demonstrating that the driving force is continuous.",
            isAnimated: true,
            sliders: [
                { id: "deltag", label: "Gas Film Thickness (δ_g in μm)", min: 10, max: 100, step: 5, val: 50 },
                { id: "deltal", label: "Liquid Film Thickness (δ_l in μm)", min: 10, max: 100, step: 5, val: 50 },
                { id: "kg", label: "Gas Mass Transfer Coefficient (k_g)", min: 0.1, max: 5.0, step: 0.1, val: 1.5 },
                { id: "kl", label: "Liquid Mass Transfer Coefficient (k_l)", min: 0.1, max: 5.0, step: 0.1, val: 1.0 },
                { id: "henry", label: "Henry Partition Coefficient (H)", min: 0.5, max: 4.0, step: 0.1, val: 1.8 },
                { 
                    id: "viewMode", 
                    label: "Plot View Mode", 
                    isSelect: true, 
                    options: [
                        { val: 0, text: "Concentration View (c) - Discontinuous" },
                        { val: 1, text: "Activity View (a = H·c in Liquid) - Continuous" }
                    ], 
                    val: 0 
                }
            ],
            init: () => {
                t = 0.0;
                diffusionParticles = [];
                // Create mass transfer tracer dots (increased to 80 for concentration-proportional density visualization)
                for (let i = 0; i < 80; i++) {
                    diffusionParticles.push({
                        progress: Math.random(), // progress along path from 0 (left) to 1 (right)
                        offsetY: (Math.random() - 0.5) * 15 // vertical random dispersion in bulk phases
                    });
                }
            },
            reset: () => {
                equationsConfig.twofilm.init();
            },
            solve: () => {
                const deltag = parameters["deltag"];
                const deltal = parameters["deltal"];
                const kg = parameters["kg"];
                const kl = parameters["kl"];
                const H = parameters["henry"];

                // Boundary Concentrations (fixed bulk)
                const C_g_bulk = 50.0; // mol/m3
                const C_l_bulk = 5.0;  // mol/m3

                // Steady state continuity flux: j_g = j_l = j
                const C_l_int = (kg * C_g_bulk + kl * C_l_bulk) / (kl + kg * H);
                const C_g_int = H * C_l_int;

                // Overall liquid coefficient KL
                const invKL = (1.0 / kl) + (1.0 / (H * kg));
                const KL = 1.0 / invKL;
                const flux = KL * (C_g_bulk / H - C_l_bulk);

                // Store variables
                parameters["_cg_bulk"] = C_g_bulk;
                parameters["_cg_int"] = C_g_int;
                parameters["_cl_int"] = C_l_int;
                parameters["_cl_bulk"] = C_l_bulk;
                parameters["_KL"] = KL;
                parameters["_flux"] = flux;

                // Move diffusion particles along profiles based on mass flux
                // In CDF mapping, p.progress shifts at a constant rate proportional to flux.
                // Wrap-around handles the continuous left-to-right flow loop.
                const speed = 0.003 * (flux / 10.0);
                if (diffusionParticles) {
                    diffusionParticles.forEach(p => {
                        p.progress += speed;
                        if (p.progress > 1.0) p.progress -= 1.0;
                        if (p.progress < 0.0) p.progress += 1.0;
                    });
                }
            },
            draw: () => {
                ctx.fillStyle = "#040507";
                ctx.fillRect(0, 0, canvas.width, canvas.height);

                const deltag = parameters["deltag"];
                const deltal = parameters["deltal"];
                const kg = parameters["kg"];
                const kl = parameters["kl"];
                const H = parameters["henry"];
                const viewMode = parseInt(parameters["viewMode"] || 0);

                const cg_bulk = parameters["_cg_bulk"];
                const cg_int = parameters["_cg_int"];
                const cl_int = parameters["_cl_int"];
                const cl_bulk = parameters["_cl_bulk"];
                const KL = parameters["_KL"] || 0;
                const flux = parameters["_flux"] || 0;

                const cx = canvas.width / 2; // interface line
                const cy_zero = canvas.height - 70; // zero concentration level

                const maxDelta = 100.0;
                const scaleX = (cx - 50) / maxDelta; // dynamically scales with canvas.width to prevent boundaries from collapsing
                const scaleY = (canvas.height - 120) / 60.0; // px per mol/m3

                const gx_bulk = cx - deltag * scaleX;
                const lx_bulk = cx + deltal * scaleX;

                // Coordinate converters for the plot area
                const getX = (yVal) => cx + yVal * scaleX;
                const getY = (cVal) => cy_zero - cVal * scaleY;

                // Draw phase background shading
                // 1. Gas-side Bulk (solid orange tint)
                ctx.fillStyle = "rgba(255, 159, 67, 0.04)";
                ctx.fillRect(40, 40, gx_bulk - 40, canvas.height - 110);
                
                // 2. Gas stagnant film (faint orange-gray tint)
                ctx.fillStyle = "rgba(255, 159, 67, 0.015)";
                ctx.fillRect(gx_bulk, 40, cx - gx_bulk, canvas.height - 110);

                // 3. Liquid stagnant film (faint blue-gray tint)
                ctx.fillStyle = "rgba(0, 210, 255, 0.015)";
                ctx.fillRect(cx, 40, lx_bulk - cx, canvas.height - 110);

                // 4. Liquid-side Bulk (solid blue tint)
                ctx.fillStyle = "rgba(0, 210, 255, 0.04)";
                ctx.fillRect(lx_bulk, 40, canvas.width - 40 - lx_bulk, canvas.height - 110);

                // Draw Grid & Ticks (makes the plot look professional)
                ctx.strokeStyle = "rgba(255, 255, 255, 0.05)";
                ctx.lineWidth = 1;
                
                // Horizontal lines & Concentration labels
                ctx.fillStyle = "rgba(255, 255, 255, 0.4)";
                ctx.font = "9px Outfit";
                ctx.textAlign = "right";
                for (let cVal = 10; cVal <= 60; cVal += 10) {
                    const y = getY(cVal);
                    ctx.beginPath();
                    ctx.moveTo(40, y);
                    ctx.lineTo(canvas.width - 40, y);
                    ctx.stroke();
                    ctx.fillText(cVal.toString(), 35, y + 3);
                }

                // Vertical grid lines & Spatial coordinate labels
                ctx.textAlign = "center";
                const xTicks = [-100, -50, 0, 50, 100];
                xTicks.forEach(yVal => {
                    const x = getX(yVal);
                    ctx.beginPath();
                    ctx.moveTo(x, 40);
                    ctx.lineTo(x, cy_zero);
                    ctx.stroke();
                    // Tick labels
                    ctx.fillText((yVal > 0 ? "+" : "") + yVal.toString(), x, cy_zero + 15);
                });

                // Draw stagnant film boundaries (dashed vertical lines)
                ctx.strokeStyle = "rgba(255, 255, 255, 0.15)";
                ctx.lineWidth = 1.0;
                ctx.setLineDash([4, 4]);
                
                ctx.beginPath();
                ctx.moveTo(gx_bulk, 40);
                ctx.lineTo(gx_bulk, cy_zero);
                ctx.stroke();
                
                ctx.beginPath();
                ctx.moveTo(lx_bulk, 40);
                ctx.lineTo(lx_bulk, cy_zero);
                ctx.stroke();
                ctx.setLineDash([]);

                // Draw interface line (solid center line)
                ctx.strokeStyle = "rgba(255, 255, 255, 0.35)";
                ctx.lineWidth = 2;
                ctx.beginPath();
                ctx.moveTo(cx, 40);
                ctx.lineTo(cx, cy_zero);
                ctx.stroke();

                // Plot values (if viewMode === 1, Cc and Cd are scaled to represent continuous activity)
                const Ca = cg_bulk;
                const Cb = cg_int;
                const Cc = (viewMode === 1) ? cg_int : cl_int;
                const Cd = (viewMode === 1) ? H * cl_bulk : cl_bulk;

                // Draw Gas concentration profile (orange curve)
                ctx.strokeStyle = "#ff9f43";
                ctx.lineWidth = 3;
                ctx.beginPath();
                ctx.moveTo(40, getY(Ca));
                ctx.lineTo(gx_bulk, getY(Ca)); // flat bulk
                ctx.lineTo(cx, getY(Cb)); // linear film gradient
                ctx.stroke();

                // Draw Liquid concentration profile (blue curve)
                ctx.strokeStyle = "#00d2ff";
                ctx.lineWidth = 3;
                ctx.beginPath();
                ctx.moveTo(cx, getY(Cc)); // interface jump value
                ctx.lineTo(lx_bulk, getY(Cd)); // linear film gradient
                ctx.lineTo(canvas.width - 40, getY(Cd)); // flat bulk
                ctx.stroke();

                // Draw Interface Equilibrium jump line (dotted red line connecting jumps)
                // Only drawn in Concentration View (viewMode === 0) since Activity is continuous
                if (viewMode === 0) {
                    ctx.strokeStyle = "rgba(255, 77, 77, 0.6)";
                    ctx.lineWidth = 1.5;
                    ctx.setLineDash([3, 3]);
                    ctx.beginPath();
                    ctx.moveTo(cx, getY(Cb));
                    ctx.lineTo(cx, getY(Cc));
                    ctx.stroke();
                    ctx.setLineDash([]);
                }

                // Interface Dots (concentration boundary points)
                ctx.fillStyle = "#ff9f43";
                ctx.beginPath(); ctx.arc(cx, getY(Cb), 5, 0, 2*Math.PI); ctx.fill();
                if (viewMode === 0) {
                    ctx.fillStyle = "#00d2ff";
                    ctx.beginPath(); ctx.arc(cx, getY(Cc), 5, 0, 2*Math.PI); ctx.fill();
                }

                // Draw dynamic diffusion tracers flowing along the profiles
                // We use Inverse Cumulative Distribution Function (CDF) mapping to distribute particles.
                // Clamping is added to prevent float-rounding from generating negative values or NaNs in Math.sqrt,
                // which prevents strict canvas engines from freezing.
                if (diffusionParticles) {
                    const x0 = 40;
                    const x1 = gx_bulk;
                    const x2 = cx;
                    const x3 = lx_bulk;
                    const x4 = canvas.width - 40;

                    // Integrals of concentration profiles across segments
                    const A1 = Ca * (x1 - x0);
                    const A2 = 0.5 * (Ca + Cb) * (x2 - x1);
                    const A3 = 0.5 * (Cc + Cd) * (x3 - x2);
                    const A4 = Cd * (x4 - x3);
                    const A_tot = A1 + A2 + A3 + A4;

                    // Normalized boundaries in the CDF domain [0, 1]
                    const P1 = A1 / A_tot;
                    const P2 = (A1 + A2) / A_tot;
                    const P3 = (A1 + A2 + A3) / A_tot;

                    // Helper to map particle progress [0, 1] to physical X-coordinate
                    const getXFromProgress = (p) => {
                        if (p <= P1) {
                            const p_prime = Math.max(0.0, Math.min(1.0, p / P1));
                            return x0 + p_prime * (x1 - x0);
                        } else if (p <= P2) {
                            const p_prime = Math.max(0.0, Math.min(1.0, (p - P1) / (P2 - P1)));
                            const c_diff = Cb - Ca;
                            if (Math.abs(c_diff) < 1e-4) {
                                return x1 + p_prime * (x2 - x1);
                            } else {
                                // Solve quadratic area accumulation for linear profile
                                // Clamp the term inside the square root to be at least 0 to prevent NaN
                                const root_val = Math.max(0.0, Ca * Ca + p_prime * (Cb * Cb - Ca * Ca));
                                const t = (-Ca + Math.sqrt(root_val)) / c_diff;
                                return x1 + t * (x2 - x1);
                            }
                        } else if (p <= P3) {
                            const p_prime = Math.max(0.0, Math.min(1.0, (p - P2) / (P3 - P2)));
                            const c_diff = Cd - Cc;
                            if (Math.abs(c_diff) < 1e-4) {
                                return x2 + p_prime * (x3 - x2);
                            } else {
                                // Solve quadratic area accumulation for linear profile
                                // Clamp the term inside the square root to be at least 0 to prevent NaN
                                const root_val = Math.max(0.0, Cc * Cc + p_prime * (Cd * Cd - Cc * Cc));
                                const t = (-Cc + Math.sqrt(root_val)) / c_diff;
                                return x2 + t * (x3 - x2);
                            }
                        } else {
                            const p_prime = Math.max(0.0, Math.min(1.0, (p - P3) / (1.0 - P3)));
                            return x3 + p_prime * (x4 - x3);
                        }
                    };

                    diffusionParticles.forEach(p => {
                        const px = getXFromProgress(p.progress);

                        // Find concentration value at px to position particle vertically on the curve
                        let val = Ca;
                        if (px < x1) {
                            val = Ca;
                        } else if (px < x2) {
                            const t = (px - x1) / (x2 - x1);
                            val = Ca + t * (Cb - Ca);
                        } else if (px < x3) {
                            const t = (px - x2) / (x3 - x2);
                            val = Cc + t * (Cd - Cc);
                        } else {
                            val = Cd;
                        }

                        const py = getY(val) + p.offsetY;

                        // Defensive check: ignore drawing if coordinates are non-finite (prevents freezing)
                        if (!isFinite(px) || !isFinite(py)) return;

                        // Add small random thermal jitter (molecular Brownian motion simulation)
                        const jitterX = (Math.random() - 0.5) * 2.5;
                        const jitterY = (Math.random() - 0.5) * 2.5;

                        // Color particles: orange in gas phase, blue in liquid phase to show absorption/solvation
                        if (px < cx) {
                            ctx.fillStyle = "rgba(255, 159, 67, 0.9)";
                        } else {
                            ctx.fillStyle = "rgba(0, 210, 255, 0.9)";
                        }

                        ctx.beginPath();
                        ctx.arc(px + jitterX, py + jitterY, 2.5, 0, 2 * Math.PI);
                        ctx.fill();
                    });
                }

                // Labeled Axes
                drawPhysicalAxes(
                    "Spatial Coordinate (Distance to Interface) y [μm]", 
                    viewMode === 1 ? "Activity a [mol/m³] (a = H·c in Liquid)" : "Concentration c [mol/m³]", 
                    -120, 120, 0, 60
                );

                // Add text labels on the plot
                ctx.fillStyle = "rgba(255, 255, 255, 0.5)";
                ctx.font = "bold 9px Outfit";
                ctx.textAlign = "center";
                ctx.fillText("GAS PHASE", (40 + gx_bulk) / 2, 55);
                ctx.fillText("LIQUID PHASE", (lx_bulk + canvas.width - 40) / 2, 55);
                
                ctx.fillStyle = "rgba(255, 159, 67, 0.6)";
                ctx.fillText("Gas Film (δ_g)", (gx_bulk + cx) / 2, 55);
                ctx.fillStyle = "rgba(0, 210, 255, 0.6)";
                ctx.fillText("Liquid Film (δ_l)", (cx + lx_bulk) / 2, 55);
                
                ctx.fillStyle = "rgba(255, 255, 255, 0.6)";
                ctx.fillText("Interface", cx, 30);

                // Draw dimension arrows/indicators for δ_g and δ_l near the bottom
                const dimY = cy_zero - 15;
                
                // Gas film thickness indicator
                ctx.strokeStyle = "rgba(255, 159, 67, 0.4)";
                ctx.lineWidth = 1;
                ctx.beginPath();
                ctx.moveTo(gx_bulk, dimY);
                ctx.lineTo(cx, dimY);
                ctx.stroke();
                // Little end caps
                ctx.beginPath();
                ctx.moveTo(gx_bulk, dimY - 3); ctx.lineTo(gx_bulk, dimY + 3);
                ctx.moveTo(cx, dimY - 3); ctx.lineTo(cx, dimY + 3);
                ctx.stroke();
                // Label
                ctx.fillStyle = "rgba(255, 159, 67, 0.7)";
                ctx.font = "8px 'JetBrains Mono', monospace";
                ctx.fillText(`δ_g = ${deltag}μm`, (gx_bulk + cx) / 2, dimY - 4);

                // Liquid film thickness indicator
                ctx.strokeStyle = "rgba(0, 210, 255, 0.4)";
                ctx.lineWidth = 1;
                ctx.beginPath();
                ctx.moveTo(cx, dimY);
                ctx.lineTo(lx_bulk, dimY);
                ctx.stroke();
                // Little end caps
                ctx.beginPath();
                ctx.moveTo(cx, dimY - 3); ctx.lineTo(cx, dimY + 3);
                ctx.moveTo(lx_bulk, dimY - 3); ctx.lineTo(lx_bulk, dimY + 3);
                ctx.stroke();
                // Label
                ctx.fillStyle = "rgba(0, 210, 255, 0.7)";
                ctx.font = "8px 'JetBrains Mono', monospace";
                ctx.fillText(`δ_l = ${deltal}μm`, (cx + lx_bulk) / 2, dimY - 4);

                // Draw concentration markers on the curves
                ctx.font = "bold 9px 'JetBrains Mono', monospace";
                ctx.fillStyle = "#ff9f43";
                ctx.fillText(viewMode === 1 ? `a_g,bulk = ${Ca.toFixed(0)}` : `c_g,bulk = ${Ca.toFixed(0)}`, 100, getY(Ca) - 8);
                ctx.fillText(viewMode === 1 ? `a_g,int = ${Cb.toFixed(1)}` : `c_g,int = ${Cb.toFixed(1)}`, cx - 55, getY(Cb) - 5);
                
                ctx.fillStyle = "#00d2ff";
                if (viewMode === 1) {
                    ctx.fillText(`a_l,int = ${Cb.toFixed(1)}`, cx + 55, getY(Cb) + 12);
                    ctx.fillText(`a_l,bulk = ${Cd.toFixed(1)}`, canvas.width - 100, getY(Cd) - 8);
                } else {
                    ctx.fillText(`c_l,int = ${Cc.toFixed(1)}`, cx + 55, getY(Cc) + 12);
                    ctx.fillText(`c_l,bulk = ${Cd.toFixed(0)}`, canvas.width - 100, getY(Cd) - 8);
                }

                // Legend
                drawLegend([
                    { color: "#ff9f43", label: viewMode === 1 ? "Activity a_gas" : "C_gas in Gas Phase" },
                    { color: "#00d2ff", label: viewMode === 1 ? "Activity a_liq (H·C_liq)" : "C_liq in Liquid Phase" },
                    { color: "rgba(255, 255, 255, 0.4)", label: "Phase Interface (y=0)" }
                ]);

                // Output metrics
                outputsList.innerHTML = `
                    <div class="stat-row"><span>Total Mass Flux (j):</span><span class="mono text-orange">${flux.toFixed(3)} mol/(m²·s)</span></div>
                    <div class="stat-row"><span>Overall Coefficient K_L:</span><span class="mono">${KL.toFixed(3)} m/s</span></div>
                    <div class="stat-row"><span>Concentration Jump C_g/C_l:</span><span class="mono">${H.toFixed(1)}x (Henry)</span></div>
                    <div class="stat-row"><span>Resistance Dominant in:</span><span class="mono" style="color: ${1/kl > 1/(H*kg) ? '#00d2ff' : '#ff9f43'};">${1/kl > 1/(H*kg) ? 'Liquid Film (1/k_l)' : 'Gas Film (1/H·k_g)'}</span></div>
                `;
            }
        };

const activeEqKey = "twofilm";
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
