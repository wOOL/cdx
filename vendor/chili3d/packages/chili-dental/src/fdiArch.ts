// Part of the coDiagnostiX Web dental layer (AGPL-3.0, like Chili3D).
//
// FDI tooth numbering helpers: the per-arch spatial order, mapping IOS labels
// to FDI numbers, and detecting an edentulous gap (a missing tooth flanked by
// present neighbours) as a restoration site.

// IOS label index (1..32) → FDI number. Matches the vendor model's
// FDI_TOOTH_NUMBER_CLASSES (label 0 = gingiva; 33..38 = other).
export const FDI_BY_LABEL: readonly number[] = [
    18, 17, 16, 15, 14, 13, 12, 11, 21, 22, 23, 24, 25, 26, 27, 28,
    38, 37, 36, 35, 34, 33, 32, 31, 41, 42, 43, 44, 45, 46, 47, 48,
];

/** FDI number for an IOS label, or 0 (gingiva/other/unknown). */
export function labelToFdi(label: number): number {
    if (label >= 1 && label <= 32) return FDI_BY_LABEL[label - 1];
    return 0;
}

/** IOS label index (1..32) for an FDI tooth number, or 0 if unknown. */
export function labelForFdi(fdi: number): number {
    const i = FDI_BY_LABEL.indexOf(fdi);
    return i >= 0 ? i + 1 : 0;
}

// Spatial order of teeth along each arch (patient right → left).
const UPPER_ARCH = [18, 17, 16, 15, 14, 13, 12, 11, 21, 22, 23, 24, 25, 26, 27, 28];
const LOWER_ARCH = [48, 47, 46, 45, 44, 43, 42, 41, 31, 32, 33, 34, 35, 36, 37, 38];

export interface ArchGap {
    target: number; // missing FDI to restore
    left: number; // present neighbour (one side)
    right: number; // present neighbour (other side)
}

/**
 * First single-tooth gap: an absent tooth whose immediate arch neighbours are
 * both present. Returns null if no such interior gap exists.
 */
export function detectGap(presentFdis: number[]): ArchGap | null {
    const present = new Set(presentFdis);
    for (const arch of [UPPER_ARCH, LOWER_ARCH]) {
        for (let i = 1; i < arch.length - 1; i++) {
            const f = arch[i];
            if (!present.has(f) && present.has(arch[i - 1]) && present.has(arch[i + 1])) {
                return { target: f, left: arch[i - 1], right: arch[i + 1] };
            }
        }
    }
    return null;
}
