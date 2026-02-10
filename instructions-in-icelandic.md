Hver er maðurinn?
* vefsíðan á íslensku, kóði og annað á ensku
* nýr maður á hverjum degi klukkan 12:00, lokar aftur 17:00 og þá er maðurinn birtur og niðurtalning í næsta..
* Má vera allskonar, fólk, karakterar úr íslenskri menningu, frægt fólk...
* Typeform inspired ui
* Nota agent fyrir hvern client, til dæmis gemini-3-flash-preview eða kimi k2.5 eða öðru módeli sem er hratt og skilur íslensku
* Þurfum einhvern einfaldan server, gagnagrunn eða worker, t.d. á cloudflare eða svipað sem heldur utan um hver var fyrstu að svara og velur eða útvegar nýjan mann hvern dag. Þessu verður að vera hægt að breyta eða skoða auðveldlega, til dæmis á cloudflare dashboard
* Max 20 spurningar, ein spurning í einu 
    * Stutt svör til baka, oftast já og nei nema til álita kemur 
* Markmið að fatta sem fyrst 
* Getur deilt þínu scori með heiminum 
* Leaderboard, fæst gisk, tími frá hvenær þú byrjar, tími frá opnaði fyrir gisk
* Ef þú giskar rétt færðu upp mynd af manninum og tækifæri til að deila á socials þínum stats
* Mátt biðja einu sinni um vísbendingu
* Ekkert login. Upplýsingar geymdar per tæki 
* Nota Svelte og SvelteKit. Tailwind. https://svelte.dev/packages https://svelte.dev/docs/kit/remote-functions https://svelte.dev/docs/kit/state-management https://svelte.dev/docs/kit/adapter-cloudflare-workers
