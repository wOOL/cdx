/**
 * Virtual Planning Export (VPE): scanbody catalog + request payload types.
 * Shared client+server — the dialog filters the catalog by implant platform,
 * the export endpoint resolves entries to parametric meshes (server/vpe.ts).
 *
 * Entries are parametric, modeled on the Straumann CARES Mono Scanbody
 * (one-piece PEEK cylinder with an anti-rotation flat on a seating collar).
 * All dimensions in mm.
 */

export interface ScanbodyEntry {
	id: string;
	name: string;
	/** prosthetic platforms this scanbody mates with (see implantPlatform) */
	platforms: string[];
	/** scan-cylinder Ø */
	bodyDiameter: number;
	/** scan-cylinder height above the collar */
	bodyHeight: number;
	/** depth of the anti-rotation flat cut into the body */
	flatDepth: number;
	/** seating collar Ø / height at the platform */
	collarDiameter: number;
	collarHeight: number;
}

export const SCANBODY_CATALOG: ScanbodyEntry[] = [
	{
		id: 'cares-mono-nc',
		name: 'Straumann CARES Mono Scanbody NC',
		platforms: ['Straumann NC', 'Straumann SC'],
		bodyDiameter: 3.6,
		bodyHeight: 8.5,
		flatDepth: 0.9,
		collarDiameter: 4.0,
		collarHeight: 1.5
	},
	{
		id: 'cares-mono-rc',
		name: 'Straumann CARES Mono Scanbody RC',
		platforms: ['Straumann RC'],
		bodyDiameter: 4.2,
		bodyHeight: 8.5,
		flatDepth: 1.0,
		collarDiameter: 4.6,
		collarHeight: 1.5
	},
	{
		id: 'cares-mono-rbwb',
		name: 'Straumann CARES Mono Scanbody RB/WB',
		platforms: ['Straumann RB/WB'],
		bodyDiameter: 4.2,
		bodyHeight: 9.0,
		flatDepth: 1.0,
		collarDiameter: 4.6,
		collarHeight: 1.2
	},
	{
		id: 'generic-np',
		name: 'Generic scanbody NP (narrow platform)',
		platforms: ['Generic NP'],
		bodyDiameter: 3.4,
		bodyHeight: 8.0,
		flatDepth: 0.8,
		collarDiameter: 3.8,
		collarHeight: 1.2
	},
	{
		id: 'generic-rp',
		name: 'Generic scanbody RP (regular platform)',
		platforms: ['Generic RP'],
		bodyDiameter: 4.0,
		bodyHeight: 9.0,
		flatDepth: 0.9,
		collarDiameter: 4.6,
		collarHeight: 1.2
	}
];

export function getScanbody(id: string): ScanbodyEntry | null {
	return SCANBODY_CATALOG.find((s) => s.id === id) ?? null;
}

/**
 * Prosthetic platform of a planned implant, or null for items without a
 * prosthetic connection (fixation pins, endo drills) — those positions get
 * "No scanbodies available".
 */
export function implantPlatform(im: {
	manufacturer: string;
	line: string;
	diameter: number;
}): string | null {
	const line = im.line.toLowerCase();
	if (line.includes('pin') || line.includes('endo')) return null;
	if (im.manufacturer === 'Straumann') {
		if (line.startsWith('blx')) return 'Straumann RB/WB';
		if (im.diameter < 3.0) return 'Straumann SC';
		if (im.diameter < 3.6) return 'Straumann NC';
		return 'Straumann RC';
	}
	return im.diameter < 3.6 ? 'Generic NP' : 'Generic RP';
}

export function scanbodiesForPlatform(platform: string | null): ScanbodyEntry[] {
	if (!platform) return [];
	return SCANBODY_CATALOG.filter((s) => s.platforms.includes(platform));
}

// ---------------- request payload ----------------

export type VpeMode = 'untouched' | 'analogs';
export type VpeLevel = 'implant' | 'abutment';

export interface VpeItem {
	implantId: number;
	level: VpeLevel;
	scanbodyId: string | null;
	include: boolean;
}

export interface VpeRequest {
	format: 'stl';
	mode: VpeMode;
	source: { kind: 'model' | 'segmentation'; id: number };
	items: VpeItem[];
	single: boolean;
	/** optional plan to take the implants from (default: master plan) */
	planId?: number;
	/** true → JSON preview payload instead of the file download */
	preview?: boolean;
}

export interface VpePreviewPart {
	name: string;
	/** float offset / count into the flat positions array */
	offset: number;
	count: number;
}

export interface VpePreviewPayload {
	positions: number[];
	parts: VpePreviewPart[];
}
