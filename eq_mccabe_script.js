// Controller script for eq_mccabe.html
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
            title: "McCabe-Thiele Method (Fractional Distillation)",
            badge: "L11 Distillation & Rectification",
            formula: "\\[ y_n = \\frac{R}{R+1} x_{n-1} + \\frac{x_D}{R+1} \\quad \\text{und} \\quad y_m = \\frac{\\dot{L}}{\\dot{V}} x_{m-1} - \\frac{\\dot{B}}{\\dot{V}} x_B \\]",
            desc: "The McCabe-Thiele method is the classic graphical analysis used to design fractionating distillation columns. It plots mass balances (operating lines) for the rectifying section (top) and stripping section (bottom) in an x-y vapor-liquid equilibrium diagram. Stepping stages (staircases) between the equilibrium curve and the operating lines determines the theoretical number of trays (stages) and the location of the feed tray.",
            isAnimated: true,
            sliders: [
                { id: "R", label: "Reflux Ratio (R)", min: 0.5, max: 8.0, step: 0.1, val: 1.5 },
                { id: "alpha", label: "Relative Volatility (α)", min: 1.5, max: 4.0, step: 0.1, val: 2.2 },
                { id: "xF", label: "Feed Concentration (x_F)", min: 0.3, max: 0.7, step: 0.05, val: 0.5 },
                { id: "xD", label: "Distillate Concentration (x_D)", min: 0.85, max: 0.98, step: 0.01, val: 0.92 },
                { id: "xB", label: "Bottoms Concentration (x_B)", min: 0.02, max: 0.15, step: 0.01, val: 0.08 }
            ],
            init: () => {
                t = 0.0;
                mccabeVaporParticles = [];
                mccabeLiquidParticles = [];
                
                // Initialize 100 particles in the reboiler pool and column
                for (let i = 0; i < 100; i++) {
                    const type = Math.random() < 0.5 ? 'A' : 'B';
                    // Distribute states: 40% pool, 30% rising, 30% falling
                    let state = 'pool';
                    let y_pct = 1.0;
                    let trayIdx = 0;
                    let progress = 0.5;
                    let isRising = false;
                    
                    const rand = Math.random();
                    if (rand < 0.4) {
                        state = 'pool';
                    } else if (rand < 0.7) {
                        state = 'column';
                        trayIdx = Math.floor(Math.random() * 8);
                        progress = Math.random();
                        isRising = true;
                    } else {
                        state = 'column';
                        trayIdx = Math.floor(Math.random() * 8);
                        progress = Math.random();
                        isRising = false;
                    }
                    
                    mccabeLiquidParticles.push({
                        state: state,
                        trayIdx: trayIdx,
                        progress: progress,
                        isRising: isRising,
                        x_offset: (Math.random() - 0.5) * 20,
                        type: type,
                        seed: Math.random(),
                        pipeProgress: Math.random(),
                        timer: Math.floor(Math.random() * 40)
                    });
                }
            },
            reset: () => {
                equationsConfig.mccabe.init();
            },
            solve: () => {
                t += 0.03; // Slower time increment (was 0.05)
                const R = parameters["R"];
                const alpha = parameters["alpha"];
                const xF = parameters["xF"];
                const xD = parameters["xD"];
                const xB = parameters["xB"];
                const q = 1.0; // Saturated liquid feed (vertical q-line)

                // Equilibrium curve: y = alpha * x / (1 + (alpha - 1) * x)
                const getEq = (x) => (alpha * x) / (1.0 + (alpha - 1.0) * x);

                // Calculate minimum reflux ratio R_min at feed composition (for q=1.0)
                const yF = getEq(xF);
                const R_min = (xD - yF) / (yF - xF);
                parameters["_R_min"] = R_min;

                // Intersection of rectifying line and q-line (vertical at x=xF)
                const xi = xF;
                const yi = (R / (R + 1.0)) * xi + (xD / (R + 1.0));

                // Stripping line connects (xB, xB) to (xi, yi)
                // Equation: y = m_s * x + c_s
                const m_s = (yi - xB) / (xi - xB);
                const c_s = xB - m_s * xB;

                // Tray stepping (Stufenkonstruktion)
                let trays = [];
                let currX = xD;
                let currY = xD;
                let stepCount = 0;
                const maxSteps = 40;
                let feedTrayIdx = 0;
                let switched = false;

                if (R < R_min) {
                    // Pinch point crossed! Distillation is physically impossible.
                    parameters["_trays"] = [];
                    parameters["_stages"] = "Invalid (R < R_min)";
                    parameters["_m_s"] = 0.0;
                    parameters["_yi"] = yi;
                    parameters["_feedTrayIdx"] = 0;
                    return;
                }

                // Inverse equilibrium curve: x = y / (alpha - (alpha - 1) * y)
                const getEqInv = (y) => y / (alpha - (alpha - 1.0) * y);

                while (currX > xB && stepCount < maxSteps) {
                    const y_eq = currY;
                    const nextX = getEqInv(y_eq);
                    
                    let nextY;
                    if (nextX > xi) {
                        nextY = (R / (R + 1.0)) * nextX + (xD / (R + 1.0));
                    } else {
                        if (!switched) {
                            feedTrayIdx = stepCount;
                            switched = true;
                        }
                        nextY = m_s * nextX + c_s;
                    }

                    trays.push({
                        x1: nextX,
                        y1: y_eq,
                        x2: nextX,
                        y2: nextY
                    });

                    currX = nextX;
                    currY = nextY;
                    stepCount++;
                }

                if (!switched) {
                    feedTrayIdx = Math.floor(stepCount / 2);
                }
                parameters["_feedTrayIdx"] = feedTrayIdx;

                // Stochastic tray transitions (McCabe-Thiele model-coupled)
                const stagesVal = (typeof stepCount === "number") ? stepCount : 8;
                
                // Particle speeds (slower for tracking)
                const speed = 0.008 + 0.004 * (R / (R + 1.0));
                const pipeSpeed = 0.015;

                if (mccabeLiquidParticles && mccabeLiquidParticles.length > 0) {
                    mccabeLiquidParticles.forEach(p => {
                        // Safety boundaries if stages count changed via slider
                        if (p.state === 'column') {
                            if (p.trayIdx >= stagesVal) {
                                p.trayIdx = stagesVal - 1;
                                p.progress = 0.5;
                                p.isRising = false;
                            }
                        }

                        if (p.state === 'feed') {
                            p.pipeProgress += pipeSpeed;
                            if (p.pipeProgress >= 1.0) {
                                p.state = 'column';
                                p.trayIdx = feedTrayIdx;
                                p.progress = 0.5;
                                p.isRising = Math.random() < 0.5;
                                p.pipeProgress = 0.0;
                            }
                        } else if (p.state === 'column') {
                            if (p.isRising) {
                                p.progress -= speed;
                                if (p.progress <= 0.0) {
                                    p.trayIdx--;
                                    p.progress = 1.0;
                                    if (p.trayIdx < 0) {
                                        p.state = 'condenser';
                                        p.timer = 20 + Math.floor(Math.random() * 30);
                                    } else {
                                        // Crossing tray boundary: vapor mass transfer equilibrium (y_k)
                                        const k = p.trayIdx;
                                        let y_k = 0.5;
                                        if (trays[k] && typeof trays[k].y1 === "number") {
                                            y_k = trays[k].y1;
                                        }
                                        p.type = Math.random() < y_k ? 'A' : 'B';
                                    }
                                }
                            } else {
                                // Falling
                                p.progress += speed;
                                if (p.progress >= 1.0) {
                                    p.trayIdx++;
                                    p.progress = 0.0;
                                    if (p.trayIdx >= stagesVal) {
                                        p.state = 'pool';
                                        p.timer = 15 + Math.floor(Math.random() * 30);
                                    } else {
                                        // Crossing tray boundary: liquid mass transfer equilibrium (x_k)
                                        const k = p.trayIdx;
                                        let x_k = 0.5;
                                        if (trays[k] && typeof trays[k].x1 === "number") {
                                            x_k = trays[k].x1;
                                        }
                                        p.type = Math.random() < x_k ? 'A' : 'B';
                                    }
                                }
                            }
                        } else if (p.state === 'condenser') {
                            p.timer--;
                            if (p.timer <= 0) {
                                const P_reflux = R / (R + 1.0);
                                if (Math.random() < P_reflux) {
                                    p.state = 'reflux';
                                    p.pipeProgress = 0.0;
                                } else {
                                    p.state = 'distillate';
                                    p.pipeProgress = 0.0;
                                }
                            }
                        } else if (p.state === 'reflux') {
                            p.pipeProgress += pipeSpeed;
                            if (p.pipeProgress >= 1.0) {
                                p.state = 'column';
                                p.trayIdx = 0;
                                p.progress = 0.0;
                                p.isRising = false;
                                p.pipeProgress = 0.0;
                            }
                        } else if (p.state === 'distillate') {
                            p.pipeProgress += pipeSpeed;
                            if (p.pipeProgress >= 1.0) {
                                p.state = 'feed';
                                p.pipeProgress = 0.0;
                                p.type = Math.random() < xF ? 'A' : 'B';
                            }
                        } else if (p.state === 'pool') {
                            p.timer--;
                            if (p.timer <= 0) {
                                const rand = Math.random();
                                if (rand < 0.80) {
                                    // Vaporize and rise from bottom tray
                                    p.state = 'column';
                                    p.trayIdx = stagesVal - 1;
                                    p.progress = 1.0;
                                    p.isRising = true;
                                } else {
                                    // Exit as bottoms
                                    p.state = 'bottoms';
                                    p.pipeProgress = 0.0;
                                }
                            }
                        } else if (p.state === 'bottoms') {
                            p.pipeProgress += pipeSpeed;
                            if (p.pipeProgress >= 1.0) {
                                p.state = 'feed';
                                p.pipeProgress = 0.0;
                                p.type = Math.random() < xF ? 'A' : 'B';
                            }
                        }
                    });
                }

                parameters["_trays"] = trays;
                parameters["_stages"] = stepCount;
                parameters["_m_s"] = m_s;
                parameters["_yi"] = yi;
            },
            draw: () => {
                ctx.fillStyle = "#040507";
                ctx.fillRect(0, 0, canvas.width, canvas.height);

                const alpha = parameters["alpha"];
                const xF = parameters["xF"];
                const xD = parameters["xD"];
                const xB = parameters["xB"];
                const R = parameters["R"];
                const trays = parameters["_trays"] || [];
                const stages = parameters["_stages"] || 0;
                const m_s = parameters["_m_s"] || 0;
                const yi = parameters["_yi"] || 0;

                // Graph coordinates (shifted to the right to leave space for column schematic)
                const padL = 220;
                const padR = 40;
                const padB = 60;
                const padT = 50;
                const gw = canvas.width - padL - padR;
                const gh = canvas.height - padB - padT;

                const getXCoord = (x) => padL + x * gw;
                const getYCoord = (y) => canvas.height - padB - y * gh;

                // --- Draw Distillation Column Schematic (Left Side) ---
                const cx = 110; // column horizontal center
                const colW = 60; // column width
                const x_left = cx - colW / 2; // 80
                const x_right = cx + colW / 2; // 140
                const y_top = padT + 20; // top of column shell
                const y_bottom = canvas.height - padB - 20; // bottom of column shell
                const colH = y_bottom - y_top;

                // Draw Column Shell (Outer boundaries)
                ctx.strokeStyle = "rgba(255, 255, 255, 0.4)";
                ctx.lineWidth = 2.0;
                ctx.beginPath();
                ctx.moveTo(x_left, y_top);
                ctx.lineTo(x_left, y_bottom);
                ctx.moveTo(x_right, y_top);
                ctx.lineTo(x_right, y_bottom);
                ctx.stroke();

                // Draw Condenser (Top)
                const condX = cx;
                const condY = y_top - 20;
                ctx.fillStyle = "#00d2ff";
                ctx.strokeStyle = "rgba(255, 255, 255, 0.6)";
                ctx.beginPath();
                ctx.arc(condX, condY, 12, 0, 2 * Math.PI);
                ctx.fill();
                ctx.stroke();
                
                // Label
                ctx.fillStyle = "rgba(255, 255, 255, 0.6)";
                ctx.font = "bold 8px Outfit";
                ctx.textAlign = "center";
                ctx.fillText("Condenser", condX, condY - 15);

                // Draw Reboiler (Bottom)
                const reboyX = cx;
                const reboyY = y_bottom + 20;
                ctx.fillStyle = "#ff4d4d";
                ctx.beginPath();
                ctx.arc(reboyX, reboyY, 12, 0, 2 * Math.PI);
                ctx.fill();
                ctx.stroke();
                
                // Label
                ctx.fillText("Reboiler", reboyX, reboyY + 22);

                // Draw connecting pipes
                ctx.strokeStyle = "rgba(255, 255, 255, 0.3)";
                ctx.lineWidth = 2;
                ctx.beginPath();
                // Top vapor line (hollow line representing vapor outlet)
                ctx.moveTo(cx, y_top);
                ctx.lineTo(cx, condY + 12);
                // Bottom liquid line
                ctx.moveTo(cx, y_bottom);
                ctx.lineTo(cx, reboyY - 12);
                
                // Reflux return line (loops from condenser back into top tray)
                ctx.moveTo(condX - 12, condY);
                ctx.lineTo(x_left - 10, condY);
                ctx.lineTo(x_left - 10, y_top + 15);
                ctx.lineTo(x_left + 2, y_top + 15);
                
                // Distillate draw-off pipe (exiting right)
                ctx.moveTo(condX + 12, condY);
                ctx.lineTo(x_right + 25, condY);
                
                // Bottoms draw-off pipe (exiting right)
                ctx.moveTo(reboyX + 12, reboyY);
                ctx.lineTo(x_right + 25, reboyY);
                
                // Feed pipe (exiting left)
                const stagesVal = (typeof stages === "number") ? stages : 8;
                const feedTrayIdx = parameters["_feedTrayIdx"] || Math.floor(stagesVal / 2);
                let feedY = y_top + 15 + (feedTrayIdx + 0.5) * (colH - 30) / Math.max(1, stagesVal);
                ctx.moveTo(x_left - 25, feedY);
                ctx.lineTo(x_left, feedY);
                ctx.stroke();
                
                // Draw feed labels
                ctx.fillStyle = "rgba(255, 255, 255, 0.5)";
                ctx.font = "8px Outfit";
                ctx.fillText("Feed (xF)", x_left - 38, feedY + 3);
                ctx.fillText("D (Distillate)", x_right + 50, condY + 3);
                ctx.fillText("B (Bottoms)", x_right + 48, reboyY + 3);

                // Draw internal trays
                const numTrays = (typeof stages === "number") ? stages : 0;
                let trayPositionsY = [];
                if (numTrays > 0 && numTrays < 40) {
                    const dy_tray = (colH - 30) / numTrays;
                    ctx.strokeStyle = "rgba(255, 255, 255, 0.5)";
                    ctx.lineWidth = 1.5;
                    for (let k = 0; k < numTrays; k++) {
                        const y_tray = y_top + 15 + k * dy_tray;
                        trayPositionsY.push(y_tray);
                        
                        ctx.beginPath();
                        if (k % 2 === 0) {
                            // Downcomer on the right: tray extends from left to x_right - 10
                            ctx.moveTo(x_left, y_tray);
                            ctx.lineTo(x_right - 10, y_tray);
                            ctx.stroke();
                            // Draw downcomer vertical plate
                            ctx.beginPath();
                            ctx.moveTo(x_right - 10, y_tray);
                            ctx.lineTo(x_right - 10, y_tray + dy_tray - 4);
                            ctx.stroke();
                        } else {
                            // Downcomer on the left: tray extends from x_left + 10 to x_right
                            ctx.moveTo(x_left + 10, y_tray);
                            ctx.lineTo(x_right, y_tray);
                            ctx.stroke();
                            // Draw downcomer vertical plate
                            ctx.beginPath();
                            ctx.moveTo(x_left + 10, y_tray);
                            ctx.lineTo(x_left + 10, y_tray + dy_tray - 4);
                            ctx.stroke();
                        }
                    }
                }

                // Draw animated particles cascading and rising (Orange A, Blue B)
                if (numTrays > 0 && typeof stages === "number") {
                    const dy_compartment = (colH - 30) / stagesVal;
                    
                    mccabeLiquidParticles.forEach(p => {
                        let px, py;
                        
                        if (p.state === 'pool') {
                            const r = Math.sqrt(p.seed) * 9;
                            const angle = p.seed * 2 * Math.PI + t * 2.0;
                            px = reboyX + Math.cos(angle) * r;
                            py = reboyY + Math.sin(angle) * r;
                        } else if (p.state === 'condenser') {
                            const r = Math.sqrt(p.seed) * 9;
                            const angle = p.seed * 2 * Math.PI + t * 1.5;
                            px = condX + Math.cos(angle) * r;
                            py = condY + Math.sin(angle) * r;
                        } else if (p.state === 'column') {
                            px = cx + Math.sin(t * (p.isRising ? 5 : 3) + p.seed * (p.isRising ? 70 : 110)) * (p.isRising ? 12 : 15);
                            py = y_top + 15 + (p.trayIdx + p.progress) * dy_compartment;
                        } else if (p.state === 'feed') {
                            px = (x_left - 25) + p.pipeProgress * 25;
                            py = feedY;
                        } else if (p.state === 'distillate') {
                            px = (condX + 12) + p.pipeProgress * 43;
                            py = condY;
                        } else if (p.state === 'bottoms') {
                            px = (reboyX + 12) + p.pipeProgress * 43;
                            py = reboyY;
                        } else if (p.state === 'reflux') {
                            const d = p.pipeProgress * 75;
                            if (d < 28) {
                                px = (condX - 12) - d;
                                py = condY;
                            } else if (d < 63) {
                                px = x_left - 10;
                                py = condY + (d - 28);
                            } else {
                                px = (x_left - 10) + (d - 63);
                                py = y_top + 15;
                            }
                        }
                        
                        // Draw particle
                        if (px !== undefined && py !== undefined) {
                            ctx.fillStyle = p.type === 'A' ? "#ff9f43" : "#00d2ff"; // Orange A vs. Blue B
                            ctx.beginPath();
                            const radius = (p.state === 'pool' || p.state === 'condenser') ? 2.0 : 2.5;
                            ctx.arc(px, py, radius, 0, 2 * Math.PI);
                            ctx.fill();
                        }
                    });
                }

                // Draw Grid
                ctx.strokeStyle = "rgba(255, 255, 255, 0.04)";
                ctx.lineWidth = 1;
                for (let g = 0; g <= 10; g++) {
                    const val = g / 10;
                    ctx.beginPath(); ctx.moveTo(getXCoord(val), getYCoord(0)); ctx.lineTo(getXCoord(val), getYCoord(1)); ctx.stroke();
                    ctx.beginPath(); ctx.moveTo(getXCoord(0), getYCoord(val)); ctx.lineTo(getXCoord(1), getYCoord(val)); ctx.stroke();
                }

                // Draw Diagonal y = x (dotted white)
                ctx.strokeStyle = "rgba(255, 255, 255, 0.25)";
                ctx.lineWidth = 1.5;
                ctx.setLineDash([4, 4]);
                ctx.beginPath();
                ctx.moveTo(getXCoord(0), getYCoord(0));
                ctx.lineTo(getXCoord(1), getYCoord(1));
                ctx.stroke();
                ctx.setLineDash([]);

                // Draw Equilibrium Curve (yellow-orange)
                ctx.strokeStyle = "#ff9f43";
                ctx.lineWidth = 3;
                ctx.beginPath();
                for (let i = 0; i <= 50; i++) {
                    const x = i / 50;
                    const y = (alpha * x) / (1.0 + (alpha - 1.0) * x);
                    if (i === 0) ctx.moveTo(getXCoord(x), getYCoord(y));
                    else ctx.lineTo(getXCoord(x), getYCoord(y));
                }
                ctx.stroke();

                // Draw Operating Lines (Verstärkungs- und Abtriebsgerade)
                // Rectifying line: xD to intersection (xF, yi)
                ctx.strokeStyle = "#4dabf7";
                ctx.lineWidth = 2.5;
                ctx.beginPath();
                ctx.moveTo(getXCoord(xD), getYCoord(xD));
                ctx.lineTo(getXCoord(xF), getYCoord(yi));
                ctx.stroke();

                // Stripping line: xB to intersection (xF, yi)
                ctx.strokeStyle = "#ff4d4d";
                ctx.lineWidth = 2.5;
                ctx.beginPath();
                ctx.moveTo(getXCoord(xB), getYCoord(xB));
                ctx.lineTo(getXCoord(xF), getYCoord(yi));
                ctx.stroke();

                // Feed line q-line (vertical at x=xF)
                ctx.strokeStyle = "rgba(255,255,255,0.4)";
                ctx.lineWidth = 1.5;
                ctx.beginPath();
                ctx.moveTo(getXCoord(xF), getYCoord(xF));
                ctx.lineTo(getXCoord(xF), getYCoord(yi));
                ctx.stroke();

                // Draw Trays Staircase (green steps)
                ctx.strokeStyle = "#39d353";
                ctx.lineWidth = 2.0;
                ctx.beginPath();
                trays.forEach((t, idx) => {
                    if (idx === 0) {
                        ctx.moveTo(getXCoord(xD), getYCoord(xD));
                    }
                    ctx.lineTo(getXCoord(t.x1), getYCoord(t.y1)); // horizontal step to equilibrium
                    ctx.lineTo(getXCoord(t.x2), getYCoord(t.y2)); // vertical step to operating line
                });
                ctx.stroke();

                // Draw Dots at boundaries
                ctx.fillStyle = "#4dabf7";
                ctx.beginPath(); ctx.arc(getXCoord(xD), getYCoord(xD), 4, 0, 2*Math.PI); ctx.fill();
                ctx.fillStyle = "#ff4d4d";
                ctx.beginPath(); ctx.arc(getXCoord(xB), getYCoord(xB), 4, 0, 2*Math.PI); ctx.fill();
                ctx.fillStyle = "rgba(255,255,255,0.6)";
                ctx.beginPath(); ctx.arc(getXCoord(xF), getYCoord(xF), 4, 0, 2*Math.PI); ctx.fill();

                // Labeled Axes
                drawPhysicalAxes("Mole Fraction in Liquid x [-]", "Mole Fraction in Vapor y [-]", 0, 1.0, 0, 1.0);

                // Legend
                drawLegend([
                    { color: "#ff9f43", label: "Species A (Orange) / Eq. Curve" },
                    { color: "#00d2ff", label: "Species B (Blue)" },
                    { color: "#4dabf7", label: "Operating Lines" },
                    { color: "#39d353", label: "Theoretical Trays" }
                ]);

                // Output metrics
                if (typeof stages === "string") {
                    outputsList.innerHTML = `
                        <div class="stat-row" style="grid-column: 1 / span 2; background: rgba(255, 77, 77, 0.1); border: 1px solid rgba(255, 77, 77, 0.3); padding: 8px; border-radius: 4px; color: #ff4d4d; font-weight: bold; font-size: 11px; text-align: center; margin-bottom: 8px; line-height: 1.4;">
                            ⚠️ Pinch Point Crossed (R < R_min = ${parameters["_R_min"].toFixed(2)})<br>Distillation is physically impossible!
                        </div>
                        <div class="stat-row"><span>Reflux Ratio R:</span><span class="mono">${R.toFixed(1)}</span></div>
                        <div class="stat-row"><span>Feed Quality q:</span><span class="mono">1.0 (Saturated Liquid)</span></div>
                    `;
                } else {
                    outputsList.innerHTML = `
                        <div class="stat-row"><span>Required Theoretical Trays:</span><span class="mono text-green" style="font-weight:bold; font-size:1.1rem;">${stages}</span></div>
                        <div class="stat-row"><span>Reflux Ratio R:</span><span class="mono">${R.toFixed(1)}</span></div>
                        <div class="stat-row"><span>Feed Quality q:</span><span class="mono">1.0 (Saturated Liquid)</span></div>
                        <div class="stat-row"><span>Stripping Operating Line Slope:</span><span class="mono">${m_s.toFixed(2)}</span></div>
                    `;
                }
            }
        };

const activeEqKey = "mccabe";
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
