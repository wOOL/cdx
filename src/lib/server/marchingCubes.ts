/**
 * Dependency-free marching cubes over a regular scalar volume.
 *
 * Data layout: x fastest, then y, then z (index = z*nx*ny + y*nx + x).
 * Output is a triangle soup in mm (voxel index * spacing) with per-vertex
 * normals derived from the volume gradient (central differences sampled at
 * the interpolated vertex location), normalized and pointing outward from
 * high-value regions (a solid sphere of high values yields normals that
 * point away from its center).
 *
 * Standard Paul Bourke corner/edge numbering:
 *   corners 0..3 ring the z=0 face (0,0,0)(1,0,0)(1,1,0)(0,1,0),
 *   corners 4..7 ring the z=1 face above them,
 *   edges 0..3 bottom ring, 4..7 top ring, 8..11 vertical.
 */

/* eslint-disable prettier/prettier */
// prettier-ignore
const EDGE_TABLE: Uint16Array = new Uint16Array([
	0x000, 0x109, 0x203, 0x30a, 0x406, 0x50f, 0x605, 0x70c,
	0x80c, 0x905, 0xa0f, 0xb06, 0xc0a, 0xd03, 0xe09, 0xf00,
	0x190, 0x099, 0x393, 0x29a, 0x596, 0x49f, 0x795, 0x69c,
	0x99c, 0x895, 0xb9f, 0xa96, 0xd9a, 0xc93, 0xf99, 0xe90,
	0x230, 0x339, 0x033, 0x13a, 0x636, 0x73f, 0x435, 0x53c,
	0xa3c, 0xb35, 0x83f, 0x936, 0xe3a, 0xf33, 0xc39, 0xd30,
	0x3a0, 0x2a9, 0x1a3, 0x0aa, 0x7a6, 0x6af, 0x5a5, 0x4ac,
	0xbac, 0xaa5, 0x9af, 0x8a6, 0xfaa, 0xea3, 0xda9, 0xca0,
	0x460, 0x569, 0x663, 0x76a, 0x066, 0x16f, 0x265, 0x36c,
	0xc6c, 0xd65, 0xe6f, 0xf66, 0x86a, 0x963, 0xa69, 0xb60,
	0x5f0, 0x4f9, 0x7f3, 0x6fa, 0x1f6, 0x0ff, 0x3f5, 0x2fc,
	0xdfc, 0xcf5, 0xfff, 0xef6, 0x9fa, 0x8f3, 0xbf9, 0xaf0,
	0x650, 0x759, 0x453, 0x55a, 0x256, 0x35f, 0x055, 0x15c,
	0xe5c, 0xf55, 0xc5f, 0xd56, 0xa5a, 0xb53, 0x859, 0x950,
	0x7c0, 0x6c9, 0x5c3, 0x4ca, 0x3c6, 0x2cf, 0x1c5, 0x0cc,
	0xfcc, 0xec5, 0xdcf, 0xcc6, 0xbca, 0xac3, 0x9c9, 0x8c0,
	0x8c0, 0x9c9, 0xac3, 0xbca, 0xcc6, 0xdcf, 0xec5, 0xfcc,
	0x0cc, 0x1c5, 0x2cf, 0x3c6, 0x4ca, 0x5c3, 0x6c9, 0x7c0,
	0x950, 0x859, 0xb53, 0xa5a, 0xd56, 0xc5f, 0xf55, 0xe5c,
	0x15c, 0x055, 0x35f, 0x256, 0x55a, 0x453, 0x759, 0x650,
	0xaf0, 0xbf9, 0x8f3, 0x9fa, 0xef6, 0xfff, 0xcf5, 0xdfc,
	0x2fc, 0x3f5, 0x0ff, 0x1f6, 0x6fa, 0x7f3, 0x4f9, 0x5f0,
	0xb60, 0xa69, 0x963, 0x86a, 0xf66, 0xe6f, 0xd65, 0xc6c,
	0x36c, 0x265, 0x16f, 0x066, 0x76a, 0x663, 0x569, 0x460,
	0xca0, 0xda9, 0xea3, 0xfaa, 0x8a6, 0x9af, 0xaa5, 0xbac,
	0x4ac, 0x5a5, 0x6af, 0x7a6, 0x0aa, 0x1a3, 0x2a9, 0x3a0,
	0xd30, 0xc39, 0xf33, 0xe3a, 0x936, 0x83f, 0xb35, 0xa3c,
	0x53c, 0x435, 0x73f, 0x636, 0x13a, 0x033, 0x339, 0x230,
	0xe90, 0xf99, 0xc93, 0xd9a, 0xa96, 0xb9f, 0x895, 0x99c,
	0x69c, 0x795, 0x49f, 0x596, 0x29a, 0x393, 0x099, 0x190,
	0xf00, 0xe09, 0xd03, 0xc0a, 0xb06, 0xa0f, 0x905, 0x80c,
	0x70c, 0x605, 0x50f, 0x406, 0x30a, 0x203, 0x109, 0x000
]);

// prettier-ignore
const TRI_TABLE: readonly (readonly number[])[] = [
	[],
	[0, 8, 3],
	[0, 1, 9],
	[1, 8, 3, 9, 8, 1],
	[1, 2, 10],
	[0, 8, 3, 1, 2, 10],
	[9, 2, 10, 0, 2, 9],
	[2, 8, 3, 2, 10, 8, 10, 9, 8],
	[3, 11, 2],
	[0, 11, 2, 8, 11, 0],
	[1, 9, 0, 2, 3, 11],
	[1, 11, 2, 1, 9, 11, 9, 8, 11],
	[3, 10, 1, 11, 10, 3],
	[0, 10, 1, 0, 8, 10, 8, 11, 10],
	[3, 9, 0, 3, 11, 9, 11, 10, 9],
	[9, 8, 10, 10, 8, 11],
	[4, 7, 8],
	[4, 3, 0, 7, 3, 4],
	[0, 1, 9, 8, 4, 7],
	[4, 1, 9, 4, 7, 1, 7, 3, 1],
	[1, 2, 10, 8, 4, 7],
	[3, 4, 7, 3, 0, 4, 1, 2, 10],
	[9, 2, 10, 9, 0, 2, 8, 4, 7],
	[2, 10, 9, 2, 9, 7, 2, 7, 3, 7, 9, 4],
	[8, 4, 7, 3, 11, 2],
	[11, 4, 7, 11, 2, 4, 2, 0, 4],
	[9, 0, 1, 8, 4, 7, 2, 3, 11],
	[4, 7, 11, 9, 4, 11, 9, 11, 2, 9, 2, 1],
	[3, 10, 1, 3, 11, 10, 7, 8, 4],
	[1, 11, 10, 1, 4, 11, 1, 0, 4, 7, 11, 4],
	[4, 7, 8, 9, 0, 11, 9, 11, 10, 11, 0, 3],
	[4, 7, 11, 4, 11, 9, 9, 11, 10],
	[9, 5, 4],
	[9, 5, 4, 0, 8, 3],
	[0, 5, 4, 1, 5, 0],
	[8, 5, 4, 8, 3, 5, 3, 1, 5],
	[1, 2, 10, 9, 5, 4],
	[3, 0, 8, 1, 2, 10, 4, 9, 5],
	[5, 2, 10, 5, 4, 2, 4, 0, 2],
	[2, 10, 5, 3, 2, 5, 3, 5, 4, 3, 4, 8],
	[9, 5, 4, 2, 3, 11],
	[0, 11, 2, 0, 8, 11, 4, 9, 5],
	[0, 5, 4, 0, 1, 5, 2, 3, 11],
	[2, 1, 5, 2, 5, 8, 2, 8, 11, 4, 8, 5],
	[10, 3, 11, 10, 1, 3, 9, 5, 4],
	[4, 9, 5, 0, 8, 1, 8, 10, 1, 8, 11, 10],
	[5, 4, 0, 5, 0, 11, 5, 11, 10, 11, 0, 3],
	[5, 4, 8, 5, 8, 10, 10, 8, 11],
	[9, 7, 8, 5, 7, 9],
	[9, 3, 0, 9, 5, 3, 5, 7, 3],
	[0, 7, 8, 0, 1, 7, 1, 5, 7],
	[1, 5, 3, 3, 5, 7],
	[9, 7, 8, 9, 5, 7, 10, 1, 2],
	[10, 1, 2, 9, 5, 0, 5, 3, 0, 5, 7, 3],
	[8, 0, 2, 8, 2, 5, 8, 5, 7, 10, 5, 2],
	[2, 10, 5, 2, 5, 3, 3, 5, 7],
	[7, 9, 5, 7, 8, 9, 3, 11, 2],
	[9, 5, 7, 9, 7, 2, 9, 2, 0, 2, 7, 11],
	[2, 3, 11, 0, 1, 8, 1, 7, 8, 1, 5, 7],
	[11, 2, 1, 11, 1, 7, 7, 1, 5],
	[9, 5, 8, 8, 5, 7, 10, 1, 3, 10, 3, 11],
	[5, 7, 0, 5, 0, 9, 7, 11, 0, 1, 0, 10, 11, 10, 0],
	[11, 10, 0, 11, 0, 3, 10, 5, 0, 8, 0, 7, 5, 7, 0],
	[11, 10, 5, 7, 11, 5],
	[10, 6, 5],
	[0, 8, 3, 5, 10, 6],
	[9, 0, 1, 5, 10, 6],
	[1, 8, 3, 1, 9, 8, 5, 10, 6],
	[1, 6, 5, 2, 6, 1],
	[1, 6, 5, 1, 2, 6, 3, 0, 8],
	[9, 6, 5, 9, 0, 6, 0, 2, 6],
	[5, 9, 8, 5, 8, 2, 5, 2, 6, 3, 2, 8],
	[2, 3, 11, 10, 6, 5],
	[11, 0, 8, 11, 2, 0, 10, 6, 5],
	[0, 1, 9, 2, 3, 11, 5, 10, 6],
	[5, 10, 6, 1, 9, 2, 9, 11, 2, 9, 8, 11],
	[6, 3, 11, 6, 5, 3, 5, 1, 3],
	[0, 8, 11, 0, 11, 5, 0, 5, 1, 5, 11, 6],
	[3, 11, 6, 0, 3, 6, 0, 6, 5, 0, 5, 9],
	[6, 5, 9, 6, 9, 11, 11, 9, 8],
	[5, 10, 6, 4, 7, 8],
	[4, 3, 0, 4, 7, 3, 6, 5, 10],
	[1, 9, 0, 5, 10, 6, 8, 4, 7],
	[10, 6, 5, 1, 9, 7, 1, 7, 3, 7, 9, 4],
	[6, 1, 2, 6, 5, 1, 4, 7, 8],
	[1, 2, 5, 5, 2, 6, 3, 0, 4, 3, 4, 7],
	[8, 4, 7, 9, 0, 5, 0, 6, 5, 0, 2, 6],
	[7, 3, 9, 7, 9, 4, 3, 2, 9, 5, 9, 6, 2, 6, 9],
	[3, 11, 2, 7, 8, 4, 10, 6, 5],
	[5, 10, 6, 4, 7, 2, 4, 2, 0, 2, 7, 11],
	[0, 1, 9, 4, 7, 8, 2, 3, 11, 5, 10, 6],
	[9, 2, 1, 9, 11, 2, 9, 4, 11, 7, 11, 4, 5, 10, 6],
	[8, 4, 7, 3, 11, 5, 3, 5, 1, 5, 11, 6],
	[5, 1, 11, 5, 11, 6, 1, 0, 11, 7, 11, 4, 0, 4, 11],
	[0, 5, 9, 0, 6, 5, 0, 3, 6, 11, 6, 3, 8, 4, 7],
	[6, 5, 9, 6, 9, 11, 4, 7, 9, 7, 11, 9],
	[10, 4, 9, 6, 4, 10],
	[4, 10, 6, 4, 9, 10, 0, 8, 3],
	[10, 0, 1, 10, 6, 0, 6, 4, 0],
	[8, 3, 1, 8, 1, 6, 8, 6, 4, 6, 1, 10],
	[1, 4, 9, 1, 2, 4, 2, 6, 4],
	[3, 0, 8, 1, 2, 9, 2, 4, 9, 2, 6, 4],
	[0, 2, 4, 4, 2, 6],
	[8, 3, 2, 8, 2, 4, 4, 2, 6],
	[10, 4, 9, 10, 6, 4, 11, 2, 3],
	[0, 8, 2, 2, 8, 11, 4, 9, 10, 4, 10, 6],
	[3, 11, 2, 0, 1, 6, 0, 6, 4, 6, 1, 10],
	[6, 4, 1, 6, 1, 10, 4, 8, 1, 2, 1, 11, 8, 11, 1],
	[9, 6, 4, 9, 3, 6, 9, 1, 3, 11, 6, 3],
	[8, 11, 1, 8, 1, 0, 11, 6, 1, 9, 1, 4, 6, 4, 1],
	[3, 11, 6, 3, 6, 0, 0, 6, 4],
	[6, 4, 8, 11, 6, 8],
	[7, 10, 6, 7, 8, 10, 8, 9, 10],
	[0, 7, 3, 0, 10, 7, 0, 9, 10, 6, 7, 10],
	[10, 6, 7, 1, 10, 7, 1, 7, 8, 1, 8, 0],
	[10, 6, 7, 10, 7, 1, 1, 7, 3],
	[1, 2, 6, 1, 6, 8, 1, 8, 9, 8, 6, 7],
	[2, 6, 9, 2, 9, 1, 6, 7, 9, 0, 9, 3, 7, 3, 9],
	[7, 8, 0, 7, 0, 6, 6, 0, 2],
	[7, 3, 2, 6, 7, 2],
	[2, 3, 11, 10, 6, 8, 10, 8, 9, 8, 6, 7],
	[2, 0, 7, 2, 7, 11, 0, 9, 7, 6, 7, 10, 9, 10, 7],
	[1, 8, 0, 1, 7, 8, 1, 10, 7, 6, 7, 10, 2, 3, 11],
	[11, 2, 1, 11, 1, 7, 10, 6, 1, 6, 7, 1],
	[8, 9, 6, 8, 6, 7, 9, 1, 6, 11, 6, 3, 1, 3, 6],
	[0, 9, 1, 11, 6, 7],
	[7, 8, 0, 7, 0, 6, 3, 11, 0, 11, 6, 0],
	[7, 11, 6],
	[7, 6, 11],
	[3, 0, 8, 11, 7, 6],
	[0, 1, 9, 11, 7, 6],
	[8, 1, 9, 8, 3, 1, 11, 7, 6],
	[10, 1, 2, 6, 11, 7],
	[1, 2, 10, 3, 0, 8, 6, 11, 7],
	[2, 9, 0, 2, 10, 9, 6, 11, 7],
	[6, 11, 7, 2, 10, 3, 10, 8, 3, 10, 9, 8],
	[7, 2, 3, 6, 2, 7],
	[7, 0, 8, 7, 6, 0, 6, 2, 0],
	[2, 7, 6, 2, 3, 7, 0, 1, 9],
	[1, 6, 2, 1, 8, 6, 1, 9, 8, 8, 7, 6],
	[10, 7, 6, 10, 1, 7, 1, 3, 7],
	[10, 7, 6, 1, 7, 10, 1, 8, 7, 1, 0, 8],
	[0, 3, 7, 0, 7, 10, 0, 10, 9, 6, 10, 7],
	[7, 6, 10, 7, 10, 8, 8, 10, 9],
	[6, 8, 4, 11, 8, 6],
	[3, 6, 11, 3, 0, 6, 0, 4, 6],
	[8, 6, 11, 8, 4, 6, 9, 0, 1],
	[9, 4, 6, 9, 6, 3, 9, 3, 1, 11, 3, 6],
	[6, 8, 4, 6, 11, 8, 2, 10, 1],
	[1, 2, 10, 3, 0, 11, 0, 6, 11, 0, 4, 6],
	[4, 11, 8, 4, 6, 11, 0, 2, 9, 2, 10, 9],
	[10, 9, 3, 10, 3, 2, 9, 4, 3, 11, 3, 6, 4, 6, 3],
	[8, 2, 3, 8, 4, 2, 4, 6, 2],
	[0, 4, 2, 4, 6, 2],
	[1, 9, 0, 2, 3, 4, 2, 4, 6, 4, 3, 8],
	[1, 9, 4, 1, 4, 2, 2, 4, 6],
	[8, 1, 3, 8, 6, 1, 8, 4, 6, 6, 10, 1],
	[10, 1, 0, 10, 0, 6, 6, 0, 4],
	[4, 6, 3, 4, 3, 8, 6, 10, 3, 0, 3, 9, 10, 9, 3],
	[10, 9, 4, 6, 10, 4],
	[4, 9, 5, 7, 6, 11],
	[0, 8, 3, 4, 9, 5, 11, 7, 6],
	[5, 0, 1, 5, 4, 0, 7, 6, 11],
	[11, 7, 6, 8, 3, 4, 3, 5, 4, 3, 1, 5],
	[9, 5, 4, 10, 1, 2, 7, 6, 11],
	[6, 11, 7, 1, 2, 10, 0, 8, 3, 4, 9, 5],
	[7, 6, 11, 5, 4, 10, 4, 2, 10, 4, 0, 2],
	[3, 4, 8, 3, 5, 4, 3, 2, 5, 10, 5, 2, 11, 7, 6],
	[7, 2, 3, 7, 6, 2, 5, 4, 9],
	[9, 5, 4, 0, 8, 6, 0, 6, 2, 6, 8, 7],
	[3, 6, 2, 3, 7, 6, 1, 5, 0, 5, 4, 0],
	[6, 2, 8, 6, 8, 7, 2, 1, 8, 4, 8, 5, 1, 5, 8],
	[9, 5, 4, 10, 1, 6, 1, 7, 6, 1, 3, 7],
	[1, 6, 10, 1, 7, 6, 1, 0, 7, 8, 7, 0, 9, 5, 4],
	[4, 0, 10, 4, 10, 5, 0, 3, 10, 6, 10, 7, 3, 7, 10],
	[7, 6, 10, 7, 10, 8, 5, 4, 10, 4, 8, 10],
	[6, 9, 5, 6, 11, 9, 11, 8, 9],
	[3, 6, 11, 0, 6, 3, 0, 5, 6, 0, 9, 5],
	[0, 11, 8, 0, 5, 11, 0, 1, 5, 5, 6, 11],
	[6, 11, 3, 6, 3, 5, 5, 3, 1],
	[1, 2, 10, 9, 5, 11, 9, 11, 8, 11, 5, 6],
	[0, 11, 3, 0, 6, 11, 0, 9, 6, 5, 6, 9, 1, 2, 10],
	[11, 8, 5, 11, 5, 6, 8, 0, 5, 10, 5, 2, 0, 2, 5],
	[6, 11, 3, 6, 3, 5, 2, 10, 3, 10, 5, 3],
	[5, 8, 9, 5, 2, 8, 5, 6, 2, 3, 8, 2],
	[9, 5, 6, 9, 6, 0, 0, 6, 2],
	[1, 5, 8, 1, 8, 0, 5, 6, 8, 3, 8, 2, 6, 2, 8],
	[1, 5, 6, 2, 1, 6],
	[1, 3, 6, 1, 6, 10, 3, 8, 6, 5, 6, 9, 8, 9, 6],
	[10, 1, 0, 10, 0, 6, 9, 5, 0, 5, 6, 0],
	[0, 3, 8, 5, 6, 10],
	[10, 5, 6],
	[11, 5, 10, 7, 5, 11],
	[11, 5, 10, 11, 7, 5, 8, 3, 0],
	[5, 11, 7, 5, 10, 11, 1, 9, 0],
	[10, 7, 5, 10, 11, 7, 9, 8, 1, 8, 3, 1],
	[11, 1, 2, 11, 7, 1, 7, 5, 1],
	[0, 8, 3, 1, 2, 7, 1, 7, 5, 7, 2, 11],
	[9, 7, 5, 9, 2, 7, 9, 0, 2, 2, 11, 7],
	[7, 5, 2, 7, 2, 11, 5, 9, 2, 3, 2, 8, 9, 8, 2],
	[2, 5, 10, 2, 3, 5, 3, 7, 5],
	[8, 2, 0, 8, 5, 2, 8, 7, 5, 10, 2, 5],
	[9, 0, 1, 5, 10, 3, 5, 3, 7, 3, 10, 2],
	[9, 8, 2, 9, 2, 1, 8, 7, 2, 10, 2, 5, 7, 5, 2],
	[1, 3, 5, 3, 7, 5],
	[0, 8, 7, 0, 7, 1, 1, 7, 5],
	[9, 0, 3, 9, 3, 5, 5, 3, 7],
	[9, 8, 7, 5, 9, 7],
	[5, 8, 4, 5, 10, 8, 10, 11, 8],
	[5, 0, 4, 5, 11, 0, 5, 10, 11, 11, 3, 0],
	[0, 1, 9, 8, 4, 10, 8, 10, 11, 10, 4, 5],
	[10, 11, 4, 10, 4, 5, 11, 3, 4, 9, 4, 1, 3, 1, 4],
	[2, 5, 1, 2, 8, 5, 2, 11, 8, 4, 5, 8],
	[0, 4, 11, 0, 11, 3, 4, 5, 11, 2, 11, 1, 5, 1, 11],
	[0, 2, 5, 0, 5, 9, 2, 11, 5, 4, 5, 8, 11, 8, 5],
	[9, 4, 5, 2, 11, 3],
	[2, 5, 10, 3, 5, 2, 3, 4, 5, 3, 8, 4],
	[5, 10, 2, 5, 2, 4, 4, 2, 0],
	[3, 10, 2, 3, 5, 10, 3, 8, 5, 4, 5, 8, 0, 1, 9],
	[5, 10, 2, 5, 2, 4, 1, 9, 2, 9, 4, 2],
	[8, 4, 5, 8, 5, 3, 3, 5, 1],
	[0, 4, 5, 1, 0, 5],
	[8, 4, 5, 8, 5, 3, 9, 0, 5, 0, 3, 5],
	[9, 4, 5],
	[4, 11, 7, 4, 9, 11, 9, 10, 11],
	[0, 8, 3, 4, 9, 7, 9, 11, 7, 9, 10, 11],
	[1, 10, 11, 1, 11, 4, 1, 4, 0, 7, 4, 11],
	[3, 1, 4, 3, 4, 8, 1, 10, 4, 7, 4, 11, 10, 11, 4],
	[4, 11, 7, 9, 11, 4, 9, 2, 11, 9, 1, 2],
	[9, 7, 4, 9, 11, 7, 9, 1, 11, 2, 11, 1, 0, 8, 3],
	[11, 7, 4, 11, 4, 2, 2, 4, 0],
	[11, 7, 4, 11, 4, 2, 8, 3, 4, 3, 2, 4],
	[2, 9, 10, 2, 7, 9, 2, 3, 7, 7, 4, 9],
	[9, 10, 7, 9, 7, 4, 10, 2, 7, 8, 7, 0, 2, 0, 7],
	[3, 7, 10, 3, 10, 2, 7, 4, 10, 1, 10, 0, 4, 0, 10],
	[1, 10, 2, 8, 7, 4],
	[4, 9, 1, 4, 1, 7, 7, 1, 3],
	[4, 9, 1, 4, 1, 7, 0, 8, 1, 8, 7, 1],
	[4, 0, 3, 7, 4, 3],
	[4, 8, 7],
	[9, 10, 8, 10, 11, 8],
	[3, 0, 9, 3, 9, 11, 11, 9, 10],
	[0, 1, 10, 0, 10, 8, 8, 10, 11],
	[3, 1, 10, 11, 3, 10],
	[1, 2, 11, 1, 11, 9, 9, 11, 8],
	[3, 0, 9, 3, 9, 11, 1, 2, 9, 2, 11, 9],
	[0, 2, 11, 8, 0, 11],
	[3, 2, 11],
	[2, 3, 8, 2, 8, 10, 10, 8, 9],
	[9, 10, 2, 0, 9, 2],
	[2, 3, 8, 2, 8, 10, 0, 1, 8, 1, 10, 8],
	[1, 10, 2],
	[1, 3, 8, 9, 1, 8],
	[0, 9, 1],
	[0, 3, 8],
	[]
];

/** Edge index -> [cornerA, cornerB]. */
// prettier-ignore
const EDGE_CORNERS: readonly (readonly [number, number])[] = [
	[0, 1], [1, 2], [2, 3], [3, 0],
	[4, 5], [5, 6], [6, 7], [7, 4],
	[0, 4], [1, 5], [2, 6], [3, 7]
];

/** Corner index -> [dx, dy, dz] within a cell. */
// prettier-ignore
const CORNER_OFFSETS: readonly (readonly [number, number, number])[] = [
	[0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0],
	[0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]
];

/** Floats per output chunk; must be divisible by 3 (~1.5 MB each). */
const CHUNK_FLOATS = 3 * 131072;

interface FloatAccumulator {
	push3(a: number, b: number, c: number): void;
	finish(): Float32Array;
}

function makeAccumulator(): FloatAccumulator {
	const chunks: Float32Array[] = [];
	let cur = new Float32Array(CHUNK_FLOATS);
	let fill = 0;
	return {
		push3(a: number, b: number, c: number): void {
			if (fill === CHUNK_FLOATS) {
				chunks.push(cur);
				cur = new Float32Array(CHUNK_FLOATS);
				fill = 0;
			}
			cur[fill] = a;
			cur[fill + 1] = b;
			cur[fill + 2] = c;
			fill += 3;
		},
		finish(): Float32Array {
			const total = chunks.length * CHUNK_FLOATS + fill;
			const out = new Float32Array(total);
			let off = 0;
			for (const c of chunks) {
				out.set(c, off);
				off += c.length;
			}
			out.set(cur.subarray(0, fill), off);
			return out;
		}
	};
}

/**
 * Extract an isosurface from a scalar volume.
 *
 * @param data       scalar volume, x fastest then y then z
 * @param dims       [nx, ny, nz] voxel counts
 * @param spacing    [sx, sy, sz] voxel size in mm
 * @param isoLevel   isosurface threshold
 * @param downsample integer stride applied on all axes (1 = full res)
 * @returns triangle soup positions (mm) and matching unit normals,
 *          both of length divisible by 9
 */
export function marchingCubes(
	data: Int16Array | Uint8Array,
	dims: [number, number, number],
	spacing: [number, number, number],
	isoLevel: number,
	downsample = 1
): { positions: Float32Array; normals: Float32Array } {
	const step = Math.max(1, Math.floor(downsample));
	const nx = dims[0];
	const ny = dims[1];
	const nz = dims[2];
	// Sampled grid: point i maps to original voxel i * step.
	const gx = Math.floor((nx - 1) / step) + 1;
	const gy = Math.floor((ny - 1) / step) + 1;
	const gz = Math.floor((nz - 1) / step) + 1;

	const positions = makeAccumulator();
	const normals = makeAccumulator();

	if (gx < 2 || gy < 2 || gz < 2) {
		return { positions: positions.finish(), normals: normals.finish() };
	}

	// mm per sampled-grid unit on each axis.
	const mmX = spacing[0] * step;
	const mmY = spacing[1] * step;
	const mmZ = spacing[2] * step;

	const nxny = nx * ny;

	/** Trilinear sample of the volume at fractional original-voxel coords (clamped). */
	function sampleTrilinear(x: number, y: number, z: number): number {
		const cx = x < 0 ? 0 : x > nx - 1 ? nx - 1 : x;
		const cy = y < 0 ? 0 : y > ny - 1 ? ny - 1 : y;
		const cz = z < 0 ? 0 : z > nz - 1 ? nz - 1 : z;
		const x0 = Math.floor(cx);
		const y0 = Math.floor(cy);
		const z0 = Math.floor(cz);
		const x1 = Math.min(nx - 1, x0 + 1);
		const y1 = Math.min(ny - 1, y0 + 1);
		const z1 = Math.min(nz - 1, z0 + 1);
		const fx = cx - x0;
		const fy = cy - y0;
		const fz = cz - z0;
		const b0 = z0 * nxny;
		const b1 = z1 * nxny;
		const r00 = b0 + y0 * nx;
		const r01 = b0 + y1 * nx;
		const r10 = b1 + y0 * nx;
		const r11 = b1 + y1 * nx;
		const v000 = data[r00 + x0];
		const v100 = data[r00 + x1];
		const v010 = data[r01 + x0];
		const v110 = data[r01 + x1];
		const v001 = data[r10 + x0];
		const v101 = data[r10 + x1];
		const v011 = data[r11 + x0];
		const v111 = data[r11 + x1];
		const c00 = v000 + (v100 - v000) * fx;
		const c01 = v010 + (v110 - v010) * fx;
		const c10 = v001 + (v101 - v001) * fx;
		const c11 = v011 + (v111 - v011) * fx;
		const c0 = c00 + (c01 - c00) * fy;
		const c1 = c10 + (c11 - c10) * fy;
		return c0 + (c1 - c0) * fz;
	}

	const NORMAL_OUT = new Float32Array(3);
	/**
	 * Unit normal at fractional original-voxel coords: negative volume gradient
	 * (central differences in mm space), so it points outward from high values.
	 */
	function normalAt(x: number, y: number, z: number): Float32Array {
		const h = step;
		let dx = (sampleTrilinear(x + h, y, z) - sampleTrilinear(x - h, y, z)) / (2 * h * spacing[0]);
		let dy = (sampleTrilinear(x, y + h, z) - sampleTrilinear(x, y - h, z)) / (2 * h * spacing[1]);
		let dz = (sampleTrilinear(x, y, z + h) - sampleTrilinear(x, y, z - h)) / (2 * h * spacing[2]);
		const len = Math.hypot(dx, dy, dz);
		if (len > 1e-12) {
			dx /= -len;
			dy /= -len;
			dz /= -len;
		} else {
			dx = 0;
			dy = 0;
			dz = 1;
		}
		NORMAL_OUT[0] = dx;
		NORMAL_OUT[1] = dy;
		NORMAL_OUT[2] = dz;
		return NORMAL_OUT;
	}

	// Two slabs of sampled values (slab z and slab z+1), reused as we sweep.
	const slabSize = gx * gy;
	let below = new Float32Array(slabSize);
	let above = new Float32Array(slabSize);

	function fillSlab(buf: Float32Array, zi: number): void {
		const zOff = zi * step * nxny;
		let k = 0;
		for (let y = 0; y < gy; y++) {
			const rowOff = zOff + y * step * nx;
			for (let x = 0; x < gx; x++) {
				buf[k++] = data[rowOff + x * step];
			}
		}
	}

	fillSlab(below, 0);

	// Per-cell scratch.
	const cv = new Float64Array(8);
	const ex = new Float64Array(12);
	const ey = new Float64Array(12);
	const ez = new Float64Array(12);
	const enx = new Float64Array(12);
	const eny = new Float64Array(12);
	const enz = new Float64Array(12);

	for (let z = 0; z < gz - 1; z++) {
		fillSlab(above, z + 1);

		for (let y = 0; y < gy - 1; y++) {
			const r0 = y * gx;
			const r1 = (y + 1) * gx;
			for (let x = 0; x < gx - 1; x++) {
				cv[0] = below[r0 + x];
				cv[1] = below[r0 + x + 1];
				cv[2] = below[r1 + x + 1];
				cv[3] = below[r1 + x];
				cv[4] = above[r0 + x];
				cv[5] = above[r0 + x + 1];
				cv[6] = above[r1 + x + 1];
				cv[7] = above[r1 + x];

				let cubeIndex = 0;
				if (cv[0] < isoLevel) cubeIndex |= 1;
				if (cv[1] < isoLevel) cubeIndex |= 2;
				if (cv[2] < isoLevel) cubeIndex |= 4;
				if (cv[3] < isoLevel) cubeIndex |= 8;
				if (cv[4] < isoLevel) cubeIndex |= 16;
				if (cv[5] < isoLevel) cubeIndex |= 32;
				if (cv[6] < isoLevel) cubeIndex |= 64;
				if (cv[7] < isoLevel) cubeIndex |= 128;

				const edgeMask = EDGE_TABLE[cubeIndex];
				if (edgeMask === 0) continue;

				for (let e = 0; e < 12; e++) {
					if ((edgeMask & (1 << e)) === 0) continue;
					const a = EDGE_CORNERS[e][0];
					const b = EDGE_CORNERS[e][1];
					const va = cv[a];
					const vb = cv[b];
					const denom = vb - va;
					let t = Math.abs(denom) < 1e-12 ? 0.5 : (isoLevel - va) / denom;
					if (t < 0) t = 0;
					else if (t > 1) t = 1;
					const oa = CORNER_OFFSETS[a];
					const ob = CORNER_OFFSETS[b];
					const px = x + oa[0] + t * (ob[0] - oa[0]);
					const py = y + oa[1] + t * (ob[1] - oa[1]);
					const pz = z + oa[2] + t * (ob[2] - oa[2]);
					ex[e] = px;
					ey[e] = py;
					ez[e] = pz;
					const n = normalAt(px * step, py * step, pz * step);
					enx[e] = n[0];
					eny[e] = n[1];
					enz[e] = n[2];
				}

				const tris = TRI_TABLE[cubeIndex];
				for (let i = 0; i < tris.length; i++) {
					const e = tris[i];
					positions.push3(ex[e] * mmX, ey[e] * mmY, ez[e] * mmZ);
					normals.push3(enx[e], eny[e], enz[e]);
				}
			}
		}

		// Swap slabs: current "above" becomes next iteration's "below".
		const tmp = below;
		below = above;
		above = tmp;
	}

	return { positions: positions.finish(), normals: normals.finish() };
}
