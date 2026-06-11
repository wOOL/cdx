/**
 * Shared (client-safe) types for the advanced DICOM import:
 * preflight response shape and the options accepted by the import pipeline.
 */

export interface PreflightSlice {
	/** index into the z-sorted slice list (sliceFrom/sliceTo refer to this) */
	index: number;
	instanceNumber: number;
	rows: number;
	cols: number;
	spacingRow: number;
	spacingCol: number;
	/** position projected onto the slice normal (mm) */
	zPos: number;
	valid: boolean;
	reason?: string;
}

export interface PreflightGap {
	/** index of the slice AFTER the gap */
	index: number;
	/** z midpoint of the gap (mm) */
	zPos: number;
	/** actual gap size (mm) */
	gap: number;
}

export interface PreflightThumb {
	/** slice index (z-sorted) the thumbnail was taken from */
	index: number;
	width: number;
	height: number;
	/** base64 PNG (8-bit grayscale) */
	png: string;
}

export interface PreflightExtra {
	/** index into the preflight slices array */
	index: number;
	description: string;
	width: number;
	height: number;
	/** base64 PNG (8-bit grayscale) */
	png: string;
}

export interface PreflightSeries {
	count: number;
	rows: number;
	cols: number;
	/** pixel spacing [row, col] mm */
	spacing: [number, number];
	zSpacingMedian: number;
	/** consecutive z gaps deviating >25% from the median */
	gaps: PreflightGap[];
	/** angle between the slice normal and the z axis (degrees) */
	tiltDeg: number;
	patientName: string;
	modality: string;
	seriesDescription: string;
}

export interface PreflightResult {
	slices: PreflightSlice[];
	series: PreflightSeries;
	warnings: string[];
	/** 64 bins over [-1000, 3000] HU, sampled from ≤20 evenly spaced slices */
	histogram: { lo: number; hi: number; bins: number[] };
	/** ≤12 evenly spaced 80px-wide thumbnails of the main series */
	thumbs: PreflightThumb[];
	/** parseable images that are not part of the main series (embedded 2D) */
	extras: PreflightExtra[];
}

export interface CropRect {
	x0: number;
	y0: number;
	x1: number;
	y1: number;
}

export interface AdvancedImportOptions {
	/** first slice to keep (z-sorted index, inclusive) */
	sliceFrom?: number;
	/** last slice to keep (z-sorted index, inclusive) */
	sliceTo?: number;
	/** "optimized 1:n" — keep every nth slice of the selection */
	sliceStep?: number;
	/** region restriction in full-resolution pixel coordinates */
	crop?: CropRect;
	/** insert synthetic slices where a z gap of ~k× the median is detected */
	fillMissing?: 'interpolate' | 'black';
	/** orthogonalize a tilted series with a y-shear approximation */
	gantryCorrect?: boolean;
	/** gray window stored on the dataset and used for the preview volume */
	grayLo?: number;
	grayHi?: number;
	/** permanent anonymization: replaces patient_name, skips patient prefill */
	alias?: string;
	/** "manual slice distance" — overrides the computed z spacing (mm) */
	zSpacingOverride?: number;
}
