// Shared helpers for Equation Playground pages

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

// Helper to draw clean plot legend with optional start X (lx) and custom spacing
function drawLegend(items, lx = 60, spacing = 115) {
    const ly = canvas.height - 45;
    ctx.textAlign = "left";
    ctx.font = "9px Outfit";

    items.forEach((item, idx) => {
        const ix = lx + idx * spacing;

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
