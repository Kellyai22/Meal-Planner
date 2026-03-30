export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const apifyToken = process.env.APIFY_API_TOKEN;
  if (!apifyToken) return res.status(500).json({ error: 'Apify token not configured' });

  const { url } = req.body;
  if (!url) return res.status(400).json({ error: 'URL required' });

  try {
    const lUrl = url.toLowerCase();
    let actorId = 'apify~facebook-posts-scraper';
    let input = { startUrls: [url], resultsLimit: 1 };

    if (lUrl.includes('instagram.com') || lUrl.includes('instagr.am')) {
      actorId = 'apify~instagram-post-scraper';
      input = { username: [url], resultsLimit: 1 };
    } else if (lUrl.includes('tiktok.com') || lUrl.includes('vm.tiktok')) {
      actorId = 'clockworks~tiktok-scraper';
      input = { postURLs: [url], shouldDownloadVideos: false, downloadSubtitlesOptions: 'TRANSCRIBE_ALL_VIDEOS' };
    }

    // Start the Apify actor run (don't wait for it to finish)
    const runRes = await fetch(
      `https://api.apify.com/v2/acts/${actorId}/runs?token=${apifyToken}`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) }
    );

    if (!runRes.ok) {
      const err = await runRes.json().catch(() => ({}));
      throw new Error(err.error?.message || 'Apify run failed to start');
    }

    const runData = await runRes.json();
    const runId = runData.data?.id;
    const datasetId = runData.data?.defaultDatasetId;

    if (!runId) throw new Error('No run ID returned');

    return res.status(200).json({ runId, datasetId });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
