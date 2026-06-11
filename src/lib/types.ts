export interface Patient {
	id: number;
	external_id: string;
	first_name: string;
	last_name: string;
	date_of_birth: string;
	sex: string;
	notes: string;
	/** JSON stash of the original identity while the patient is anonymized; '' = not anonymized */
	real_data: string;
	created_at: string;
	updated_at: string;
}

export type CaseStatus = 'new' | 'planning' | 'finalized';

export interface Case {
	id: number;
	patient_id: number;
	title: string;
	status: CaseStatus;
	notes: string;
	created_at: string;
	updated_at: string;
}

export interface Dataset {
	id: number;
	case_id: number;
	kind: string;
	description: string;
	cols: number;
	rows: number;
	slices: number;
	spacing_x: number;
	spacing_y: number;
	spacing_z: number;
	window_center: number;
	window_width: number;
	patient_name: string;
	study_date: string;
	modality: string;
	series_description: string;
	volume_path: string;
	preview_path: string;
	preview_cols: number;
	preview_rows: number;
	preview_slices: number;
	status: string;
	locked?: number;
	import_warnings?: string;
	gray_lo?: number;
	gray_hi?: number;
	created_at: string;
}

export interface Model {
	id: number;
	case_id: number;
	name: string;
	kind: 'scan' | 'segmentation' | 'guide' | 'waxup' | 'other';
	file_path: string;
	color: string;
	opacity: number;
	visible: number;
	transform: string;
	plan_id: number | null;
	params: string;
	created_at: string;
}

export interface Plan {
	id: number;
	case_id: number;
	name: string;
	is_master: number;
	locked: number;
	approved: number;
	pan_curve: string;
	settings: string;
	jaw: 'mandible' | 'maxilla';
	sent: number;
	guide_stale: number;
	created_at: string;
	updated_at: string;
}

export interface Nerve {
	id: number;
	plan_id: number;
	name: string;
	color: string;
	diameter: number;
	points: string;
	visible: number;
	created_at: string;
}

export interface Implant {
	id: number;
	plan_id: number;
	tooth: string;
	manufacturer: string;
	line: string;
	article: string;
	diameter: number;
	length: number;
	x: number;
	y: number;
	z: number;
	ax: number;
	ay: number;
	az: number;
	rotation: number;
	color: string;
	sleeve: string;
	abutment: string;
	visible: number;
	created_at: string;
}

export interface Measurement {
	id: number;
	plan_id: number;
	type: 'distance' | 'angle' | 'density' | 'polyline' | 'annotation' | 'auxline';
	points: string;
	value: number;
	label: string;
	created_at: string;
}

export interface PatientWithCases extends Patient {
	cases: Case[];
}
