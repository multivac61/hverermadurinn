<script lang="ts">
  import '../app.css';

  let { data, children } = $props();
</script>

<svelte:head>
  <title>{data.seo.siteName}</title>
  <meta name="description" content={data.seo.description} />
  <link rel="canonical" href={data.seo.pageUrl} />

  <meta property="og:type" content="website" />
  <meta property="og:site_name" content={data.seo.siteName} />
  <meta property="og:title" content={data.seo.siteName} />
  <meta property="og:description" content={data.seo.description} />
  <meta property="og:url" content={data.seo.pageUrl} />
  <meta property="og:image" content={data.seo.ogImage} />
  <meta property="og:image:width" content="1200" />
  <meta property="og:image:height" content="630" />

  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:title" content={data.seo.siteName} />
  <meta name="twitter:description" content={data.seo.description} />
  <meta name="twitter:image" content={data.seo.ogImage} />
</svelte:head>

{@render children()}
