// Controller script for eq_stokes.html
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
            title: "Stokes' Law (Particle Settling Velocity)",
            badge: "L17 Particle Technology",
            formula: "\\[ v_w = \\frac{d_w^2 \\cdot (\\rho_p - \\rho_f) \\cdot g}{18 \\cdot \\eta} \\]",
            desc: "Stokes' law calculates the terminal settling velocity of a spherical particle falling through a viscous fluid under laminar conditions. It serves as the foundation for mechanical separations such as gravity settling, classification, and flotation. Dragging sliders highlights the quadratic impact of particle diameter dw.<br><br><strong>Why are there multiple particles?</strong> To help students visualize the quadratic effect of size ($v_w \\propto d_w^2$), the screen displays <strong>three grey reference particles</strong> of fixed diameters (20, 60, and 120 μm) alongside the <strong>orange target particle</strong>. Dragging the diameter slider dynamically resizes the target particle and changes its settling speed and force balance in real-time.",
            isAnimated: true,
            sliders: [
                { id: "dp", label: "Particle Diameter (d_w in μm)", min: 10, max: 150, step: 5, val: 50 },
                { id: "rhop", label: "Particle Density (ρ_p in kg/m³)", min: 1200, max: 4000, step: 100, val: 2500 },
                { id: "visc", label: "Fluid Viscosity (η in mPa·s)", min: 1.0, max: 50.0, step: 1.0, val: 5.0 }
            ],
            init: () => {
                t = 0.0;
                stokesParticles = [
                    { id: "target", d: 50, x: 190, y_pos: 40, isTarget: true },
                    { id: "ref_small", d: 20, x: 70, y_pos: 40, isTarget: false },
                    { id: "ref_medium", d: 60, x: 130, y_pos: 40, isTarget: false },
                    { id: "ref_large", d: 120, x: 250, y_pos: 40, isTarget: false }
                ];
            },
            reset: () => {
                equationsConfig.stokes.init();
            },
            solve: () => {
                const targetD = parameters["dp"];
                const rhop = parameters["rhop"];
                const visc = parameters["visc"] * 1e-3; // convert mPa.s to Pa.s
                const rhof = 1000.0; // water density
                const g = 9.81;

                // Update target particle diameter to match slider
                stokesParticles.forEach(p => {
                    if (p.isTarget) {
                        p.d = targetD;
                    }
                });

                // Solve for terminal settling velocity
                const dw_m = targetD * 1e-6;
                const v_term = (dw_m * dw_m * (rhop - rhof) * g) / (18 * visc); // m/s
                const dy_dt = v_term * 200000; // Scaled for screen readability

                // Move all particles in the channel
                stokesParticles.forEach(p => {
                    const d_m = p.d * 1e-6;
                    const vt = (d_m * d_m * (rhop - rhof) * g) / (18 * visc);
                    p.y_pos += vt * 200000 * dt;
                    if (p.y_pos > canvas.height - 70) {
                        p.y_pos = 40; // reset loop
                    }
                });

                t += dt;
                parameters["_v_term"] = v_term;
            },
            draw: () => {
                ctx.fillStyle = "#040507";
                ctx.fillRect(0, 0, canvas.width, canvas.height);

                const targetD = parameters["dp"];
                const rhop = parameters["rhop"];
                const rhof = 1000.0;
                const v_term = parameters["_v_term"] || 0;

                // Draw fluid background (blue gradient)
                const grad = ctx.createLinearGradient(0, 0, 0, canvas.height);
                grad.addColorStop(0, "rgba(0, 162, 255, 0.05)");
                grad.addColorStop(1, "rgba(0, 162, 255, 0.15)");
                ctx.fillStyle = grad;
                ctx.fillRect(40, 40, canvas.width - 80, canvas.height - 110);

                // Draw comparison and target particles
                stokesParticles.forEach(p => {
                    ctx.fillStyle = p.isTarget ? "#ff9f43" : "rgba(255, 255, 255, 0.25)";
                    
                    // radius scaled visually
                    const r = Math.max(3, p.d / 6);
                    ctx.beginPath();
                    ctx.arc(p.x, p.y_pos, r, 0, 2 * Math.PI);
                    ctx.fill();

                    // Label particle with diameter and role
                    ctx.fillStyle = p.isTarget ? "#ff9f43" : "rgba(255, 255, 255, 0.4)";
                    ctx.font = p.isTarget ? "bold 10px 'Outfit', sans-serif" : "9px 'Outfit', sans-serif";
                    ctx.textAlign = "center";
                    const labelText = p.isTarget ? `Target (dw): ${Math.round(p.d)} μm` : `Ref: ${p.d} μm`;
                    ctx.fillText(labelText, p.x, p.y_pos - r - 6);

                    // Draw dynamic force arrows directly on the falling target particle
                    if (p.isTarget) {
                        const arrowScale = r * 0.7;
                        const lenFg_p = 8 + arrowScale + ((rhop - 1200) / 2800) * 8;
                        const lenFb_p = lenFg_p * (rhof / rhop);
                        const lenFd_p = lenFg_p - lenFb_p;

                        // Draw Fg (down, red)
                        drawVector(p.x, p.y_pos, p.x, p.y_pos + lenFg_p, "#ff4d4d", "", 2.0);
                        // Draw Fb (up, blue, offset left)
                        drawVector(p.x - 4, p.y_pos, p.x - 4, p.y_pos - lenFb_p, "#00d2ff", "", 2.0);
                        // Draw Fd (up, drag/yellow, offset right)
                        drawVector(p.x + 4, p.y_pos, p.x + 4, p.y_pos - lenFd_p, "#ffd200", "", 2.0);
                    }
                });

                // Draw zoomed view of the target particle and its forces
                const zx = canvas.width - 120;
                const zy = 150;
                const zRadius = 35;

                // Draw Zoom Circle title
                ctx.fillStyle = "rgba(255, 255, 255, 0.8)";
                ctx.font = "bold 11px 'Outfit', sans-serif";
                ctx.textAlign = "center";
                ctx.fillText("Zoom: Force Balance", zx, zy - zRadius - 20);

                // Draw zoomed circle
                ctx.fillStyle = "rgba(255, 255, 255, 0.02)";
                ctx.strokeStyle = "rgba(255, 255, 255, 0.15)";
                ctx.lineWidth = 1;
                ctx.beginPath();
                ctx.arc(zx, zy, zRadius + 35, 0, 2 * Math.PI);
                ctx.fill();
                ctx.stroke();

                // Draw magnified particle
                ctx.fillStyle = "#ff9f43";
                ctx.beginPath();
                ctx.arc(zx, zy, zRadius, 0, 2 * Math.PI);
                ctx.fill();

                // Compute forces for vector drawing
                // Fg = Vol * rho_p * g
                const vol = (4/3) * Math.PI * Math.pow(targetD*1e-6, 3);
                const Fg = vol * rhop * 9.81;
                const Fb = vol * rhof * 9.81;
                const Fd = Fg - Fb; // at terminal velocity

                // Dynamic scaling of force vectors for visual balance on screen
                const lenFg = 30 + (targetD / 150) * 60 + ((rhop - 1200) / 2800) * 20;
                const lenFb = lenFg * (rhof / rhop);
                const lenFd = lenFg - lenFb;

                // Draw Fg vector (Gravity - red arrow down, thicker)
                drawVector(zx, zy, zx, zy + lenFg, "#ff4d4d", "Fg", 4.0);
                // Draw Fb vector (Buoyancy - blue arrow up, thicker, offset left)
                drawVector(zx - 12, zy, zx - 12, zy - lenFb, "#00d2ff", "Fb", 4.0);
                // Draw Fw vector (Drag - yellow arrow up, thicker, offset right)
                drawVector(zx + 12, zy, zx + 12, zy - lenFd, "#ffd200", "Fw", 4.0);

                // Draw Physical Axes
                drawPhysicalAxes("Kanalbreite x [cm]", "Falltiefe (Absitzweg) z [cm]", 0, 20, 0, 100);

                // Draw Legend
                drawLegend([
                    { color: "#ff9f43", label: "Target Particle (d_w)" },
                    { color: "#ff4d4d", label: "Gravity Fg" },
                    { color: "#00d2ff", label: "Buoyancy Fb" },
                    { color: "#ffd200", label: "Drag Fw" }
                ]);

                // Output metrics
                outputsList.innerHTML = `
                    <div class="stat-row"><span>Terminal Velocity (v_w):</span><span class="mono text-green">${(v_term * 1e3).toFixed(3)} mm/s</span></div>
                    <div class="stat-row"><span>Gravity Fg:</span><span class="mono">${Fg.toExponential(3)} N</span></div>
                    <div class="stat-row"><span>Buoyancy Fb:</span><span class="mono">${Fb.toExponential(3)} N</span></div>
                    <div class="stat-row"><span>Drag Fw:</span><span class="mono">${Fd.toExponential(3)} N</span></div>
                `;
            }
        };

const activeEqKey = "stokes";
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
