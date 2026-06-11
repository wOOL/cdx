import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getSettings, setSetting } from '$lib/server/db/repo';

const KEY = 'implant_favorites';

function readFavorites(): string[] {
	try {
		const v = JSON.parse(getSettings()[KEY] ?? '[]');
		return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
	} catch {
		return [];
	}
}

export const GET: RequestHandler = () => json({ favorites: readFavorites() });

export const PUT: RequestHandler = async ({ request }) => {
	const body = await request.json().catch(() => null);
	const favorites: unknown = body?.favorites;
	if (!Array.isArray(favorites) || favorites.some((f) => typeof f !== 'string')) {
		error(400, 'favorites must be an array of line keys');
	}
	if (favorites.length > 500) error(400, 'too many favorites');
	const unique = [...new Set(favorites as string[])];
	setSetting(KEY, JSON.stringify(unique));
	return json({ favorites: unique });
};
