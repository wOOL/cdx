// Part of the coDiagnostiX Web dental layer (AGPL-3.0, like Chili3D).
//
// IOS tooth-segmentation display palette. Mirrors the vendor's _IOS_COLORS
// (index == class label). The server decodes the model's per-vertex colours
// back to these label indices; we render them with the same palette so the
// in-app overlay matches the model's own visualisation. Label 0 = gingiva
// (rendered as a soft tissue tone), -1 = unmatched (grey).

// 39 RGBA rows (0..255), index = label.
const IOS_COLORS_255: ReadonlyArray<readonly [number, number, number]> = [
    [255, 255, 255], [174, 199, 232], [152, 223, 138], [31, 119, 180], [255, 187, 120],
    [188, 189, 34], [140, 86, 75], [255, 152, 150], [214, 39, 40], [197, 176, 213],
    [148, 103, 189], [196, 156, 148], [23, 190, 207], [247, 182, 210], [66, 188, 102],
    [219, 219, 141], [140, 57, 197], [202, 185, 52], [51, 176, 203], [200, 54, 131],
    [92, 193, 61], [78, 71, 183], [172, 114, 82], [255, 127, 14], [91, 163, 138],
    [153, 98, 156], [140, 153, 101], [158, 218, 229], [100, 125, 154], [178, 127, 135],
    [146, 111, 194], [44, 160, 44], [112, 128, 144], [96, 207, 209], [227, 119, 194],
    [213, 92, 176], [94, 106, 211], [82, 84, 163], [100, 85, 144],
];

// Soft gingiva tone (label 0) so teeth stand out; grey for unmatched (-1).
const GINGIVA: readonly [number, number, number] = [0.86, 0.66, 0.66];
const UNMATCHED: readonly [number, number, number] = [0.5, 0.5, 0.5];

/** Display colour (rgb 0..1) for a segmentation label. */
export function colorForLabel(label: number): readonly [number, number, number] {
    if (label === 0) return GINGIVA;
    if (label < 0 || label >= IOS_COLORS_255.length) return UNMATCHED;
    const [r, g, b] = IOS_COLORS_255[label];
    return [r / 255, g / 255, b / 255];
}

/** Flat per-vertex [r,g,b,...] colour array (0..1) for a label buffer. */
export function labelsToColorArray(labels: Int16Array): number[] {
    const out = new Array<number>(labels.length * 3);
    for (let i = 0; i < labels.length; i++) {
        const [r, g, b] = colorForLabel(labels[i]);
        out[i * 3] = r;
        out[i * 3 + 1] = g;
        out[i * 3 + 2] = b;
    }
    return out;
}
