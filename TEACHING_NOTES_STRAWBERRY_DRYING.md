# Teaching Notes: Drying Strawberry Simulator

This note provides a guide for using the **Strawberry Drying Simulator** in a Bachelor-level Technical Chemistry course.

## 1. Main Teaching Message
* **The experiment tells us that drying is slow.** (Average mass loss and drying rate curves are observable in lab measurements).
* **The simulation hidden fields tell us why it is slow.** (Internal gradients, concentrations, fluxes, and boundary layer transfer).
* **Core Goal**: Teach students to identify internal vs. external bottlenecks (surface vs. bulk diffusion limitations) and make correct engineering decisions rather than naive trials.

---

## 2. How to Use the Simulator in 10 Minutes
1. **Introduction (2 min)**:
   - Introduce the drying strawberry of radius $R$ exposed to hot drying air.
   - Explain the observables (scale weighing mass loss, surface state badge) versus hidden fields (moisture profile, bulk flux, boundary evaporation rate).
2. **First Run - Baseline (2 min)**:
   - Load **Task 0 (Reference Case)**. Click **Run Simulation**.
   - Show the drying curves. Drag the timeline scrub slider to see how the strawberry dries from the surface inward.
3. **Experiment 1 - The Fan Dilemma (3 min)**:
   - Load **Task 1 (Surface-Limited)**. Keep "Show Only Experiment" active.
   - Run simulation. Mass loss is slow. Ask students: *"Drying is slow. What would you do?"* (Naturally they suggest cutting it, heating it, or blowing harder).
   - Click **Reveal Hidden Fields** and select **Moisture Field** and **Evaporation Flux**. Students see the internal moisture is flat (fast diffusion) but boundary arrows are tiny (slow evaporation).
   - **Conclusion**: Increasing internal diffusion or cutting it won't help. We must improve the air side (blow harder, decrease RH, increase $K_{\text{evap}}$).
4. **Experiment 2 - The Diffusion Barrier (3 min)**:
   - Load **Task 2 (Bulk-diffusion-limited)**. Keep "Show Only Experiment" active.
   - Run simulation. Drying is slow. Ask students: *"Should we blow harder air / increase fan speed?"* (Students naturally say yes).
   - Click **Reveal Hidden Fields**. Select **Moisture Field** and **Bulk Flux**.
   - Students see a bone-dry crust shell at the boundary but a completely wet blue core. The evaporation arrows are tiny because the dry surface blocks water supply.
   - **Conclusion**: Blowing harder will not help! The bottleneck is bulk diffusion. We must cut it smaller (reduce $R$) or heat the bulk (increase $D_{\text{bulk}}$).

---

## 3. Suggested Student Questions
1. *Under what conditions does blowing harder air give diminishing returns, and why?*
   - **Answer**: When bulk diffusion is the rate-limiting step ($Bi_m > 10$). Once the surface dries out, evaporation is limited by the rate at which water reaches the surface, not by how fast it is swept away by the wind.
2. *If we cut a strawberry slice in half, by how much does the characteristic drying time decrease?*
   - **Answer**: It decreases by 4x because diffusion time scales quadratically with characteristic length ($t_{\text{diff}} \propto R^2$).
3. *Why does the strawberry temperature remain cool at the beginning but heat up to air temperature at the end?*
   - **Answer**: During the constant-rate period (wet surface), latent heat of evaporation cools the strawberry (wet-bulb effect). Once the surface dries (falling-rate period), evaporation drops, and the lumped capacity heats up to thermal equilibrium with the air.

---

## 4. Expected Decision Reversals
| Student View | Naive Decision (Experiment Only) | Correct Decision (After Hidden Fields) | Bottleneck |
| :--- | :--- | :--- | :--- |
| **Task 1** (Low $K_{\text{evap}}$) | Cut smaller, heat product. | Blow harder, decrease air RH. | **Surface-limited** |
| **Task 2** (Low $D_{\text{bulk}}$) | Blow harder / increase fan speed. | Cut smaller pieces, apply volumetric heating. | **Bulk-diffusion-limited** |
| **Task 5** (Crust mode) | Keep air temperature extremely high. | Lower initial temperature / stepwise drying. | **Bulk-diffusion-limited (crust)** |
