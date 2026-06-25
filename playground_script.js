// Multiphysics Equation Playground JS Engine
document.addEventListener("DOMContentLoaded", () => {
    // UI Elements
    const eqTitle = document.getElementById("eq-title");
    const eqFormula = document.getElementById("eq-formula");
    const lectureBadge = document.getElementById("lecture-badge");
    const slidersBox = document.getElementById("sliders-box");
    const playbackBox = document.getElementById("playback-box");
    const btnPlay = document.getElementById("btn-play");
    const btnReset = document.getElementById("btn-reset");
    const outputsBox = document.getElementById("outputs-box");
    const outputsList = document.getElementById("outputs-list");
    const canvas = document.getElementById("playground-canvas");
    const ctx = canvas.getContext("2d");
    const eqDesc = document.getElementById("eq-desc");
    const navButtons = document.querySelectorAll(".eq-nav-btn");

    // Global Sim State
    let activeEq = "navier";
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

    // Sidebar navigation click handler
    navButtons.forEach(btn => {
        btn.addEventListener("click", (e) => {
            navButtons.forEach(b => b.classList.remove("active"));
            e.target.classList.add("active");
            activeEq = e.target.getAttribute("data-eq");
            
            initEquation();
        });
    });

    // Playback control event listeners
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

    btnReset.addEventListener("click", () => {
        resetEquation();
    });

    // Window resize handler
    window.addEventListener("resize", () => {
        resizeCanvas();
        drawActive();
    });

    function resizeCanvas() {
        // Keep standard aspect ratio on high DPI displays
        const wrapper = canvas.parentElement;
        let w = wrapper.clientWidth;
        if (!w || w < 100) {
            w = 550;
        }
        canvas.width = w;
        canvas.height = Math.round(w * 0.76);
    }

    // Definitions of all 9 equations and their solvers
    const equationsConfig = {
        navier: {
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
        },
        stokes: {
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
        },
        ergun: {
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
        },
        twofilm: {
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
        },
        mccabe: {
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
        },
        adsorption: {
            title: "Adsorption Isotherms & Breakthrough Column",
            badge: "L16 Adsorption & Absorption",
            formula: "\\[ \\text{Langmuir: } X_A = \\frac{a \\cdot c}{b + c} \\quad \\text{und} \\quad \\text{Freundlich: } X_A = k \\cdot c^n \\]",
            desc: "The adsorption isotherm describes the thermodynamic equilibrium between the solid-phase adsorbate loading X and the fluid-phase concentration c. In fixed-bed adsorption columns, the mass transfer front (breakthrough front) propagates through the bed at a velocity inversely proportional to the slope of the isotherm. The simulation solves the time-dependent advection-reaction-diffusion PDE to demonstrate breakthrough front sharpening (favorable isotherm) and dispersion.",
            isAnimated: true,
            sliders: [
                { id: "type", label: "Isotherm Type", min: 0, max: 1, step: 1, val: 0, isSelect: true, options: [{val:0, text:"Langmuir"}, {val:1, text:"Freundlich"}] },
                { id: "affinity", label: "Adsorption Affinity", min: 0.2, max: 3.0, step: 0.1, val: 1.2 },
                { id: "c0", label: "Inlet Concentration (c_feed)", min: 10.0, max: 50.0, step: 5.0, val: 30.0 }
            ],
            init: () => {
                t = 0.0;
                // Clear concentration profile inside column
                for (let i = 0; i < Nz; i++) {
                    adsC[i] = 0.0;
                    adsX[i] = 0.0;
                }
            },
            reset: () => {
                equationsConfig.adsorption.init();
            },
            solve: () => {
                const type = parameters["type"];
                const affinity = parameters["affinity"];
                const c0 = parameters["c0"];
                const eps = 0.4; // Porosity
                const rhob = 800.0; // bed density
                const u = 1.2; // flow velocity (cm/s)
                const dz = 1.0; // cm

                // Equilibrium loading functions X(c)
                const getX = (c) => {
                    if (type === 0) {
                        // Langmuir: X = a*c / (b+c)
                        const a = 0.2 * affinity;
                        const b = 15.0;
                        return (a * c) / (b + c);
                    } else {
                        // Freundlich: X = k * c^n
                        const k = 0.005 * affinity;
                        const n = 0.6; // favorable shape
                        return k * Math.pow(c, n);
                    }
                };

                // Transient Finite Difference Solver Step
                // dc/dt + u/eps * dc/dz = D_a * d2c/dz2 - (rhob/eps) * dX/dt
                // Explicit upwind discretization for convection
                let nextC = new Float32Array(adsC);
                const dt_ads = 0.04;
                
                nextC[0] = c0; // Inlet boundary condition
                for (let i = 1; i < Nz - 1; i++) {
                    // Current loading
                    const x_old = getX(adsC[i]);
                    // Convective change
                    const conv = (u / eps) * (adsC[i] - adsC[i-1]) / dz;
                    // Diffusive dispersion
                    const disp = 0.15 * (adsC[i+1] - 2 * adsC[i] + adsC[i-1]) / (dz * dz);

                    // Estimate new concentration using implicit/explicit step-over
                    // dX/dt = dX/dc * dc/dt. Hence, dc/dt * (1 + (rhob/eps)*dX/dc) = disp - conv
                    // For stability, we approximate dX/dc locally:
                    const dX_dc = Math.max(1e-5, (getX(adsC[i] + 0.1) - getX(adsC[i])) / 0.1);
                    const factor = 1.0 + (rhob / eps) * dX_dc;
                    
                    nextC[i] = adsC[i] + dt_ads * (disp - conv) / factor;
                    nextC[i] = Math.max(0, Math.min(c0, nextC[i]));
                }
                nextC[Nz-1] = nextC[Nz-2]; // convective outlet

                adsC = nextC;
                for (let i = 0; i < Nz; i++) {
                    adsX[i] = getX(adsC[i]);
                }

                t += dt_ads;
            },
            draw: () => {
                ctx.fillStyle = "#040507";
                ctx.fillRect(0, 0, canvas.width, canvas.height);

                const type = parameters["type"];
                const c0 = parameters["c0"];

                // Visual Layout: Left panel is Isotherm curve, Right panel is 1D column
                const panelW = canvas.width / 2.3;
                const panelH = canvas.height - 110;

                // Left Panel: Isotherm Plot
                ctx.strokeStyle = "rgba(255,255,255,0.06)";
                ctx.strokeRect(40, 40, panelW, panelH);
                
                // Draw Isotherm Curve
                ctx.strokeStyle = "#ff9f43";
                ctx.lineWidth = 2.5;
                ctx.beginPath();
                
                const getX = (c) => {
                    const affinity = parameters["affinity"];
                    if (type === 0) {
                        return (0.2 * affinity * c) / (15.0 + c);
                    } else {
                        return 0.005 * affinity * Math.pow(c, 0.6);
                    }
                };

                const maxX = getX(50.0);
                const scaleX_iso = panelW / 50.0;
                const scaleY_iso = panelH / (maxX + 1e-6);

                for (let cVal = 0; cVal <= 50; cVal += 1.0) {
                    const x_val = getX(cVal);
                    const px = 40 + cVal * scaleX_iso;
                    const py = 40 + panelH - x_val * scaleY_iso;
                    if (cVal === 0) ctx.moveTo(px, py);
                    else ctx.lineTo(px, py);
                }
                ctx.stroke();

                // Draw Current feed point dot
                const x_feed = getX(c0);
                ctx.fillStyle = "#ff4d4d";
                ctx.beginPath();
                ctx.arc(40 + c0 * scaleX_iso, 40 + panelH - x_feed * scaleY_iso, 5, 0, 2*Math.PI);
                ctx.fill();

                // Left Axes
                ctx.strokeStyle = "rgba(255,255,255,0.2)";
                ctx.lineWidth = 1;
                ctx.beginPath();
                ctx.moveTo(40, 40); ctx.lineTo(40, 40 + panelH); ctx.lineTo(40 + panelW, 40 + panelH);
                ctx.stroke();
                
                ctx.fillStyle = "rgba(255,255,255,0.4)";
                ctx.font = "8px Outfit";
                ctx.fillText("0", 35, 40 + panelH + 8);
                ctx.fillText(c0.toFixed(0), 40 + c0 * scaleX_iso - 5, 40 + panelH + 8);
                ctx.fillText(x_feed.toFixed(3), 8, 40 + panelH - x_feed * scaleY_iso + 3);
                
                ctx.save();
                ctx.translate(15, 40 + panelH/2);
                ctx.rotate(-Math.PI/2);
                ctx.fillText("Solid Loading X [kg/kg]", 0, 0);
                ctx.restore();
                ctx.fillText("Liquid Concentration c [mol/m³]", 40 + panelW/2, 40 + panelH + 18);

                // Right Panel: 1D Adsorption column profile
                const rx = canvas.width - panelW - 40;
                ctx.strokeStyle = "rgba(255,255,255,0.06)";
                ctx.strokeRect(rx, 40, panelW, panelH);

                // Draw column concentration profiles adsC
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

                // Draw loading profile adsX (dashed orange)
                ctx.strokeStyle = "rgba(255, 159, 67, 0.6)";
                ctx.lineWidth = 1.5;
                ctx.setLineDash([3, 3]);
                ctx.beginPath();
                for (let i = 0; i < Nz; i++) {
                    const px = rx + i * stepX;
                    const py = 40 + panelH - adsX[i] * scaleY_iso * (panelH / (panelH)); // scale to panelH height
                    if (i === 0) ctx.moveTo(px, py);
                    else ctx.lineTo(px, py);
                }
                ctx.stroke();
                ctx.setLineDash([]);

                // Right Axes
                ctx.strokeStyle = "rgba(255,255,255,0.2)";
                ctx.beginPath();
                ctx.moveTo(rx, 40); ctx.lineTo(rx, 40 + panelH); ctx.lineTo(rx + panelW, 40 + panelH);
                ctx.stroke();

                ctx.fillStyle = "rgba(255,255,255,0.4)";
                ctx.fillText("Inlet", rx + 2, 40 + panelH + 8);
                ctx.fillText("Outlet", rx + panelW - 25, 40 + panelH + 8);
                ctx.fillText("C_feed", rx - 32, 40 + panelH - c0 * scaleC + 3);
                
                ctx.save();
                ctx.translate(rx - 38, 40 + panelH/2);
                ctx.rotate(-Math.PI/2);
                ctx.fillText("Liquid Concentration c [mol/m³]", 0, 0);
                ctx.restore();
                ctx.fillText("Spatial Coordinate (Column Height) z [cm]", rx + panelW/2, 40 + panelH + 18);

                // Titles above panels
                ctx.fillStyle = "#fff";
                ctx.font = "bold 9px Outfit";
                ctx.textAlign = "left";
                ctx.fillText("Equilibrium Isotherm", 40, 32);
                ctx.fillText("Breakthrough Column Profile", rx, 32);

                // Legend
                drawLegend([
                    { color: "#00d2ff", label: "Fluid Concentration c(z, t)" },
                    { color: "rgba(255, 159, 67, 0.8)", label: "Adsorbent Loading X(z, t)", dashed: true },
                    { color: "#ff4d4d", label: "Feed Operating Point" }
                ]);

                // Output calculations
                const meanC = Array.from(adsC).reduce((a,b)=>a+b, 0) / Nz;
                const saturation = (meanC / c0) * 100;
                outputsList.innerHTML = `
                    <div class="stat-row"><span>Bed Saturation Level:</span><span class="mono text-blue">${saturation.toFixed(1)} %</span></div>
                    <div class="stat-row"><span>Isotherm Type:</span><span class="mono">${type === 0 ? 'Langmuir' : 'Freundlich'}</span></div>
                    <div class="stat-row"><span>Front Characteristics:</span><span class="mono" style="color: #39d353;">Self-Sharpening (Favorable)</span></div>
                    <div class="stat-row"><span>Calculated Max Loading:</span><span class="mono">${getX(c0).toFixed(4)} kg/kg</span></div>
                `;
            }
        },
        butler: {
            title: "Butler-Volmer Equation (Electrode Kinetics)",
            badge: "L3 Basics of Electrochemistry",
            formula: "\\[ j = j_0 \\left[ \\exp\\left( \\frac{\\alpha_a F \\eta}{R T} \\right) - \\exp\\left( -\\frac{\\alpha_c F \\eta}{R T} \\right) \\] \\]",
            desc: "The Butler-Volmer equation describes the relationship between the electrical current density j at an electrode and the overpotential η. It represents the foundation of kinetics in batteries, fuel cells, and electrolyzers. The visualizer plots the cathodic reduction branch, the anodic oxidation branch, and the net current density. Adjusting the transfer coefficients α_a and α_c demonstrates symmetry breaking.",
            isAnimated: false,
            sliders: [
                { id: "j0", label: "Exchange Current Density (j₀ in A/m²)", min: 0.1, max: 2.0, step: 0.1, val: 1.0 },
                { id: "alpha_a", label: "Anodic Transfer Coefficient (α_a)", min: 0.2, max: 0.8, step: 0.05, val: 0.5 },
                { id: "alpha_c", label: "Cathodic Transfer Coefficient (α_c)", min: 0.2, max: 0.8, step: 0.05, val: 0.5 },
                { id: "temp", label: "Electrolyte Temperature (T in °C)", min: 10, max: 90, step: 5, val: 25 }
            ],
            init: () => {},
            reset: () => {},
            solve: () => {
                const j0 = parameters["j0"];
                const alpha_a = parameters["alpha_a"];
                const alpha_c = parameters["alpha_c"];
                const T_k = parameters["temp"] + 273.15;
                const F = 96485.0; // Faraday constant
                const R = 8.314; // gas constant

                // Calculate Tafel slopes / current for graph overpotential range -0.4V to 0.4V
                // Store results for legend/calculations output
                parameters["_F_RT"] = F / (R * T_k);
            },
            draw: () => {
                ctx.fillStyle = "#040507";
                ctx.fillRect(0, 0, canvas.width, canvas.height);

                const j0 = parameters["j0"];
                const alpha_a = parameters["alpha_a"];
                const alpha_c = parameters["alpha_c"];
                const F_RT = parameters["_F_RT"] || 38.92;

                const padL = 60;
                const padB = 60;
                const gw = canvas.width - padL - 40;
                const gh = canvas.height - padB - 40;

                const getXCoord = (eta) => padL + ((eta + 0.5) / 1.0) * gw; // eta in [-0.5, 0.5]
                const getYCoord = (j) => {
                    // scale j from -100 to 100 A/m2
                    const normalized = (j + 80.0) / 160.0;
                    return canvas.height - padB - normalized * gh;
                };

                // Draw Grid
                ctx.strokeStyle = "rgba(255,255,255,0.04)";
                ctx.lineWidth = 1;
                for (let g = 0; g <= 10; g++) {
                    const etaVal = -0.5 + g * 0.1;
                    const jVal = -80 + g * 16;
                    ctx.beginPath(); ctx.moveTo(getXCoord(etaVal), getYCoord(-80)); ctx.lineTo(getXCoord(etaVal), getYCoord(80)); ctx.stroke();
                    ctx.beginPath(); ctx.moveTo(getXCoord(-0.5), getYCoord(jVal)); ctx.lineTo(getXCoord(0.5), getYCoord(jVal)); ctx.stroke();
                }

                // Draw X-axis (zero line of current)
                ctx.strokeStyle = "rgba(255,255,255,0.2)";
                ctx.lineWidth = 1.5;
                ctx.beginPath();
                ctx.moveTo(getXCoord(-0.5), getYCoord(0));
                ctx.lineTo(getXCoord(0.5), getYCoord(0));
                ctx.stroke();

                // Draw Y-axis (zero line of overpotential)
                ctx.beginPath();
                ctx.moveTo(getXCoord(0), getYCoord(-80));
                ctx.lineTo(getXCoord(0), getYCoord(80));
                ctx.stroke();

                // Compute and draw curves
                // Anodic current: j0 * exp(alpha_a * F_RT * eta)
                // Cathodic current: -j0 * exp(-alpha_c * F_RT * eta)
                ctx.lineWidth = 2.0;

                // Anodic (dotted green)
                ctx.strokeStyle = "rgba(57, 211, 83, 0.55)";
                ctx.setLineDash([2, 2]);
                ctx.beginPath();
                for (let i = 0; i <= 50; i++) {
                    const eta = -0.5 + i * 0.02;
                    const j_a = j0 * Math.exp(alpha_a * F_RT * eta);
                    if (i === 0) ctx.moveTo(getXCoord(eta), getYCoord(j_a));
                    else ctx.lineTo(getXCoord(eta), getYCoord(j_a));
                }
                ctx.stroke();

                // Cathodic (dotted red)
                ctx.strokeStyle = "rgba(255, 77, 77, 0.55)";
                ctx.beginPath();
                for (let i = 0; i <= 50; i++) {
                    const eta = -0.5 + i * 0.02;
                    const j_c = -j0 * Math.exp(-alpha_c * F_RT * eta);
                    if (i === 0) ctx.moveTo(getXCoord(eta), getYCoord(j_c));
                    else ctx.lineTo(getXCoord(eta), getYCoord(j_c));
                }
                ctx.stroke();
                ctx.setLineDash([]);

                // Net current (solid blue)
                ctx.strokeStyle = "#00d2ff";
                ctx.lineWidth = 3.0;
                ctx.beginPath();
                for (let i = 0; i <= 50; i++) {
                    const eta = -0.5 + i * 0.02;
                    const j_a = j0 * Math.exp(alpha_a * F_RT * eta);
                    const j_c = -j0 * Math.exp(-alpha_c * F_RT * eta);
                    const j_net = j_a + j_c;
                    if (i === 0) ctx.moveTo(getXCoord(eta), getYCoord(j_net));
                    else ctx.lineTo(getXCoord(eta), getYCoord(j_net));
                }
                ctx.stroke();

                // Labeled Axes
                drawPhysicalAxes("Electrode Overpotential η [V]", "Current Density j [A/m²]", -0.5, 0.5, -80, 80);

                // Legend
                drawLegend([
                    { color: "#00d2ff", label: "Net Current Density j_net" },
                    { color: "#39d353", label: "Anodic Oxidation Branch", dashed: true },
                    { color: "#ff4d4d", label: "Cathodic Reduction Branch", dashed: true }
                ]);

                // Output calculations
                outputsList.innerHTML = `
                    <div class="stat-row"><span>Faraday Factor F/RT:</span><span class="mono">${F_RT.toFixed(2)} V⁻¹</span></div>
                    <div class="stat-row"><span>Exchange Current Density j₀:</span><span class="mono">${j0.toFixed(2)} A/m²</span></div>
                    <div class="stat-row"><span>Symmetry Ratio α_a/α_c:</span><span class="mono">${(alpha_a / alpha_c).toFixed(2)}</span></div>
                `;
            }
        },
        hatta: {
            title: "Hatta Number (Fluid-Fluid Macrokinetics)",
            badge: "L7 Macrokinetics II",
            formula: "\\[ Ha = \\delta \\cdot \\sqrt{\\frac{k_v \\cdot c_B^{n-1}}{D_{A}}} \\]",
            desc: "The Hatta number compares the rate of reaction inside a liquid boundary film to the rate of diffusion through it. It determines the location and regime of gas absorption processes. If Ha is small (Ha < 0.3), reaction is slow and mass transfer is slow (reaction occurs in bulk liquid). If Ha is large (Ha > 3), reaction is fast and consumes all reactant inside the thin film boundary layer (mass-transfer controlled regime).",
            isAnimated: false,
            sliders: [
                { id: "k", label: "Reaction Rate Constant (k_v)", min: 0.1, max: 25.0, step: 0.5, val: 5.0 },
                { id: "diff", label: "Diffusion Coefficient (D_A in 10⁻⁹ m²/s)", min: 0.5, max: 5.0, step: 0.1, val: 1.5 },
                { id: "delta", label: "Film Thickness (δ in μm)", min: 10, max: 80, step: 5, val: 40 }
            ],
            init: () => {},
            reset: () => {},
            solve: () => {
                const k = parameters["k"];
                const D_A = parameters["diff"] * 1e-9;
                const delta = parameters["delta"] * 1e-6; // um to m

                // Hatta number: delta * sqrt(k / DA)
                const Ha = delta * Math.sqrt(k / D_A);
                
                // Analytical solution for concentration profile c(y) inside film y in [0, delta]
                // c(y) = c0 * sinh(Ha * (1 - y/delta)) / sinh(Ha) (assuming bulk concentration = 0)
                parameters["_Ha"] = Ha;
                parameters["_delta_m"] = delta;
            },
            draw: () => {
                ctx.fillStyle = "#040507";
                ctx.fillRect(0, 0, canvas.width, canvas.height);

                const k = parameters["k"];
                const Ha = parameters["_Ha"] || 0;
                const delta_m = parameters["_delta_m"] || 4e-5;

                const c0 = 100.0; // inlet concentration (%)
                const padL = 60;
                const padB = 60;
                const gw = canvas.width - padL - 50;
                const gh = canvas.height - padB - 40;

                const getXCoord = (y_pct) => padL + y_pct * gw; // y_pct in [0, 1.2] where 1.0 is boundary
                const getYCoord = (c_pct) => canvas.height - padB - (c_pct / 100) * gh;

                // Draw Grid
                ctx.strokeStyle = "rgba(255,255,255,0.04)";
                ctx.lineWidth = 1;
                for (let g = 0; g <= 10; g++) {
                    const yVal = g / 10;
                    ctx.beginPath(); ctx.moveTo(getXCoord(yVal), getYCoord(0)); ctx.lineTo(getXCoord(yVal), getYCoord(100)); ctx.stroke();
                    ctx.beginPath(); ctx.moveTo(getXCoord(0), getYCoord(g * 10)); ctx.lineTo(getXCoord(1.2), getYCoord(g * 10)); ctx.stroke();
                }

                // Draw Boundary lines (Film border y = delta)
                ctx.strokeStyle = "rgba(255, 255, 255, 0.25)";
                ctx.lineWidth = 2;
                ctx.beginPath();
                ctx.moveTo(getXCoord(1.0), getYCoord(0));
                ctx.lineTo(getXCoord(1.0), getYCoord(100));
                ctx.stroke();

                // Draw Shaded background for film (yellow-orange) vs bulk (blue)
                ctx.fillStyle = "rgba(255, 159, 67, 0.05)";
                ctx.fillRect(padL, 40, gw, gh);
                ctx.fillStyle = "rgba(0, 210, 255, 0.05)";
                ctx.fillRect(getXCoord(1.0), 40, gw * 0.2, gh);

                // Draw Concentration Profile
                ctx.strokeStyle = "#ff9f43";
                ctx.lineWidth = 3.0;
                ctx.beginPath();

                // Hyperbolic sinh solver helper
                const sinh = (x) => 0.5 * (Math.exp(x) - Math.exp(-x));

                // Draw inside film
                for (let i = 0; i <= 50; i++) {
                    const y_pct = i / 50;
                    let c;
                    if (Ha < 0.01) {
                        c = c0 * (1.0 - y_pct); // linear pure diffusion limit
                    } else {
                        c = c0 * sinh(Ha * (1.0 - y_pct)) / sinh(Ha);
                    }
                    ctx.lineTo(getXCoord(y_pct), getYCoord(c));
                }
                // Draw inside bulk (stays at zero for simple absorber)
                ctx.lineTo(getXCoord(1.0), getYCoord(0));
                ctx.lineTo(getXCoord(1.2), getYCoord(0));
                ctx.stroke();

                // Labeled Axes
                drawPhysicalAxes("Normalized Film Coordinate y/δ [-]", "Relative Concentration c/c₀ [%]", 0, 1.2, 0, 100);

                // Labels on canvas
                ctx.fillStyle = "rgba(255, 255, 255, 0.5)";
                ctx.font = "9px Outfit";
                ctx.textAlign = "center";
                ctx.fillText("Boundary Film (y ≤ δ)", getXCoord(0.5), 55);
                ctx.fillText("Bulk Liquid", getXCoord(1.1), 55);

                // Legend
                drawLegend([
                    { color: "#ff9f43", label: "Reactant Concentration Profile" },
                    { color: "rgba(255, 255, 255, 0.3)", label: "Film-Bulk Boundary (y = δ)" }
                ]);

                // Output calculations
                outputsList.innerHTML = `
                    <div class="stat-row"><span>Hatta Number (Ha):</span><span class="mono text-orange" style="font-weight:bold; font-size:1.05rem;">${Ha.toFixed(3)}</span></div>
                    <div class="stat-row"><span>Reaction Regime:</span><span class="mono" style="color: ${Ha > 3.0 ? '#ff4d4d' : (Ha < 0.3 ? '#39d353' : '#ff9f43')};">
                        ${Ha > 3.0 ? 'Fast (Film Reaction)' : (Ha < 0.3 ? 'Slow (Bulk Reaction)' : 'Transition Regime')}
                    </span></div>
                    <div class="stat-row"><span>Film Effectiveness Factor (E):</span><span class="mono">${(Ha > 0 ? (1.0 / Math.tanh(Ha) - 1.0/Ha).toFixed(3) : 1.0)}</span></div>
                `;
            }
        },
        thiele: {
            title: "Thiele Modulus & Pore Effectiveness (Intraparticle Catalysis)",
            badge: "L6 Heterogeneous Catalysis / L7 Reactors",
            formula: "\\[ \\Phi = R_0 \\cdot \\sqrt{\\frac{k_v}{D_{eff}}} \\quad \\text{und} \\quad \\eta_P = \\frac{3}{\\Phi} \\left( \\frac{1}{\\tanh(\\Phi)} - \\frac{1}{\\Phi} \\right) \\]",
            desc: "The Thiele modulus Φ evaluates the ratio of intrinsic reaction rate to intraparticle diffusion rate inside a porous catalyst pellet. At high Thiele modulus (Φ > 3), the reactant is consumed rapidly in the outer shell of the pellet, before it can diffuse into the core. The inner core of the catalyst remains unused (diffusion bottleneck), causing the pore effectiveness factor η_P to drop significantly. The 1D simulation computes the radial concentration profile c(r) inside a spherical catalyst pellet.",
            isAnimated: false,
            sliders: [
                { id: "k", label: "Reaction Rate Constant (k_v)", min: 0.1, max: 20.0, step: 0.5, val: 4.0 },
                { id: "deff", label: "Effective Diffusivity (D_eff in 10⁻⁹ m²/s)", min: 0.2, max: 4.0, step: 0.1, val: 1.0 },
                { id: "R0", label: "Pellet Radius (R₀ in mm)", min: 1.0, max: 5.0, step: 0.2, val: 2.5 }
            ],
            init: () => {},
            reset: () => {},
            solve: () => {
                const k = parameters["k"];
                const D_eff = parameters["deff"] * 1e-9;
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
            },
            draw: () => {
                ctx.fillStyle = "#040507";
                ctx.fillRect(0, 0, canvas.width, canvas.height);

                const Phi = parameters["_Phi"] || 0;
                const eta_p = parameters["_eta_p"] || 1.0;

                // Visual Layout: Left panel is spherical radial profile c(r), Right is eta_p vs Phi plot
                const panelW = canvas.width / 2.3;
                const panelH = canvas.height - 110;

                const getXCoordL = (r_pct) => 40 + r_pct * panelW; // r_pct in [0, 1.0] where 1.0 is surface
                const getYCoordL = (c_pct) => 40 + panelH - (c_pct / 100) * panelH;

                // Left Panel: Spherical Radial Profile plot
                ctx.strokeStyle = "rgba(255,255,255,0.06)";
                ctx.strokeRect(40, 40, panelW, panelH);

                // Draw profile: c(r)/c0 = (R0/r) * sinh(Phi * r / R0) / sinh(Phi)
                ctx.strokeStyle = "#ff9f43";
                ctx.lineWidth = 3.0;
                ctx.beginPath();
                const sinh = (x) => 0.5 * (Math.exp(x) - Math.exp(-x));

                for (let i = 0; i <= 50; i++) {
                    const r_pct = i / 50;
                    let c_pct;

                    if (Phi > 50.0) {
                        if (r_pct < 0.002) {
                            c_pct = 0.0;
                        } else {
                            c_pct = 100.0 * (1.0 / r_pct) * Math.exp(Phi * (r_pct - 1.0));
                        }
                    } else {
                        if (r_pct < 0.002) {
                            // Limit r->0: c(0)/c0 = Phi / sinh(Phi)
                            c_pct = Phi < 0.01 ? 100.0 : 100.0 * Phi / sinh(Phi);
                        } else {
                            c_pct = Phi < 0.01 ? 100.0 : 100.0 * (1.0 / r_pct) * sinh(Phi * r_pct) / sinh(Phi);
                        }
                    }
                    c_pct = Math.max(0.0, Math.min(100.0, c_pct)); // Clamp to prevent NaN coordinates
                    ctx.lineTo(getXCoordL(r_pct), getYCoordL(c_pct));
                }
                ctx.stroke();

                // Left Axes
                ctx.strokeStyle = "rgba(255,255,255,0.2)";
                ctx.lineWidth = 1;
                ctx.beginPath();
                ctx.moveTo(40, 40); ctx.lineTo(40, 40 + panelH); ctx.lineTo(40 + panelW, 40 + panelH);
                ctx.stroke();

                ctx.fillStyle = "rgba(255,255,255,0.4)";
                ctx.font = "8px Outfit";
                ctx.fillText("Core (r=0)", 35, 40 + panelH + 8);
                ctx.fillText("Surface (r=R₀)", 40 + panelW - 45, 40 + panelH + 8);
                
                ctx.save();
                ctx.translate(15, 40 + panelH/2);
                ctx.rotate(-Math.PI/2);
                ctx.fillText("Relative Concentration c(r)/c₀ [-]", 0, 0);
                ctx.restore();
                ctx.fillText("Dimensionless Radius r/R₀ [-]", 40 + panelW/2, 40 + panelH + 18);

                // Right Panel: Pore Efficiency vs Thiele Modulus Plot
                const rx = canvas.width - panelW - 40;
                ctx.strokeStyle = "rgba(255,255,255,0.06)";
                ctx.strokeRect(rx, 40, panelW, panelH);

                const getXCoordR = (pVal) => rx + (pVal / 10.0) * panelW; // Phi in [0, 10.0]
                const getYCoordR = (eVal) => 40 + panelH - eVal * panelH; // eta_p in [0, 1.0]

                // Draw eta_p vs Phi curve (blue line)
                ctx.strokeStyle = "#00d2ff";
                ctx.lineWidth = 2.0;
                ctx.beginPath();
                for (let pVal = 0.05; pVal <= 10.0; pVal += 0.2) {
                    const ep = (3.0 / pVal) * (1.0 / Math.tanh(pVal) - 1.0 / pVal);
                    if (pVal === 0.05) ctx.moveTo(getXCoordR(pVal), getYCoordR(ep));
                    else ctx.lineTo(getXCoordR(pVal), getYCoordR(ep));
                }
                ctx.stroke();

                // Draw active operating point dot on curve (red)
                const dotPhi = Math.min(10.0, Phi);
                const dotEta = (3.0 / dotPhi) * (1.0 / Math.tanh(dotPhi) - 1.0 / dotPhi);
                ctx.fillStyle = "#ff4d4d";
                ctx.beginPath();
                ctx.arc(getXCoordR(dotPhi), getYCoordR(dotEta), 5, 0, 2*Math.PI);
                ctx.fill();

                // Right Axes
                ctx.strokeStyle = "rgba(255,255,255,0.2)";
                ctx.beginPath();
                ctx.moveTo(rx, 40); ctx.lineTo(rx, 40 + panelH); ctx.lineTo(rx + panelW, 40 + panelH);
                ctx.stroke();

                ctx.fillStyle = "rgba(255,255,255,0.4)";
                ctx.fillText("0", rx - 5, 40 + panelH + 8);
                ctx.fillText("10", rx + panelW - 8, 40 + panelH + 8);
                ctx.fillText("1.0", rx - 18, 45);
                ctx.fillText("Thiele Modulus Φ [-]", rx + panelW/2, 40 + panelH + 18);
                
                ctx.save();
                ctx.translate(rx - 25, 40 + panelH/2);
                ctx.rotate(-Math.PI/2);
                ctx.fillText("Pore Effectiveness η_P [-]", 0, 0);
                ctx.restore();

                // Titles above panels
                ctx.fillStyle = "#fff";
                ctx.font = "bold 9px Outfit";
                ctx.textAlign = "left";
                ctx.fillText("Intraparticle Concentration Profile", 40, 32);
                ctx.fillText("Effectiveness Factor η_P vs. Φ", rx, 32);

                // Legend
                drawLegend([
                    { color: "#ff9f43", label: "Pellet Profile c(r)" },
                    { color: "#00d2ff", label: "Pore Effectiveness η_P" },
                    { color: "#ff4d4d", label: "Active Operating Point" }
                ]);

                // Output calculations
                outputsList.innerHTML = `
                    <div class="stat-row"><span>Thiele Modulus (Φ):</span><span class="mono text-orange" style="font-weight:bold; font-size:1.05rem;">${Phi.toFixed(3)}</span></div>
                    <div class="stat-row"><span>Pore Effectiveness (η_P):</span><span class="mono text-blue" style="font-weight:bold; font-size:1.05rem;">${(eta_p * 100).toFixed(1)} %</span></div>
                    <div class="stat-row"><span>Rate Limitation:</span><span class="mono" style="color: ${Phi > 3.0 ? '#ff4d4d' : '#39d353'};">
                        ${Phi > 3.0 ? 'Intraparticle Diffusion Control' : 'Kinetic Control (Ideal)'}
                    </span></div>
                `;
            }
        }
    };

    // Helper to draw physical cartesian axes with labels and units
    function drawPhysicalAxes(xLabel, yLabel, xMin, xMax, yMin, yMax) {
        ctx.fillStyle = "rgba(255, 255, 255, 0.4)";
        ctx.font = "9px Outfit";
        ctx.textAlign = "center";

        // Draw horizontal axis label
        ctx.fillText(xLabel, canvas.width / 2, canvas.height - 20);

        // Draw vertical axis label
        ctx.save();
        ctx.translate(15, canvas.height / 2);
        ctx.rotate(-Math.PI / 2);
        ctx.fillText(yLabel, 0, 0);
        ctx.restore();
    }

    // Helper to draw clean plot legend
    function drawLegend(items) {
        const lx = 60;
        const ly = canvas.height - 45;
        ctx.textAlign = "left";
        ctx.font = "9px Outfit";

        items.forEach((item, idx) => {
            const ix = lx + idx * 115;
            
            // Draw color line indicator
            ctx.strokeStyle = item.color;
            ctx.lineWidth = 2.5;
            if (item.dashed) ctx.setLineDash([2, 2]);
            
            ctx.beginPath();
            ctx.moveTo(ix, ly - 3);
            ctx.lineTo(ix + 15, ly - 3);
            ctx.stroke();
            ctx.setLineDash([]);

            // Draw label
            ctx.fillStyle = "rgba(255,255,255,0.7)";
            ctx.fillText(item.label, ix + 20, ly);
        });
    }

    // Helper to draw vectors (forces/velocities)
    function drawVector(x1, y1, x2, y2, color, label, lineWidth = 2.0) {
        ctx.strokeStyle = color;
        ctx.fillStyle = color;
        ctx.lineWidth = lineWidth;

        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.stroke();

        // Arrow head
        const angle = Math.atan2(y2 - y1, x2 - x1);
        const arrowLength = Math.max(5, lineWidth * 2.5);
        ctx.beginPath();
        ctx.moveTo(x2, y2);
        ctx.lineTo(x2 - arrowLength * Math.cos(angle - Math.PI / 6), y2 - arrowLength * Math.sin(angle - Math.PI / 6));
        ctx.lineTo(x2 - arrowLength * Math.cos(angle + Math.PI / 6), y2 - arrowLength * Math.sin(angle + Math.PI / 6));
        ctx.fill();

        // Label
        if (label) {
            ctx.fillStyle = "#fff";
            ctx.font = "bold 9px 'JetBrains Mono', monospace";
            ctx.fillText(label, x2 + 6 * Math.cos(angle), y2 + 6 * Math.sin(angle) + 3);
        }
    }

    // Setup active equation sliders, MathJax, and text elements
    function initEquation() {
        const eq = equationsConfig[activeEq];

        // Set titles and badges
        eqTitle.textContent = eq.title;
        lectureBadge.textContent = eq.badge;
        eqFormula.innerHTML = eq.formula;
        eqDesc.innerHTML = eq.desc;

        // Render equations via MathJax
        if (window.MathJax && typeof window.MathJax.typesetPromise === "function") {
            window.MathJax.typesetPromise([eqFormula]).catch(err => console.log(err));
        }

        // Show/hide animation playback bar
        if (eq.isAnimated) {
            playbackBox.style.display = "flex";
            btnPlay.textContent = isRunning ? "⏸ Pause" : "▶ Start";
            if (isRunning) btnPlay.classList.add("btn-danger");
            else btnPlay.classList.remove("btn-danger");
        } else {
            playbackBox.style.display = "none";
            // For static equations, pause loop
            if (isRunning) {
                isRunning = false;
                if (animId) cancelAnimationFrame(animId);
            }
        }

        // Populate controls sliders dynamically
        slidersBox.innerHTML = "";
        parameters = {};

        eq.sliders.forEach(s => {
            parameters[s.id] = s.val;
            
            const group = document.createElement("div");
            group.className = "control-group";

            if (s.isSelect) {
                // Render Select Dropdown
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
                    if (!eq.isAnimated || !isRunning) {
                        eq.solve();
                        eq.draw();
                    }
                });
            } else {
                // Render Range Slider
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

                    // Redraw static equations or paused animations instantly as sliders drag
                    if (!eq.isAnimated || !isRunning) {
                        eq.solve();
                        eq.draw();
                    }
                });
            }
        });

        // Initialize equation state variables
        eq.init();
        resizeCanvas();
        if (activeEq === "navier") {
            // Pre-run solver to populate history trails so streamlines show up immediately on load
            for (let step = 0; step < 12; step++) {
                eq.solve();
            }
        } else {
            eq.solve();
        }
        eq.draw();
    }

    function resetEquation() {
        const eq = equationsConfig[activeEq];
        eq.init();
        if (activeEq === "navier") {
            // Pre-run solver on reset as well
            for (let step = 0; step < 12; step++) {
                eq.solve();
            }
        } else {
            eq.solve();
        }
        eq.draw();
    }

    // Animation Loop
    function animate() {
        if (!isRunning) return;

        const eq = equationsConfig[activeEq];
        if (eq.isAnimated) {
            try {
                eq.solve();
                eq.draw();
                animId = requestAnimationFrame(animate);
            } catch (err) {
                console.error("Animation Loop Crash:", err);
                if (outputsList) {
                    outputsList.innerHTML = `<div class="error-msg" style="color: #ff4d4d; font-weight: bold; padding: 10px; background: rgba(255, 77, 77, 0.1); border-radius: 4px; border: 1px solid rgba(255, 77, 77, 0.3); font-family: monospace; font-size: 10px;">Animation Error: ${err.message}<br>${err.stack}</div>`;
                }
                isRunning = false;
            }
        }
    }

    function drawActive() {
        const eq = equationsConfig[activeEq];
        try {
            eq.solve();
            eq.draw();
        } catch (err) {
            console.error("Draw Active Crash:", err);
            if (outputsList) {
                outputsList.innerHTML = `<div class="error-msg" style="color: #ff4d4d; font-weight: bold; padding: 10px; background: rgba(255, 77, 77, 0.1); border-radius: 4px; border: 1px solid rgba(255, 77, 77, 0.3); font-family: monospace; font-size: 10px;">Draw Error: ${err.message}</div>`;
            }
        }
    }

    // Initialize on load
    initEquation();
});
