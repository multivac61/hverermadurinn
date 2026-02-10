<script lang="ts">
  import {
    adminAssignRound,
    adminCreatePerson,
    adminGetRound,
    adminListPersons
  } from './admin.remote';

  let token = '';
  let error = '';
  let success = '';

  let displayName = '';
  let descriptionIs = '';
  let imageUrl = '';
  let aliasesCsv = '';

  let roundId = new Date().toISOString().slice(0, 10);
  let personId = '';
  let hintTextIs = '';

  let people: Array<{ id: string; displayName: string }> = [];
  let roundInfo: { personName: string | null; personId: string; hintTextIs: string | null } | null = null;

  async function refreshPeople() {
    const q = adminListPersons({ token });
    await q;
    people = (q.current?.people ?? []) as Array<{ id: string; displayName: string }>;
  }

  async function refreshRound() {
    const q = adminGetRound({ token, roundId });
    await q;
    roundInfo = (q.current?.round ?? null) as typeof roundInfo;
  }

  async function login() {
    error = '';
    success = '';
    try {
      await refreshPeople();
      await refreshRound();
      success = 'Admin tenging virk.';
    } catch (e) {
      error = (e as Error).message;
    }
  }

  async function createPerson() {
    error = '';
    success = '';
    try {
      await adminCreatePerson({ token, displayName, descriptionIs, imageUrl, aliasesCsv });
      displayName = '';
      descriptionIs = '';
      imageUrl = '';
      aliasesCsv = '';
      await refreshPeople();
      success = 'Persóna búin til.';
    } catch (e) {
      error = (e as Error).message;
    }
  }

  async function assignRound() {
    error = '';
    success = '';
    try {
      await adminAssignRound({ token, roundId, personId, hintTextIs });
      await refreshRound();
      success = 'Dagsetning uppfærð.';
    } catch (e) {
      error = (e as Error).message;
    }
  }
</script>

<main class="mx-auto max-w-3xl px-4 py-10">
  <section class="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-zinc-200">
    <h1 class="text-2xl font-semibold">Admin</h1>
    <p class="mt-2 text-sm text-zinc-600">Stjórna persónum og dagsetningum.</p>

    <div class="mt-4 flex gap-2">
      <input class="w-full rounded-xl border border-zinc-300 px-3 py-2" bind:value={token} placeholder="ADMIN_TOKEN" />
      <button class="rounded-xl bg-zinc-900 px-4 py-2 text-white" on:click={login}>Tengja</button>
    </div>

    {#if error}
      <p class="mt-3 rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>
    {/if}
    {#if success}
      <p class="mt-3 rounded-lg bg-emerald-50 p-3 text-sm text-emerald-700">{success}</p>
    {/if}
  </section>

  <section class="mt-6 rounded-2xl bg-white p-6 shadow-sm ring-1 ring-zinc-200">
    <h2 class="text-xl font-semibold">Ný persóna</h2>
    <div class="mt-4 grid gap-3">
      <input class="rounded-xl border border-zinc-300 px-3 py-2" bind:value={displayName} placeholder="Nafn" />
      <input class="rounded-xl border border-zinc-300 px-3 py-2" bind:value={imageUrl} placeholder="Mynd URL" />
      <input class="rounded-xl border border-zinc-300 px-3 py-2" bind:value={aliasesCsv} placeholder="Aliasar (kommuaðskilið)" />
      <textarea class="min-h-24 rounded-xl border border-zinc-300 px-3 py-2" bind:value={descriptionIs} placeholder="Lýsing á íslensku"></textarea>
      <button class="w-fit rounded-xl bg-indigo-600 px-4 py-2 text-white" on:click={createPerson}>Búa til</button>
    </div>
  </section>

  <section class="mt-6 rounded-2xl bg-white p-6 shadow-sm ring-1 ring-zinc-200">
    <h2 class="text-xl font-semibold">Úthluta degi</h2>
    <div class="mt-4 grid gap-3">
      <input class="rounded-xl border border-zinc-300 px-3 py-2" bind:value={roundId} placeholder="YYYY-MM-DD" />
      <select class="rounded-xl border border-zinc-300 px-3 py-2" bind:value={personId}>
        <option value="">Veldu persónu</option>
        {#each people as person}
          <option value={person.id}>{person.displayName}</option>
        {/each}
      </select>
      <input class="rounded-xl border border-zinc-300 px-3 py-2" bind:value={hintTextIs} placeholder="Vísbending (optional)" />
      <div class="flex gap-2">
        <button class="w-fit rounded-xl bg-zinc-900 px-4 py-2 text-white" on:click={assignRound}>Vista dag</button>
        <button class="w-fit rounded-xl bg-zinc-200 px-4 py-2" on:click={refreshRound}>Sækja dag</button>
      </div>
    </div>

    {#if roundInfo}
      <div class="mt-4 rounded-lg bg-zinc-100 p-3 text-sm">
        <p><strong>Round:</strong> {roundId}</p>
        <p><strong>Person:</strong> {roundInfo.personName ?? 'Óþekkt'} ({roundInfo.personId})</p>
        <p><strong>Hint:</strong> {roundInfo.hintTextIs ?? '—'}</p>
      </div>
    {/if}
  </section>
</main>
