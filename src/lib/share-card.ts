export type ShareCardInput = {
  leagueName: string;
  week: number;
  myTeam: string;
  oppTeam: string;
  myScore: number;
  oppScore: number;
  winProbability: number | null;
  color: string;
  appName?: string;
};

const SIZE = 1080;

function fitText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number) {
  if (ctx.measureText(text).width <= maxWidth) return text;
  let out = text;
  while (out.length > 1 && ctx.measureText(`${out}…`).width > maxWidth) out = out.slice(0, -1);
  return `${out}…`;
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
  ctx.fill();
}

export function drawShareCard(canvas: HTMLCanvasElement, input: ShareCardInput) {
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas is unavailable on this device.");
  canvas.width = SIZE;
  canvas.height = SIZE;

  const body = '"Inter Tight", system-ui, sans-serif';
  const nums = '"Barlow Condensed", "Inter Tight", system-ui, sans-serif';
  const appName = input.appName ?? "Gridiron Edge";
  const win = input.winProbability === null ? null : Math.max(0, Math.min(1, input.winProbability));

  ctx.fillStyle = "#1c1c1c";
  ctx.fillRect(0, 0, SIZE, SIZE);
  ctx.fillStyle = "#212121";
  roundRect(ctx, 60, 60, SIZE - 120, SIZE - 120, 36);

  // league colour stripe
  ctx.fillStyle = input.color;
  roundRect(ctx, 60, 60, 14, SIZE - 120, 7);

  // header
  ctx.textBaseline = "alphabetic";
  ctx.fillStyle = input.color;
  ctx.font = `600 40px ${body}`;
  ctx.textAlign = "left";
  ctx.fillText(fitText(ctx, input.leagueName, 700), 120, 180);

  ctx.fillStyle = "#8f8f8f";
  ctx.font = `500 34px ${body}`;
  ctx.textAlign = "right";
  ctx.fillText(`Week ${input.week}`, SIZE - 120, 180);

  // team names
  const leftX = 120;
  const rightX = SIZE - 120;
  ctx.font = `500 34px ${body}`;
  ctx.fillStyle = "#a6a6a6";
  ctx.textAlign = "left";
  ctx.fillText(fitText(ctx, input.myTeam, 380), leftX, 400);
  ctx.textAlign = "right";
  ctx.fillText(fitText(ctx, input.oppTeam, 380), rightX, 400);

  // scores
  ctx.fillStyle = "#f5f5f5";
  ctx.font = `700 170px ${nums}`;
  ctx.textAlign = "left";
  ctx.fillText(input.myScore.toFixed(1), leftX, 560);
  ctx.textAlign = "right";
  ctx.fillText(input.oppScore.toFixed(1), rightX, 560);

  // win probability bar
  const barX = 120;
  const barW = SIZE - 240;
  const barY = 680;
  ctx.fillStyle = "#333333";
  roundRect(ctx, barX, barY, barW, 22, 11);
  if (win !== null && win > 0) {
    ctx.fillStyle = input.color;
    roundRect(ctx, barX, barY, Math.max(22, barW * win), 22, 11);
  }

  ctx.fillStyle = "#a6a6a6";
  ctx.font = `500 34px ${body}`;
  ctx.textAlign = "left";
  ctx.fillText(win === null ? "Win chance —" : `${Math.round(win * 100)}% win chance`, barX, barY + 80);
  ctx.textAlign = "right";
  ctx.fillText(input.myScore >= input.oppScore ? "Leading" : "Trailing", barX + barW, barY + 80);

  // app name, small in the corner
  ctx.fillStyle = "#6e6e6e";
  ctx.font = `500 26px ${body}`;
  ctx.textAlign = "left";
  ctx.fillText(appName, 120, SIZE - 110);
}

async function toBlob(canvas: HTMLCanvasElement) {
  return new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
}

function slug(text: string) {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "matchup";
}

/** Renders the card offscreen and shares it, falling back to a download. */
export async function shareMatchupCard(input: ShareCardInput): Promise<"shared" | "downloaded"> {
  if (document.fonts?.ready) await document.fonts.ready.catch(() => undefined);

  const canvas = document.createElement("canvas");
  drawShareCard(canvas, input);

  const blob = await toBlob(canvas);
  if (!blob) throw new Error("Could not create the image.");

  const fileName = `${slug(input.leagueName)}-week-${input.week}.png`;
  const file = new File([blob], fileName, { type: "image/png" });
  const nav = navigator as Navigator & { canShare?: (data: ShareData) => boolean };

  if (nav.share && nav.canShare?.({ files: [file] })) {
    try {
      await nav.share({ files: [file], title: `${input.leagueName} · Week ${input.week}` });
      return "shared";
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return "shared";
    }
  }

  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
  return "downloaded";
}
