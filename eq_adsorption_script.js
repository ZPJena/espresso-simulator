// Controller script for eq_adsorption.html
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
            title: "Adsorption Isotherms & Breakthrough Column",
            badge: "L16 Adsorption & Absorption",
            formula: "\\[ \\text{Lang: } X_A = \\frac{a \\cdot c}{b + c} \\quad \\text{Freund: } X_A = k \\cdot c^n \\quad \\text{BET: } X_A = \\frac{X_m C x}{(1-x)(1-x+Cx)} \\]",
            desc: "The adsorption isotherm describes the thermodynamic equilibrium between the solid-phase adsorbate loading X and the fluid-phase concentration c. In fixed-bed adsorption columns, the mass transfer front (breakthrough front) propagates through the bed at a velocity inversely proportional to the slope of the isotherm. The simulation solves the time-dependent advection-reaction-diffusion PDE to demonstrate breakthrough front sharpening (favorable isotherm) and dispersion.",
            isAnimated: true,
            sliders: [
                { id: "mode", label: "Simulation Mode", min: 0, max: 1, step: 1, val: 0, isSelect: true, options: [{val:0, text:"Breakthrough Column (PDE)"}, {val:1, text:"Molecular Monte Carlo (GCMC)"}] },
                { id: "type", label: "Isotherm Type", min: 0, max: 2, step: 1, val: 0, isSelect: true, options: [{val:0, text:"Langmuir"}, {val:1, text:"Freundlich"}, {val:2, text:"BET (Multilayer)"}] },
                { id: "affinity", label: "Adsorption Affinity", min: 0.2, max: 3.0, step: 0.1, val: 1.2 },
                { id: "c0", label: "Inlet Concentration / Pressure", min: 10.0, max: 50.0, step: 5.0, val: 30.0 }
            ],
            init: () => {
                t = 0.0;
                for (let i = 0; i < Nz; i++) {
                    adsC[i] = 0.0;
                    adsX[i] = 0.0;
                }
                for (let i = 0; i < 15; i++) {
                    gcmcHeights[i] = 0;
                }
                gcmcGasParticles = [];
                gcmcEvent = null;
                gcmcTotalSteps = 0;
                gcmcAcceptedSteps = 0;
                gcmcAccumulatedLoading = [];
                gcmcRunningAvgLoading = 0.0;

                const c0 = parameters["c0"] || 30.0;
                const targetGasCount = Math.round(c0 * 0.8);
                const w = canvas.width || 550;
                const h_canvas = canvas.height || 420;
                const leftMargin = 55;
                const rightMargin = 40;
                const gap = 35;
                const panelW = (w - leftMargin - rightMargin - gap) / 2;
                const rx = leftMargin + panelW + gap;
                const panelH = h_canvas - 110;
                const y_bottom = 40 + panelH - 12;

                for (let i = 0; i < targetGasCount; i++) {
                    gcmcGasParticles.push({
                        x: rx + 10 + Math.random() * (panelW - 20),
                        y: 45 + Math.random() * (y_bottom - 80),
                        vx: (Math.random() - 0.5) * 2.5,
                        vy: (Math.random() - 0.5) * 2.5,
                        adsorbed: false
                    });
                }
            },
            reset: () => {
                equationsConfig.adsorption.init();
            },
            solve: () => {
                const type = parameters["type"];
                const affinity = parameters["affinity"];
                const c0 = parameters["c0"];
                const mode = parameters["mode"] || 0;

                if (mode === 0) {
                    const eps = 0.4;
                    const rhob = 800.0;
                    const u = 1.2;
                    const dz = 1.0;

                    const getX = (c) => {
                        if (type === 0) {
                            const a = 0.2 * affinity;
                            const b = 15.0;
                            return (a * c) / (b + c);
                        } else if (type === 1) {
                            const k = 0.005 * affinity;
                            const n = 0.6;
                            return k * Math.pow(c, n);
                        } else {
                            const x = Math.min(0.95, c / 60.0);
                            const C_bet = 5.0 * affinity;
                            const Xm = 0.08;
                            return (Xm * C_bet * x) / ((1.0 - x) * (1.0 - x + C_bet * x) + 1e-4);
                        }
                    };

                    let nextC = new Float32Array(adsC);
                    const dt_ads = 0.04;
                    
                    nextC[0] = c0;
                    for (let i = 1; i < Nz - 1; i++) {
                        const conv = (u / eps) * (adsC[i] - adsC[i-1]) / dz;
                        const disp = 0.15 * (adsC[i+1] - 2 * adsC[i] + adsC[i-1]) / (dz * dz);

                        const dX_dc = Math.max(1e-5, (getX(adsC[i] + 0.1) - getX(adsC[i])) / 0.1);
                        const factor = 1.0 + (rhob / eps) * dX_dc;
                        
                        nextC[i] = adsC[i] + dt_ads * (disp - conv) / factor;
                        nextC[i] = Math.max(0, Math.min(c0, nextC[i]));
                    }
                    nextC[Nz-1] = nextC[Nz-2];

                    adsC = nextC;
                    for (let i = 0; i < Nz; i++) {
                        adsX[i] = getX(adsC[i]);
                    }

                    t += dt_ads;
                } else {
                    const w = canvas.width || 550;
                    const h_canvas = canvas.height || 420;
                    const leftMargin = 55;
                    const rightMargin = 40;
                    const gap = 35;
                    const panelW = (w - leftMargin - rightMargin - gap) / 2;
                    const rx = leftMargin + panelW + gap;
                    const panelH = h_canvas - 110;
                    const y_bottom = 40 + panelH - 12;
                    const W_avail = panelW - 30;
                    const dx_col = W_avail / 15.0;
                    const dy_layer = 14;
                    const radius_p = 5.5;

                    const x_rel = Math.min(0.95, c0 / 60.0);
                    const K_lang = 0.067 * affinity;
                    const C_bet = 5.0 * affinity;
                    const getFreundlichK = (col) => {
                        return 0.02 * affinity * Math.exp((14 - col) / 3.5);
                    };

                    if (!isRunning) {
                        const steps = 500;
                        for (let step = 0; step < steps; step++) {
                            const isInsert = Math.random() < 0.5;
                            const col = Math.floor(Math.random() * 15);
                            const h = gcmcHeights[col];

                            if (isInsert) {
                                if (type === 0 && h === 0) {
                                    if (Math.random() < Math.min(1, K_lang * c0)) gcmcHeights[col] = 1;
                                } else if (type === 1 && h === 0) {
                                    if (Math.random() < Math.min(1, getFreundlichK(col) * c0)) gcmcHeights[col] = 1;
                                } else if (type === 2 && h < 10) {
                                    const P_acc = h === 0 ? Math.min(1, C_bet * x_rel) : Math.min(1, x_rel);
                                    if (Math.random() < P_acc) gcmcHeights[col] = h + 1;
                                }
                            } else {
                                if (h > 0) {
                                    if (type === 0) {
                                        if (Math.random() < Math.min(1, 1.0 / (K_lang * c0 + 1e-6))) gcmcHeights[col] = 0;
                                    } else if (type === 1) {
                                        if (Math.random() < Math.min(1, 1.0 / (getFreundlichK(col) * c0 + 1e-6))) gcmcHeights[col] = 0;
                                    } else {
                                        const P_acc = h === 1 ? Math.min(1, 1.0 / (C_bet * x_rel + 1e-6)) : Math.min(1, 1.0 / (x_rel + 1e-6));
                                        if (Math.random() < P_acc) gcmcHeights[col] = h - 1;
                                    }
                                }
                            }
                        }

                        let totalAdsorbed = 0;
                        for (let i = 0; i < 15; i++) totalAdsorbed += gcmcHeights[i];
                        gcmcRunningAvgLoading = totalAdsorbed / 15.0;

                        const existingIdx = gcmcAccumulatedLoading.findIndex(pt => Math.abs(pt.c - c0) < 1.5);
                        if (existingIdx !== -1) {
                            gcmcAccumulatedLoading[existingIdx].loading = gcmcRunningAvgLoading;
                        } else {
                            gcmcAccumulatedLoading.push({ c: c0, loading: gcmcRunningAvgLoading });
                        }
                    } else {
                        gcmcGasParticles.forEach(p => {
                            p.x += p.vx;
                            p.y += p.vy;

                            if (p.x < rx + 5) { p.x = rx + 5; p.vx = Math.abs(p.vx); }
                            if (p.x > rx + panelW - 5) { p.x = rx + panelW - 5; p.vx = -Math.abs(p.vx); }
                            if (p.y < 45) { p.y = 45; p.vy = Math.abs(p.vy); }

                            const col = Math.floor((p.x - (rx + 15)) / dx_col);
                            if (col >= 0 && col < 15) {
                                const h = gcmcHeights[col];
                                const y_top_col = y_bottom - h * dy_layer;
                                if (p.y > y_top_col + 2) {
                                    // Side collision with the pillar (below the top)
                                    p.vx = -p.vx;
                                    const cx = rx + 15 + (col + 0.5) * dx_col;
                                    // dx_col/2 + 2 approx 9px, matching column radius (5.5) + gas particle radius (3.5)
                                    if (p.x < cx) {
                                        p.x = cx - dx_col / 2 - 2;
                                    } else {
                                        p.x = cx + dx_col / 2 + 2;
                                    }
                                } else if (p.y >= y_top_col - radius_p) {
                                    const maxH = (type === 2) ? 10 : 1;
                                    if (h < maxH) {
                                        let P_ads = 0;
                                        if (h === 0) {
                                            if (type === 0) P_ads = Math.min(0.8, 0.4 * affinity);
                                            else if (type === 1) P_ads = Math.min(0.8, 0.4 * getFreundlichK(col) * 15.0);
                                            else P_ads = Math.min(0.8, 0.2 * C_bet);
                                        } else {
                                            P_ads = 0.4;
                                        }

                                        if (Math.random() < P_ads) {
                                            gcmcHeights[col] = h + 1;
                                            p.adsorbed = true;
                                            gcmcTotalSteps++;
                                            gcmcAcceptedSteps++;
                                            gcmcEvent = { type: "insert", col, h, accepted: true, timer: 12 };
                                        } else {
                                            p.vy = -Math.abs(p.vy);
                                            p.y = y_top_col - radius_p - 2;
                                            gcmcTotalSteps++;
                                            if (Math.random() < 0.15) {
                                                gcmcEvent = { type: "insert", col, h, accepted: false, timer: 12 };
                                            }
                                        }
                                    } else {
                                        p.vy = -Math.abs(p.vy);
                                        p.y = y_top_col - radius_p - 2;
                                    }
                                }
                            } else {
                                if (p.y > y_bottom - 5) {
                                    p.y = y_bottom - 5;
                                    p.vy = -Math.abs(p.vy);
                                }
                            }
                        });

                        gcmcGasParticles = gcmcGasParticles.filter(p => !p.adsorbed);

                        for (let col = 0; col < 15; col++) {
                            const h = gcmcHeights[col];
                            if (h > 0) {
                                let P_des = 0;
                                if (h === 1) {
                                    if (type === 0) P_des = 0.003 / affinity;
                                    else if (type === 1) P_des = 0.003 / getFreundlichK(col);
                                    else P_des = 0.003 / C_bet;
                                } else {
                                    P_des = 0.003;
                                }

                                if (Math.random() < P_des) {
                                    gcmcHeights[col] = h - 1;
                                    gcmcEvent = { type: "delete", col, h: h - 1, accepted: true, timer: 12 };
                                    gcmcAcceptedSteps++;
                                    
                                    gcmcGasParticles.push({
                                        x: rx + 15 + (col + 0.5) * dx_col,
                                        y: y_bottom - (h - 1) * dy_layer - 8,
                                        vx: (Math.random() - 0.5) * 2.5,
                                        vy: -Math.random() * 1.5 - 0.5,
                                        adsorbed: false
                                    });
                                }
                            }
                        }

                        const targetGasCount = Math.round(c0 * 0.8);
                        if (gcmcGasParticles.length < targetGasCount) {
                            gcmcGasParticles.push({
                                x: rx + 10 + Math.random() * (panelW - 20),
                                y: 48,
                                vx: (Math.random() - 0.5) * 2.5,
                                vy: Math.random() * 1.5 + 0.5,
                                adsorbed: false
                            });
                        } else if (gcmcGasParticles.length > targetGasCount) {
                            const removeIdx = gcmcGasParticles.findIndex(p => p.y < 120);
                            if (removeIdx !== -1) {
                                gcmcGasParticles.splice(removeIdx, 1);
                            } else {
                                gcmcGasParticles.pop();
                            }
                        }

                        let totalAdsorbed = 0;
                        for (let i = 0; i < 15; i++) totalAdsorbed += gcmcHeights[i];
                        const avgHeight = totalAdsorbed / 15.0;
                        gcmcRunningAvgLoading = 0.98 * gcmcRunningAvgLoading + 0.02 * avgHeight;

                        if (Math.random() < 0.02) {
                            const existingIdx = gcmcAccumulatedLoading.findIndex(pt => Math.abs(pt.c - c0) < 1.5);
                            if (existingIdx !== -1) {
                                gcmcAccumulatedLoading[existingIdx].loading = gcmcRunningAvgLoading;
                            } else {
                                gcmcAccumulatedLoading.push({ c: c0, loading: gcmcRunningAvgLoading });
                            }
                            if (gcmcAccumulatedLoading.length > 20) {
                                gcmcAccumulatedLoading.shift();
                            }
                        }
                    }

                    t += 0.04;
                }
            },
            draw: () => {
                ctx.fillStyle = "#040507";
                ctx.fillRect(0, 0, canvas.width, canvas.height);

                const type = parameters["type"];
                const c0 = parameters["c0"];
                const affinity = parameters["affinity"];
                const mode = parameters["mode"] || 0;

                const getX = (c) => {
                    if (type === 0) {
                        return (0.2 * affinity * c) / (15.0 + c);
                    } else if (type === 1) {
                        return 0.005 * affinity * Math.pow(c, 0.6);
                    } else {
                        const x = Math.min(0.95, c / 60.0);
                        const C_bet = 5.0 * affinity;
                        const Xm = 0.08;
                        return (Xm * C_bet * x) / ((1.0 - x) * (1.0 - x + C_bet * x) + 1e-4);
                    }
                };

                const leftMargin = 55;
                const rightMargin = 40;
                const gap = 35;
                const panelW = (canvas.width - leftMargin - rightMargin - gap) / 2;
                const panelH = canvas.height - 110;
                const rx = leftMargin + panelW + gap;

                ctx.strokeStyle = "rgba(255,255,255,0.06)";
                ctx.strokeRect(leftMargin, 40, panelW, panelH);
                
                ctx.strokeStyle = "#ff9f43";
                ctx.lineWidth = 2.5;
                ctx.beginPath();

                const maxX = getX(50.0);
                const scaleX_iso = panelW / 50.0;
                const scaleY_iso = panelH / (maxX + 1e-6);

                for (let cVal = 0; cVal <= 50; cVal += 1.0) {
                    const x_val = getX(cVal);
                    const px = leftMargin + cVal * scaleX_iso;
                    const py = 40 + panelH - x_val * scaleY_iso;
                    if (cVal === 0) ctx.moveTo(px, py);
                    else ctx.lineTo(px, py);
                }
                ctx.stroke();

                if (mode === 1) {
                    const getSimScaledX = (h_avg) => {
                        if (type === 0) return h_avg * 0.2 * affinity;
                        else if (type === 1) return h_avg * 0.14 * affinity;
                        else return h_avg * 0.08;
                    };

                    gcmcAccumulatedLoading.forEach(pt => {
                        const scaledX = getSimScaledX(pt.loading);
                        ctx.fillStyle = "rgba(0, 210, 255, 0.6)";
                        ctx.beginPath();
                        ctx.arc(leftMargin + pt.c * scaleX_iso, 40 + panelH - scaledX * scaleY_iso, 4, 0, 2*Math.PI);
                        ctx.fill();
                        ctx.strokeStyle = "#fff";
                        ctx.lineWidth = 1;
                        ctx.stroke();
                    });

                    const curScaledX = getSimScaledX(gcmcRunningAvgLoading);
                    const blink = 0.5 + 0.5 * Math.sin(Date.now() / 150);
                    ctx.fillStyle = `rgba(0, 210, 255, ${0.4 + 0.6 * blink})`;
                    ctx.beginPath();
                    ctx.arc(leftMargin + c0 * scaleX_iso, 40 + panelH - curScaledX * scaleY_iso, 7, 0, 2*Math.PI);
                    ctx.fill();
                    ctx.strokeStyle = "#00d2ff";
                    ctx.lineWidth = 2;
                    ctx.stroke();
                }

                // Draw analytical feed point on top so it is never covered by simulated points
                const x_feed = getX(c0);
                ctx.fillStyle = "#ff4d4d";
                ctx.beginPath();
                ctx.arc(leftMargin + c0 * scaleX_iso, 40 + panelH - x_feed * scaleY_iso, 5, 0, 2*Math.PI);
                ctx.fill();

                ctx.strokeStyle = "rgba(255,255,255,0.3)";
                ctx.lineWidth = 1.5;
                ctx.beginPath();
                ctx.moveTo(leftMargin, 40); ctx.lineTo(leftMargin, 40 + panelH); ctx.lineTo(leftMargin + panelW, 40 + panelH);
                ctx.stroke();
                
                ctx.fillStyle = "rgba(255,255,255,0.6)";
                ctx.font = "9px 'JetBrains Mono', monospace";
                
                ctx.textAlign = "right";
                ctx.fillText(x_feed.toFixed(3), leftMargin - 8, 40 + panelH - x_feed * scaleY_iso + 3);
                ctx.beginPath();
                ctx.moveTo(leftMargin - 4, 40 + panelH - x_feed * scaleY_iso);
                ctx.lineTo(leftMargin, 40 + panelH - x_feed * scaleY_iso);
                ctx.stroke();

                ctx.textAlign = "center";
                ctx.fillText("0", leftMargin, 40 + panelH + 12);
                ctx.fillText(c0.toFixed(0), leftMargin + c0 * scaleX_iso, 40 + panelH + 12);
                ctx.beginPath();
                ctx.moveTo(leftMargin + c0 * scaleX_iso, 40 + panelH);
                ctx.lineTo(leftMargin + c0 * scaleX_iso, 40 + panelH + 4);
                ctx.stroke();
                
                ctx.save();
                ctx.translate(leftMargin - 35, 40 + panelH/2);
                ctx.rotate(-Math.PI/2);
                ctx.fillText("Solid Loading X [kg/kg]", 0, 0);
                ctx.restore();

                ctx.fillText("Liquid Concentration c [mol/m³]", leftMargin + panelW/2, 40 + panelH + 24);

                if (mode === 0) {
                    ctx.strokeStyle = "rgba(255,255,255,0.06)";
                    ctx.strokeRect(rx, 40, panelW, panelH);

                    ctx.strokeStyle = "#00d2ff";
                    ctx.lineWidth = 3;
                    ctx.beginPath();
                    const stepX = panelW / (Nz - 1);
                    const scaleC = panelH / 50.0;
                    for (let i = 0; i < Nz; i++) {
                        const px = rx + i * stepX;
                        const py = 40 + panelH - adsC[i] * scaleC;
                        if (i === 0) ctx.moveTo(px, py);
                        else ctx.lineTo(px, py);
                    }
                    ctx.stroke();

                    ctx.strokeStyle = "rgba(255, 159, 67, 0.6)";
                    ctx.lineWidth = 1.5;
                    ctx.setLineDash([3, 3]);
                    ctx.beginPath();
                    for (let i = 0; i < Nz; i++) {
                        const px = rx + i * stepX;
                        const py = 40 + panelH - adsX[i] * scaleY_iso;
                        if (i === 0) ctx.moveTo(px, py);
                        else ctx.lineTo(px, py);
                    }
                    ctx.stroke();
                    ctx.setLineDash([]);

                    ctx.strokeStyle = "rgba(255,255,255,0.3)";
                    ctx.lineWidth = 1.5;
                    ctx.beginPath();
                    ctx.moveTo(rx, 40); ctx.lineTo(rx, 40 + panelH); ctx.lineTo(rx + panelW, 40 + panelH);
                    ctx.stroke();

                    ctx.fillStyle = "rgba(255,255,255,0.6)";
                    ctx.font = "9px 'JetBrains Mono', monospace";
                    ctx.textAlign = "center";
                    ctx.fillText("Inlet (z=0)", rx + 30, 40 + panelH + 12);
                    ctx.fillText("Outlet (z=L)", rx + panelW - 35, 40 + panelH + 12);

                    ctx.textAlign = "right";
                    ctx.fillText(c0.toFixed(0), rx - 8, 40 + panelH - c0 * scaleC + 3);
                    ctx.beginPath();
                    ctx.moveTo(rx - 4, 40 + panelH - c0 * scaleC);
                    ctx.lineTo(rx, 40 + panelH - c0 * scaleC);
                    ctx.stroke();
                    
                    ctx.save();
                    ctx.translate(rx - 32, 40 + panelH/2);
                    ctx.rotate(-Math.PI/2);
                    ctx.textAlign = "center";
                    ctx.fillText("Concentration c [mol/m³]", 0, 0);
                    ctx.restore();
                    
                    ctx.textAlign = "center";
                    ctx.fillText("Spatial Coordinate (Column Height) z [cm]", rx + panelW/2, 40 + panelH + 24);

                    ctx.fillStyle = "#fff";
                    ctx.font = "bold 9px Outfit";
                    ctx.textAlign = "left";
                    ctx.fillText("Equilibrium Isotherm", leftMargin, 32);
                    ctx.fillText("Breakthrough Column Profile", rx, 32);

                    drawLegend([
                        { color: "#00d2ff", label: "Fluid Concentration c(z, t)" },
                        { color: "rgba(255, 159, 67, 0.8)", label: "Adsorbent Loading X(z, t)", dashed: true },
                        { color: "#ff4d4d", label: "Feed Operating Point" }
                    ], 50, 72);

                    const meanC = Array.from(adsC).reduce((a,b)=>a+b, 0) / Nz;
                    const saturation = (meanC / c0) * 100;
                    outputsList.innerHTML = `
                        <div class="stat-row"><span>Bed Saturation Level:</span><span class="mono text-blue">${saturation.toFixed(1)} %</span></div>
                        <div class="stat-row"><span>Isotherm Type:</span><span class="mono">${type === 0 ? 'Langmuir' : type === 1 ? 'Freundlich' : 'BET'}</span></div>
                        <div class="stat-row"><span>Front Characteristics:</span><span class="mono" style="color: #39d353;">Self-Sharpening (Favorable)</span></div>
                        <div class="stat-row"><span>Calculated Max Loading:</span><span class="mono">${getX(c0).toFixed(4)} kg/kg</span></div>
                    `;
                } else {
                    ctx.strokeStyle = "rgba(255,255,255,0.1)";
                    ctx.strokeRect(rx, 40, panelW, panelH);

                    ctx.strokeStyle = "rgba(255,255,255,0.3)";
                    ctx.lineWidth = 1.5;
                    ctx.beginPath();
                    ctx.moveTo(rx + panelW, 40); ctx.lineTo(rx + panelW, 40 + panelH);
                    ctx.moveTo(rx, 40 + panelH); ctx.lineTo(rx + panelW, 40 + panelH);
                    ctx.stroke();

                    ctx.fillStyle = "rgba(255,255,255,0.5)";
                    ctx.font = "8px 'JetBrains Mono', monospace";
                    ctx.textAlign = "left";
                    ctx.fillText("z = 5 nm", rx + panelW + 6, 45);
                    ctx.fillText("z = 0 (Wall)", rx + panelW + 6, 40 + panelH - 12);
                    ctx.beginPath();
                    ctx.moveTo(rx + panelW, 40); ctx.lineTo(rx + panelW + 4, 40);
                    ctx.moveTo(rx + panelW, 40 + panelH - 12); ctx.lineTo(rx + panelW + 4, 40 + panelH - 12);
                    ctx.stroke();

                    ctx.textAlign = "center";
                    ctx.fillText("x = 0", rx + 15, 40 + panelH + 12);
                    ctx.fillText("x = 10 nm", rx + panelW - 15, 40 + panelH + 12);
                    ctx.beginPath();
                    ctx.moveTo(rx + 15, 40 + panelH); ctx.lineTo(rx + 15, 40 + panelH + 4);
                    ctx.moveTo(rx + panelW - 15, 40 + panelH); ctx.lineTo(rx + panelW - 15, 40 + panelH + 4);
                    ctx.stroke();

                    ctx.fillStyle = "rgba(255,255,255,0.2)";
                    ctx.font = "8px Outfit";
                    ctx.fillText("Gas Phase (Reservoir)", rx + 10, 52);

                    gcmcGasParticles.forEach(p => {
                        ctx.fillStyle = "rgba(0, 210, 255, 0.5)";
                        ctx.beginPath();
                        ctx.arc(p.x, p.y, 3.5, 0, 2*Math.PI);
                        ctx.fill();
                    });

                    const y_bottom = 40 + panelH - 12;
                    ctx.fillStyle = "#1e222b";
                    ctx.fillRect(rx + 2, y_bottom + 6, panelW - 4, 6);
                    ctx.strokeStyle = "rgba(255,255,255,0.15)";
                    ctx.strokeRect(rx + 2, y_bottom + 6, panelW - 4, 6);

                    ctx.fillStyle = "rgba(255,255,255,0.3)";
                    ctx.font = "8px Outfit";
                    ctx.fillText("Solid Adsorbent (Active Sites)", rx + panelW/2 - 60, y_bottom + 22);

                    const W_avail = panelW - 30;
                    const dx_col = W_avail / 15.0;
                    const dy_layer = 14;
                    const radius_p = 5.5;

                    for (let col = 0; col < 15; col++) {
                        const cx = rx + 15 + (col + 0.5) * dx_col;

                        ctx.fillStyle = "rgba(255,255,255,0.1)";
                        ctx.beginPath();
                        ctx.arc(cx, y_bottom + 6, 2, 0, 2*Math.PI);
                        ctx.fill();

                        const height = gcmcHeights[col];
                        for (let h = 0; h < height; h++) {
                            const cy = y_bottom - h * dy_layer;
                            
                            if (h === 0) {
                                if (type === 1) {
                                    const K_col = 0.02 * affinity * Math.exp((14 - col) / 3.5);
                                    const intensity = Math.min(1.0, K_col / (0.02 * affinity * Math.exp(14/3.5)));
                                    ctx.fillStyle = `hsl(28, 100%, ${35 + 25 * intensity}%)`;
                                    ctx.shadowColor = `hsl(28, 100%, 50%)`;
                                    ctx.shadowBlur = 4 * intensity;
                                } else {
                                    ctx.fillStyle = "#ff9f43";
                                    ctx.shadowColor = "#ff9f43";
                                    ctx.shadowBlur = 3;
                                }
                            } else {
                                ctx.fillStyle = `rgba(0, 210, 255, ${0.85 - (h-1)*0.06})`;
                                ctx.shadowBlur = 0;
                            }

                            ctx.beginPath();
                            ctx.arc(cx, cy, radius_p, 0, 2*Math.PI);
                            ctx.fill();
                            ctx.shadowBlur = 0;
                            
                            ctx.fillStyle = "rgba(255,255,255,0.25)";
                            ctx.beginPath();
                            ctx.arc(cx - 1.5, cy - 1.5, 1.5, 0, 2*Math.PI);
                            ctx.fill();
                        }
                    }

                    if (gcmcEvent && gcmcEvent.timer > 0) {
                        const col = gcmcEvent.col;
                        const h = gcmcEvent.h;
                        const cx = rx + 15 + (col + 0.5) * dx_col;
                        const cy = y_bottom - h * dy_layer;
                        const progress = gcmcEvent.timer / 12.0;

                        if (gcmcEvent.type === "insert") {
                            if (gcmcEvent.accepted) {
                                ctx.strokeStyle = `rgba(57, 211, 83, ${progress})`;
                                ctx.lineWidth = 2;
                                ctx.beginPath();
                                ctx.arc(cx, cy, radius_p + (1.0 - progress) * 12, 0, 2*Math.PI);
                                ctx.stroke();

                                ctx.fillStyle = `rgba(57, 211, 83, ${progress})`;
                                ctx.font = "bold 12px 'JetBrains Mono', monospace";
                                ctx.fillText("+", cx - 4, cy - 8 - (1.0 - progress)*6);
                            } else {
                                ctx.strokeStyle = `rgba(255, 77, 77, ${progress})`;
                                ctx.lineWidth = 1.5;
                                ctx.beginPath();
                                const size = 5;
                                ctx.moveTo(cx - size, cy - size); ctx.lineTo(cx + size, cy + size);
                                ctx.moveTo(cx + size, cy - size); ctx.lineTo(cx - size, cy + size);
                                ctx.stroke();

                                ctx.fillStyle = `rgba(255, 77, 77, ${progress})`;
                                ctx.font = "8px Outfit";
                                ctx.fillText("X", cx - 3, cy - 9);
                            }
                        } else if (gcmcEvent.type === "delete") {
                            if (gcmcEvent.accepted) {
                                ctx.strokeStyle = `rgba(255, 77, 77, ${progress})`;
                                ctx.lineWidth = 2;
                                ctx.beginPath();
                                ctx.arc(cx, cy, radius_p + progress * 8, 0, 2*Math.PI);
                                ctx.stroke();

                                ctx.fillStyle = `rgba(255, 77, 77, ${progress})`;
                                ctx.font = "bold 14px 'JetBrains Mono', monospace";
                                ctx.fillText("-", cx - 4, cy - 8 - (1.0 - progress)*6);
                            }
                        }
                        gcmcEvent.timer--;
                    }

                    ctx.fillStyle = "#fff";
                    ctx.font = "bold 9px Outfit";
                    ctx.textAlign = "left";
                    ctx.fillText("Equilibrium Isotherm", leftMargin, 32);
                    ctx.fillText("Molecular GCMC Adsorption Pore (2D slit)", rx, 32);

                    // Draw Left panel legend (Plot)
                    drawLegend([
                        { color: "#00d2ff", label: "Simulated Isotherm Point" }
                    ], 50, 150);

                    // Draw Right panel legend (Microscopic GCMC)
                    if (type === 1) {
                        drawLegend([
                            { color: "#ff9f43", label: "Heterogeneous Sites" },
                            { color: "rgba(0, 210, 255, 0.7)", label: "Gas Molecules" }
                        ], rx, 105);
                    } else if (type === 2) {
                        drawLegend([
                            { color: "#ff9f43", label: "First Layer (Chemi)" },
                            { color: "rgba(0, 210, 255, 0.8)", label: "Upper Layers (Physi)" }
                        ], rx, 105);
                    } else {
                        drawLegend([
                            { color: "#ff9f43", label: "Monolayer Sites" },
                            { color: "rgba(0, 210, 255, 0.7)", label: "Gas Molecules" }
                        ], rx, 105);
                    }

                    let totalParticles = 0;
                    let firstLayerCount = 0;
                    for (let i = 0; i < 15; i++) {
                        totalParticles += gcmcHeights[i];
                        if (gcmcHeights[i] > 0) firstLayerCount++;
                    }
                    const coverage = (firstLayerCount / 15) * 100;
                    const acceptanceRate = gcmcTotalSteps > 0 ? (gcmcAcceptedSteps / gcmcTotalSteps * 100) : 0;
                    outputsList.innerHTML = `
                        <div class="stat-row"><span>Reservoir Pressure/Conc (c₀):</span><span class="mono text-blue">${c0.toFixed(0)} mol/m³</span></div>
                        <div class="stat-row"><span>Adsorbed Molecules (Total):</span><span class="mono text-orange">${totalParticles}</span></div>
                        <div class="stat-row"><span>Monolayer Surface Coverage:</span><span class="mono">${coverage.toFixed(1)} %</span></div>
                        <div class="stat-row"><span>MC Acceptance Rate:</span><span class="mono" style="color: #39d353;">${acceptanceRate.toFixed(1)} %</span></div>
                `;
            }
        }
    };

const activeEqKey = "adsorption";
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
