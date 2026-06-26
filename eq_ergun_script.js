// Controller script for eq_ergun.html
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
            title: "Ergun Equation (Packed-Bed Pressure Drop)",
            badge: "L12 Extraction / L13 Drying",
            formula: "\\[ \\frac{\\Delta p}{L} = 150 \\frac{(1-\\epsilon)^2}{\\epsilon^3} \\frac{\\eta \\cdot u}{d_p^2} + 1.75 \\frac{1-\\epsilon}{\\epsilon^3} \\frac{\\rho \\cdot u^2}{d_p} \\]",
            desc: "The Ergun equation calculates the pressure drop of a fluid flowing through a packed bed of particles (e.g., fixed-bed reactors, chromatography columns, or coffee espresso pucks). The pressure drop results from two distinct mechanisms: viscous shear losses (Kozeny-Carman term, linear with velocity u) and inertial drag losses (Burke-Plummer term, quadratic with u). The cubic dependency on bed porosity ε (as ε³ in the denominator) illustrates why slight compression or plugging causes massive flow blockages.",
            isAnimated: true,
            sliders: [
                { id: "eps", label: "Bed Porosity (ε)", min: 0.22, max: 0.60, step: 0.01, val: 0.40 },
                { id: "dp", label: "Particle Diameter (d_p in mm)", min: 1.0, max: 10.0, step: 0.5, val: 3.0 },
                { id: "vel", label: "Superficial Velocity (u in m/s)", min: 0.1, max: 2.0, step: 0.1, val: 0.8 },
                { id: "visc", label: "Fluid Viscosity (η in mPa·s)", min: 0.5, max: 10.0, step: 0.5, val: 1.0 },
                { id: "rhof", label: "Fluid Density (ρ in kg/m³)", min: 1, max: 1200, step: 50, val: 1000 }
            ],
            init: () => {
                t = 0.0;
                flowParticles = [];
                for (let i = 0; i < 40; i++) {
                    flowParticles.push({
                        x: Math.random() * (canvas.width - 250) + 50,
                        y: Math.random() * (canvas.height - 110) + 40,
                        offset: Math.random() * 2 * Math.PI
                    });
                }
            },
            reset: () => {
                equationsConfig.ergun.init();
            },
            solve: () => {
                const eps = parameters["eps"];
                const dp = parameters["dp"] * 1e-3; // mm to m
                const u = parameters["vel"];
                const eta = parameters["visc"] * 1e-3; // dynamic viscosity of fluid (Pa s)
                const rho = parameters["rhof"]; // density of fluid (kg/m3)
                const L = 1.0; // Column length (m)

                // Ergun Equation
                // Term 1: Viscous
                const t1 = 150 * (Math.pow(1 - eps, 2) / Math.pow(eps, 3)) * (eta * u / (dp * dp));
                // Term 2: Inertial
                const t2 = 1.75 * ((1 - eps) / Math.pow(eps, 3)) * (rho * u * u / dp);
                
                const dp_dL = t1 + t2; // Pa/m
                const totalDP = dp_dL * L; // Pa (for 1m)

                // Store calculations
                parameters["_dp"] = totalDP / 1e5; // convert Pa to bar
                parameters["_t1_pct"] = (t1 / dp_dL) * 100;
                parameters["_t2_pct"] = (t2 / dp_dL) * 100;

                // Move particles according to porosity and flow velocity
                // Lower porosity = tighter channel = higher local velocity but much harder flow resistance
                // We show particles moving at speed proportional to u * (eps^2) to show choking visual
                const flowSpeed = u * Math.pow(eps / 0.4, 2) * 5;
                const colW = canvas.width - 230;
                const colH = canvas.height - 110;
                const dp_mm = parameters["dp"];
                const radius = Math.min(35, dp_mm * 3.5);
                const colSpacingX = radius * 2.2;
                const colSpacingY = radius * 2.1;

                flowParticles.forEach(p => {
                    p.x += flowSpeed;

                    // Resolve collisions with grid cylinders to force weaving/tortuosity
                    const gridX = Math.round((p.x - 65) / colSpacingX);
                    const gridY = Math.round((p.y - 55) / colSpacingY);

                    // Check neighbors in a 3x3 grid around the particle
                    for (let dx = -1; dx <= 1; dx++) {
                        for (let dy = -1; dy <= 1; dy++) {
                            const cx = 65 + (gridX + dx) * colSpacingX;
                            const cy = 55 + (gridY + dy) * colSpacingY;
                            
                            // Check if this circle center is within the column
                            if (cx >= 50 && cx <= colW + 30 && cy >= 40 && cy <= colH + 30) {
                                const dist = Math.hypot(p.x - cx, p.y - cy);
                                const minDistance = radius + 3; // radius + padding
                                if (dist < minDistance) {
                                    const overlap = minDistance - dist;
                                    const angle = Math.atan2(p.y - cy, p.x - cx);
                                    
                                    // Push particle away from the cylinder center
                                    p.y += Math.sin(angle) * overlap * 0.85;
                                    p.x += Math.max(0.1, Math.cos(angle)) * overlap * 0.15;
                                }
                            }
                        }
                    }

                    // Keep particles inside the column vertically
                    if (p.y < 45) p.y = 45;
                    if (p.y > colH + 30) p.y = colH + 30;

                    // Wrap around borders (exit column)
                    if (p.x > colW + 40) {
                        p.x = 50;
                        p.y = Math.random() * (colH - 20) + 50;
                    }
                });

                t += dt;
            },
            draw: () => {
                ctx.fillStyle = "#040507";
                ctx.fillRect(0, 0, canvas.width, canvas.height);

                const eps = parameters["eps"];
                const dp = parameters["dp"];
                const u = parameters["vel"];
                const totalDP = parameters["_dp"] || 0;
                const t1_pct = parameters["_t1_pct"] || 0;
                const t2_pct = parameters["_t2_pct"] || 0;

                const colW = canvas.width - 230;
                const colH = canvas.height - 110;

                // Draw porous column boundary
                ctx.strokeStyle = "rgba(255,255,255,0.15)";
                ctx.lineWidth = 3;
                ctx.strokeRect(50, 40, colW, colH);

                // Draw packing particles (circles represent packed bed)
                // Density of circles based on 1 - eps
                const seed = 42;
                ctx.fillStyle = "rgba(255, 255, 255, 0.12)";
                // Draw static random circles
                let randX = 65;
                const radius = Math.min(35, dp * 3.5);
                while (randX < colW + 30) {
                    for (let yPos = 55; yPos < colH + 30; yPos += radius * 2.1) {
                        ctx.beginPath();
                        ctx.arc(randX, yPos, radius, 0, 2 * Math.PI);
                        ctx.fill();
                    }
                    randX += radius * 2.2;
                }

                // Draw moving fluid tracer particles (glowing blue)
                ctx.fillStyle = "rgba(0, 210, 255, 0.85)";
                flowParticles.forEach(p => {
                    ctx.beginPath();
                    ctx.arc(p.x, p.y + Math.sin(t + p.offset) * 4, 3, 0, 2*Math.PI);
                    ctx.fill();
                });

                // Draw relative pressure drop graph on the right
                const rx = canvas.width - 130;
                const ry = 60;
                const rw = 90;
                const rh = 120;

                // Draw Bar chart of pressure drop contribution
                ctx.fillStyle = "rgba(255, 255, 255, 0.05)";
                ctx.fillRect(rx, ry, rw, rh);
                ctx.strokeStyle = "rgba(255, 255, 255, 0.1)";
                ctx.strokeRect(rx, ry, rw, rh);

                // Viscous term bar (laminar) - blue
                const h1 = (t1_pct / 100) * rh;
                ctx.fillStyle = "#00d2ff";
                ctx.fillRect(rx + 15, ry + rh - h1, 20, h1);

                // Inertial term bar (turbulent) - red
                const h2 = (t2_pct / 100) * rh;
                ctx.fillStyle = "#ff4d4d";
                ctx.fillRect(rx + 55, ry + rh - h2, 20, h2);

                // Lables for bars
                ctx.fillStyle = "rgba(255, 255, 255, 0.6)";
                ctx.font = "8px Outfit";
                ctx.textAlign = "center";
                ctx.fillText("Viscous", rx + 25, ry + rh + 12);
                ctx.fillText("Inertial", rx + 65, ry + rh + 12);

                // Draw pressure loss curve (linear drop profile from left to right)
                ctx.strokeStyle = "#ff9f43";
                ctx.lineWidth = 2.5;
                ctx.beginPath();
                ctx.moveTo(50, 40 + colH);
                ctx.lineTo(50 + colW, 40 + colH - Math.min(colH, totalDP * 25));
                ctx.stroke();

                // Labeled Axes
                drawPhysicalAxes("Position in Packed Bed (Bed Depth) z [cm]", "Relative Pressure p [bar]", 0, 100, 0, 10);

                // Legend
                drawLegend([
                    { color: "#ff9f43", label: "Pressure Drop Profile Δp" },
                    { color: "rgba(0, 210, 255, 0.8)", label: "Fluid Particles" },
                    { color: "#00d2ff", label: "Viscous Pressure Loss" },
                    { color: "#ff4d4d", label: "Inertial Pressure Loss" }
                ]);

                // Output metrics
                outputsList.innerHTML = `
                    <div class="stat-row"><span>Total Pressure Drop (Δp):</span><span class="mono text-orange">${totalDP.toFixed(3)} bar</span></div>
                    <div class="stat-row"><span>Viscous Fraction (Laminar):</span><span class="mono text-blue">${t1_pct.toFixed(1)} %</span></div>
                    <div class="stat-row"><span>Inertial Fraction (Turbulent):</span><span class="mono text-red">${t2_pct.toFixed(1)} %</span></div>
                    <div class="stat-row"><span>Bed Porosity ε:</span><span class="mono">${(eps * 100).toFixed(0)} %</span></div>
                `;
            }
        };

const activeEqKey = "ergun";
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
