import { indexedDBStorage } from '@/lib/indexedDBStorage';
import { supabase } from '@/integrations/supabase/client';
import { getSession } from '@/lib/session';
import { FloorPlan, Project } from '@/types/project';
import {
  SignBuilding, SignDestination, SignFloor, SignFloorPlanLink, SignLabelLine,
  SignPlanData, SignPlanMarker, SignPosition, SignPositionType, SignQrToken,
  SignType, SignArrowDirection, SignPositionStatus, emptySignPlanData,
} from '@/types/signPlan';
import { saveSignPlan } from '@/lib/signPlanStorage';

/**
 * Seed-Daten "Musterklinik".
 *
 * Ohne realistische Menge laesst sich nicht beurteilen, ob Filter, Plan und
 * Listen taugen – deshalb legt dieser Generator ein vollstaendiges Testprojekt
 * an: zwei Gebaeude, vier Geschosse, sechs Schildtypen, 40 Positionen,
 * zehn Ziele und zwei Grundrisse.
 *
 * Abweichung vom Auftrag: die beiden Grundrisse werden hier auf einem Canvas
 * GEZEICHNET statt als PDF mitgeliefert. Die App speichert hochgeladene PDFs
 * ohnehin als gerenderte Bildseiten (siehe FloorPlanUpload) – das Ergebnis ist
 * also identisch, aber ohne Binaerdatei im Repo.
 */

const now = () => new Date().toISOString();

function record<T extends object>(projectId: string, fields: T) {
  const stamp = now();
  return { id: crypto.randomUUID(), projectId, createdAt: stamp, updatedAt: stamp, deletedAt: null, ...fields };
}

// ─── Grundrisse zeichnen ────────────────────────────────────────────────────

interface Room {
  x: number; y: number; w: number; h: number; label: string;
}

const WIDTH = 1400;
const HEIGHT = 1000;

/** Schematischer Grundriss: Aussenwand, Mittelflur, beschriftete Raeume. */
function drawFloorPlan(title: string, rooms: Room[]): string {
  const canvas = document.createElement('canvas');
  canvas.width = WIDTH;
  canvas.height = HEIGHT;
  const ctx = canvas.getContext('2d');
  if (!ctx) return '';

  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, WIDTH, HEIGHT);

  // Aussenwand
  ctx.strokeStyle = '#111827';
  ctx.lineWidth = 8;
  ctx.strokeRect(60, 100, WIDTH - 120, HEIGHT - 180);

  // Flur als helle Flaeche in der Mitte
  ctx.fillStyle = '#f3f4f6';
  ctx.fillRect(60, 430, WIDTH - 120, 160);

  ctx.strokeStyle = '#374151';
  ctx.lineWidth = 3;
  ctx.font = '20px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  for (const room of rooms) {
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(room.x, room.y, room.w, room.h);
    ctx.strokeRect(room.x, room.y, room.w, room.h);
    ctx.fillStyle = '#374151';
    ctx.fillText(room.label, room.x + room.w / 2, room.y + room.h / 2);
  }

  ctx.fillStyle = '#9ca3af';
  ctx.font = '22px sans-serif';
  ctx.fillText('F L U R', WIDTH / 2, 510);

  ctx.fillStyle = '#111827';
  ctx.font = 'bold 34px sans-serif';
  ctx.textAlign = 'left';
  ctx.fillText(title, 60, 55);
  ctx.font = '18px sans-serif';
  ctx.fillStyle = '#6b7280';
  ctx.fillText('Musterklinik – schematischer Grundriss (Testdaten)', 60, HEIGHT - 40);

  return canvas.toDataURL('image/png');
}

function groundFloorRooms(): Room[] {
  const labels = ['Aufnahme', 'Notaufnahme', 'Labor', 'Radiologie', 'Wartezone', 'Cafeteria'];
  const bottom = ['Chirurgie', 'Innere Medizin', 'Kapelle', 'Verwaltung', 'Technik', 'WC'];
  const rooms: Room[] = [];
  labels.forEach((label, index) => {
    rooms.push({ x: 90 + index * 205, y: 130, w: 190, h: 280, label });
  });
  bottom.forEach((label, index) => {
    rooms.push({ x: 90 + index * 205, y: 610, w: 190, h: 190, label });
  });
  return rooms;
}

function firstFloorRooms(): Room[] {
  const top = ['Station 1A', 'Station 1B', 'Physiotherapie', 'Endoskopie', 'Sozialdienst'];
  const bottom = ['Station 1C', 'Aufenthalt', 'Schwesternzimmer', 'Arztzimmer', 'Lager'];
  const rooms: Room[] = [];
  top.forEach((label, index) => {
    rooms.push({ x: 90 + index * 248, y: 130, w: 228, h: 280, label });
  });
  bottom.forEach((label, index) => {
    rooms.push({ x: 90 + index * 248, y: 610, w: 228, h: 190, label });
  });
  return rooms;
}

// ─── Stammdaten ─────────────────────────────────────────────────────────────

const TYPE_SEED = [
  {
    code: 'LS-01', name: 'Deckenhaenger Wegweiser', widthMm: 1200, heightMm: 300,
    material: 'Alu-Verbundplatte 4 mm, beidseitig bedruckt', mounting: 'Abgehaengt an Deckenabhaengung',
    unitPrice: 289, color: '#2563eb',
    descriptionNeutral: 'Doppelseitiger Deckenwegweiser, Traegerplatte aus Aluminium-Verbund, '
      + 'beidseitig mit UV-bestaendigem Digitaldruck, inklusive Deckenabhaengung aus Edelstahlseil.',
  },
  {
    code: 'LS-02', name: 'Wandwegweiser', widthMm: 800, heightMm: 200,
    material: 'Aluminium eloxiert, 3 mm', mounting: 'Wandmontage mit Abstandhaltern',
    unitPrice: 149, color: '#059669',
    descriptionNeutral: 'Einseitiger Wandwegweiser aus eloxiertem Aluminium mit auswechselbarem '
      + 'Textschild, Montage mit Abstandhaltern aus Edelstahl.',
  },
  {
    code: 'LS-03', name: 'Tuerschild taktil', widthMm: 200, heightMm: 150,
    material: 'Acrylglas mit taktiler Schrift und Braille', mounting: 'Klebemontage',
    unitPrice: 79.5, color: '#d97706',
    descriptionNeutral: 'Tuerschild mit erhabener Profilschrift und Brailleschrift nach DIN 32986, '
      + 'Traeger aus Acrylglas, Klebemontage auf der Wand neben dem Tuergriff.',
  },
  {
    code: 'LS-04', name: 'Raumnummernschild', widthMm: 100, heightMm: 100,
    material: 'Aluminium eloxiert, 2 mm', mounting: 'Klebemontage',
    unitPrice: 24.9, color: '#7c3aed',
    descriptionNeutral: 'Kleines Raumnummernschild aus eloxiertem Aluminium mit Digitaldruck, '
      + 'Ecken gerundet, Klebemontage.',
  },
  {
    code: 'LS-05', name: 'Standstele Aussenbereich', widthMm: 500, heightMm: 1800,
    material: 'Aluminium-Profilrahmen, pulverbeschichtet', mounting: 'Bodenmontage im Fundament',
    unitPrice: 1450, color: '#dc2626',
    descriptionNeutral: 'Freistehende Informationsstele mit Aluminium-Profilrahmen, '
      + 'pulverbeschichtet, auswechselbare Einlegeschilder, Bodenmontage im Betonfundament.',
  },
  {
    code: 'LS-06', name: 'Fluchtwegkennzeichnung', widthMm: 200, heightMm: 100,
    material: 'Kunststoff, langnachleuchtend', mounting: 'Klebemontage',
    unitPrice: 18.9, color: '#0891b2',
    descriptionNeutral: 'Rettungszeichen nach ASR A1.3, langnachleuchtende Folie auf '
      + 'Kunststofftraeger, Klebemontage.',
  },
];

const DESTINATION_SEED: [string, string][] = [
  ['Notaufnahme', 'Emergency'],
  ['Radiologie', 'Radiology'],
  ['Innere Medizin', 'Internal Medicine'],
  ['Chirurgie', 'Surgery'],
  ['Labor', 'Laboratory'],
  ['Aufnahme', 'Admissions'],
  ['Cafeteria', 'Cafeteria'],
  ['Kapelle', 'Chapel'],
  ['Physiotherapie', 'Physiotherapy'],
  ['Verwaltung', 'Administration'],
];

/** Kleiner deterministischer Zufall, damit jeder Seed-Lauf gleich aussieht. */
function makeRandom(seed: number) {
  let state = seed;
  return () => {
    state = (state * 1664525 + 1013904223) % 4294967296;
    return state / 4294967296;
  };
}

// ─── Aufbau ─────────────────────────────────────────────────────────────────

export interface SeedResult {
  projectId: string;
  projectNumber: string;
  positionCount: number;
}

export async function createMusterklinikProject(): Promise<SeedResult> {
  const session = getSession();
  const projectId = crypto.randomUUID();
  const employeeId = session?.role === 'employee' ? session.id : null;
  const projectNumber = `Musterklinik ${new Date().toISOString().slice(0, 10)}`;

  const floorPlans: FloorPlan[] = [
    {
      id: crypto.randomUUID(),
      name: 'Haus A – Erdgeschoss',
      imageData: drawFloorPlan('Haus A – Erdgeschoss', groundFloorRooms()),
      markers: [],
      pageIndex: 0,
      createdAt: new Date(),
    },
    {
      id: crypto.randomUUID(),
      name: 'Haus A – 1. Obergeschoss',
      imageData: drawFloorPlan('Haus A – 1. Obergeschoss', firstFloorRooms()),
      markers: [],
      pageIndex: 1,
      createdAt: new Date(),
    },
  ];

  const project: Project = {
    id: projectId,
    projectNumber,
    projectType: 'aufmass_mit_plan',
    customerName: 'Musterklinik gGmbH (Testdaten)',
    employeeId,
    accessEmployeeIds: employeeId ? [employeeId] : [],
    locations: [],
    floorPlans,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  await indexedDBStorage.saveProject(project);

  // Bewusst best-effort: das Testprojekt muss auch ohne Netz entstehen.
  try {
    await supabase.from('projects').upsert({
      id: projectId,
      project_number: projectNumber,
      project_type: 'aufmass_mit_plan',
      customer_name: project.customerName || null,
      user_id: employeeId || projectId,
      employee_id: employeeId,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      // Die generierten Supabase-Typen kennen customer_name auf projects noch
      // nicht – derselbe Cast steht so schon in NewProject.tsx.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any, { onConflict: 'id' });
  } catch (error) {
    console.warn('Seed: Projekt-Upsert nach Supabase fehlgeschlagen (nicht kritisch)', error);
  }

  const data: SignPlanData = emptySignPlanData();

  const houseA = record(projectId, { name: 'Haus A – Hauptgebaeude', sortOrder: 0 }) as SignBuilding;
  const houseB = record(projectId, { name: 'Haus B – Ambulanz', sortOrder: 10 }) as SignBuilding;
  data.buildings.push(houseA, houseB);

  const floorUg = record(projectId, { buildingId: houseA.id, name: 'Untergeschoss', code: 'UG', level: -1 }) as SignFloor;
  const floorEg = record(projectId, { buildingId: houseA.id, name: 'Erdgeschoss', code: 'EG', level: 0 }) as SignFloor;
  const floorOg = record(projectId, { buildingId: houseA.id, name: '1. Obergeschoss', code: '1OG', level: 1 }) as SignFloor;
  const floorBEg = record(projectId, { buildingId: houseB.id, name: 'Erdgeschoss', code: 'B-EG', level: 0 }) as SignFloor;
  data.floors.push(floorUg, floorEg, floorOg, floorBEg);

  data.floorPlanLinks.push(
    record(projectId, { floorPlanId: floorPlans[0].id, floorId: floorEg.id }) as SignFloorPlanLink,
    record(projectId, { floorPlanId: floorPlans[1].id, floorId: floorOg.id }) as SignFloorPlanLink,
  );

  const types = TYPE_SEED.map((seed, index) => record(projectId, {
    ...seed,
    manufacturer: '',
    articleNumber: '',
    sortOrder: index * 10,
  }) as SignType);
  data.types.push(...types);
  const byCode = (code: string) => types.find((type) => type.code === code)!;

  const destinations = DESTINATION_SEED.map(([name, nameSecondary], index) =>
    record(projectId, { name, nameSecondary, sortOrder: index * 10 }) as SignDestination);
  data.destinations.push(...destinations);

  // 40 Positionen: 16 im EG und 12 im 1.OG (beide mit Plan und Markern),
  // 6 im UG und 6 in Haus B ohne Plan.
  const layout: { floor: SignFloor; count: number; planId: string | null }[] = [
    { floor: floorEg, count: 16, planId: floorPlans[0].id },
    { floor: floorOg, count: 12, planId: floorPlans[1].id },
    { floor: floorUg, count: 6, planId: null },
    { floor: floorBEg, count: 6, planId: null },
  ];

  const random = makeRandom(20260907);
  const statuses: SignPositionStatus[] = ['geplant', 'geplant', 'geplant', 'freigegeben', 'bestellt'];
  const arrows: SignArrowDirection[] = ['left', 'right', 'up', 'up_left', 'up_right'];
  const counters = new Map<string, number>();
  let positionCount = 0;

  for (const { floor, count, planId } of layout) {
    for (let index = 0; index < count; index++) {
      const sequence = (counters.get(floor.code) ?? 0) + 1;
      counters.set(floor.code, sequence);

      // Grob jede dritte Position ist ein Wegweiser, der Rest Tuerbeschilderung.
      const isWayfinder = index % 3 === 0;
      const isCeiling = isWayfinder && index % 6 === 0;
      const destination = destinations[(index + count) % destinations.length];

      const position = record(projectId, {
        floorId: floor.id,
        positionNumber: `${floor.code}-${String(sequence).padStart(3, '0')}`,
        title: isWayfinder ? `Wegweiser Flur ${index + 1}` : `Tuerschild ${destination.name}`,
        status: statuses[Math.floor(random() * statuses.length)],
        // Eine einzige Position als Nachtrag, damit die Stueckliste die
        // getrennte Ausweisung zeigt.
        isAddition: floor.id === floorEg.id && index === 15,
        note: '',
        locationId: null,
      }) as SignPosition;
      data.positions.push(position);
      positionCount++;

      data.qrTokens.push(record(projectId, {
        positionId: position.id,
        token: crypto.randomUUID().replace(/-/g, '').slice(0, 16),
      }) as SignQrToken);

      // Typzuordnung – an jeder vierten Position haengen zwei Schilder.
      const primary = isWayfinder ? (isCeiling ? byCode('LS-01') : byCode('LS-02')) : byCode('LS-03');
      const links: SignPositionType[] = [
        record(projectId, { positionId: position.id, signTypeId: primary.id, quantity: isCeiling ? 1 : 1 }) as SignPositionType,
      ];
      if (index % 4 === 1) {
        links.push(record(projectId, {
          positionId: position.id,
          signTypeId: byCode('LS-04').id,
          quantity: 2,
        }) as SignPositionType);
      }
      if (index % 7 === 3) {
        links.push(record(projectId, {
          positionId: position.id,
          signTypeId: byCode('LS-06').id,
          quantity: 1,
        }) as SignPositionType);
      }
      data.positionTypes.push(...links);

      // Beschriftungszeilen: Wegweiser bekommen drei Ziele mit Pfeil,
      // Tuerschilder eine Zeile, taktil und Braille gekennzeichnet.
      const primaryLink = links[0];
      if (isWayfinder) {
        for (let line = 0; line < 3; line++) {
          const target = destinations[(index + line * 3) % destinations.length];
          data.labelLines.push(record(projectId, {
            positionTypeId: primaryLink.id,
            sortOrder: line * 10,
            destinationId: target.id,
            textOverride: '',
            textSecondary: '',
            arrow: arrows[(index + line) % arrows.length],
            pictogram: '',
            isTactile: false,
            isBraille: false,
          }) as SignLabelLine);
        }
      } else {
        data.labelLines.push(record(projectId, {
          positionTypeId: primaryLink.id,
          sortOrder: 0,
          destinationId: destination.id,
          textOverride: '',
          textSecondary: '',
          arrow: 'none',
          pictogram: '',
          isTactile: true,
          isBraille: true,
        }) as SignLabelLine);
      }

      // Marker: Tuerschilder an den Raeumen oben und unten, Wegweiser in den
      // Flur. Jede Position bekommt einen eigenen Rasterplatz – laegen die
      // Marker uebereinander, liesse sich im Prototyp nicht pruefen, ob
      // Antippen und Verschieben taugen.
      if (planId) {
        const columns = 8;
        const column = index % columns;
        const band = Math.floor(index / columns);
        const x = 0.07 + column * 0.115 + band * 0.032;
        const y = isWayfinder
          ? 0.47 + band * 0.055
          : (band % 2 === 0 ? 0.32 : 0.64) + (column % 2) * 0.045;
        data.markers.push(record(projectId, {
          floorPlanId: planId,
          positionId: position.id,
          x: Math.min(0.97, Math.max(0.03, Number(x.toFixed(4)))),
          y: Math.min(0.97, Math.max(0.03, Number(y.toFixed(4)))),
        }) as SignPlanMarker);
      }
    }
  }

  await saveSignPlan(projectId, data);

  return { projectId, projectNumber, positionCount };
}
