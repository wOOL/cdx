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
