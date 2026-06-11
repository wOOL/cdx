/**
 * Minimal Markdown → HTML renderer for the bundled manual.
 * Supports: #-headings, paragraphs, **bold**, *italic*, `code`, [links](…),
 * ![images](…), tables, blockquotes, unordered/ordered lists, --- rules.
 * Not a general-purpose renderer — just enough for docs/manual/*.md.
 */

function esc(s: string): string {
	return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function inline(s: string): string {
	let out = esc(s);
	// images before links (shared bracket syntax)
	out = out.replace(
		/!\[([^\]]*)\]\(([^)\s]+)\)/g,
		(_m, alt, src) => `<img src="${src}" alt="${alt}" loading="lazy" />`
	);
	out = out.replace(
		/\[([^\]]+)\]\(([^)\s]+)\)/g,
		(_m, text, href) => `<a href="${href}">${text}</a>`
	);
	out = out.replace(/`([^`]+)`/g, '<code>$1</code>');
	out = out.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
	out = out.replace(/\*([^*]+)\*/g, '<em>$1</em>');
	return out;
}

export function renderMarkdown(md: string, imgPrefix = ''): string {
	const src = imgPrefix ? md.replace(/\]\(img\//g, `](${imgPrefix}img/`) : md;
	const lines = src.split('\n');
	const html: string[] = [];
	let i = 0;

	const isTableRow = (l: string) => /^\s*\|.*\|\s*$/.test(l);
	const isSepRow = (l: string) => /^\s*\|[\s:|-]+\|\s*$/.test(l);

	while (i < lines.length) {
		const line = lines[i];

		if (!line.trim()) {
			i++;
			continue;
		}

		const h = line.match(/^(#{1,4})\s+(.*)$/);
		if (h) {
			const lvl = h[1].length;
			const text = h[2];
			const id = text
				.toLowerCase()
				.replace(/[^a-z0-9\s-]/g, '')
				.trim()
				.replace(/\s+/g, '-');
			html.push(`<h${lvl} id="${id}">${inline(text)}</h${lvl}>`);
			i++;
			continue;
		}

		if (/^---+\s*$/.test(line)) {
			html.push('<hr />');
			i++;
			continue;
		}

		if (line.startsWith('>')) {
			const quote: string[] = [];
			while (i < lines.length && lines[i].startsWith('>')) {
				quote.push(lines[i].replace(/^>\s?/, ''));
				i++;
			}
			html.push(`<blockquote>${renderMarkdown(quote.join('\n'), imgPrefix)}</blockquote>`);
			continue;
		}

		if (line.startsWith('```')) {
			const code: string[] = [];
			i++;
			while (i < lines.length && !lines[i].startsWith('```')) {
				code.push(lines[i]);
				i++;
			}
			i++;
			html.push(`<pre><code>${esc(code.join('\n'))}</code></pre>`);
			continue;
		}

		if (isTableRow(line) && i + 1 < lines.length && isSepRow(lines[i + 1])) {
			const cells = (l: string) =>
				l
					.trim()
					.replace(/^\||\|$/g, '')
					.split('|')
					.map((c) => c.trim());
			const head = cells(line);
			i += 2;
			const rows: string[][] = [];
			while (i < lines.length && isTableRow(lines[i])) {
				rows.push(cells(lines[i]));
				i++;
			}
			html.push(
				`<table><thead><tr>${head.map((c) => `<th>${inline(c)}</th>`).join('')}</tr></thead>` +
					`<tbody>${rows
						.map((r) => `<tr>${r.map((c) => `<td>${inline(c)}</td>`).join('')}</tr>`)
						.join('')}</tbody></table>`
			);
			continue;
		}

		const ul = line.match(/^(\s*)[-*]\s+(.*)$/);
		const ol = line.match(/^(\s*)\d+\.\s+(.*)$/);
		if (ul || ol) {
			const ordered = !!ol;
			const items: string[] = [];
			const re = ordered ? /^(\s*)\d+\.\s+(.*)$/ : /^(\s*)[-*]\s+(.*)$/;
			let cur = '';
			while (i < lines.length) {
				const m = lines[i].match(re);
				if (m) {
					if (cur) items.push(cur);
					cur = m[2];
					i++;
				} else if (lines[i].trim() && /^\s{2,}/.test(lines[i])) {
					cur += ' ' + lines[i].trim();
					i++;
				} else {
					break;
				}
			}
			if (cur) items.push(cur);
			const tag = ordered ? 'ol' : 'ul';
			html.push(`<${tag}>${items.map((it) => `<li>${inline(it)}</li>`).join('')}</${tag}>`);
			continue;
		}

		// paragraph: gather until blank/structural line
		const para: string[] = [line];
		i++;
		while (
			i < lines.length &&
			lines[i].trim() &&
			!/^(#{1,4}\s|>|```|---|\s*[-*]\s|\s*\d+\.\s)/.test(lines[i]) &&
			!isTableRow(lines[i])
		) {
			para.push(lines[i]);
			i++;
		}
		html.push(`<p>${inline(para.join(' '))}</p>`);
	}

	return html.join('\n');
}
