// Controller script for eq_crystallization.html
// Part of the Equation Playground Split Suite
// Redesigned with dynamic suspended crystals, fluid swirl flow, stirrer-speed coupled gravity settling, and mass-conserving kinetics.
// Adjusted to support non-stirred scenarios (e.g., Evaporative Basin / Salar de Atacama).

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
let dt = 0.05; // s per step
let parameters = {}; // Stores current values of sliders

// Simulation State variables
let soluteC = 60.0; // dissolved solute concentration, mol/L
let currentTemp = 80.0; // °C
let cStar = 60.0; // solubility limit, mol/L
let apparentC = 60.0; // apparent solute concentration, mol/L

// History for plotting
let historyTime = [];
let historyc = [];
let historycStar = [];
let historyTemp = [];

// Monte Carlo Particles
let soluteParticles = [];
let crystals = [];
let ripples = []; // expanding cyan ripples for molecular deposition events
let vacuumBubbles = []; // rising vapor bubbles for vacuum boiling flash visualization
const maxSoluteParticles = 180;

// Configuration Object for this specific equation
const eqConfig = {
    title: "Crystallization Kinetics (Nucleation & Growth)",
    badge: "L14/L15 Crystallization & Precipitation",
    formula: "\\[ S = \\frac{c}{c^*}, \\quad B = k_n (c - c^*)^b + B_{\\text{secondary}} \\quad \\text{und} \\quad G = \\frac{dL}{dt} = k_g (c - c^*)^g \\]",
    desc: "This simulator visualizes crystallization kinetics in a cooling batch crystallizer. Cooling lowers the temperature, which decreases the solubility c*(T) and increases the supersaturation S = c/c*. If S crosses the metastable limit (S > 1.15), crystal nuclei (cyan hexagons) stochastically spawn in the crystallizer. Solute particles (orange dots) then collide with and deposit onto these crystals, causing them to grow visually and depleting the dissolved solute concentration. Students can analyze the final crystal size distribution (CSD) histogram to see how fast cooling leads to many small crystals (nucleation-dominated) while slow cooling yields fewer, larger crystals (growth-dominated).",
    isAnimated: true,
    sliders: [
        {
            id: "method",
            label: "Crystallization Mode",
            isSelect: true,
            options: [
                { val: 0, text: "Cooling Crystallization (Kaltrührer)" },
                { val: 1, text: "Vacuum Crystallization (Vakuum-Rührkristallisator)" },
                { val: 2, text: "Solar Evaporative Crystallization (Salar de Atacama)" }
            ],
            val: 0
        },
        { id: "T0", label: "Initial Temperature (T₀ in °C)", min: 40, max: 95, step: 5, val: 80 },
        { id: "coolRate", label: "Cooling Rate (dT/dt in K/s)", min: 0.1, max: 5.0, step: 0.1, val: 0.8 },
        { id: "kn", label: "Nucleation Constant (k_n)", min: 0.1, max: 5.0, step: 0.1, val: 1.0 },
        { id: "kg", label: "Growth Constant (k_g)", min: 0.1, max: 5.0, step: 0.1, val: 1.5 },
        { id: "rpm", label: "Stirrer Speed (RPM)", min: 0, max: 300, step: 20, val: 160 },
        { id: "simSpeed", label: "Simulation Speed", min: 0.2, max: 4.0, step: 0.2, val: 1.0 }
    ],
    init: () => {
        t = 0.0;
        currentTemp = parameters["T0"] || 80.0;
        soluteC = 60.0;
        apparentC = 60.0;
        cStar = 10.0 + 0.008 * currentTemp * currentTemp;
        
        historyTime = [];
        historyc = [];
        historycStar = [];
        historyTemp = [];
        
        crystals = [];
        soluteParticles = [];
        ripples = [];
        vacuumBubbles = [];
        
        // Initialize solute particles (orange dots representing dissolved molecules)
        const w = canvas.width || 550;
        const h_canvas = canvas.height || 420;
        const leftMargin = 55;
        const gap = 35;
        const panelW = (w - leftMargin - 40 - gap) / 2;
        const cx = leftMargin + panelW / 2;
        const cy = 40 + (h_canvas - 110) / 2;
        
        const r_width = 170;
        const r_height = 180;
        const rx_min = cx - r_width / 2 + 10;
        const rx_max = cx + r_width / 2 - 10;
        const ry_min = cy - r_height / 2 + 10;
        const ry_max = cy + r_height / 2 - 10;
        
        for (let i = 0; i < maxSoluteParticles; i++) {
            soluteParticles.push({
                x: rx_min + Math.random() * (rx_max - rx_min),
                y: ry_min + Math.random() * (ry_max - ry_min),
                vx: (Math.random() - 0.5) * 1.5,
                vy: (Math.random() - 0.5) * 1.5
            });
        }
    },
    reset: () => {
        eqConfig.init();
    },
    solve: () => {
        const T0 = parameters["T0"] || 80.0;
        const coolRate = parameters["coolRate"] || 0.8;
        const kn = parameters["kn"] || 1.0;
        const kg = parameters["kg"] || 1.5;
        const method = parameters["method"] || 0; // 0 = Cooling, 1 = Vacuum, 2 = Solar Evaporative
        
        // Solar Evaporative mode (Salar de Atacama / static pool) has NO stirrer
        const rpm = method === 2 ? 0 : (parameters["rpm"] !== undefined ? parameters["rpm"] : 160);
        
        const simSpeed = parameters["simSpeed"] || 1.0;
        const effectiveDt = dt * simSpeed;
        t += effectiveDt;
        
        // 1. Solve parameters based on Method
        let solventVol = 1.0;
        
        if (method === 0) {
            // Cooling Mode (isochoric cooling)
            currentTemp = Math.max(20.0, T0 - coolRate * t);
            cStar = 10.0 + 0.008 * currentTemp * currentTemp;
        } else if (method === 1) {
            // Vacuum Mode (boiling flash cooling + evaporation)
            currentTemp = Math.max(20.0, T0 - coolRate * t);
            cStar = 10.0 + 0.008 * currentTemp * currentTemp;
            solventVol = Math.max(0.5, 1.0 - 0.007 * t);
        } else if (method === 2) {
            // Solar Evaporative Mode (isothermal evaporation, no stirrer)
            currentTemp = T0;
            cStar = 10.0 + 0.008 * currentTemp * currentTemp;
            solventVol = Math.max(0.4, 1.0 - 0.0095 * t);
        }
        
        // Apparent concentration (rises if solvent volume decreases)
        apparentC = soluteC / solventVol;
        
        // Supersaturation & driving force
        const S = apparentC / Math.max(1.0, cStar);
        const deltaC = Math.max(0.0, apparentC - cStar);
        
        // Boundaries dynamically adjusted for evaporative liquid level
        const w = canvas.width || 550;
        const h_canvas = canvas.height || 420;
        const leftMargin = 55;
        const gap = 35;
        const panelW = (w - leftMargin - 40 - gap) / 2;
        const cx = leftMargin + panelW / 2;
        const cy = 40 + (h_canvas - 110) / 2;
        
        const r_width = 170;
        const r_height = 180;
        const rx_min = cx - r_width / 2 + 10;
        const rx_max = cx + r_width / 2 - 10;
        const ry_min = cy - r_height / 2 + 10;
        const ry_max = cy + r_height / 2 - 10;
        
        const ry_min_current = ry_min + (ry_max - ry_min) * (1.0 - solventVol);
        
        // 1 particle of solute concentration is equivalent to 0.333 mol/L
        const particleConcUnit = 0.333;
        
        // 2. Stochastic Primary Nucleation
        // Occurs in the Labile zone (typically S > 1.15)
        if (S > 1.15) {
            const P_nuc = kn * 0.00045 * Math.pow(deltaC, 1.6) * effectiveDt;
            if (Math.random() < P_nuc && crystals.length < 40 && soluteC > 2.0) {
                // Spawn a new primary crystal with mass = 4.0 units
                crystals.push({
                    x: rx_min + 15 + Math.random() * (rx_max - rx_min - 30),
                    y: ry_min_current + 15 + Math.random() * (ry_max - ry_min_current - 30),
                    vx: (Math.random() - 0.5) * 0.8,
                    vy: (Math.random() - 0.5) * 0.8,
                    mass: 4.0, // Initial mass in equivalent particle units
                    size: Math.pow(4.0, 1/3) * 5.0, // dynamic visual size
                    angle: Math.random() * 2 * Math.PI,
                    dAngle: (Math.random() - 0.5) * 0.05,
                    glowTimer: 25,
                    isSecondary: false
                });
                // Subtract nucleated mass from bulk concentration
                soluteC = Math.max(0.0, soluteC - 4.0 * particleConcUnit);
            }
        }
        
        // 3. Stirring Dynamics (Suspension vs Gravity Settling)
        // Crystals start to settle if rpm is below 60 RPM
        const settlingGravity = rpm < 60 ? 0.08 * (1.0 - rpm / 60) : 0.0;
        
        // 4. Crystal Growth & Secondary Nucleation
        crystals.forEach(cr => {
            // Swirl drag field from stirrer (centered at cx, cy + 15)
            const dx = cr.x - cx;
            const dy = cr.y - (cy + 15);
            const r_dist = Math.hypot(dx, dy);
            let fluid_vx = 0;
            let fluid_vy = 0;
            if (r_dist > 0 && rpm > 0) {
                const tx = -dy / r_dist;
                const ty = dx / r_dist;
                const swirl_mag = 1.8 * (rpm / 150) * Math.exp(-r_dist / 65.0) * simSpeed;
                fluid_vx = tx * swirl_mag;
                fluid_vy = ty * swirl_mag;
            }
            
            // Apply drag force
            cr.vx += 0.12 * (fluid_vx - cr.vx);
            cr.vy += 0.12 * (fluid_vy - cr.vy);
            
            // Gravity settling if stirrer is too slow
            cr.vy += settlingGravity * simSpeed;
            
            // Drag friction damping
            cr.vx *= 0.98;
            cr.vy *= 0.98;
            
            // Tiny thermal drift
            cr.vx += (Math.random() - 0.5) * 0.06;
            cr.vy += (Math.random() - 0.5) * 0.06;
            
            // Limit speed
            const spd = Math.hypot(cr.vx, cr.vy);
            if (spd > 2.0) {
                cr.vx = (cr.vx / spd) * 2.0;
                cr.vy = (cr.vy / spd) * 2.0;
            }
            
            cr.x += cr.vx * simSpeed;
            cr.y += cr.vy * simSpeed;
            
            // Boundary bounce
            if (cr.x < rx_min + 5) { cr.x = rx_min + 5; cr.vx = -cr.vx; }
            if (cr.x > rx_max - 5) { cr.x = rx_max - 5; cr.vx = -cr.vx; }
            if (cr.y < ry_min_current + 5) { cr.y = ry_min_current + 5; cr.vy = Math.abs(cr.vy) * 0.5; }
            if (cr.y > ry_max - 5) { cr.y = ry_max - 5; cr.vy = -Math.abs(cr.vy) * 0.5; }
            
            // Mass-based growth: dM/dt is proportional to surface area (mass^(2/3)) and supersaturation driving force
            const massG = kg * 0.065 * deltaC * Math.pow(cr.mass, 2/3) * effectiveDt;
            cr.mass += massG;
            // Visual size scales with cube root of mass (volumetric 3D scaling)
            cr.size = Math.pow(cr.mass, 1/3) * 5.0;
            cr.angle += cr.dAngle;
            
            // Glow
            if (cr.glowTimer > 0) cr.glowTimer--;
            
            // Mass depletion from bulk concentration
            soluteC = Math.max(0.0, soluteC - massG * particleConcUnit);
            
            // 5. Secondary Nucleation (Impeller Shear)
            // Occurs when crystal collides with stirrer blades centered at (cx, cy + 15)
            const distToImpeller = Math.hypot(cr.x - cx, cr.y - (cy + 15));
            if (distToImpeller < cr.size / 2 + 15 && cr.size > 8.0 && crystals.length < 40 && rpm > 50) {
                if (S > 1.01 && Math.random() < 0.02 * (rpm / 150) * effectiveDt * kg) {
                    // Shear off a small mass from the parent crystal (conserving mass)
                    const shearMass = Math.min(cr.mass * 0.3, 4.0);
                    if (cr.mass > shearMass + 2.0) {
                        cr.mass -= shearMass;
                        cr.size = Math.pow(cr.mass, 1/3) * 5.0;
                        
                        const theta = Math.random() * 2 * Math.PI;
                        crystals.push({
                            x: cx + 18 * Math.cos(theta),
                            y: (cy + 15) + 18 * Math.sin(theta),
                            vx: cr.vx + (Math.random() - 0.5) * 1.5,
                            vy: cr.vy + (Math.random() - 0.5) * 1.5,
                            mass: shearMass, // seed mass taken from parent
                            size: Math.pow(shearMass, 1/3) * 5.0,
                            angle: Math.random() * 2 * Math.PI,
                            dAngle: (Math.random() - 0.5) * 0.1,
                            glowTimer: 15,
                            isSecondary: true
                        });
                    }
                }
            }
        });
        
        // 6. Particle Swirl, Diffusion, and Collision
        soluteParticles.forEach(p => {
            // Swirl drag
            const dx = p.x - cx;
            const dy = p.y - (cy + 15);
            const r_dist = Math.hypot(dx, dy);
            let fluid_vx = 0;
            let fluid_vy = 0;
            if (r_dist > 0 && rpm > 0) {
                const tx = -dy / r_dist;
                const ty = dx / r_dist;
                const swirl_mag = 2.4 * (rpm / 150) * Math.exp(-r_dist / 65.0) * simSpeed;
                fluid_vx = tx * swirl_mag;
                fluid_vy = ty * swirl_mag;
            }
            
            p.vx += 0.22 * (fluid_vx - p.vx);
            p.vy += 0.22 * (fluid_vy - p.vy);
            
            // Random diffusion walk
            p.vx += (Math.random() - 0.5) * 0.35;
            p.vy += (Math.random() - 0.5) * 0.35;
            
            const spd = Math.hypot(p.vx, p.vy);
            if (spd > 2.5) {
                p.vx = (p.vx / spd) * 2.5;
                p.vy = (p.vy / spd) * 2.5;
            }
            
            p.x += p.vx * simSpeed;
            p.y += p.vy * simSpeed;
            
            // Boundary bounce
            if (p.x < rx_min) { p.x = rx_min; p.vx = -p.vx; }
            if (p.x > rx_max) { p.x = rx_max; p.vx = -p.vx; }
            if (p.y < ry_min_current) { p.y = ry_min_current; p.vy = Math.abs(p.vy); }
            if (p.y > ry_max) { p.y = ry_max; p.vy = -p.vy; }
            
            // Collision with crystals (deposition)
            for (let i = 0; i < crystals.length; i++) {
                const cr = crystals[i];
                const dist = Math.hypot(p.x - cr.x, p.y - cr.y);
                if (dist < cr.size / 2 + 2) {
                    p.remove = true;
                    // Add mass to crystal (conserving physical mass: 1 particle = 6.0 mass units)
                    const particleMassValue = 6.0;
                    cr.mass += particleMassValue;
                    cr.size = Math.pow(cr.mass, 1/3) * 5.0;
                    // Deplete solute concentration
                    soluteC = Math.max(0.0, soluteC - particleMassValue * particleConcUnit);
                    
                    ripples.push({
                        x: p.x,
                        y: p.y,
                        radius: 2.0,
                        alpha: 1.0
                    });
                    break;
                }
            }
        });
        
        // Update ripples
        ripples.forEach(rp => {
            rp.radius += 0.8 * simSpeed;
            rp.alpha -= 0.08 * simSpeed;
        });
        ripples = ripples.filter(rp => rp.alpha > 0.01);
        
        // Remove hit particles
        soluteParticles = soluteParticles.filter(p => !p.remove);
        
        // 7. Vacuum boiling vapor bubbles rising and popping
        if (method === 1 && isRunning && Math.random() < 0.4 * simSpeed) {
            vacuumBubbles.push({
                x: rx_min + 5 + Math.random() * (rx_max - rx_min - 10),
                y: ry_max - 5,
                vx: (Math.random() - 0.5) * 0.4,
                vy: -1.2 - Math.random() * 0.8,
                size: 1.2 + Math.random() * 2.2,
                alpha: 0.6 + Math.random() * 0.4
            });
        }
        
        vacuumBubbles.forEach(b => {
            b.x += b.vx * simSpeed;
            b.y += b.vy * simSpeed;
            b.vx += (Math.random() - 0.5) * 0.1;
            if (b.y < ry_min_current + 15) {
                b.alpha -= 0.15 * simSpeed;
            }
        });
        vacuumBubbles = vacuumBubbles.filter(b => b.y > ry_min_current && b.alpha > 0.05);
        
        // Keep solute particle counts synchronized with concentration
        const targetParticles = Math.round(maxSoluteParticles * (soluteC / 60.0));
        while (soluteParticles.length > targetParticles) {
            soluteParticles.pop();
        }
        while (soluteParticles.length < targetParticles) {
            soluteParticles.push({
                x: rx_min + Math.random() * (rx_max - rx_min),
                y: ry_min_current + Math.random() * (ry_max - ry_min_current),
                vx: (Math.random() - 0.5) * 1.5,
                vy: (Math.random() - 0.5) * 1.5
            });
        }
        
        // Downsampled logging for histories
        if (historyTime.length === 0 || t - historyTime[historyTime.length - 1] >= 0.25) {
            historyTime.push(t);
            historyc.push(apparentC);
            historycStar.push(cStar);
            historyTemp.push(currentTemp);
            
            if (historyTime.length > 150) {
                historyTime.shift();
                historyc.shift();
                historycStar.shift();
                historyTemp.shift();
            }
        }
    },
    draw: () => {
        ctx.fillStyle = "#040507";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        
        const w = canvas.width || 550;
        const h_canvas = canvas.height || 420;
        const leftMargin = 55;
        const gap = 35;
        const panelW = (w - leftMargin - 40 - gap) / 2;
        const panelH = h_canvas - 110;
        const cx = leftMargin + panelW / 2;
        const cy = 40 + panelH / 2;
        const rx = leftMargin + panelW + gap;
        const plotH = 105;
        
        const r_width = 170;
        const r_height = 180;
        
        const method = parameters["method"] || 0;
        // Solar Evaporative mode has NO stirrer
        const rpm = method === 2 ? 0 : (parameters["rpm"] !== undefined ? parameters["rpm"] : 160);
        
        let solventVol = 1.0;
        if (method === 1) {
            solventVol = Math.max(0.5, 1.0 - 0.007 * t);
        } else if (method === 2) {
            solventVol = Math.max(0.4, 1.0 - 0.0095 * t);
        }
        
        const ry_min = cy - r_height / 2 + 10;
        const ry_max = cy + r_height / 2 - 10;
        const ry_min_current = ry_min + (ry_max - ry_min) * (1.0 - solventVol);
        
        // Left Panel: Crystallizer tank border
        ctx.strokeStyle = "rgba(255,255,255,0.06)";
        ctx.strokeRect(leftMargin, 40, panelW, panelH);
        
        // 1. Draw double-walled glass reactor outline
        ctx.fillStyle = "rgba(255, 255, 255, 0.012)";
        ctx.strokeStyle = "rgba(255, 255, 255, 0.16)";
        ctx.beginPath();
        ctx.roundRect(cx - r_width / 2, cy - r_height / 2, r_width, r_height, 10);
        ctx.fill();
        ctx.stroke();
        
        // 2. Draw cooling jacket fluid border (shifts from warm orange-red to ice-blue)
        const T0 = parameters["T0"] || 80.0;
        const coolPct = Math.max(0.0, Math.min(1.0, (currentTemp - 20.0) / (T0 - 20.0))); // 1 at start, 0 at cold
        const red = Math.round(40 + coolPct * 110);
        const blue = Math.round(180 - coolPct * 110);
        ctx.strokeStyle = `rgba(${red}, 100, ${blue}, 0.22)`;
        ctx.lineWidth = 4.0;
        ctx.beginPath();
        ctx.roundRect(cx - r_width / 2 - 8, cy - r_height / 2 - 4, r_width + 16, r_height + 8, 12);
        ctx.stroke();
        ctx.lineWidth = 1.0;
        
        // 3. Draw active solvent liquid region
        ctx.fillStyle = "rgba(0, 150, 255, 0.045)";
        ctx.beginPath();
        ctx.roundRect(cx - r_width / 2 + 2, ry_min_current - 3, r_width - 4, (cy + r_height / 2) - ry_min_current + 1, 6);
        ctx.fill();
        
        // Draw stirrer impeller (metallic shaft & rotating blade) - hidden in Solar Evaporative mode
        if (method !== 2) {
            ctx.strokeStyle = "rgba(255,255,255,0.35)";
            ctx.lineWidth = 1.8;
            ctx.beginPath();
            ctx.moveTo(cx, cy - r_height / 2 - 10);
            ctx.lineTo(cx, cy + 15);
            const rot = isRunning ? t * (rpm / 60) * 2 * Math.PI : 0.0;
            ctx.moveTo(cx - 32 * Math.cos(rot), cy + 15 - 5 * Math.sin(rot));
            ctx.lineTo(cx + 32 * Math.cos(rot), cy + 15 + 5 * Math.sin(rot));
            ctx.stroke();
            ctx.lineWidth = 1.0;
        }
        
        // 4. Draw Solute molecules (orange dots)
        soluteParticles.forEach(p => {
            ctx.fillStyle = "#ff9f43";
            ctx.beginPath();
            ctx.arc(p.x, p.y, 2.0, 0, 2 * Math.PI);
            ctx.fill();
        });
        
        // 5. Draw molecular deposition ripples
        ripples.forEach(rp => {
            ctx.strokeStyle = `rgba(0, 210, 255, ${rp.alpha})`;
            ctx.lineWidth = 1.0;
            ctx.beginPath();
            ctx.arc(rp.x, rp.y, rp.radius, 0, 2 * Math.PI);
            ctx.stroke();
        });
        
        // 6. Draw rising vacuum bubbles
        if (method === 1) {
            vacuumBubbles.forEach(b => {
                ctx.strokeStyle = `rgba(255, 255, 255, ${b.alpha * 0.45})`;
                ctx.fillStyle = `rgba(255, 255, 255, ${b.alpha * 0.15})`;
                ctx.lineWidth = 0.8;
                ctx.beginPath();
                ctx.arc(b.x, b.y, b.size, 0, 2 * Math.PI);
                ctx.fill();
                ctx.stroke();
            });
        }
        
        // 7. Draw Crystals (Faceted hexagons with growth rings & solute-depletion halos)
        crystals.forEach(cr => {
            // Depletion boundary halo (faint blue shadow)
            ctx.fillStyle = "rgba(0, 210, 255, 0.03)";
            ctx.beginPath();
            ctx.arc(cr.x, cr.y, cr.size * 1.4, 0, 2 * Math.PI);
            ctx.fill();
            
            // Spontaneous nucleation birth glow
            if (cr.glowTimer > 0) {
                ctx.strokeStyle = cr.isSecondary ? `rgba(255, 150, 0, ${cr.glowTimer / 15.0})` : `rgba(255, 255, 255, ${cr.glowTimer / 25.0})`;
                ctx.lineWidth = cr.isSecondary ? 1.0 : 1.8;
                ctx.beginPath();
                ctx.arc(cr.x, cr.y, cr.size * 1.3 + (25 - cr.glowTimer) * 0.8, 0, 2 * Math.PI);
                ctx.stroke();
                ctx.lineWidth = 1.0;
            }
            
            // Hexagonal facets
            ctx.save();
            ctx.translate(cr.x, cr.y);
            ctx.rotate(cr.angle);
            
            ctx.fillStyle = cr.isSecondary ? "rgba(255, 160, 0, 0.55)" : "rgba(0, 210, 255, 0.55)";
            ctx.strokeStyle = cr.isSecondary ? "#ff9f43" : "#00d2ff";
            ctx.lineWidth = 1.0;
            
            ctx.beginPath();
            const sides = 6;
            for (let i = 0; i < sides; i++) {
                const angle = (i * 2 * Math.PI) / sides;
                const x_side = (cr.size / 2) * Math.cos(angle);
                const y_side = (cr.size / 2) * Math.sin(angle);
                if (i === 0) ctx.moveTo(x_side, y_side);
                else ctx.lineTo(x_side, y_side);
            }
            ctx.closePath();
            ctx.fill();
            ctx.stroke();
            
            // Tree rings showing growth history layers
            ctx.strokeStyle = "rgba(255, 255, 255, 0.2)";
            const drawHex = (r) => {
                ctx.beginPath();
                for (let i = 0; i < sides; i++) {
                    const angle = (i * 2 * Math.PI) / sides;
                    ctx.lineTo(r * Math.cos(angle), r * Math.sin(angle));
                }
                ctx.closePath();
                ctx.stroke();
            };
            if (cr.size > 8.0) drawHex(cr.size / 3);
            if (cr.size > 16.0) drawHex(cr.size * 2 / 3);
            
            ctx.restore();
        });
        
        // Dynamic Title depending on crystallization method
        ctx.fillStyle = "#fff";
        ctx.font = "bold 9px Outfit";
        ctx.textAlign = "left";
        let modeTitle = "Stirred Cooling Crystallizer (Kaltrührer)";
        if (method === 1) {
            modeTitle = "Vacuum Stirred Crystallizer (Vakuum-Rührkristallisator)";
        } else if (method === 2) {
            modeTitle = "Solar Evaporative Crystallization (Salar de Atacama)";
        }
        ctx.fillText(modeTitle, leftMargin + 10, 32);
        
        ctx.fillStyle = "rgba(255,255,255,0.4)";
        ctx.font = "8px Outfit";
        ctx.textAlign = "center";
        ctx.fillText(`Crystals: ${crystals.length}`, cx, cy + r_height / 2 + 15);
        
        // Right Panel: Plots
        const getXCoord = (timeVal) => {
            const maxTime = Math.max(20.0, t);
            return rx + (timeVal / maxTime) * panelW;
        };
        const getYCoordTop = (concVal) => {
            const maxcVal = 80.0;
            return 45 + plotH - (concVal / maxcVal) * plotH;
        };
        
        // 1. Top Plot: Concentration c(t) & Solubility c*(T) & Metastable/Labile Zones
        ctx.strokeStyle = "rgba(255,255,255,0.06)";
        ctx.strokeRect(rx, 45, panelW, plotH);
        
        // Draw thermodynamic zones in plot background
        if (historyTime.length > 1) {
            // A. Metastable Zone (Soft green/yellow between c* and 1.15*c*)
            ctx.fillStyle = "rgba(57, 211, 83, 0.08)";
            ctx.beginPath();
            ctx.moveTo(getXCoord(historyTime[0]), getYCoordTop(historycStar[0]));
            for (let i = 1; i < historyTime.length; i++) {
                ctx.lineTo(getXCoord(historyTime[i]), getYCoordTop(historycStar[i]));
            }
            for (let i = historyTime.length - 1; i >= 0; i--) {
                ctx.lineTo(getXCoord(historyTime[i]), getYCoordTop(historycStar[i] * 1.15));
            }
            ctx.closePath();
            ctx.fill();
            
            // B. Labile/Unstable Zone (Soft red above 1.15*c*)
            ctx.fillStyle = "rgba(255, 77, 77, 0.06)";
            ctx.beginPath();
            ctx.moveTo(getXCoord(historyTime[0]), getYCoordTop(historycStar[0] * 1.15));
            for (let i = 1; i < historyTime.length; i++) {
                ctx.lineTo(getXCoord(historyTime[i]), getYCoordTop(historycStar[i] * 1.15));
            }
            ctx.lineTo(getXCoord(historyTime[historyTime.length - 1]), 45); // plot top boundary
            ctx.lineTo(getXCoord(historyTime[0]), 45);
            ctx.closePath();
            ctx.fill();
            
            // C. Undersaturated Zone (Faint blue below c*)
            ctx.fillStyle = "rgba(0, 210, 255, 0.03)";
            ctx.beginPath();
            ctx.moveTo(getXCoord(historyTime[0]), getYCoordTop(historycStar[0]));
            for (let i = 1; i < historyTime.length; i++) {
                ctx.lineTo(getXCoord(historyTime[i]), getYCoordTop(historycStar[i]));
            }
            ctx.lineTo(getXCoord(historyTime[historyTime.length - 1]), 45 + plotH); // plot bottom boundary
            ctx.lineTo(getXCoord(historyTime[0]), 45 + plotH);
            ctx.closePath();
            ctx.fill();
        }
        
        ctx.strokeStyle = "rgba(255,255,255,0.04)";
        for (let i = 1; i < 5; i++) {
            const pct = i / 5;
            ctx.beginPath();
            ctx.moveTo(rx + pct * panelW, 45);
            ctx.lineTo(rx + pct * panelW, 45 + plotH);
            ctx.moveTo(rx, 45 + pct * plotH);
            ctx.lineTo(rx + panelW, 45 + pct * plotH);
            ctx.stroke();
        }
        
        if (historyTime.length > 1) {
            // Solubility c*(T) (Blue dashed line)
            ctx.strokeStyle = "#4dabf7";
            ctx.setLineDash([2, 2]);
            ctx.beginPath();
            ctx.moveTo(getXCoord(historyTime[0]), getYCoordTop(historycStar[0]));
            for (let i = 1; i < historyTime.length; i++) {
                ctx.lineTo(getXCoord(historyTime[i]), getYCoordTop(historycStar[i]));
            }
            ctx.stroke();
            ctx.setLineDash([]);
            
            // Concentration c(t) (Orange solid line)
            ctx.strokeStyle = "#ff9f43";
            ctx.lineWidth = 2.0;
            ctx.beginPath();
            ctx.moveTo(getXCoord(historyTime[0]), getYCoordTop(historyc[0]));
            for (let i = 1; i < historyTime.length; i++) {
                ctx.lineTo(getXCoord(historyTime[i]), getYCoordTop(historyc[i]));
            }
            ctx.stroke();
            ctx.lineWidth = 1.0;
        }
        
        // Axes and Ticks Top
        ctx.strokeStyle = "rgba(255,255,255,0.2)";
        ctx.beginPath();
        ctx.moveTo(rx, 45); ctx.lineTo(rx, 45 + plotH); ctx.lineTo(rx + panelW, 45 + plotH);
        ctx.stroke();
        
        ctx.fillStyle = "rgba(255,255,255,0.4)";
        ctx.font = "8px 'JetBrains Mono', monospace";
        ctx.textAlign = "right";
        ctx.fillText("80", rx - 6, 48);
        ctx.fillText("40", rx - 6, 45 + plotH / 2 + 3);
        ctx.fillText("0", rx - 6, 45 + plotH);
        
        ctx.textAlign = "center";
        const totalDuration = Math.max(20.0, t);
        ctx.fillText("0s", getXCoord(0.0), 45 + plotH + 11);
        ctx.fillText((totalDuration / 2).toFixed(0) + "s", getXCoord(totalDuration / 2), 45 + plotH + 11);
        ctx.fillText(totalDuration.toFixed(0) + "s", getXCoord(totalDuration), 45 + plotH + 11);
        
        ctx.fillStyle = "#fff";
        ctx.font = "bold 9px Outfit";
        ctx.textAlign = "left";
        ctx.fillText("Concentration vs. Solubility Limit [mol/L]", rx, 36);
        
        // 2. Bottom Plot: Crystal Size Distribution (CSD) Histogram
        ctx.strokeStyle = "rgba(255,255,255,0.06)";
        ctx.strokeRect(rx, 210, panelW, plotH);
        
        // Calculate CSD bins
        const bins = [0, 0, 0, 0, 0]; // Bins: 0-6px, 6-12px, 12-18px, 18-24px, >24px
        crystals.forEach(cr => {
            const size = cr.size;
            if (size < 6.0) bins[0]++;
            else if (size < 12.0) bins[1]++;
            else if (size < 18.0) bins[2]++;
            else if (size < 24.0) bins[3]++;
            else bins[4]++;
        });
        
        const maxBinVal = Math.max(5, ...bins);
        const barW = (panelW - 20) / 5;
        ctx.fillStyle = "rgba(0, 210, 255, 0.4)";
        ctx.strokeStyle = "#00d2ff";
        ctx.lineWidth = 1.0;
        
        for (let i = 0; i < 5; i++) {
            const h = (bins[i] / maxBinVal) * (plotH - 20);
            const bx = rx + 10 + i * barW + 2;
            const by = 210 + plotH - h;
            
            ctx.beginPath();
            ctx.rect(bx, by, barW - 4, h);
            ctx.fill();
            ctx.stroke();
            
            // Draw count text on top of bar
            if (bins[i] > 0) {
                ctx.fillStyle = "rgba(255,255,255,0.6)";
                ctx.font = "7px 'JetBrains Mono', monospace";
                ctx.textAlign = "center";
                ctx.fillText(bins[i].toString(), bx + (barW - 4) / 2, by - 4);
            }
        }
        
        // Axes and Ticks Bottom
        ctx.strokeStyle = "rgba(255,255,255,0.2)";
        ctx.beginPath();
        ctx.moveTo(rx, 210); ctx.lineTo(rx, 210 + plotH); ctx.lineTo(rx + panelW, 210 + plotH);
        ctx.stroke();
        
        ctx.fillStyle = "rgba(255,255,255,0.4)";
        ctx.font = "8px Outfit";
        ctx.textAlign = "center";
        ctx.fillText("< 6", rx + 10 + 0 * barW + barW / 2, 210 + plotH + 11);
        ctx.fillText("6-12", rx + 10 + 1 * barW + barW / 2, 210 + plotH + 11);
        ctx.fillText("12-18", rx + 10 + 2 * barW + barW / 2, 210 + plotH + 11);
        ctx.fillText("18-24", rx + 10 + 3 * barW + barW / 2, 210 + plotH + 11);
        ctx.fillText("> 24", rx + 10 + 4 * barW + barW / 2, 210 + plotH + 11);
        
        ctx.fillStyle = "#fff";
        ctx.font = "bold 9px Outfit";
        ctx.textAlign = "left";
        ctx.fillText("Crystal Size Distribution (CSD) [px]", rx, 201);
        
        // Legends on panels
        drawLegend([
            { color: "#ff9f43", label: "Solute Molecules" },
            { color: "#00d2ff", label: "Primary Crystals" },
            { color: "#ff9f43", label: "Secondary Crystals" }
        ], leftMargin + 6, 52);
        
        // Output calculations
        const S_val = apparentC / Math.max(1.0, cStar);
        let supersatText = `<span class="mono" style="color: #8b949e;">Undersaturated</span>`;
        if (S_val > 1.15) {
            supersatText = `<span class="mono" style="color: #ff4d4d; font-weight:bold;">Labile (Unstable)</span>`;
        } else if (S_val > 1.0) {
            supersatText = `<span class="mono" style="color: #ff9f43; font-weight:bold;">Metastable</span>`;
        }
        
        const deltaC_val = Math.max(0.0, apparentC - cStar);
        const B_rate = S_val > 1.15 ? parameters["kn"] * 0.05 * Math.pow(deltaC_val, 1.6) : 0.0;
        const G_rate = parameters["kg"] * 0.08 * deltaC_val;
        
        const primaryCount = crystals.filter(c => !c.isSecondary).length;
        const secondaryCount = crystals.filter(c => c.isSecondary).length;
        
        outputsList.innerHTML = `
            <div class="stat-row"><span>Reactor Temperature:</span><span class="mono" style="font-weight:bold; color:#4dabf7;">${currentTemp.toFixed(1)} °C</span></div>
            <div class="stat-row"><span>Supersaturation (S):</span><span class="mono" style="font-weight:bold; color:${S_val > 1.15 ? '#ff4d4d' : S_val > 1.0 ? '#ff9f43' : '#8b949e'};">${S_val.toFixed(3)}</span></div>
            <div class="stat-row"><span>Thermodynamic State:</span>${supersatText}</div>
            <div class="stat-row"><span>Nucleation Rate (B):</span><span class="mono">${B_rate.toFixed(2)} nuclei/s</span></div>
            <div class="stat-row"><span>Growth Rate (G):</span><span class="mono">${G_rate.toFixed(2)} nm/s</span></div>
            <div class="stat-row"><span>Total Crystals:</span><span class="mono" style="color:#00d2ff; font-weight:bold;">${crystals.length} <span style="font-weight:normal; font-size:8px; color:rgba(255,255,255,0.4)">(${primaryCount} P / ${secondaryCount} S)</span></span></div>
        `;
    }
};

const activeEqKey = "crystallization";
const isAnimated = true;

// Generate Sliders dynamically
function initSliders(sliders) {
    slidersBox.innerHTML = "";
    parameters = {};
    sliders.forEach(s => {
        parameters[s.id] = s.val;
        const group = document.createElement("div");
        group.className = "control-group";
        group.id = `slider-container-${s.id}`;
        
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
                const val = parseFloat(e.target.value);
                parameters[s.id] = val;
                
                // Toggle RPM slider visibility based on method selection
                if (s.id === "method") {
                    const rpmContainer = document.getElementById("slider-container-" + "rpm");
                    if (rpmContainer) {
                        rpmContainer.style.display = val === 2 ? "none" : "block";
                    }
                    updateDescription(val);
                }
                
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
}

if (btnReset) {
    btnReset.addEventListener("click", () => {
        isRunning = false;
        if (btnPlay) {
            btnPlay.textContent = "▶ Start";
            btnPlay.classList.remove("btn-danger");
        }
        if (animId) cancelAnimationFrame(animId);
        eqConfig.init();
        eqConfig.solve();
        eqConfig.draw();
        
        // Restore RPM visibility if evaporative mode is reset
        const currentMethod = parameters["method"] || 0;
        const rpmContainer = document.getElementById("slider-container-" + "rpm");
        if (rpmContainer) {
            rpmContainer.style.display = currentMethod === 2 ? "none" : "block";
        }
        updateDescription(currentMethod);
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
    if (isAnimated) {
        playbackBox.style.display = "flex";
        btnPlay.textContent = isRunning ? "⏸ Pause" : "▶ Start";
    } else {
        playbackBox.style.display = "none";
    }

    initSliders(eqConfig.sliders);
    eqConfig.init();
    resizeCanvas();
    
    // Hide RPM slider initially if method is 2
    const currentMethod = parameters["method"] || 0;
    const rpmContainer = document.getElementById("slider-container-" + "rpm");
    if (rpmContainer) {
        rpmContainer.style.display = currentMethod === 2 ? "none" : "block";
    }
    updateDescription(currentMethod);
    
    eqConfig.solve();
    eqConfig.draw();
});

// Didactical description updates dynamically per mode
function updateDescription(method) {
    const descEl = document.getElementById("eq-desc");
    if (!descEl) return;
    
    if (method === 0) {
        descEl.innerHTML = `<strong>Cooling Crystallization (Kaltrührer)</strong>: Cooling lowers the temperature, which decreases the solubility $c^*(T)$ and increases the supersaturation $S = c/c^*$. This batch operation uses an impeller stirrer to maintain suspension and promote secondary nucleation through crystal-impeller collisions. Rapid cooling creates many small crystals (nucleation-dominated), while slow cooling produces fewer, larger crystals (growth-dominated).`;
    } else if (method === 1) {
        descEl.innerHTML = `<strong>Vacuum Crystallization (Vakuum-Rührkristallisator)</strong>: Operates by lowering the pressure, causing the solvent to boil/flash-evaporate at a lower temperature. This adiabatic flash-evaporation cools the solvent (decreasing $c^*$) and simultaneously vaporizes it (decreasing volume, raising $c$). The combination drives rapid supersaturation. The stirred vessel prevents settling and triggers secondary nucleation. Translucent rising bubbles visualize the flash evaporation.`;
    } else if (method === 2) {
        descEl.innerHTML = `<strong>Solar Evaporative Crystallization (Salar de Atacama)</strong>: Model of environmental evaporation ponds where solar heating drives evaporation of solvent at a constant ambient temperature, reducing the liquid volume and concentrating solute to drive supersaturation. Without a mechanical stirrer (RPM locked to 0), crystals settle to the bottom and grow statically, forming high-purity crystalline beds with zero secondary shear nucleation.`;
    }
    
    // Trigger MathJax typeset to render LaTeX inside description
    if (window.MathJax && window.MathJax.typeset) {
        window.MathJax.typeset();
    }
}
