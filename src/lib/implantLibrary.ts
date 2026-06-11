/** Implant catalog. Dimensions in mm. */

export type LineKind = 'implant' | 'pin' | 'endoDrill';

export interface ImplantLine {
	manufacturer: string;
	line: string;
	diameters: number[];
	lengths: number[];
	/** apex taper as fraction of diameter (0 = cylindrical) */
	taper: number;
	/** item category; absent = 'implant' */
	kind?: LineKind;
	/** availability region; absent = 'global' */
	region?: string;
	/** technical note shown on hover (cogwheel badge) */
	techInfo?: string;
	/** manufacturer documentation link */
	docUrl?: string;
	/** article-number prefix, searchable */
	article?: string;
	/** line originates from an uploaded catalog (set by mergeCatalog) */
	custom?: boolean;
	/** flagged outdated by catalog admin (catalog lines only) */
	outdated?: boolean;
}

/** known availability regions, in display order */
export const REGIONS = ['global', 'EU', 'US'] as const;

/** stable identity of a line across catalogs/favorites */
export function lineKey(l: Pick<ImplantLine, 'manufacturer' | 'line'>): string {
	return `${l.manufacturer}/${l.line}`;
}

export const IMPLANT_LIBRARY: ImplantLine[] = [
	{
		manufacturer: 'Generic',
		line: 'Cylindrical',
		diameters: [3.0, 3.3, 3.75, 4.1, 4.8, 5.0, 5.5],
		lengths: [6, 8, 10, 12, 14, 16],
		taper: 0,
		region: 'global',
		article: 'GEN-CYL',
		techInfo: 'Parallel-walled body, machined collar; universal drill protocol.'
	},
	{
		manufacturer: 'Generic',
		line: 'Tapered',
		diameters: [3.3, 3.75, 4.1, 4.8, 5.0],
		lengths: [8, 10, 11.5, 13, 15],
		taper: 0.35,
		region: 'global',
		article: 'GEN-TAP',
		techInfo: 'Tapered body for under-prepared osteotomies; higher primary stability.'
	},
	{
		manufacturer: 'Straumann',
		line: 'BLT (Bone Level Tapered)',
		diameters: [2.9, 3.3, 4.1, 4.8],
		lengths: [8, 10, 12, 14, 16],
		taper: 0.3,
		region: 'global',
		article: 'STM-BLT',
		techInfo: 'Bone Level Tapered, Roxolid material, SLActive surface; CrossFit connection.',
		docUrl: 'https://dental.straumann.com/implants/blt'
	},
	{
		manufacturer: 'Straumann',
		line: 'BLX',
		diameters: [3.5, 3.75, 4.0, 4.5, 5.0, 5.5],
		lengths: [8, 10, 12, 14, 16, 18],
		taper: 0.4,
		region: 'global',
		article: 'STM-BLX',
		techInfo: 'Fully tapered, dynamic bone management; TorcFit connection; immediate protocols.',
		docUrl: 'https://dental.straumann.com/implants/blx'
	},
	{
		manufacturer: 'Nobel Biocare',
		line: 'NobelActive',
		diameters: [3.0, 3.5, 4.3, 5.0],
		lengths: [8.5, 10, 11.5, 13, 15, 18],
		taper: 0.45,
		region: 'global',
		article: 'NB-ACT',
		techInfo: 'Expanding-taper body, condensing thread; conical connection with platform shift.',
		docUrl: 'https://www.nobelbiocare.com/nobelactive'
	},
	{
		manufacturer: 'Dentsply Sirona',
		line: 'Astra Tech EV',
		diameters: [3.0, 3.6, 4.2, 4.8, 5.4],
		lengths: [6, 8, 9, 11, 13, 15],
		taper: 0.15,
		region: 'EU',
		article: 'DS-AEV',
		techInfo: 'OsseoSpeed EV surface; one-position-only index; EU distribution catalog.',
		docUrl: 'https://www.dentsplysirona.com/astra-tech-ev'
	},
	{
		manufacturer: 'Zimmer Biomet',
		line: 'TSV',
		diameters: [3.7, 4.1, 4.7, 6.0],
		lengths: [8, 10, 11.5, 13, 16],
		taper: 0.25,
		region: 'US',
		article: 'ZB-TSV',
		techInfo: 'Tapered Screw-Vent, MTX surface; internal hex connection; US distribution catalog.',
		docUrl: 'https://www.zimmerbiomet.com/tsv'
	},
	{
		manufacturer: 'coDiagnostiX',
		line: 'Fixation Pin',
		diameters: [1.5],
		lengths: [20],
		taper: 0.1,
		kind: 'pin',
		region: 'global',
		article: 'CDX-PIN',
		techInfo: 'lateral auto-angled placement; default tooth position XX',
		docUrl: 'https://dental.straumann.com/guided-surgery/fixation-pins'
	},
	{
		manufacturer: 'Generic',
		line: 'Anchor Pin',
		diameters: [1.2],
		lengths: [16],
		taper: 0.1,
		kind: 'pin',
		region: 'global',
		article: 'GEN-PIN',
		techInfo: 'lateral auto-angled placement; default tooth position XX'
	},
	{
		manufacturer: 'Generic',
		line: 'Endo Access Drill',
		diameters: [1.0, 1.2],
		lengths: [16, 19, 21, 25],
		taper: 0.6,
		kind: 'endoDrill',
		region: 'global',
		article: 'GEN-ENDO',
		techInfo: 'endodontic access — straight path only',
		docUrl: 'https://dental.straumann.com/endodontics/guided-access'
	}
];

// ---------------- filtering & catalog merge ----------------

export interface LineFilter {
	/** case-insensitive substring match on manufacturer / line / article */
	q?: string;
	manufacturer?: string;
	diameter?: number;
	length?: number;
	favoritesOnly?: boolean;
	/** favorite line keys (see lineKey) */
	favorites?: string[];
	kind?: LineKind;
	/** 'global' lines match every region filter */
	region?: string;
	/** outdated lines: hidden by default; built-ins are never outdated */
	outdated?: 'include' | 'exclude' | 'only';
	/** source list; defaults to the built-in library */
	lines?: ImplantLine[];
}

export function filterLines(opts: LineFilter): ImplantLine[] {
	const src = opts.lines ?? IMPLANT_LIBRARY;
	const q = opts.q?.trim().toLowerCase();
	const mode = opts.outdated ?? 'exclude';
	return src.filter((l) => {
		if (mode === 'exclude' && l.outdated) return false;
		if (mode === 'only' && !l.outdated) return false;
		if (opts.kind && (l.kind ?? 'implant') !== opts.kind) return false;
		if (opts.manufacturer && l.manufacturer !== opts.manufacturer) return false;
		if (opts.diameter != null && !l.diameters.includes(opts.diameter)) return false;
		if (opts.length != null && !l.lengths.includes(opts.length)) return false;
		if (opts.region) {
			const r = l.region ?? 'global';
			if (r !== 'global' && r !== opts.region) return false;
		}
		if (opts.favoritesOnly && !(opts.favorites ?? []).includes(lineKey(l))) return false;
		if (q) {
			const hay = `${l.manufacturer} ${l.line} ${l.article ?? ''}`.toLowerCase();
			if (!hay.includes(q)) return false;
		}
		return true;
	});
}

/**
 * Merge uploaded-catalog lines into the built-in library. Catalog lines are
 * marked `custom: true`; a catalog line with the same manufacturer/line key
 * replaces the built-in one (catalog update), all others are appended.
 */
export function mergeCatalog(catalogLines: ImplantLine[]): ImplantLine[] {
	const marked = catalogLines.map((l) => ({ ...l, taper: l.taper ?? 0, custom: true }));
	const keys = new Set(marked.map(lineKey));
	return [...IMPLANT_LIBRARY.filter((l) => !keys.has(lineKey(l))), ...marked];
}

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
	/** Set when the sleeve comes from a custom sleeve system (/sleeves). */
	systemId?: number;
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
	/** bone classes this step applies to (default: all) — soft ≈ D4/D5, medium ≈ D3, hard ≈ D1/D2 */
	bone?: ('soft' | 'medium' | 'hard')[];
	/** manufacturer instructions-for-use link */
	docUrl?: string;
}

export function boneClassLabel(step: DrillStep): string {
	if (!step.bone || step.bone.length === 3) return 'all';
	return step.bone.join(' / ');
}

/**
 * Ordered drill sequence per sleeve system. Steps whose minImplantDiameter exceeds
 * the planned implant are skipped; the drill stops at the guided length.
 */
export const DRILL_PROTOCOLS: Record<string, DrillStep[]> = {
	'Straumann T-Sleeve': [
		{
			name: 'Needle drill',
			diameter: 1.6,
			color: 'gray',
			docUrl: 'https://dental.straumann.com/guided-surgery/drill-protocols/needle-drill'
		},
		{
			name: 'Pilot drill',
			diameter: 2.2,
			color: 'yellow',
			docUrl: 'https://dental.straumann.com/guided-surgery/drill-protocols/pilot-drill'
		},
		{ name: 'Drill ⌀2.8', diameter: 2.8, color: 'red', minImplantDiameter: 3.3 },
		{ name: 'Drill ⌀3.5', diameter: 3.5, color: 'blue', minImplantDiameter: 4.1 },
		{ name: 'Drill ⌀4.2', diameter: 4.2, color: 'green', minImplantDiameter: 4.8 },
		{
			name: 'Profile drill',
			diameter: 4.2,
			color: 'gray',
			bone: ['medium', 'hard'],
			docUrl: 'https://dental.straumann.com/guided-surgery/drill-protocols/profile-drill'
		},
		{
			name: 'Bone tap',
			diameter: 4.1,
			color: 'gray',
			bone: ['hard'],
			docUrl: 'https://dental.straumann.com/guided-surgery/drill-protocols/bone-tap'
		}
	],
	'Generic sleeve': [
		{ name: 'Pilot drill', diameter: 2.0, color: 'yellow' },
		{ name: 'Twist drill ⌀2.8', diameter: 2.8, color: 'red', minImplantDiameter: 3.3 },
		{ name: 'Twist drill ⌀3.4', diameter: 3.4, color: 'blue', minImplantDiameter: 4.0 },
		{ name: 'Twist drill ⌀4.1', diameter: 4.1, color: 'green', minImplantDiameter: 4.8, bone: ['medium', 'hard'] },
		{ name: 'Twist drill ⌀4.7', diameter: 4.7, color: 'black', minImplantDiameter: 5.4, bone: ['medium', 'hard'] },
		{ name: 'Cortical tap', diameter: 4.0, color: 'gray', bone: ['hard'] }
	],
	'Pilot drill sleeve': [{ name: 'Pilot drill', diameter: 2.0, color: 'yellow' }]
};

export function drillSequence(sleeve: SleeveSpec, implantDiameter: number): DrillStep[] {
	const steps = DRILL_PROTOCOLS[sleeve.system] ?? DRILL_PROTOCOLS['Generic sleeve'];
	return steps.filter(
		(s) => s.minImplantDiameter == null || implantDiameter >= s.minImplantDiameter
	);
}

/** reference reading for the density-statistics / sinus-lift panels */
export const DENSITY_DOC_LINKS: { label: string; url: string }[] = [
	{
		label: 'Bone density classification (D1–D4) and drill-protocol adaptation',
		url: 'https://dental.straumann.com/guided-surgery/bone-density-classification'
	},
	{
		label: 'Guided surgery drill protocols — instructions for use',
		url: 'https://dental.straumann.com/guided-surgery/drill-protocols'
	},
	{
		label: 'Sinus floor elevation — lateral window technique',
		url: 'https://dental.straumann.com/sinus-lift/lateral-window'
	},
	{
		label: 'Sinus floor elevation — transcrestal (osteotome) technique',
		url: 'https://dental.straumann.com/sinus-lift/transcrestal'
	}
];

// ---------------- user-defined abutments ----------------

/**
 * User-designed abutment: 1–4 stacked conical segments (emergence profile +
 * mesostructure, bottom → top), an inclination of the whole stack (0–45°)
 * and a rotation around the implant axis (degrees).
 * Valid ranges: height 0.5–8 mm, diameters 1–8 mm per segment.
 */
export interface UserAbutment {
	name: string;
	segments: { height: number; lowerD: number; upperD: number }[];
	/** stack inclination relative to the implant axis, degrees (0–45) */
	inclination: number;
	/** rotation around the implant axis, degrees */
	rotation: number;
}

/**
 * Abutment JSON stored on an implant. Superset of AbutmentSpec so the
 * existing 2D glyph rendering (type/angle/height/diameter) keeps working;
 * custom abutments carry their source segments + rotation alongside.
 */
export type StoredAbutment = AbutmentSpec & {
	preset?: string;
	rotation?: number;
	segments?: UserAbutment['segments'];
};

/**
 * Convert a user-defined abutment into the AbutmentSpec-compatible JSON shape
 * consumed by the planning glyphs: total height = sum of segment heights,
 * platform diameter = widest segment diameter, angle = inclination.
 */
export function userAbutmentToSpec(a: UserAbutment): StoredAbutment {
	const height = a.segments.reduce((s, seg) => s + seg.height, 0);
	const diameter = a.segments.reduce((d, seg) => Math.max(d, seg.lowerD, seg.upperD), 0);
	return {
		type: a.inclination > 0 ? 'angled' : 'straight',
		angle: a.inclination,
		height,
		diameter,
		preset: 'custom',
		rotation: a.rotation,
		segments: a.segments.map((s) => ({ ...s }))
	};
}

// ---------------- virtual teeth (prosthetic-driven planning) ----------------

/**
 * Virtual-tooth crown templates, one per tooth type and jaw (8 shapes × 2 jaws,
 * mirrored across quadrants). `tooth` is the representative FDI number in
 * quadrant 1 (upper) / 4 (lower); widths are mesiodistal, heights are crown
 * heights (mm, population averages).
 */
export const VIRTUAL_TEETH: { tooth: number; name: string; widthMM: number; heightMM: number }[] = [
	{ tooth: 11, name: 'Upper central incisor', widthMM: 8.5, heightMM: 10.5 },
	{ tooth: 12, name: 'Upper lateral incisor', widthMM: 6.5, heightMM: 9.0 },
	{ tooth: 13, name: 'Upper canine', widthMM: 7.6, heightMM: 10.0 },
	{ tooth: 14, name: 'Upper first premolar', widthMM: 7.0, heightMM: 8.5 },
	{ tooth: 15, name: 'Upper second premolar', widthMM: 6.8, heightMM: 8.0 },
	{ tooth: 16, name: 'Upper first molar', widthMM: 10.3, heightMM: 7.5 },
	{ tooth: 17, name: 'Upper second molar', widthMM: 9.8, heightMM: 7.0 },
	{ tooth: 18, name: 'Upper third molar', widthMM: 9.2, heightMM: 6.5 },
	{ tooth: 41, name: 'Lower central incisor', widthMM: 5.3, heightMM: 9.0 },
	{ tooth: 42, name: 'Lower lateral incisor', widthMM: 5.9, heightMM: 9.5 },
	{ tooth: 43, name: 'Lower canine', widthMM: 6.9, heightMM: 11.0 },
	{ tooth: 44, name: 'Lower first premolar', widthMM: 6.9, heightMM: 8.5 },
	{ tooth: 45, name: 'Lower second premolar', widthMM: 7.1, heightMM: 8.0 },
	{ tooth: 46, name: 'Lower first molar', widthMM: 11.2, heightMM: 7.5 },
	{ tooth: 47, name: 'Lower second molar', widthMM: 10.7, heightMM: 7.0 },
	{ tooth: 48, name: 'Lower third molar', widthMM: 10.5, heightMM: 6.5 }
];

/** Template for any of the 32 FDI teeth (quadrants 2/3 map to the 1/4 templates). */
export function virtualToothTemplate(
	tooth: number
): { tooth: number; name: string; widthMM: number; heightMM: number } | null {
	const q = Math.floor(tooth / 10);
	const pos = tooth % 10;
	if (q < 1 || q > 4 || pos < 1 || pos > 8) return null;
	const repQuadrant = q <= 2 ? 1 : 4;
	return VIRTUAL_TEETH.find((t) => t.tooth === repQuadrant * 10 + pos) ?? null;
}

/**
 * Closed 2D crown outline polygon for a virtual tooth (FDI number), in mm,
 * centered on the origin: x = mesiodistal, y = occlusal-cervical (crown
 * height). Simple anatomically plausible shapes — molar = rounded square with
 * a cusp hint, premolar = rounded square (2 cusps), canine = pointed,
 * incisor = chisel (flat incisal edge, rounded cervical).
 * The polygon is explicitly closed (first point repeated as the last) and
 * always has ≥ 8 distinct vertices. Quadrants 2/3 are mirrored in x.
 */
export function virtualToothOutline(tooth: number): { x: number; y: number }[] {
	const tpl = virtualToothTemplate(tooth);
	if (!tpl) return [];
	const q = Math.floor(tooth / 10);
	const pos = tooth % 10;
	const hw = tpl.widthMM / 2;
	const hh = tpl.heightMM / 2;
	const mirror = q === 2 || q === 3 ? -1 : 1;

	// superellipse radius: |cos|^p, |sin|^p shaping; cuspK adds a cusp hint
	const N = 36;
	const pts: { x: number; y: number }[] = [];
	let exp: number; // squareness (higher = boxier)
	let cusps = 0;
	let cuspAmp = 0;
	let chisel = false;
	let pointed = false;
	if (pos >= 6) {
		exp = 0.35; // molar: rounded square
		cusps = 4;
		cuspAmp = 0.045;
	} else if (pos >= 4) {
		exp = 0.5; // premolar: rounded, slightly boxy
		cusps = 2;
		cuspAmp = 0.04;
	} else if (pos === 3) {
		exp = 1.0; // canine: oval with a labial point
		pointed = true;
	} else {
		exp = 0.55; // incisor: chisel
		chisel = true;
	}

	for (let i = 0; i < N; i++) {
		const th = (i / N) * Math.PI * 2;
		const c = Math.cos(th);
		const s = Math.sin(th);
		// superellipse parametrization
		let x = Math.sign(c) * Math.pow(Math.abs(c), exp) * hw;
		let y = Math.sign(s) * Math.pow(Math.abs(s), exp) * hh;
		if (cusps > 0) {
			const m = 1 + cuspAmp * Math.cos(cusps * th + Math.PI / 4);
			x *= m;
			y *= m;
		}
		if (chisel && y > 0) {
			// flatten the incisal edge (top) into a chisel
			y = hh * (0.92 + 0.08 * Math.abs(s));
			x *= 0.96;
		}
		if (pointed && y > 0) {
			// taper toward a single incisal point
			const t = y / hh;
			x *= 1 - 0.65 * t;
			y = hh * Math.min(1, t * 1.08);
		}
		pts.push({ x: mirror * x, y });
	}
	pts.push({ ...pts[0] }); // explicit closure
	return pts;
}
