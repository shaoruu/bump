import { createCanvas, registerFont } from "canvas";
import { writeFileSync, mkdirSync } from "fs";
import { join } from "path";

const SIZE = 1024;
const OUT = "icon_options";
const CX = SIZE / 2;
const CY = SIZE / 2;

mkdirSync(OUT, { recursive: true });

registerFont("/Users/shaoruu/Library/Fonts/BerkeleyMono-Regular.otf", {
  family: "BerkeleyMono", weight: "400",
});
registerFont("/Users/shaoruu/Library/Fonts/BerkeleyMono-Bold.otf", {
  family: "BerkeleyMono", weight: "700",
});

const F = "BerkeleyMono";

function rr(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

function icon(name, inset, radius) {
  const iconSize = SIZE - 2 * inset;

  const canvas = createCanvas(SIZE, SIZE);
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, SIZE, SIZE);
  ctx.save();
  rr(ctx, inset, inset, iconSize, iconSize, radius);
  ctx.clip();

  ctx.fillStyle = "rgb(252,250,245)";
  ctx.fillRect(inset, inset, iconSize, iconSize);

  const textX = inset + 55;
  const textY = inset + 175;
  const gx = textX + 200 * 1.2;
  const gy = textY;
  const grad = ctx.createRadialGradient(gx, gy, 0, gx, gy, 300);
  const stops = 24;
  for (let i = 0; i <= stops; i++) {
    const t = i / stops;
    const alpha = 0.06 * Math.pow(1 - t, 2.2);
    grad.addColorStop(t, `rgba(0,160,140,${alpha.toFixed(4)})`);
  }
  ctx.fillStyle = grad;
  ctx.fillRect(inset, inset, iconSize, iconSize);

  ctx.font = `700 200px ${F}`;
  ctx.textBaseline = "middle";
  ctx.fillStyle = "rgb(14,14,14)";
  ctx.fillText("bump", textX, textY);

  ctx.restore();
  rr(ctx, inset, inset, iconSize, iconSize, radius);
  ctx.strokeStyle = "rgba(0,0,0,0.06)";
  ctx.lineWidth = 2;
  ctx.stroke();

  writeFileSync(join(OUT, `${name}.png`), canvas.toBuffer("image/png"));
  console.log(`  ${name} (inset=${inset}, radius=${radius}, shape=${iconSize})`);
}

icon("final", 102, 170);

console.log("\nDone");
