<script lang="ts">
	import { invalidateAll } from '$app/navigation';
	import Icon from '$lib/components/Icon.svelte';

	let { data } = $props();

	type Team = (typeof data.teams)[number];

	const ROLES = ['owner', 'editor', 'reader'] as const;
	const OVERRIDE_LEVELS = ['read', 'modify', 'delete'] as const;

	// ---- shared fetch helper ----
	let busy = $state(false);

	async function api(path: string, init: RequestInit): Promise<unknown | null> {
		busy = true;
		try {
			const res = await fetch(path, init);
			const body = await res.json().catch(() => null);
			if (!res.ok) {
				alert((body as { message?: string } | null)?.message ?? 'Request failed');
			}
			// refresh either way so selects bounce back after a rejected change
			await invalidateAll();
			return res.ok ? body : null;
		} finally {
			busy = false;
		}
	}

	const jsonInit = (method: string, body: unknown): RequestInit => ({
		method,
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify(body)
	});

	function userLabel(userId: number): string {
		const u = data.users.find((u) => u.id === Number(userId));
		return u ? u.name || u.email : `user #${userId}`;
	}

	// ---- teams ----
	let newTeamName = $state('');
	// per-team add-member picker state, keyed by team id
	let addUser = $state<Record<number, string>>({});
	let addRole = $state<Record<number, string>>({});

	function createTeam() {
		return api('/api/teams', jsonInit('POST', { name: newTeamName })).then((ok) => {
			if (ok) newTeamName = '';
		});
	}

	function renameTeam(team: Team) {
		const name = prompt('Team name', team.name);
		if (name == null || !name.trim() || name === team.name) return;
		return api(`/api/teams/${team.id}`, jsonInit('PATCH', { name }));
	}

	function deleteTeam(team: Team) {
		if (!confirm(`Delete team “${team.name}”? Its patient access entries are cleared.`)) return;
		return api(`/api/teams/${team.id}`, { method: 'DELETE' });
	}

	function addMember(team: Team) {
		const userId = Number(addUser[team.id]);
		if (!userId) return;
		return api(
			`/api/teams/${team.id}`,
			jsonInit('PATCH', { addMember: { userId, role: addRole[team.id] ?? 'reader' } })
		).then((ok) => {
			if (ok) addUser[team.id] = '';
		});
	}

	function removeMember(team: Team, userId: number) {
		return api(`/api/teams/${team.id}`, jsonInit('PATCH', { removeMember: userId }));
	}

	function setRole(team: Team, userId: number, role: string) {
		return api(`/api/teams/${team.id}`, jsonInit('PATCH', { setRole: { userId, role } }));
	}

	function ownerCount(team: Team): number {
		return team.members.filter((m) => m.role === 'owner').length;
	}

	function isLastOwner(team: Team, userId: number): boolean {
		const m = team.members.find((m) => Number(m.userId) === Number(userId));
		return m?.role === 'owner' && ownerCount(team) <= 1;
	}

	function nonMembers(team: Team) {
		return data.users.filter((u) => !team.members.some((m) => Number(m.userId) === u.id));
	}

	// ---- patient access list ----
	const aclEntries = $derived(
		Object.entries(data.acl).map(([pid, entry]) => ({
			patientId: Number(pid),
			patient: data.patients.find((p) => p.id === Number(pid))?.name ?? `patient #${pid}`,
			teamId: entry.teamId,
			overrides: entry.overrides ?? {}
		}))
	);

	let aclPatient = $state('');
	let aclTeam = $state('');
	// per-entry override picker state, keyed by patient id
	let ovUser = $state<Record<number, string>>({});
	let ovLevel = $state<Record<number, string>>({});

	const unassignedPatients = $derived(
		data.patients.filter((p) => !(String(p.id) in data.acl))
	);

	function putAcl(patientId: number, teamId: number | null, overrides?: Record<string, string>) {
		return api('/api/teams/acl', jsonInit('PUT', { patientId, teamId, overrides }));
	}

	function addEntry() {
		if (!aclPatient || !aclTeam) return;
		return putAcl(Number(aclPatient), Number(aclTeam)).then((ok) => {
			if (ok) aclPatient = '';
		});
	}

	function changeEntryTeam(patientId: number, overrides: Record<string, string>, teamId: string) {
		return putAcl(patientId, Number(teamId), overrides);
	}

	function clearEntry(e: { patientId: number; patient: string }) {
		if (!confirm(`Remove access restrictions for ${e.patient}? Everyone gets full access again.`))
			return;
		return putAcl(e.patientId, null);
	}

	function addOverride(e: { patientId: number; teamId: number; overrides: Record<string, string> }) {
		const userId = ovUser[e.patientId];
		if (!userId) return;
		const overrides = { ...e.overrides, [userId]: ovLevel[e.patientId] ?? 'read' };
		return putAcl(e.patientId, e.teamId, overrides).then((ok) => {
			if (ok) ovUser[e.patientId] = '';
		});
	}

	function removeOverride(
		e: { patientId: number; teamId: number; overrides: Record<string, string> },
		userId: string
	) {
		const overrides = { ...e.overrides };
		delete overrides[userId];
		return putAcl(e.patientId, e.teamId, overrides);
	}

	function teamName(teamId: number): string {
		return data.teams.find((t) => t.id === Number(teamId))?.name ?? `team #${teamId}`;
	}
</script>

<svelte:head>
	<title>Teams — coDiagnostiX Web</title>
</svelte:head>

<header class="appbar">
	<a class="btn ghost" href="/"><Icon name="back" size={18} /></a>
	<div class="brand"><span class="brand-x">co</span>DiagnostiX<span class="brand-web">web</span></div>
	<div class="appbar-sub">Teams & access</div>
	<div class="spacer"></div>
	<a class="btn ghost" href="/settings"><Icon name="settings" size={15} /> Settings</a>
</header>

<div class="teams-wrap">
	<!-- policy explainer -->
	<div class="panel policy">
		<div class="panel-header">Access policy</div>
		<div class="policy-body">
			<p>
				Patients without an access list are fully accessible to everyone (single-practice
				default). Assigning a team restricts access by role:
				<span class="chip role-owner">owner → delete</span>
				<span class="chip role-editor">editor → modify</span>
				<span class="chip role-reader">reader → read</span>
				— non-members keep read-only visibility.
			</p>
			<p class="muted">
				Per-user overrides combine with the role and the <strong>most restrictive wins</strong>:
				an editor overridden to “read” only reads, and a reader overridden to “delete” still only
				reads. Team owners hold full access by role; only an explicit override on the owner can
				restrict it.
			</p>
		</div>
	</div>

	<!-- teams -->
	<div class="panel">
		<div class="panel-header">Teams</div>
		<div class="teams-body">
			<div class="new-team">
				<input
					placeholder="New team name…"
					bind:value={newTeamName}
					onkeydown={(e) => e.key === 'Enter' && createTeam()}
				/>
				<button class="btn primary" onclick={createTeam} disabled={busy || !newTeamName.trim()}>
					<Icon name="plus" size={14} /> Create team
				</button>
			</div>

			{#if data.teams.length}
				<div class="team-cards">
					{#each data.teams as team (team.id)}
						<div class="team-card">
							<div class="team-head">
								<span class="team-name">{team.name}</span>
								<span class="muted">{team.members.length} member{team.members.length === 1 ? '' : 's'}</span>
								<span class="team-actions">
									<button class="btn ghost" onclick={() => renameTeam(team)} disabled={busy} title="Rename team"><Icon name="edit" size={13} /></button>
									<button class="btn ghost" onclick={() => deleteTeam(team)} disabled={busy} title="Delete team (clears its patient access entries)"><Icon name="trash" size={13} /></button>
								</span>
							</div>
							<div class="member-chips">
								{#each team.members as m (m.userId)}
									<span class="member-chip role-{m.role}">
										<Icon name="patient" size={12} />
										{userLabel(m.userId)}
										<select
											value={m.role}
											disabled={busy}
											title={isLastOwner(team, m.userId)
												? 'The last owner cannot be demoted'
												: 'Change role'}
											onchange={(e) => setRole(team, Number(m.userId), e.currentTarget.value)}
										>
											{#each ROLES as r (r)}<option value={r}>{r}</option>{/each}
										</select>
										<button
											class="chip-x"
											disabled={busy || isLastOwner(team, m.userId)}
											title={isLastOwner(team, m.userId)
												? 'The last owner cannot be removed'
												: 'Remove member'}
											onclick={() => removeMember(team, Number(m.userId))}><Icon name="close" size={11} /></button>
									</span>
								{/each}
							</div>
							<div class="add-member">
								<select bind:value={addUser[team.id]} disabled={busy || !nonMembers(team).length}>
									<option value="">{nonMembers(team).length ? 'Add member…' : 'All users are members'}</option>
									{#each nonMembers(team) as u (u.id)}
										<option value={String(u.id)}>{u.name || u.email}</option>
									{/each}
								</select>
								<select bind:value={addRole[team.id]} disabled={busy}>
									{#each ROLES as r (r)}<option value={r} selected={r === 'reader'}>{r}</option>{/each}
								</select>
								<button class="btn" onclick={() => addMember(team)} disabled={busy || !addUser[team.id]}>
									<Icon name="plus" size={13} /> Add
								</button>
							</div>
						</div>
					{/each}
				</div>
			{:else}
				<p class="muted empty">No teams yet — create one to manage per-patient access.</p>
			{/if}
		</div>
	</div>

	<!-- patient access list -->
	<div class="panel">
		<div class="panel-header">Patient access list</div>
		<div class="teams-body">
			<div class="new-team">
				<select bind:value={aclPatient} disabled={busy || !unassignedPatients.length}>
					<option value="">{unassignedPatients.length ? 'Patient…' : 'All patients assigned'}</option>
					{#each unassignedPatients as p (p.id)}
						<option value={String(p.id)}>{p.name || `patient #${p.id}`}</option>
					{/each}
				</select>
				<select bind:value={aclTeam} disabled={busy || !data.teams.length}>
					<option value="">{data.teams.length ? 'Team…' : 'Create a team first'}</option>
					{#each data.teams as t (t.id)}
						<option value={String(t.id)}>{t.name}</option>
					{/each}
				</select>
				<button class="btn primary" onclick={addEntry} disabled={busy || !aclPatient || !aclTeam}>
					<Icon name="plus" size={14} /> Restrict patient
				</button>
			</div>

			{#if aclEntries.length}
				<table class="acl-table">
					<thead>
						<tr>
							<th>Patient</th>
							<th>Team</th>
							<th>Per-user overrides</th>
							<th></th>
						</tr>
					</thead>
					<tbody>
						{#each aclEntries as e (e.patientId)}
							<tr>
								<td>{e.patient}</td>
								<td>
									<select
										value={String(e.teamId)}
										disabled={busy}
										title="Reassign team ({teamName(e.teamId)})"
										onchange={(ev) => changeEntryTeam(e.patientId, e.overrides, ev.currentTarget.value)}
									>
										{#each data.teams as t (t.id)}
											<option value={String(t.id)}>{t.name}</option>
										{/each}
									</select>
								</td>
								<td>
									<div class="override-rows">
										{#each Object.entries(e.overrides) as [uid, level] (uid)}
											<span class="member-chip ov-{level}">
												{userLabel(Number(uid))} → {level}
												<button class="chip-x" disabled={busy} title="Remove override" onclick={() => removeOverride(e, uid)}><Icon name="close" size={11} /></button>
											</span>
										{/each}
										<span class="ov-add">
											<select bind:value={ovUser[e.patientId]} disabled={busy}>
												<option value="">Override user…</option>
												{#each data.users as u (u.id)}
													<option value={String(u.id)}>{u.name || u.email}</option>
												{/each}
											</select>
											<select bind:value={ovLevel[e.patientId]} disabled={busy}>
												{#each OVERRIDE_LEVELS as l (l)}<option value={l} selected={l === 'read'}>{l}</option>{/each}
											</select>
											<button class="btn" onclick={() => addOverride(e)} disabled={busy || !ovUser[e.patientId]}>Set</button>
										</span>
									</div>
								</td>
								<td class="row-actions">
									<button class="btn ghost" onclick={() => clearEntry(e)} disabled={busy} title="Clear restrictions — back to full access for everyone">
										<Icon name="trash" size={13} />
									</button>
								</td>
							</tr>
						{/each}
					</tbody>
				</table>
			{:else}
				<p class="muted empty">
					No restrictions yet — every patient is fully accessible to all users.
				</p>
			{/if}
		</div>
	</div>
</div>

<style>
	.appbar {
		display: flex;
		align-items: center;
		gap: 14px;
		padding: 0 16px;
		height: 48px;
		background: var(--bg-0);
		border-bottom: 1px solid var(--border-soft);
		flex: none;
	}
	.brand {
		font-size: 17px;
		font-weight: 700;
	}
	.brand-x {
		color: var(--accent-bright);
		font-weight: 400;
	}
	.brand-web {
		font-size: 10px;
		color: var(--accent-2);
		vertical-align: super;
		margin-left: 3px;
		font-weight: 600;
		text-transform: uppercase;
	}
	.appbar-sub {
		color: var(--text-dim);
		border-left: 1px solid var(--border);
		padding-left: 14px;
	}
	.spacer {
		flex: 1;
	}
	.teams-wrap {
		flex: 1;
		overflow-y: auto;
		padding: 24px;
		display: flex;
		flex-direction: column;
		gap: 16px;
		max-width: 1100px;
		margin: 0 auto;
		width: 100%;
	}
	.policy {
		border-color: var(--accent-dim);
	}
	.policy-body {
		padding: 12px 14px;
		font-size: 12px;
		display: flex;
		flex-direction: column;
		gap: 8px;
	}
	.policy-body p {
		margin: 0;
	}
	.teams-body {
		padding: 14px;
		display: flex;
		flex-direction: column;
		gap: 14px;
	}
	.new-team {
		display: flex;
		gap: 10px;
		align-items: center;
	}
	.new-team input {
		flex: 1;
		max-width: 320px;
	}
	.team-cards {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(420px, 1fr));
		gap: 12px;
	}
	.team-card {
		border: 1px solid var(--border);
		border-radius: var(--radius);
		background: var(--bg-1);
		padding: 12px;
		display: flex;
		flex-direction: column;
		gap: 10px;
	}
	.team-head {
		display: flex;
		align-items: center;
		gap: 10px;
	}
	.team-name {
		font-weight: 700;
		font-size: 13px;
	}
	.team-actions {
		margin-left: auto;
		display: flex;
		gap: 4px;
	}
	.member-chips,
	.override-rows {
		display: flex;
		flex-wrap: wrap;
		gap: 6px;
		align-items: center;
	}
	.member-chip {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		padding: 2px 6px 2px 8px;
		border-radius: 12px;
		font-size: 11px;
		border: 1px solid var(--border);
		background: var(--bg-3);
	}
	.member-chip select {
		font-size: 11px;
		padding: 0 2px;
		background: var(--bg-0);
	}
	.member-chip.role-owner {
		border-color: var(--accent-bright);
	}
	.member-chip.role-editor {
		border-color: var(--accent-2);
	}
	.member-chip.role-reader {
		border-color: var(--border);
	}
	.member-chip.ov-read {
		border-color: var(--border);
	}
	.member-chip.ov-modify {
		border-color: var(--accent-2);
	}
	.member-chip.ov-delete {
		border-color: var(--accent-bright);
	}
	.chip-x {
		border: 0;
		background: transparent;
		color: var(--text-dim);
		display: inline-flex;
		align-items: center;
		padding: 1px;
		border-radius: 50%;
	}
	.chip-x:hover:not(:disabled) {
		color: var(--red);
	}
	.chip-x:disabled {
		opacity: 0.35;
	}
	.add-member {
		display: flex;
		gap: 8px;
		align-items: center;
	}
	.add-member select {
		font-size: 11px;
	}
	.chip {
		display: inline-block;
		padding: 1px 9px;
		border-radius: 10px;
		font-size: 11px;
		border: 1px solid var(--border);
		background: var(--bg-3);
		color: var(--text-dim);
	}
	.chip.role-owner {
		color: var(--accent-bright);
		border-color: var(--accent-dim);
	}
	.chip.role-editor {
		color: var(--accent-2);
		border-color: var(--accent-2);
	}
	.chip.role-reader {
		color: var(--text-dim);
	}
	.acl-table {
		width: 100%;
		border-collapse: collapse;
		font-size: 12px;
	}
	.acl-table th,
	.acl-table td {
		border-bottom: 1px solid var(--border-soft);
		padding: 8px 10px;
		text-align: left;
		vertical-align: top;
	}
	.acl-table th {
		font-size: 10px;
		text-transform: uppercase;
		letter-spacing: 0.4px;
		color: var(--text-dim);
	}
	.ov-add {
		display: inline-flex;
		gap: 6px;
		align-items: center;
	}
	.ov-add select,
	.ov-add :global(.btn) {
		font-size: 11px;
	}
	.row-actions {
		white-space: nowrap;
		text-align: right;
	}
	.row-actions :global(.btn) {
		padding: 2px 8px;
		font-size: 11px;
	}
	.empty {
		padding: 16px;
		text-align: center;
	}
</style>
