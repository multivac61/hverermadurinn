<script lang="ts">
  import {
    adminAssignRound,
    adminCreatePerson,
    adminGetRound,
    adminListPersons,
    adminListSubmissions
  } from './admin.remote';

  let token = '';
  let error = '';
  let success = '';

  let displayName = '';
  let descriptionIs = '';
  let imageUrl = '';
  let aliasesCsv = '';
  let isIcelander = 'unknown';
  let yesKeywordsCsv = '';
  let noKeywordsCsv = '';

  let roundId = new Date().toISOString().slice(0, 10);
  let personId = '';
  let hintTextIs = '';

  let people: Array<{ id: string; displayName: string }> = [];
  let roundInfo: { personName: string | null; personId: string; hintTextIs: string | null } | null = null;
  let submissionRoundId = roundId;
  let submissionLimit = 150;
  let submissionsFlaggedOnly = false;
  let submissionStats = {
    total: 0,
    flagged: 0,
    unknownAnswers: 0,
    guesses: 0,
    correctGuesses: 0
  };
  let submissions: Array<{
    id: string;
    roundId: string;
    sessionId: string;
    username: string | null;
    inputText: string;
    intentKind: string;
    resolvedKind: string;
    expectedIntentKind: string;
    likelyMismatch: boolean;
    reviewFlags: string[];
    normalizedGuessText: string | null;
    answerLabel: string | null;
    answerTextIs: string | null;
    guessCorrect: boolean | null;
    questionCount: number;
    remaining: number;
    createdAt: number | null;
  }> = [];

  function normalizeAdminError(errorInput: unknown) {
    const raw = errorInput instanceof Error ? errorInput.message : String(errorInput ?? 'UNKNOWN_ERROR');

    if (raw.includes('Remote function schema validation failed')) {
      if (raw.includes("min_length") || raw.includes('>=1')) {
        return 'Vantar ADMIN_TOKEN.';
      }
      return 'Ógild gögn í beiðni. Athugaðu reiti og reyndu aftur.';
    }

    if (raw === 'ADMIN_TOKEN_MISSING') return 'Sláðu inn ADMIN_TOKEN.';
    if (raw === 'UNAUTHORIZED') return 'Rangt ADMIN_TOKEN.';
    if (raw === 'ADMIN_TOKEN_NOT_CONFIGURED') return 'ADMIN_TOKEN er ekki stillt í umhverfi.';
    if (raw === 'DB_NOT_CONFIGURED') return 'Gagnagrunnur er ekki stilltur.';
    if (raw === 'PERSON_NOT_FOUND') return 'Persóna fannst ekki.';

    return raw;
  }

  function getRequiredToken() {
    const value = token.trim();
    if (!value) throw new Error('ADMIN_TOKEN_MISSING');
    return value;
  }

  async function refreshPeople(adminToken: string) {
    const result = await adminListPersons({ token: adminToken });
    people = (result.people ?? []) as Array<{ id: string; displayName: string }>;
  }

  async function refreshRound(adminToken: string) {
    const result = await adminGetRound({ token: adminToken, roundId });
    roundInfo = (result.round ?? null) as typeof roundInfo;
  }

  async function refreshSubmissions(adminToken: string) {
    const result = await adminListSubmissions({
      token: adminToken,
      roundId: submissionRoundId.trim() || undefined,
      limit: submissionLimit,
      flaggedOnly: submissionsFlaggedOnly
    });

    submissions = (result.submissions ?? []) as typeof submissions;
    submissionStats =
      (result.stats as typeof submissionStats | undefined) ??
      ({ total: 0, flagged: 0, unknownAnswers: 0, guesses: 0, correctGuesses: 0 } as typeof submissionStats);
  }

  async function login() {
    error = '';
    success = '';
    try {
      const adminToken = getRequiredToken();
      await refreshPeople(adminToken);
      await refreshRound(adminToken);
      await refreshSubmissions(adminToken);
      success = 'Admin tenging virk.';
    } catch (e) {
      error = normalizeAdminError(e);
      success = '';
    }
  }

  async function createPerson() {
    error = '';
    success = '';
    try {
      const adminToken = getRequiredToken();
      await adminCreatePerson({
        token: adminToken,
        displayName,
        descriptionIs,
        imageUrl,
        aliasesCsv,
        isIcelander: isIcelander === 'unknown' ? undefined : isIcelander === 'yes',
        yesKeywordsCsv,
        noKeywordsCsv
      });
      displayName = '';
      descriptionIs = '';
      imageUrl = '';
      aliasesCsv = '';
      isIcelander = 'unknown';
      yesKeywordsCsv = '';
      noKeywordsCsv = '';
      await refreshPeople(adminToken);
      success = 'Persóna búin til.';
    } catch (e) {
      error = normalizeAdminError(e);
      success = '';
    }
  }

  async function assignRound() {
    error = '';
    success = '';
    try {
      const adminToken = getRequiredToken();
      await adminAssignRound({ token: adminToken, roundId, personId, hintTextIs });
      await refreshRound(adminToken);
      success = 'Dagsetning uppfærð.';
    } catch (e) {
      error = normalizeAdminError(e);
      success = '';
    }
  }

  async function refreshRoundFromUi() {
    error = '';
    try {
      const adminToken = getRequiredToken();
      await refreshRound(adminToken);
    } catch (e) {
      error = normalizeAdminError(e);
    }
  }

  async function refreshSubmissionsFromUi() {
    error = '';
    try {
      const adminToken = getRequiredToken();
      await refreshSubmissions(adminToken);
    } catch (e) {
      error = normalizeAdminError(e);
    }
  }

  function formatDate(value: number | null) {
    if (!value) return '—';
    return new Date(value).toLocaleString('is-IS');
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
      <select class="rounded-xl border border-zinc-300 px-3 py-2" bind:value={isIcelander}>
        <option value="unknown">Þjóðerni óskráð</option>
        <option value="yes">Íslendingur</option>
        <option value="no">Ekki Íslendingur</option>
      </select>
      <input
        class="rounded-xl border border-zinc-300 px-3 py-2"
        bind:value={yesKeywordsCsv}
        placeholder="Já-lykilorð (kommuaðskilið, optional)"
      />
      <input
        class="rounded-xl border border-zinc-300 px-3 py-2"
        bind:value={noKeywordsCsv}
        placeholder="Nei-lykilorð (kommuaðskilið, optional)"
      />
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
        <button class="w-fit rounded-xl bg-zinc-200 px-4 py-2" on:click={refreshRoundFromUi}>Sækja dag</button>
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

  <section class="mt-6 rounded-2xl bg-white p-6 shadow-sm ring-1 ring-zinc-200">
    <h2 class="text-xl font-semibold">Læstar innsendingar</h2>
    <p class="mt-2 text-sm text-zinc-600">Append-only listi til að rýna intent og svör eftir á.</p>

    <div class="mt-4 grid gap-3 sm:grid-cols-[1fr_auto_auto] sm:items-end">
      <input class="rounded-xl border border-zinc-300 px-3 py-2" bind:value={submissionRoundId} placeholder="Round (YYYY-MM-DD eða autt)" />
      <input class="rounded-xl border border-zinc-300 px-3 py-2" bind:value={submissionLimit} type="number" min="1" max="500" />
      <button class="rounded-xl bg-zinc-900 px-4 py-2 text-white" on:click={refreshSubmissionsFromUi}>Sækja innsendingar</button>
    </div>

    <label class="mt-3 inline-flex items-center gap-2 text-sm text-zinc-700">
      <input type="checkbox" bind:checked={submissionsFlaggedOnly} />
      Sýna aðeins líkleg intent-frávik
    </label>

    <div class="mt-4 grid gap-2 sm:grid-cols-5">
      <div class="rounded-lg bg-zinc-100 px-3 py-2 text-xs"><strong>Alls:</strong> {submissionStats.total}</div>
      <div class="rounded-lg bg-zinc-100 px-3 py-2 text-xs"><strong>Frávik:</strong> {submissionStats.flagged}</div>
      <div class="rounded-lg bg-zinc-100 px-3 py-2 text-xs"><strong>Unknown:</strong> {submissionStats.unknownAnswers}</div>
      <div class="rounded-lg bg-zinc-100 px-3 py-2 text-xs"><strong>Gisk:</strong> {submissionStats.guesses}</div>
      <div class="rounded-lg bg-zinc-100 px-3 py-2 text-xs"><strong>Rétt gisk:</strong> {submissionStats.correctGuesses}</div>
    </div>

    {#if submissions.length === 0}
      <p class="mt-4 text-sm text-zinc-600">Engar innsendingar fundust.</p>
    {:else}
      <div class="mt-4 max-h-[28rem] overflow-auto rounded-xl border border-zinc-200">
        <table class="w-full min-w-[980px] text-left text-xs">
          <thead class="sticky top-0 bg-zinc-100 text-zinc-700">
            <tr>
              <th class="px-3 py-2">Tími</th>
              <th class="px-3 py-2">Round</th>
              <th class="px-3 py-2">Notandi</th>
              <th class="px-3 py-2">Input</th>
              <th class="px-3 py-2">Intent</th>
              <th class="px-3 py-2">Expected</th>
              <th class="px-3 py-2">Resolved</th>
              <th class="px-3 py-2">Flags</th>
              <th class="px-3 py-2">Svar</th>
              <th class="px-3 py-2">QC/Rem</th>
            </tr>
          </thead>
          <tbody>
            {#each submissions as row}
              <tr class="border-t border-zinc-200 align-top">
                <td class="px-3 py-2 whitespace-nowrap">{formatDate(row.createdAt)}</td>
                <td class="px-3 py-2 whitespace-nowrap">{row.roundId}</td>
                <td class="px-3 py-2 whitespace-nowrap">{row.username ? `@${row.username}` : row.sessionId.slice(0, 8)}</td>
                <td class="px-3 py-2">{row.inputText}</td>
                <td class="px-3 py-2 whitespace-nowrap">{row.intentKind}</td>
                <td class="px-3 py-2 whitespace-nowrap">{row.expectedIntentKind}</td>
                <td class="px-3 py-2 whitespace-nowrap">{row.resolvedKind}</td>
                <td class="px-3 py-2">
                  {#if row.reviewFlags.length === 0}
                    <span class="text-zinc-400">—</span>
                  {:else}
                    <span class={row.likelyMismatch ? 'text-red-600 font-semibold' : 'text-zinc-600'}>{row.reviewFlags.join(', ')}</span>
                  {/if}
                </td>
                <td class="px-3 py-2">
                  {#if row.resolvedKind === 'guess'}
                    {row.guessCorrect === true ? 'Rétt gisk' : 'Rangt gisk'}
                    {#if row.normalizedGuessText}
                      <span class="text-zinc-500"> — {row.normalizedGuessText}</span>
                    {/if}
                  {:else}
                    {row.answerLabel ?? ''} {row.answerTextIs ?? ''}
                  {/if}
                </td>
                <td class="px-3 py-2 whitespace-nowrap">{row.questionCount}/{row.remaining}</td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    {/if}
  </section>
</main>
