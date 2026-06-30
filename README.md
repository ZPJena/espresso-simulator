# Friedrich Schiller University Jena - Technical Chemistry I: FEM Simulations

This repository contains the COMSOL Multiphysics simulation models, Java automation scripts, and Python processing workflows for **Technical Chemistry I (FEM Lectures)** at Friedrich Schiller University Jena.

It showcases two key engineering demos that turn mathematical formulas into pictures:
1. **Strawberry Drying Simulation (Lecture 1 / Course Note L13)**: Demonstrates "Simulation as a bridge between experiment and theory" by showing how hot-air drying kinetics are dominated by boundary-layer evaporation (Phase I) and internal moisture diffusion (Phase II).
2. **Pizza Cooking & Oven Preheating Optimization (Lecture 4 / Course Note L07)**: Couples instationary heat conduction with Arrhenius-based chemical doneness kinetics to analyze and compare preheated oven versus cold-start oven scenarios, demonstrating a 51.7% energy-time savings.

---

## Project Structure & Components

### 1. Strawberry Drying Demo (Course Note L13 - Stofftrennung Trockung)
* **`strawberry_drying_TC1.mph`**: 2D axisymmetric FEM model coupling Heat Transfer (`ht`) and Transport of Diluted Species (`tds`).
* **`RunParameterStudyPrint.java`**: Solves parameter studies for $T_{air} = 40^\circ\text{C}$ and $80^\circ\text{C}$.
* **`CreateCustomPlots.java`**: Recreates the default visual plot groups `pg1` (Temperature) and `pg2` (Concentration).
* **`ExportAllImages.java`**: Loops through the 73 solved time steps and exports the 2D field PNG frames.
* **`process_log.py`**: Extracts the average data curves and generates the comparative plot `drying_curves_comparison.png`.
* **`stitch_animation.py`**: Merges T and c frames into the animated GIF `strawberry_drying_simulation.gif`.

### 2. Pizza Cooking & Preheating Demo (Course Note L07 - Makrokinetik II)
* **`pizza_cooking.mph`**: 2D plane Cartesian FEM model coupling heat transfer and non-isothermal doneness kinetics ($c$, from 0 to 1).
* **`SolvePizzaModel.java`**: Builds the geometry and selections, performs the trial run, evaluates center doneness at $t = 720\text{ s}$ to calibrate $A_0$ dynamically ($A_0 \approx 2.039 \times 10^5\,\text{s}^{-1}$), and solves both Scenario A (Preheated) and Scenario B (Cold-Start). Exports data curves to text files via built-in COMSOL table saves.
* **`ExportPizzaImages.java`**: Generates widescreen $800 \times 200$ PNG frames of temperature and doneness over the 151 solved steps.
* **`plot_pizza_curves.py`**: Parses the exported text files, computes cooking time, oven runtime, and dwell-time metrics, and plots the comparative curves.
* **`stitch_pizza_animations.py`**: Combines temperature and doneness frames into split-view animated GIFs and exports static snapshots.

---

## How to Run the Simulations

### Prerequisites
1. **COMSOL Multiphysics 6.4** (with `comsolcompile.exe` and `comsolbatch.exe` in the system path or referenced explicitly).
2. **Python** (Anaconda environment recommended, with `numpy`, `matplotlib`, and `pillow` installed).

### Execution Workflows

#### Run Strawberry Drying Simulation:
```bash
# 1. Solve parameter study and export console logs
"C:\Program Files\COMSOL\COMSOL64\Multiphysics\bin\win64\comsolcompile.exe" RunParameterStudyPrint.java
"C:\Program Files\COMSOL\COMSOL64\Multiphysics\bin\win64\comsolbatch.exe" -inputfile RunParameterStudyPrint.class

# 2. Extract curves and plot
python process_log.py

# 3. Export image frames and compile animation
"C:\Program Files\COMSOL\COMSOL64\Multiphysics\bin\win64\comsolcompile.exe" ExportAllImages.java
"C:\Program Files\COMSOL\COMSOL64\Multiphysics\bin\win64\comsolbatch.exe" -inputfile ExportAllImages.class
python stitch_animation.py
```

#### Run Pizza Cooking & Preheating Simulation:
```bash
# 1. Build model, calibrate A0, solve scenarios and export tables
"C:\Program Files\COMSOL\COMSOL64\Multiphysics\bin\win64\comsolcompile.exe" SolvePizzaModel.java
"C:\Program Files\COMSOL\COMSOL64\Multiphysics\bin\win64\comsolbatch.exe" -inputfile SolvePizzaModel.class

# 2. Process curves and compute energy metrics
python plot_pizza_curves.py

# 3. Export spatial field images and stitch split-view animations
mkdir -Force frames
"C:\Program Files\COMSOL\COMSOL64\Multiphysics\bin\win64\comsolcompile.exe" ExportPizzaImages.java
"C:\Program Files\COMSOL\COMSOL64\Multiphysics\bin\win64\comsolbatch.exe" -inputfile ExportPizzaImages.class
python stitch_pizza_animations.py
```

---

## Key Takeaways for Students

### 1. Strawberry Drying Demo
* **Experiment vs. Simulation**: Weighing a drying strawberry only gives mass loss over time. The 2D axisymmetric simulation reveals the *hidden* concentration profiles, showing that the outer layer dries out first and forms a high-resistance barrier.
* **Wet-Bulb Effect**: Shows how evaporation cooling can temporarily drop the internal temperature below the initial room temperature.

### 2. Pizza Cooking Demo
* **Transport-Reaction Coupling**: The chemical reaction rate of cooking doneness increases exponentially according to the Arrhenius law ($R_c \propto \exp(-E_a/R_g T)(1-c)$). Convection at the boundary heats the outer crust first, while heat conduction slowly transports energy to the center, leading to a propagating cooking front.
* **Preheating Paradox (Energy Savings)**:
  * **Scenario A (Preheated)**: Oven preheating (17.3 min) + Baking (12 min) = **29.3 minutes** total oven runtime.
  * **Scenario B (Cold-Start)**: Pizza in cold oven. Baking = **14.2 minutes** total oven runtime.
  * **Result**: Putting the pizza in a cold oven saves **51.7% of oven operation time** (and thus over 50% energy) because the pizza cooks significantly during the preheating transient.
* **Thermal Stress Reduction**: In Scenario B, the pizza is cooked *before* the oven even reaches 200°C, spending 0 seconds at maximum heat. This prevents the outer crust from drying out or burning.

---

## Interactive Web-Based Drying Strawberry Simulator

In addition to the COMSOL models, this repository features a client-side interactive web-based simulator located at [drying.html](file:///c:/Users/zhiwe/SynologyDrive/04_Software_Code/TC1/drying.html). It helps students explore internal mass transport limitations and external evaporation boundaries interactively.

### Model Assumptions
1. **1D Radial Grid**: Discretizes a sphere of radius $R$ into 15 concentric shells, solving the transient mass conservation diffusion equation with the Finite Volume Method (FVM) for perfect mass conservation.
2. **Lumped Thermal Capacity**: The strawberry's Biot number for heat is very low ($Bi \ll 0.1$). We assume temperature is spatially uniform, heating up over time from convective air contact and cooled by latent heat of evaporation.
3. **Diffusivity Modes**:
   - **Constant**: Bulk moisture diffusivity remains constant throughout the simulation.
   - **Moisture-dependent (Crust)**: Diffusivity drops quadratically with moisture depletion ($D \propto (w/w_0)^2$), modeling dry shell/crust formation at the boundary.

### Parameters
* **Air Temp $T_{\text{air}}$**: $30^\circ\text{C}$ to $90^\circ\text{C}$ (default $60^\circ\text{C}$).
* **Relative Humidity $RH_{\text{air}}$**: $0.05$ to $0.80$ (default $0.20$), which determines the equilibrium moisture content $w_{\text{eq}}$.
* **Evaporation Coeff $K_{\text{evap}}$**: $10^{-5}$ to $10^{-2}$ m/s (log scale, default $2 \times 10^{-4}$ m/s).
* **Bulk Diffusivity $D_{\text{bulk}}$**: $10^{-12}$ to $10^{-8}$ m²/s (log scale, default $2 \times 10^{-10}$ m²/s).
* **Strawberry Radius $R$**: $5$ mm to $20$ mm (default $10$ mm).
* **Drying Time**: $1$ to $6$ hours.

### Guided Tasks
- **Task 0 (Reference Case)**: Standard parameter set baseline.
- **Task 1 (Surface-Limited)**: High internal diffusion, low surface evaporation. Air-side boundary layer is the bottleneck.
- **Task 2 (Bulk-Limited)**: Low internal diffusion, high surface evaporation. Inner core mass transfer is the bottleneck.
- **Task 3 (Blowing Harder)**: Compares $K_{\text{evap}}$ sweeps to show diminishing returns of fan speed.
- **Task 4 (Cutting Smaller)**: Compares radius sweeps to show how dividing the sample speeds up bulk drying.
- **Task 5 (Crust Formation)**: Analyzes how moisture-dependent diffusivity slows down drying as a dry crust forms at the surface.

### Running Locally
To run the simulator locally, simply open [drying.html](file:///c:/Users/zhiwe/SynologyDrive/04_Software_Code/TC1/drying.html) in any modern web browser. There are no server dependencies or package installations required.

### Deploying to GitHub Pages
To host the suite online via GitHub Pages:
1. Go to your repository settings on GitHub.
2. Under the **Code and automation** section, click **Pages**.
3. Under **Build and deployment**, select **Deploy from a branch**.
4. Choose the `main` (or `master`) branch and directory `/` (root), then click **Save**.
5. The simulators will be accessible at `https://<your-username>.github.io/<repository-name>/drying.html`.

