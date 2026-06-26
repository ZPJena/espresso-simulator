// Controller script for eq_hatta.html
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
            title: "Hatta Number (Fluid-Fluid Macrokinetics)",
            badge: "L7 Macrokinetics II",
            formula: "\\[ Ha = \\delta \\cdot \\sqrt{\\frac{k_v \\cdot c_B^{n-1}}{D_{A}}} \\]",
            desc: "The Hatta number ($Ha$) compares the rate of reaction inside a liquid boundary film to the rate of diffusion through it. It governs fluid-fluid mass transfer with reaction (Class 7). The microscopic visualizer shows solute gas $A$ (orange) dissolving from the gas phase (left) through the gas-liquid interface into the liquid boundary film ($\\delta$), where it reacts with bulk reactant $B$ (blue) to yield product $P$ (purple). Product $P$ then diffuses away into the bulk liquid. Reactant $B$ is kept in excess ($c_{B,0} \\gg c_A^*$), matching typical physical absorption. When $Ha < 0.3$ (slow reaction), $A$ diffuses deep into the bulk liquid before reacting. When $Ha > 3.0$ (fast reaction), $A$ is consumed rapidly inside the thin liquid film boundary layer, visualising film-limited reaction-diffusion.",
            isAnimated: true,
            sliders: [
                { id: "k", label: "Reaction Rate Constant (k_v)", min: 0.1, max: 25.0, step: 0.5, val: 5.0 },
                { id: "diff", label: "Diffusion Coefficient (D_A in 10⁻⁹ m²/s)", min: 0.5, max: 5.0, step: 0.1, val: 1.5 },
                { id: "delta", label: "Film Thickness (δ in μm)", min: 10, max: 80, step: 5, val: 40 },
                { id: "simSpeed", label: "Simulation Speed", min: 0.2, max: 4.0, step: 0.2, val: 1.0 }
            ],
            init: () => {
                t = 0.0;
                hattaParticlesA = [];
                hattaParticlesB = [];
                hattaProducts = [];
                const w = canvas.width || 550;
                const h_canvas = canvas.height || 420;
                const leftMargin = 55;
                const rightMargin = 40;
                const gap = 35;
                const panelW = (w - leftMargin - rightMargin - gap) / 2;
                const rx = leftMargin + panelW + gap;
                const panelH = h_canvas - 110;

                const x_interface = rx + (0.2 / 1.4) * panelW;

                // Populate 3 Gas A particles on the left of interface (highly sparse gas representation with velocity properties)
                for (let i = 0; i < 3; i++) {
                    const angle = Math.random() * 2 * Math.PI;
                    hattaParticlesA.push({
                        x: rx + 2 + Math.random() * (x_interface - rx - 4),
                        y: 45 + Math.random() * (panelH - 20),
                        vx: Math.cos(angle) * 1.5,
                        vy: Math.sin(angle) * 1.5
                    });
                }

                // Populate 150 B particles in the liquid phase (physically dense liquid reactant representation)
                for (let i = 0; i < 150; i++) {
                    hattaParticlesB.push({
                        x: x_interface + 5 + Math.random() * (rx + panelW - x_interface - 10),
                        y: 45 + Math.random() * (panelH - 20)
                    });
                }
            },
            reset: () => {
                eqConfig.init();
            },
            solve: () => {
                const k = parameters["k"];
                const D_A_val = parameters["diff"]; // slider diff (0.5 to 5.0)
                const D_A = D_A_val * 1e-9;
                const delta = parameters["delta"] * 1e-6; // um to m

                // Hatta number: delta * sqrt(k / DA)
                const Ha = delta * Math.sqrt(k / D_A);
                parameters["_Ha"] = Ha;
                parameters["_delta_m"] = delta;

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

                    const x_interface = rx + (0.2 / 1.4) * panelW;
                    const x_film_end = rx + (1.2 / 1.4) * panelW;
                    const x_bulk_end = rx + panelW;

                    // Update A particles (gas movement & liquid diffusion/random walk)
                    const diffSpeed = Math.sqrt(D_A_val) * 8.0;
                    
                    hattaParticlesA.forEach(p => {
                        if (p.x < x_interface) {
                            // Ensure gas particles have velocity properties
                            if (p.vx === undefined || p.vy === undefined) {
                                const angle = Math.random() * 2 * Math.PI;
                                p.vx = Math.cos(angle) * 1.5;
                                p.vy = Math.sin(angle) * 1.5;
                            }

                            // Gas phase: straight-line movement (large mean free path)
                            p.x += p.vx;
                            p.y += p.vy;

                            // Boundaries: bounce off left wall
                            if (p.x < rx) {
                                p.x = rx;
                                p.vx = -p.vx;
                            }
                            // Bounce off top/bottom walls
                            if (p.y < 45) {
                                p.y = 45;
                                p.vy = -p.vy;
                            }
                            if (p.y > y_bottom - 5) {
                                p.y = y_bottom - 5;
                                p.vy = -p.vy;
                            }

                            // Stochastic direction change (collision with other gas molecules, 2% probability per frame)
                            if (Math.random() < 0.02) {
                                const angle = Math.random() * 2 * Math.PI;
                                p.vx = Math.cos(angle) * 1.5;
                                p.vy = Math.sin(angle) * 1.5;
                            }

                            // Dissolution check at interface
                            if (p.x >= x_interface) {
                                const liquidACount = hattaParticlesA.filter(a => a.x >= x_interface).length;
                                // Dissolve if liquid solute is not oversaturated, with a probability
                                if (liquidACount < 10 && Math.random() < 0.6) {
                                    p.x = x_interface + 1.0; // cross over
                                    delete p.vx;
                                    delete p.vy;
                                } else {
                                    p.x = x_interface - 2.0; // bounce back
                                    p.vx = -p.vx;
                                }
                            }
                        } else {
                            // Liquid phase: physical random walk
                            p.x += (Math.random() - 0.5) * diffSpeed;
                            p.y += (Math.random() - 0.5) * diffSpeed;

                            // Boundaries (cannot cross back to gas phase)
                            if (p.x < x_interface) p.x = x_interface;
                        }

                        // Y boundary clamping
                        if (p.y < 45) p.y = 45;
                        if (p.y > y_bottom - 5) p.y = y_bottom - 5;
                    });

                    // Remove A particles that diffused past the right edge (into bulk liquid)
                    hattaParticlesA = hattaParticlesA.filter(p => p.x <= x_bulk_end);

                    // Update B particles (physical random walk)
                    hattaParticlesB.forEach(p => {
                        // Liquid phase: physical random walk
                        p.x += (Math.random() - 0.5) * diffSpeed;
                        p.y += (Math.random() - 0.5) * diffSpeed;

                        // Clamped inside liquid phase (cannot enter gas phase!)
                        if (p.x < x_interface) p.x = x_interface;
                        if (p.x > x_bulk_end) p.x = x_bulk_end;
                        if (p.y < 45) p.y = 45;
                        if (p.y > y_bottom - 5) p.y = y_bottom - 5;
                    });

                    // Liquid phase collision resolution (hard-sphere repulsion, diameter = 7.0)
                    // Combine B particles and dissolved A particles for collision checks
                    const liquidParticles = [
                        ...hattaParticlesB,
                        ...hattaParticlesA.filter(p => p.x >= x_interface)
                    ];

                    // Run 2 iterations of collision resolution for stability
                    for (let iter = 0; iter < 2; iter++) {
                        for (let i = 0; i < liquidParticles.length; i++) {
                            for (let j = i + 1; j < liquidParticles.length; j++) {
                                const pi = liquidParticles[i];
                                const pj = liquidParticles[j];
                                const dx = pj.x - pi.x;
                                const dy = pj.y - pi.y;
                                const dist = Math.hypot(dx, dy);
                                if (dist < 7.0) {
                                    const overlap = 7.0 - dist;
                                    const nx = dist > 0.001 ? dx / dist : (Math.random() - 0.5);
                                    const ny = dist > 0.001 ? dy / dist : (Math.random() - 0.5);
                                    const len = Math.hypot(nx, ny);
                                    const ux = len > 0 ? nx / len : 1.0;
                                    const uy = len > 0 ? ny / len : 0.0;

                                    pi.x -= ux * (overlap / 2);
                                    pi.y -= uy * (overlap / 2);
                                    pj.x += ux * (overlap / 2);
                                    pj.y += uy * (overlap / 2);
                                }
                            }
                        }
                        
                        // Re-clamp boundaries after pushing
                        liquidParticles.forEach(p => {
                            if (p.x < x_interface) p.x = x_interface;
                            if (p.x > x_bulk_end) p.x = x_bulk_end;
                            if (p.y < 45) p.y = 45;
                            if (p.y > y_bottom - 5) p.y = y_bottom - 5;
                        });
                    }

                    // Check for reactions between A and B
                    // Reaction only occurs in the liquid phase!
                    for (let i = 0; i < hattaParticlesA.length; i++) {
                        if (hattaParticlesA[i].x < x_interface) continue; // Only react if dissolved!
                        
                        for (let j = 0; j < hattaParticlesB.length; j++) {
                            const dx = hattaParticlesA[i].x - hattaParticlesB[j].x;
                            const dy = hattaParticlesA[i].y - hattaParticlesB[j].y;
                            const dist = Math.hypot(dx, dy);
                            if (dist < 8.0) {
                                // Reaction probability is proportional to k (fast reaction = instant reaction)
                                // Scaled down to allow a clear bulk-limited kinetic regime at low k
                                const P_rx = Math.min(1.0, 0.05 * k);
                                if (Math.random() < P_rx) {
                                    // React! Spawn a product particle
                                    hattaProducts.push({
                                        x: (hattaParticlesA[i].x + hattaParticlesB[j].x) / 2,
                                        y: (hattaParticlesA[i].y + hattaParticlesB[j].y) / 2,
                                        alpha: 1.0,
                                        vx: 0.8, // drifts to the right (towards bulk)
                                        vy: (Math.random() - 0.5) * 0.4 - 0.2 // drifts slightly upwards/downwards
                                    });
                                    // Remove reactants
                                    hattaParticlesA.splice(i, 1);
                                    hattaParticlesB.splice(j, 1);
                                    i--;
                                    break;
                                }
                            }
                        }
                    }

                    // Update product particles (fade and drift right towards bulk)
                    hattaProducts.forEach(p => {
                        p.x += p.vx;
                        p.y += p.vy;
                        p.alpha -= 0.025; // fade rate
                    });
                    hattaProducts = hattaProducts.filter(p => p.alpha > 0 && p.x < x_bulk_end && p.y > 40 && p.y < y_bottom);

                    // Maintain concentration boundary conditions:
                    // 1. Maintain 3 A particles in the gas phase with velocity properties
                    while (hattaParticlesA.filter(p => p.x < x_interface).length < 3) {
                        const angle = Math.random() * 2 * Math.PI;
                        hattaParticlesA.push({
                            x: rx + 2 + Math.random() * (x_interface - rx - 4),
                            y: 45 + Math.random() * (panelH - 20),
                            vx: Math.cos(angle) * 1.5,
                            vy: Math.sin(angle) * 1.5
                        });
                    }

                    // 2. Maintain 150 B particles in the liquid phase (replenished in the bulk liquid)
                    while (hattaParticlesB.length < 150) {
                        hattaParticlesB.push({
                            x: x_film_end + Math.random() * (x_bulk_end - x_film_end - 4),
                            y: 45 + Math.random() * (panelH - 20)
                        });
                    }
                }
            },
            draw: () => {
                ctx.fillStyle = "#040507";
                ctx.fillRect(0, 0, canvas.width, canvas.height);

                const k = parameters["k"];
                const Ha = parameters["_Ha"] || 0;
                const delta_m = parameters["_delta_m"] || 4e-5;

                const leftMargin = 55;
                const rightMargin = 40;
                const gap = 35;
                const panelW = (canvas.width - leftMargin - rightMargin - gap) / 2;
                const panelH = canvas.height - 110;
                const rx = leftMargin + panelW + gap;

                const c0 = 100.0; // inlet concentration (%)
                const getXCoord = (y_pct) => leftMargin + ((y_pct - (-0.2)) / 1.4) * panelW; // y_pct in [-0.2, 1.2]
                const getYCoord = (c_pct) => 40 + panelH - (c_pct / 100) * panelH;

                const x_interface = rx + (0.2 / 1.4) * panelW;
                const x_film_end = rx + (1.2 / 1.4) * panelW;
                const x_bulk_end = rx + panelW;
                const y_bottom = 40 + panelH - 12;

                // Left Panel: Concentration Profile Plot
                ctx.strokeStyle = "rgba(255,255,255,0.06)";
                ctx.strokeRect(leftMargin, 40, panelW, panelH);

                // Draw Grid
                ctx.strokeStyle = "rgba(255,255,255,0.04)";
                ctx.lineWidth = 1;
                const yTicks = [-0.2, 0.0, 0.2, 0.4, 0.6, 0.8, 1.0, 1.2];
                yTicks.forEach(tick => {
                    ctx.beginPath();
                    ctx.moveTo(getXCoord(tick), 40);
                    ctx.lineTo(getXCoord(tick), 40 + panelH);
                    ctx.stroke();
                });
                for (let g = 0; g <= 10; g++) {
                    ctx.beginPath();
                    ctx.moveTo(leftMargin, getYCoord(g * 10));
                    ctx.lineTo(leftMargin + panelW, getYCoord(g * 10));
                    ctx.stroke();
                }

                // Draw Shaded background for Gas (orange) vs Liquid Film (light gray) vs Liquid Bulk (blue)
                ctx.fillStyle = "rgba(255, 159, 67, 0.06)";
                ctx.fillRect(leftMargin, 40, getXCoord(0.0) - leftMargin, panelH); // Gas region [-0.2, 0.0]
                ctx.fillStyle = "rgba(255, 255, 255, 0.015)";
                ctx.fillRect(getXCoord(0.0), 40, getXCoord(1.0) - getXCoord(0.0), panelH); // Film region [0.0, 1.0]
                ctx.fillStyle = "rgba(0, 210, 255, 0.06)";
                ctx.fillRect(getXCoord(1.0), 40, getXCoord(1.2) - getXCoord(1.0), panelH); // Bulk region [1.0, 1.2]

                // Draw Interface line (vertical at y = 0.0)
                ctx.strokeStyle = "rgba(255, 255, 255, 0.4)";
                ctx.lineWidth = 2.0;
                ctx.beginPath();
                ctx.moveTo(getXCoord(0.0), 40);
                ctx.lineTo(getXCoord(0.0), 40 + panelH);
                ctx.stroke();

                // Draw Film boundary line (dashed vertical at y = 1.0)
                ctx.strokeStyle = "rgba(255, 255, 255, 0.2)";
                ctx.lineWidth = 1.5;
                ctx.setLineDash([3, 3]);
                ctx.beginPath();
                ctx.moveTo(getXCoord(1.0), 40);
                ctx.lineTo(getXCoord(1.0), 40 + panelH);
                ctx.stroke();
                ctx.setLineDash([]);

                // Draw Concentration Profile of Reactant A (orange curve)
                ctx.strokeStyle = "#ff9f43";
                ctx.lineWidth = 3.0;
                ctx.beginPath();
                const sinh = (x) => 0.5 * (Math.exp(x) - Math.exp(-x));

                // 1. Gas phase (constant 100%)
                ctx.moveTo(getXCoord(-0.2), getYCoord(c0));
                ctx.lineTo(getXCoord(0.0), getYCoord(c0));

                // 2. Film phase
                for (let i = 0; i <= 50; i++) {
                    const y_pct = i / 50;
                    let c;
                    if (Ha < 0.01) {
                        c = c0 * (1.0 - y_pct); // linear pure diffusion limit
                    } else {
                        const ha_term = Math.min(700, Ha * (1.0 - y_pct));
                        const ha_denom = Math.min(700, Ha);
                        if (Ha > 50.0) {
                            c = c0 * Math.exp(Ha * (-y_pct));
                        } else {
                            c = c0 * sinh(ha_term) / sinh(ha_denom);
                        }
                    }
                    c = Math.max(0.0, Math.min(c0, c));
                    ctx.lineTo(getXCoord(y_pct), getYCoord(c));
                }

                // 3. Bulk phase (constant 0%)
                ctx.lineTo(getXCoord(1.2), getYCoord(0));
                ctx.stroke();

                // Left Panel Axes Ticks
                ctx.fillStyle = "rgba(255, 255, 255, 0.4)";
                ctx.font = "9px 'JetBrains Mono', monospace";
                
                // Y-ticks
                ctx.textAlign = "right";
                for (let g = 0; g <= 100; g += 20) {
                    ctx.fillText(g.toString(), leftMargin - 8, getYCoord(g) + 3);
                    ctx.beginPath();
                    ctx.moveTo(leftMargin - 4, getYCoord(g));
                    ctx.lineTo(leftMargin, getYCoord(g));
                    ctx.stroke();
                }

                // X-ticks
                ctx.textAlign = "center";
                yTicks.forEach(tick => {
                    ctx.fillText(tick.toFixed(1), getXCoord(tick), 40 + panelH + 12);
                    ctx.beginPath();
                    ctx.moveTo(getXCoord(tick), 40 + panelH);
                    ctx.lineTo(getXCoord(tick), 40 + panelH + 4);
                    ctx.stroke();
                });

                // Titles and labels
                ctx.fillStyle = "#fff";
                ctx.font = "bold 9px Outfit";
                ctx.textAlign = "left";
                ctx.fillText("Reactant Concentration Profile", leftMargin, 32);

                ctx.save();
                ctx.translate(leftMargin - 32, 40 + panelH / 2);
                ctx.rotate(-Math.PI / 2);
                ctx.textAlign = "center";
                ctx.fillStyle = "rgba(255,255,255,0.6)";
                ctx.fillText("Relative Concentration c/c₀ [%]", 0, 0);
                ctx.restore();

                ctx.textAlign = "center";
                ctx.fillText("Normalized Film Coordinate y/δ [-]", leftMargin + panelW / 2, 40 + panelH + 24);

                ctx.fillStyle = "rgba(255, 255, 255, 0.5)";
                ctx.font = "8px Outfit";
                ctx.textAlign = "center";
                ctx.fillText("Gas Phase", getXCoord(-0.1), 55);
                ctx.fillText("Liquid Boundary Film (y ≤ δ)", getXCoord(0.5), 55);
                ctx.fillText("Bulk Liquid", getXCoord(1.1), 55);

                // --- Right Panel: Microscopic 2D Boundary Film ---
                ctx.strokeStyle = "rgba(255,255,255,0.06)";
                ctx.strokeRect(rx, 40, panelW, panelH);

                ctx.fillStyle = "#fff";
                ctx.font = "bold 9px Outfit";
                ctx.textAlign = "left";
                ctx.fillText("Microscopic 2D Boundary Film (2D slit)", rx, 32);

                // Gas phase shading
                ctx.fillStyle = "rgba(255, 159, 67, 0.06)";
                ctx.fillRect(rx, 40, x_interface - rx, panelH);

                // Film region shading
                ctx.fillStyle = "rgba(255, 255, 255, 0.015)";
                ctx.fillRect(x_interface, 40, x_film_end - x_interface, panelH);

                // Bulk region shading
                ctx.fillStyle = "rgba(0, 210, 255, 0.06)";
                ctx.fillRect(x_film_end, 40, x_bulk_end - x_film_end, panelH);

                // Gas-Liquid Interface line
                ctx.strokeStyle = "rgba(255, 255, 255, 0.4)";
                ctx.lineWidth = 2.0;
                ctx.beginPath();
                ctx.moveTo(x_interface, 40);
                ctx.lineTo(x_interface, y_bottom);
                ctx.stroke();

                // Film boundary line (dashed vertical at y = delta)
                ctx.strokeStyle = "rgba(255,255,255,0.15)";
                ctx.lineWidth = 1;
                ctx.setLineDash([3, 3]);
                ctx.beginPath();
                ctx.moveTo(x_film_end, 40);
                ctx.lineTo(x_film_end, y_bottom);
                ctx.stroke();
                ctx.setLineDash([]);

                // Right panel labels
                ctx.fillStyle = "rgba(255,255,255,0.4)";
                ctx.font = "8px Outfit";
                ctx.textAlign = "center";
                ctx.fillText("Gas Phase", rx + (x_interface - rx)/2, 52);
                ctx.fillText("Gas-Liquid Interface", x_interface, y_bottom + 12);
                ctx.fillText("Liquid Film (δ)", x_interface + (x_film_end - x_interface)/2, y_bottom + 12);
                ctx.fillText("Bulk Liquid", x_film_end + (x_bulk_end - x_film_end)/2, 52);

                // Draw reactant A (orange dots)
                hattaParticlesA.forEach(p => {
                    ctx.fillStyle = "#ff9f43";
                    ctx.beginPath();
                    ctx.arc(p.x, p.y, 3.5, 0, 2 * Math.PI);
                    ctx.fill();
                });

                // Draw reactant B (blue dots)
                hattaParticlesB.forEach(p => {
                    ctx.fillStyle = "rgba(0, 210, 255, 0.85)";
                    ctx.beginPath();
                    ctx.arc(p.x, p.y, 3.5, 0, 2 * Math.PI);
                    ctx.fill();
                });

                // Draw products (purple fading dots)
                hattaProducts.forEach(p => {
                    ctx.fillStyle = `rgba(168, 85, 247, ${p.alpha})`; // Purple product
                    ctx.shadowColor = "rgb(168, 85, 247)";
                    ctx.shadowBlur = 3 * p.alpha;
                    ctx.beginPath();
                    ctx.arc(p.x, p.y, 4.0, 0, 2 * Math.PI);
                    ctx.fill();
                    ctx.shadowBlur = 0;
                });

                // Draw Legends
                // Left Panel Legend
                drawLegend([
                    { color: "#ff9f43", label: "Reactant A Profile" },
                    { color: "rgba(255, 255, 255, 0.35)", label: "Film Boundary (y=δ)" }
                ], 50, 110);

                // Right Panel Legend (using circles indicator)
                const rlx = rx;
                const rly = canvas.height - 45;
                ctx.font = "9px Outfit";
                ctx.textAlign = "left";

                // A legend (orange dot)
                ctx.fillStyle = "#ff9f43";
                ctx.beginPath(); ctx.arc(rlx + 5, rly - 3, 3.5, 0, 2*Math.PI); ctx.fill();
                ctx.fillStyle = "rgba(255,255,255,0.7)";
                ctx.fillText("Solute A", rlx + 13, rly);

                // B legend (blue dot)
                ctx.fillStyle = "rgba(0, 210, 255, 0.85)";
                ctx.beginPath(); ctx.arc(rlx + 80, rly - 3, 3.5, 0, 2*Math.PI); ctx.fill();
                ctx.fillStyle = "rgba(255,255,255,0.7)";
                ctx.fillText("Reactant B", rlx + 88, rly);

                // Product legend (purple dot)
                ctx.fillStyle = "rgb(168, 85, 247)";
                ctx.beginPath(); ctx.arc(rlx + 150, rly - 3, 4.0, 0, 2*Math.PI); ctx.fill();
                ctx.fillStyle = "rgba(255,255,255,0.7)";
                ctx.fillText("Product P", rlx + 158, rly);

                // Output calculations table
                outputsList.innerHTML = `
                    <div class="stat-row"><span>Hatta Number (Ha):</span><span class="mono text-orange" style="font-weight:bold; font-size:1.05rem;">${Ha.toFixed(3)}</span></div>
                    <div class="stat-row"><span>Reaction Regime:</span><span class="mono" style="color: ${Ha > 3.0 ? '#ff4d4d' : (Ha < 0.3 ? '#39d353' : '#ff9f43')}; font-weight:bold;">
                        ${Ha > 3.0 ? 'Fast Reaction (Film-Limited)' : (Ha < 0.3 ? 'Slow Reaction (Bulk-Limited)' : 'Transition Regime')}
                    </span></div>
                    <div class="stat-row"><span>Film Effectiveness Factor (E):</span><span class="mono">${(Ha > 0 ? (1.0 / Math.tanh(Ha) - 1.0/Ha).toFixed(3) : 1.0)}</span></div>
                    <div class="stat-row"><span>Boundary Layer Depth δ:</span><span class="mono">${(delta_m * 1e6).toFixed(0)} μm</span></div>
                `;
            }
        };

const activeEqKey = "hatta";
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
