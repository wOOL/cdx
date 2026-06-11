/** Implant catalog. Dimensions in mm. */

export interface ImplantLine {
	manufacturer: string;
	line: string;
	diameters: number[];
	lengths: number[];
	/** apex taper as fraction of diameter (0 = cylindrical) */
	taper: number;
}

export const IMPLANT_LIBRARY: ImplantLine[] = [
	{
		manufacturer: 'Generic',
		line: 'Cylindrical',
		diameters: [3.0, 3.3, 3.75, 4.1, 4.8, 5.0, 5.5],
		lengths: [6, 8, 10, 12, 14, 16],
		taper: 0
	},
	{
		manufacturer: 'Generic',
		line: 'Tapered',
		diameters: [3.3, 3.75, 4.1, 4.8, 5.0],
		lengths: [8, 10, 11.5, 13, 15],
		taper: 0.35
	},
	{
		manufacturer: 'Straumann',
		line: 'BLT (Bone Level Tapered)',
		diameters: [2.9, 3.3, 4.1, 4.8],
		lengths: [8, 10, 12, 14, 16],
		taper: 0.3
	},
	{
		manufacturer: 'Straumann',
		line: 'BLX',
		diameters: [3.5, 3.75, 4.0, 4.5, 5.0, 5.5],
		lengths: [8, 10, 12, 14, 16, 18],
		taper: 0.4
	},
	{
		manufacturer: 'Nobel Biocare',
		line: 'NobelActive',
		diameters: [3.0, 3.5, 4.3, 5.0],
		lengths: [8.5, 10, 11.5, 13, 15, 18],
		taper: 0.45
	},
	{
		manufacturer: 'Dentsply Sirona',
		line: 'Astra Tech EV',
		diameters: [3.0, 3.6, 4.2, 4.8, 5.4],
		lengths: [6, 8, 9, 11, 13, 15],
		taper: 0.15
	},
	{
		manufacturer: 'Zimmer Biomet',
		line: 'TSV',
		diameters: [3.7, 4.1, 4.7, 6.0],
		lengths: [8, 10, 11.5, 13, 16],
		taper: 0.25
	}
];

/** FDI two-digit notation, upper right → upper left → lower left → lower right */
export const FDI_UPPER = [18, 17, 16, 15, 14, 13, 12, 11, 21, 22, 23, 24, 25, 26, 27, 28];
export const FDI_LOWER = [48, 47, 46, 45, 44, 43, 42, 41, 31, 32, 33, 34, 35, 36, 37, 38];

export type Notation = 'fdi' | 'universal';

/** Universal (US) numbering: 1–16 across the maxilla (right→left), 17–32 across the mandible (left→right). */
const FDI_TO_UNIVERSAL = new Map<number, number>([
	...FDI_UPPER.map((fdi, i) => [fdi, i + 1] as [number, number]),
	...[38, 37, 36, 35, 34, 33, 32, 31, 41, 42, 43, 44, 45, 46, 47, 48].map(
		(fdi, i) => [fdi, i + 17] as [number, number]
	)
]);

/** Display label for a tooth position stored in FDI. */
export function toothLabel(fdi: string | number, notation: Notation): string {
	const n = Number(fdi);
	if (!n) return String(fdi || '—');
	if (notation === 'universal') return String(FDI_TO_UNIVERSAL.get(n) ?? fdi);
	return String(fdi);
}

const IMPLANT_COLORS = [
	'#3aa757',
	'#2f9ec7',
	'#f08a24',
	'#b06ad4',
	'#d4566a',
	'#46b8a0',
	'#c7b22f',
	'#7a8cf0'
];

export function implantColor(index: number): string {
	return IMPLANT_COLORS[index % IMPLANT_COLORS.length];
}

export function articleName(line: ImplantLine, d: number, l: number): string {
	return `${line.line} ⌀${d.toFixed(1)} × ${l.toFixed(1)} mm`;
}

// ---------------- sleeves ----------------

export interface SleeveSystem {
	name: string;
	/** outer diameter options (mm) */
	diameters: number[];
	/** sleeve height options (mm) */
	heights: number[];
	/** shoulder-to-sleeve-bottom offset options (mm), coDiagnostiX H-positions */
	offsets: number[];
	wall: number;
}

export const SLEEVE_SYSTEMS: SleeveSystem[] = [
	{ name: 'Straumann T-Sleeve', diameters: [5.0, 6.0], heights: [5.0], offsets: [2, 4, 6], wall: 0.55 },
	{ name: 'Generic sleeve', diameters: [4.0, 5.0, 6.0], heights: [4.0, 5.0, 6.0], offsets: [2, 3, 4, 5, 6, 7, 8], wall: 0.5 },
	{ name: 'Pilot drill sleeve', diameters: [2.8, 3.5], heights: [4.0, 6.0], offsets: [2, 4, 6, 8], wall: 0.4 }
];

export interface SleeveSpec {
	system: string;
	diameter: number;
	height: number;
	offset: number;
}

export function defaultSleeve(): SleeveSpec {
	const s = SLEEVE_SYSTEMS[1];
	return { system: s.name, diameter: 5.0, height: 5.0, offset: 4 };
}

/** total drill length from sleeve top to implant apex */
export function drillLength(implantLength: number, sleeve: SleeveSpec): number {
	return implantLength + sleeve.offset + sleeve.height;
}

// ---------------- abutments ----------------

export interface AbutmentSpec {
	type: 'straight' | 'angled';
	/** angulation in degrees (0 for straight) */
	angle: number;
	/** height above the implant shoulder, mm */
	height: number;
	/** prosthetic platform diameter, mm */
	diameter: number;
}

export const ABUTMENT_PRESETS: { name: string; spec: AbutmentSpec | null }[] = [
	{ name: 'None', spec: null },
	{ name: 'Straight 4 mm', spec: { type: 'straight', angle: 0, height: 4, diameter: 4.5 } },
	{ name: 'Straight 5.5 mm', spec: { type: 'straight', angle: 0, height: 5.5, diameter: 4.5 } },
	{ name: 'Angled 17° / 4 mm', spec: { type: 'angled', angle: 17, height: 4, diameter: 4.5 } },
	{ name: 'Angled 30° / 4 mm', spec: { type: 'angled', angle: 30, height: 4, diameter: 4.5 } }
];

export function abutmentLabel(a: AbutmentSpec | null): string {
	if (!a) return 'None';
	return a.type === 'straight'
		? `Straight ${a.height.toFixed(1)} mm`
		: `Angled ${a.angle.toFixed(0)}° / ${a.height.toFixed(1)} mm`;
}

// ---------------- drill protocols ----------------

export interface DrillStep {
	name: string;
	/** drill diameter (mm) */
	diameter: number;
	/** handle color code printed in the protocol */
	color: string;
	/** only used when the implant diameter is at least this value */
	minImplantDiameter?: number;
}

/**
 * Ordered drill sequence per sleeve system. Steps whose minImplantDiameter exceeds
 * the planned implant are skipped; the drill stops at the guided length.
 */
export const DRILL_PROTOCOLS: Record<string, DrillStep[]> = {
	'Straumann T-Sleeve': [
		{ name: 'Needle drill', diameter: 1.6, color: 'gray' },
		{ name: 'Pilot drill', diameter: 2.2, color: 'yellow' },
		{ name: 'Drill ⌀2.8', diameter: 2.8, color: 'red', minImplantDiameter: 3.3 },
		{ name: 'Drill ⌀3.5', diameter: 3.5, color: 'blue', minImplantDiameter: 4.1 },
		{ name: 'Drill ⌀4.2', diameter: 4.2, color: 'green', minImplantDiameter: 4.8 }
	],
	'Generic sleeve': [
		{ name: 'Pilot drill', diameter: 2.0, color: 'yellow' },
		{ name: 'Twist drill ⌀2.8', diameter: 2.8, color: 'red', minImplantDiameter: 3.3 },
		{ name: 'Twist drill ⌀3.4', diameter: 3.4, color: 'blue', minImplantDiameter: 4.0 },
		{ name: 'Twist drill ⌀4.1', diameter: 4.1, color: 'green', minImplantDiameter: 4.8 },
		{ name: 'Twist drill ⌀4.7', diameter: 4.7, color: 'black', minImplantDiameter: 5.4 }
	],
	'Pilot drill sleeve': [{ name: 'Pilot drill', diameter: 2.0, color: 'yellow' }]
};

export function drillSequence(sleeve: SleeveSpec, implantDiameter: number): DrillStep[] {
	const steps = DRILL_PROTOCOLS[sleeve.system] ?? DRILL_PROTOCOLS['Generic sleeve'];
	return steps.filter(
		(s) => s.minImplantDiameter == null || implantDiameter >= s.minImplantDiameter
	);
}
