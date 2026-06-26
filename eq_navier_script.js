// Controller script for eq_navier.html
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
            title: "Navier-Stokes Equation (Momentum Balance)",
            badge: "L2 Mass & Heat Transport",
            formula: "\\[ -\\nabla p + \\eta \\Delta \\mathbf{u} + \\rho \\mathbf{f} = \\rho \\left( \\frac{\\partial \\mathbf{u}}{\\partial t} + \\mathbf{u} \\cdot \\nabla \\mathbf{u} \\right) \\]",
            desc: "The Navier-Stokes equation describes the transport of momentum in fluid flows. Understanding the non-linear convection term (flow diversion, drag, eddy generation) is a core challenge in transport phenomena. This simulation visualizes flow past a cylindrical pellet. Increasing the Reynolds number (by decreasing viscosity) dynamically demonstrates the transition from symmetric, creep-flow behavior to boundary-layer separation and wake recirculation vortices.",
            isAnimated: true,
            sliders: [
                { id: "re", label: "Reynolds Number (Re)", min: 0.5, max: 100, step: 0.5, val: 5.0 },
                { id: "speed", label: "Inflow Velocity (u₀)", min: 1.0, max: 8.0, step: 0.2, val: 3.5 }
            ],
            init: () => {
                t = 0.0;
                flowParticles = [];
                // Create random stream particles
                for (let i = 0; i < numParticles; i++) {
                    flowParticles.push({
                        x: Math.random() * canvas.width,
                        y: Math.random() * canvas.height,
                        speed: Math.random() * 0.5 + 0.75,
                        history: []
                    });
                }
            },
            reset: () => {
                equationsConfig.navier.init();
            },
            solve: () => {
                // Navier-Stokes approximation of flow fields
                const re = parameters["re"];
                const u0 = parameters["speed"];
                const cx = canvas.width / 2;
                const cy = canvas.height / 2;
                const R = 45.0; // Cylinder radius

                flowParticles.forEach(p => {
                    // Coordinates relative to cylinder center
                    const dx = p.x - cx;
                    const dy = p.y - cy;
                    const r2 = dx*dx + dy*dy;
                    const r = Math.sqrt(r2);

                    if (r <= R) {
                        // Particle inside cylinder, move outside
                        p.x = 0;
                        p.y = Math.random() * canvas.height;
                        p.history = [];
                        return;
                    }

                    // Potential flow base velocity vectors
                    // ux = u0 * (1 - R^2 * (x^2 - y^2) / r^4)
                    // uy = u0 * (-2 * R^2 * x * y / r^4)
                    const r4 = r2 * r2;
                    let ux = u0 * (1.0 - (R*R * (dx*dx - dy*dy)) / r4);
                    let uy = u0 * (-2.0 * R*R * dx * dy) / r4;

                    // Add wake recirculation / boundary layer separation for high Re
                    if (dx > 0 && re > 12.0) {
                        // Recirculation bubble length increases with Re
                        const bubbleLen = R * (0.1 + 0.12 * (re - 12.0));
                        const factor = Math.max(0, 1.0 - dx / bubbleLen);
                        if (factor > 0) {
                            // Reverse flow behind cylinder
                            const scale = factor * Math.exp(-dy*dy / (0.6*R*R));
                            ux = ux * (1.0 - 1.8 * scale);
                            // Add slight vortex circulation towards centerline
                            uy = uy - 0.4 * u0 * Math.sign(dy) * scale;
                        }
                    }

                    // Update position
                    p.x += ux * p.speed * 0.8;
                    p.y += uy * p.speed * 0.8;

                    // Keep track of trail
                    p.history.push({x: p.x, y: p.y});
                    if (p.history.length > 8) p.history.shift();

                    // Wrap around borders
                    if (p.x > canvas.width || p.y < 0 || p.y > canvas.height) {
                        p.x = 0;
                        p.y = Math.random() * canvas.height;
                        p.history = [];
                    }
                });
            },
            draw: () => {
                ctx.fillStyle = "#040507";
                ctx.fillRect(0, 0, canvas.width, canvas.height);

                // Grid background
                ctx.strokeStyle = "rgba(255, 255, 255, 0.02)";
                ctx.lineWidth = 1;
                const gridSize = 40;
                for (let x = 0; x < canvas.width; x += gridSize) {
                    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, canvas.height); ctx.stroke();
                }
                for (let y = 0; y < canvas.height; y += gridSize) {
                    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(canvas.width, y); ctx.stroke();
                }

                const cx = canvas.width / 2;
                const cy = canvas.height / 2;
                const R = 45.0;
                const re = parameters["re"];

                // Draw recirculating wake boundary (dashed orange line)
                if (re > 12.0) {
                    const bubbleLen = R * (0.1 + 0.12 * (re - 12.0));
                    ctx.strokeStyle = "rgba(255, 159, 67, 0.35)";
                    ctx.lineWidth = 1.5;
                    ctx.setLineDash([4, 4]);
                    ctx.beginPath();
                    ctx.ellipse(cx + bubbleLen/2, cy, bubbleLen/2 + R/2, R * 0.7, 0, 0, 2*Math.PI);
                    ctx.stroke();
                    ctx.setLineDash([]);
                }

                // Draw streamlines/particles
                flowParticles.forEach(p => {
                    if (p.history.length < 2) return;
                    ctx.strokeStyle = "rgba(0, 210, 255, 0.5)";
                    ctx.lineWidth = 2.0;
                    ctx.beginPath();
                    ctx.moveTo(p.history[0].x, p.history[0].y);
                    for (let h = 1; h < p.history.length; h++) {
                        ctx.lineTo(p.history[h].x, p.history[h].y);
                    }
                    ctx.stroke();

                    // particle head
                    ctx.fillStyle = "rgba(255, 255, 255, 0.8)";
                    ctx.beginPath();
                    ctx.arc(p.x, p.y, 2, 0, 2 * Math.PI);
                    ctx.fill();
                });

                // Draw Cylinder (solid obstruction)
                ctx.fillStyle = "#1e222b";
                ctx.strokeStyle = "rgba(255, 255, 255, 0.15)";
                ctx.lineWidth = 3;
                ctx.beginPath();
                ctx.arc(cx, cy, R, 0, 2 * Math.PI);
                ctx.fill();
                ctx.stroke();

                // Draw Axes (Physical Context)
                drawPhysicalAxes("Flow Direction (Channel Length) x [cm]", "Channel Width y [cm]", 0, 30, 0, 20);

                // Draw Legend
                drawLegend([
                    { color: "#00d2ff", label: "Streamlines" },
                    { color: "#1e222b", label: "Catalyst Cylinder (Pellet)" },
                    { color: "rgba(255, 159, 67, 0.8)", label: "Separation Wake", dashed: true }
                ]);

                // Calculations text update
                const visc = (1.2 * parameters["speed"] * 0.09) / re; // computed viscosity proxy
                outputsList.innerHTML = `
                    <div class="stat-row"><span>Flow Regime:</span><span class="mono" style="color: ${re > 30 ? '#ff9f43' : '#39d353'};">${re > 30 ? 'Boundary Layer Separation' : 'Creeping Laminar Flow'}</span></div>
                    <div class="stat-row"><span>Reynolds Number Re:</span><span class="mono">${re.toFixed(1)}</span></div>
                    <div class="stat-row"><span>Effective Viscosity η:</span><span class="mono">${(visc * 1e3).toFixed(2)} mPa·s</span></div>
                `;
            }
        };

const activeEqKey = "navier";
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
