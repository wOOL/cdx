import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { getPatient, listImages } from '$lib/server/db/repo';

export const load: PageServerLoad = async ({ params }) => {
	const patient = getPatient(Number(params.id));
	if (!patient) error(404, 'Patient not found');
	return { patient, images: listImages(patient.id) };
};
