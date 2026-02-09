import { Group, Line, IText } from "fabric";

export function createMeasurementGroup(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  label: string,
  color: string = "#ef4444",
) {
  const strokeWidth = 3;
  const capLength = 14; // length of end caps in px
  const textOffset = 20; // distance of label from the line along the perpendicular

  // main measurement line
  const line = new Line([x1, y1, x2, y2], {
    stroke: color,
    strokeWidth,
    strokeLineCap: "round",
    selectable: false,
  });

  // perpendicular unit vector
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len = Math.hypot(dx, dy) || 1;
  const px = -dy / len;
  const py = dx / len;
  const half = capLength / 2;

  // end caps
  const cap1 = new Line([x1 - px * half, y1 - py * half, x1 + px * half, y1 + py * half], {
    stroke: color,
    strokeWidth,
    selectable: false,
  });
  const cap2 = new Line([x2 - px * half, y2 - py * half, x2 + px * half, y2 + py * half], {
    stroke: color,
    strokeWidth,
    selectable: false,
  });

  // centered label positioned below the line, rotated parallel to it
  const midX = (x1 + x2) / 2;
  const midY = (y1 + y2) / 2;

  // Calculate angle in degrees
  let angle = Math.atan2(dy, dx) * (180 / Math.PI);
  
  // Determine if we need to flip to keep text readable
  let flipped = false;
  if (angle > 90) { angle -= 180; flipped = true; }
  if (angle < -90) { angle += 180; flipped = true; }

  // Perpendicular direction: always push text to the "below" side
  // When flipped, the perpendicular must be inverted to stay on the same visual side
  const sign = flipped ? -1 : 1;
  const offsetX = sign * px * textOffset;
  const offsetY = sign * py * textOffset;

  const text = new IText(label, {
    left: midX + offsetX,
    top: midY + offsetY,
    originX: "center",
    originY: "top",
    angle: angle,
    fill: color,
    fontSize: 22,
    fontFamily: "Arial",
    fontWeight: "bold",
    backgroundColor: "rgba(255, 255, 255, 0.9)",
    padding: 4,
    selectable: false,
    editable: false,
  });

  const group = new Group([line, cap1, cap2, text], {
    selectable: true,
    subTargetCheck: false,
    objectCaching: true,
  });

  // tag for future identification
  // @ts-ignore
  group.data = { type: "measurement" };

  return group;
}
