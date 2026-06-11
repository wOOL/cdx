import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { PageServerLoad } from './$types';
import { renderMarkdown } from '$lib/server/markdown';

const MANUAL_DIR = process.env.CDX_MANUAL_DIR ?? join(process.cwd(), 'docs', 'manual');

export const load: PageServerLoad = async () => {
	let chapters: { id: string; title: string; html: string }[] = [];
	try {
		const files = readdirSync(MANUAL_DIR)
			.filter((f) => /^\d{2}-.*\.md$/.test(f))
			.sort();
		chapters = files.map((f) => {
			const md = readFileSync(join(MANUAL_DIR, f), 'utf-8');
			const title = md.match(/^#\s+(.*)$/m)?.[1] ?? f;
			return { id: f.replace(/\.md$/, ''), title, html: renderMarkdown(md, '/manual/') };
		});
	} catch {
		chapters = [];
	}
	return { chapters };
};
