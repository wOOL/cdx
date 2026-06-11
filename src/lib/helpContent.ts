/**
 * Context-sensitive help content (SPEC §13.3).
 *
 * Each entry maps a help topic key to a title and a list of paragraphs.
 * Content is drawn from docs/SPEC.md; topics are referenced by the
 * HelpOverlay component (F1 / per-dialog "?" buttons).
 */
export interface HelpEntry {
	title: string;
	body: string[];
}

export const HELP: Record<string, HelpEntry> = {
	dentaldb: {
		title: 'Patient database & start screen',
		body: [
			'The start screen is the application entry point: create a new dataset from DICOM data, open an existing dataset, or jump to management and collaboration functions. One dataset corresponds to one imported CBCT/CT volume together with all derived objects and one or more treatment plans. Maxilla and mandible are planned as two separate plans, so a single dataset can carry both jaws side by side.',
			'The dataset list shows patient name, date of birth, patient ID and modification info, and can be searched and sorted. Use the work-mode selector to choose between EXPERT (free toolbar-driven planning) and EASY (a guided wizard shell over the same objects); the selected mode is applied when a dataset is opened. Patients can be renamed, anonymized with reversible pseudonymization, or deleted together with their datasets after a confirmation dialog. Deleting a dataset is permanent, so export an archive first when in doubt.'
		]
	},
	data: {
		title: 'Data import (DICOM & model scans)',
		body: [
			'DICOM import accepts axial single-frame series uploaded as files, folders or ZIP archives. Quick transfer auto-detects a valid series and creates the dataset with sensible defaults, while advanced transfer gives manual control over slice selection, grayscale windows, slice distance and region restriction. Validation checks orientation, pixel spacing, resolution and modality consistency; warnings such as resolution below 512×512 or slice width above 1 mm never block the import, but the dataset is flagged as created despite warnings.',
			'Model scans (STL or PLY surface scans) are imported through a wizard: choose the source file, pick a registration object, click at least three corresponding regions alternately on scan and anatomy, then let the automatic surface registration refine the fit. Always verify the merged contours in all views afterwards — matching accuracy directly influences the accuracy of the designed surgical guide. Scans that should not be aligned yet can be imported with deferred matching and aligned later by double-clicking them in the object tree.'
		]
	},
	align: {
		title: 'Patient coordinate system alignment',
		body: [
			'Aligning the patient coordinate system compensates for gantry tilt and patient positioning in the scanner, and it defines the initial orientation of implants and virtual teeth. Make the occlusal plane horizontal and the sagittal plane vertical before placing any implants, because later changes rotate all planned objects with the anatomy.',
			'Use the alignment dialog to rotate the volume in yaw, pitch and roll; the planning views and the panoramic reconstruction follow the new orientation immediately. A reset action restores the default orientation read from the DICOM geometry. After alignment, check the axial view: the dental arch should appear symmetric and the occlusal plane should lie flat across the cross-sectional views.'
		]
	},
	pano: {
		title: 'Panoramic curve',
		body: [
			'The panoramic curve defines the virtual OPG view, the travel path of the cross-sectional views and the initial position of newly inserted implants, so it should be defined right after coordinate-system alignment. Open the curve editor and pick an axial layer that contains both bone and tooth information.',
			'Drag the basic points so the curve follows the center of the dental arch from one retromolar region to the other; click along the curve to add extra points where the arch needs finer control. The panoramic and cross-sectional views regenerate live while you edit. A well-placed curve keeps the cross-sections perpendicular to the arch, which is essential for judging implant angulation in the buccolingual direction.'
		]
	},
	nerve: {
		title: 'Nerve canals',
		body: [
			'Nerve canals are first-class planning objects: an ordered list of points, each with its own diameter (default 2.0 mm), rendered as a pink tube in 3D, as circles where the canal crosses 2D slices, and as a curve in the panoramic view. Trace the inferior alveolar nerve from the mental foramen to the mandibular foramen by clicking points in the panoramic or cross-sectional views; drag points to refine and use the diameter dialog to adjust single points or all points at once.',
			'Automatic detection can trace the radiolucent canal between two seed points, replacing the intermediate points. Automatic nerve detection does not guarantee exact and accurate nerve canal display — always verify the position manually in all views. If the nerve definition is not clear due to poor image quality, the dataset must not be used. The safety engine continuously checks the implant-to-nerve distance (default 2 mm) and warns in the status bar; the warning is advisory and never blocks placement.'
		]
	},
	implant: {
		title: 'Implant planning',
		body: [
			'Implants are chosen from a versioned catalog of manufacturers and series; each item carries article data, lengths and diameters. Pick a tooth position in the dental chart and insert the implant — its initial pose is derived from the panoramic curve and the occlusal plane. Planned items are copied into the plan, so later catalog updates never silently change an existing plan.',
			'Position the implant in any view: left-drag translates, right-drag rotates around the crestal or apical pivot depending on the cursor position. The status bar shows live verification chips for average bone density, distance to other implants (default minimum 3 mm, sleeves included) and distance to the nerve canal (default 2 mm). Use the diameter and length steppers to switch between neighboring catalog sizes, the Make Parallel dialog to align multiple implants, and the angle dialogs to verify prosthetic axes. All distance checks are warnings only — the surgeon stays responsible for the plan.'
		]
	},
	sleeve: {
		title: 'Sleeve planning',
		body: [
			'Every guided trajectory needs a sleeve: the metal guidance that is inserted into the surgical guide. The sleeve dialog lists only systems compatible with the selected implant and shows the system parameters with the sleeve positioned over the implant. Sleeve geometry and position drive the guide’s sleeve mounts, the drill-hole negative geometry and the depth calculations in the surgical protocol.',
			'Sleeve position is selected from the discrete offsets defined by the system (for example H2 / H4 / H6, the distance from sleeve bottom to implant shoulder). The sleeve-to-sleeve collision check is always active with zero tolerance and reports conflicts in the status bar. Custom sleeve systems can be defined for in-house workflows, including sleeveless guides realized through auxiliary sleeves — never drill directly through the guide; always use appropriate metal guidance to avoid chipping.'
		]
	},
	guide: {
		title: 'Surgical guide design',
		body: [
			'The guide designer turns the planning into a printable drill guide. Prerequisites: all implants carry sleeves and a matched model scan (without wax-up) is present. The wizard walks through insertion direction, contact surfaces, sleeve mounts, body parameters and labels; undercuts are blocked out automatically from the chosen insertion direction.',
			'Key parameters are the offset between guide and teeth (default 0.15 mm, printer dependent), wall thickness (default 3.0 mm) and connector thickness (default 2.5 mm); gaps between supports are bridged with automatic connectors. Inspection windows let you verify seating during surgery but must not compromise stability. When the underlying planning changes after the design, the guide is flagged stale and cannot be produced until the design is updated. The finished guide is exported as a binary STL for 3D printing; export requires an approved plan.'
		]
	},
	report: {
		title: 'Reports & printing',
		body: [
			'The print menu generates the production documents for a plan: the material list (a bill of materials of implants, sleeves and abutments with dimensions and tooth positions), the details report with per-implant view captures, and the surgical protocol with the guided drill sequence per implant derived from the sleeve-system protocol definitions.',
			'Every report carries a common header with licensee and patient block plus the tooth-notation note, and a footer with disclaimer and timestamp. Printouts containing images of the dataset are not intended for diagnostic purposes. Reports for production use should be generated from a finalized plan; the plan name and approval status are stamped on the documents. Use Print All to batch-generate a persisted selection of documents.'
		]
	},
	segmentation: {
		title: 'Segmentation & 3D models',
		body: [
			'Segmentation turns voxels into named, colored regions; the 3D view renders these segmented surfaces rather than a raw volume. The first slot is always the threshold segmentation: all voxels inside a high/low density window, reconstructed live as you move the threshold. Lower thresholds capture dense structures such as bone; adjust the window before fine-tuning.',
			'Additional segmentations are edited with brush, flood-fill and boundary tools, slice by slice or propagated automatically across slices — always check propagated slices one by one. Each segmentation shows its volume in milliliters and can be converted into a 3D surface model for use as a guide base or for export. Use source and exclude roles to constrain editing tools to existing regions when separating bone from teeth.'
		]
	},
	images: {
		title: 'Image management',
		body: [
			'Image Management is the per-patient image library: view snapshots, screenshots and imported pictures such as OPGs or clinical photos. Every planning view offers a snapshot button that captures a high-resolution image directly into the library, and the screenshot hotkey follows the filename scheme configured in the settings.',
			'From the library you can open the Image Viewer with one, two or four image panes, browse with the navigation arrows, inspect image information, pan and zoom, or switch to full screen. Images can be downloaded for use in external documentation and travel with dataset archives during export and import.'
		]
	},
	inbox: {
		title: 'Inbox & case transfers',
		body: [
			'The inbox lists incoming and outgoing case transfers between paired accounts. Each transfer activity carries a transfer number and a colored status bar moving through upload, download, import and finished (or rejected) states, so both sides always see where a case stands. Received plans arrive write-protected to preserve the sender’s version.',
			'Sending a plan write-protects it locally and marks it with a Sent label; to continue working, create an editable copy so the transferred version stays in the history. Service requests — such as guide design or fabrication orders to a laboratory — ride on the same transfer mechanism and are non-binding inquiries. Use the search, filters and tidy-up actions to keep the list manageable.'
		]
	},
	contacts: {
		title: 'Contacts',
		body: [
			'Contacts are the account-to-account pairings used for case sharing. Exchange the 7-digit connection code with a colleague or laboratory: one side enters the other’s code, and after pairing both accounts appear in each other’s contact lists, grouped by type.',
			'A paired contact can receive plans, send plans back and exchange service requests through the inbox. Before the first send you must confirm the consent disclaimer covering patient consent and lawful data sharing. Deleting a contact shows a warning and stops future transfers, but transfers already completed remain in the history.'
		]
	},
	settings: {
		title: 'Settings',
		body: [
			'The settings page collects the application defaults: safety distances (implant-to-implant 3 mm and implant-to-nerve 2 mm, both adjustable from 0 to 10 mm and checked against sleeves too), the dental notation used in charts and reports (FDI or Universal), measurement decimal places, cross-sectional view spacing and screenshot naming.',
			'Printout options include the plan comment on the material list and an uploadable practice logo for report headers. Changes apply to new computations immediately; safety-distance changes re-evaluate the live warnings in open plans. The audit log records sensitive events such as finalization, exports, sharing, deletions and anonymization, and user administration lets an admin create additional accounts.'
		]
	},
	account: {
		title: 'Account & management console',
		body: [
			'The account page is the management console for your login: profile data, password change and multi-factor authentication, plus the subscription tier with its feature flags and the remaining guide-export credits. Tiers gate editing capabilities data-driven — viewer accounts open every dataset read-only.',
			'Export credits are decremented when a surgical guide is exported for production; the remaining balance is shown before each export. Work mode (EXPERT or EASY) is stored per user and applied when a dataset is opened. From here you can also reach backup and archive functions for exporting complete datasets including all plans and images.'
		]
	},
	evaluation: {
		title: 'Treatment evaluation',
		body: [
			'Treatment evaluation compares the planned implant positions of a plan with the positions actually achieved after surgery. Two study types are supported: a postoperative model scan with scanbodies, or a postoperative CT/CBCT from which a surface model has been derived. Create a study by picking the case, the plan to evaluate and the postoperative model of that case.',
			'Running a study registers the postoperative model onto the case’s planning base scan with an automatic surface registration (ICP), then finds each implant’s achieved axis in the mesh around the planned trajectory and fits its principal direction. The report lists, per implant, the entry deviation in millimeters, the apex deviation at the planned depth and the angular deviation in degrees, together with the registration quality (RMS). Results can be exported as a CSV table for documentation or scientific evaluation. Implants without enough postoperative surface data around the planned trajectory are reported as insufficient data rather than producing a misleading number.'
		]
	},
	catalogs: {
		title: 'Implant catalogs',
		body: [
			'The implant catalog is server data, versioned and administered here: upload catalog files to add manufacturers, series and items with article data, available lengths and diameters. Active catalog versions are merged into the implant picker used during planning.',
			'Items planned in existing cases are copies — updating or deactivating a catalog never mutates a plan retroactively. Items can be flagged outdated; depending on the plan’s implant-update mode, the user is prompted to keep the outdated article or replace it with the newer version and re-check the plan afterwards. Region availability controls which items appear for which markets.'
		]
	},
	'sleeves-admin': {
		title: 'Custom sleeve systems',
		body: [
			'Custom sleeve systems describe in-house or third-party guidance hardware that is not part of the factory catalog. The wizard collects the geometry — either manual parameters (inner diameter, outer diameter, height, optional article number) or an STL with a defined top side — followed by the position modes the system allows (distance to crestal level, distance to implant top, or complete length for drill-stop systems).',
			'The sleeve-hole step defines the negative geometry subtracted from the guide: computed automatically, designed segment by segment with the editor, or omitted for systems not used with digital guides. Finished definitions are saved as presets that can be exported, imported and deleted, but not edited in place — create a new version instead. A printed calibration matrix can fine-tune hole diameters per sleeve model in 0.01 mm steps.'
		]
	},
	designer: {
		title: 'Implant designer',
		body: [
			'The implant designer creates user-defined implants for systems that are missing from the catalog. Build the geometry segment by segment as a rotational body — each segment with name, height, top and bottom diameter and inclination — or import an STL of the fixture.',
			'Published designs are added to the catalog and behave like factory items in the picker, marked with a user icon; publishing locks the design against further editing so already-planned cases stay consistent. Use realistic dimensions and verify the crestal diameter against the intended sleeve system, because the guide’s drill holes and the surgical protocol are derived from these values.'
		]
	}
};
